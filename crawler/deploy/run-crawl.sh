#!/bin/bash
# =============================================================================
# 경매 크롤링 자동 실행 스크립트
# crontab에 의해 매일 오전 5시 KST에 실행됩니다.
#
# 순서:
#   1. 최신 코드 pull
#   2. 크롤링 실행 (python -m src.main)
#   3. SQLite 정리  (python sqlite_cleaning.py)
#   4. DB 파일을 Fly.io 웹 앱으로 전송 (flyctl sftp)
#   4.5. 지역 시그널 인덱싱 (index_region_signals.py)
#   4.6. minutes_cache.db를 Fly.io로 전송
#   5. 시그널 사전 계산 트리거 (curl → Fly.io API)
# =============================================================================
set -euo pipefail

# --- 경로 설정 (자동 감지: opc 또는 crawler 유저) ---
if [ -d "/home/crawler/auction-project" ]; then
    DEPLOY_USER="crawler"
elif [ -d "/home/opc/auction-project" ]; then
    DEPLOY_USER="opc"
else
    DEPLOY_USER="${DEPLOY_USER:-$(whoami)}"
fi

APP_DIR="/home/$DEPLOY_USER/auction-project"
CRAWLER_DIR="$APP_DIR/crawler"
VENV="$CRAWLER_DIR/.venv/bin/activate"
OUTPUT_DB="$CRAWLER_DIR/output/auction_data.db"

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"
}

fail() {
    log "ERROR: $*"
    exit 1
}

file_signature() {
    if [ -f "$1" ]; then
        stat -c '%Y:%s' "$1"
    else
        echo ""
    fi
}

require_db_table_rows() {
    local db_path="$1"
    local table_name="$2"

    python - "$db_path" "$table_name" <<'PY'
import sqlite3
import sys

db_path, table_name = sys.argv[1], sys.argv[2]
conn = sqlite3.connect(db_path)
try:
    row = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name = ?",
        (table_name,),
    ).fetchone()
    if row is None:
        raise SystemExit(f"missing table: {table_name}")

    count = conn.execute(f'SELECT COUNT(*) FROM "{table_name}"').fetchone()[0]
    if count <= 0:
        raise SystemExit(f"empty table: {table_name}")

    print(count)
finally:
    conn.close()
PY
}

# Fly.io CLI 경로
export FLYCTL_INSTALL="/home/$DEPLOY_USER/.fly"
export PATH="$FLYCTL_INSTALL/bin:$PATH"

# --- 환경 변수 로드 ---
if [ -f "$CRAWLER_DIR/.env" ]; then
    set -a
    source "$CRAWLER_DIR/.env"
    set +a
fi

log "=== 크롤링 시작 ==="

# --- 1. 최신 코드 pull ---
log "[1/7] Pulling latest code..."
cd "$APP_DIR"
git pull origin main --ff-only 2>/dev/null || log "Git pull skipped (not on main or conflicts)"

# --- 2. 크롤링 실행 ---
log "[2/7] Running crawler..."
cd "$CRAWLER_DIR"
source "$VENV"

# output 디렉토리 생성
mkdir -p "$CRAWLER_DIR/output"

# DATABASE_DIR을 로컬 output으로 설정
export DATABASE_DIR="$CRAWLER_DIR/output"

OLD_DB_SIGNATURE="$(file_signature "$OUTPUT_DB")"
python -m src.main
log "Crawling complete."

NEW_DB_SIGNATURE="$(file_signature "$OUTPUT_DB")"
if [ -z "$NEW_DB_SIGNATURE" ]; then
    fail "Crawler did not create $OUTPUT_DB"
fi
if [ "$NEW_DB_SIGNATURE" = "$OLD_DB_SIGNATURE" ]; then
    fail "Crawler did not update $OUTPUT_DB; refusing to upload stale DB"
fi
RAW_COUNT="$(require_db_table_rows "$OUTPUT_DB" "auction_list")"
log "Raw DB validated: auction_list rows=$RAW_COUNT"

# --- 3. SQLite 정리 ---
log "[3/7] Cleaning SQLite database..."
python sqlite_cleaning.py "$OUTPUT_DB"
CLEAN_COUNT="$(require_db_table_rows "$OUTPUT_DB" "auction_list_cleaned")"
log "SQLite cleaning complete. auction_list_cleaned rows=$CLEAN_COUNT"

# --- 4. Fly.io로 DB 전송 ---
log "[4/7] Transferring DB to Fly.io..."
FLY_APP="applemango"

if command -v flyctl &> /dev/null && [ -n "${FLY_API_TOKEN:-}" ]; then
    export FLY_ACCESS_TOKEN="$FLY_API_TOKEN"
    
    # Fly.io 앱이 stopped 상태일 수 있으므로 먼저 시작
    FLY_MACHINE_ID="d89954db022e78"
    flyctl machines start "$FLY_MACHINE_ID" -a "$FLY_APP" 2>/dev/null || true
    sleep 15

    # Upload to a temporary path first, then atomically replace the live DB.
    flyctl ssh console -a "$FLY_APP" -C "rm -f /data/auction_data.db.tmp" 2>/dev/null || true
    flyctl ssh sftp shell -a "$FLY_APP" <<SFTP
put $OUTPUT_DB /data/auction_data.db.tmp
SFTP

    # sftp creates files as root:644 — make writable so Next.js can update scores/cache
    flyctl ssh console -a "$FLY_APP" -C "chmod 666 /data/auction_data.db.tmp && mv /data/auction_data.db.tmp /data/auction_data.db" 2>/dev/null || fail "Remote DB swap failed"

    log "DB transfer to Fly.io complete."
else
    log "flyctl not found or FLY_API_TOKEN not set. Skipping transfer."
    log "DB saved locally at: $OUTPUT_DB"
fi

# --- 4.5 지역 시그널 인덱싱 ---
log "[5/7] Indexing region signals..."
cd "$CRAWLER_DIR"
export MINUTES_CACHE_PATH="$CRAWLER_DIR/output/minutes_cache.db"
INDEX_SUCCESS=0
if python scripts/index_region_signals.py --db-path "$OUTPUT_DB" --cache-path "$MINUTES_CACHE_PATH"; then
    INDEX_SUCCESS=1
    log "Region signal indexing complete."
else
    log "Warning: region signal indexing failed"
fi

# --- 4.6 minutes_cache.db 전송 ---
log "[6/7] Transferring minutes_cache.db to Fly.io..."
CACHE_DB="$CRAWLER_DIR/output/minutes_cache.db"
if [ "$INDEX_SUCCESS" -eq 1 ] && [ -s "$CACHE_DB" ] && command -v flyctl &> /dev/null && [ -n "${FLY_API_TOKEN:-}" ]; then
    flyctl ssh console -a "$FLY_APP" -C "rm -f /data/minutes_cache.db.tmp" 2>/dev/null || true
    flyctl ssh sftp shell -a "$FLY_APP" <<SFTP
put $CACHE_DB /data/minutes_cache.db.tmp
SFTP

    flyctl ssh console -a "$FLY_APP" -C "chmod 666 /data/minutes_cache.db.tmp && mv /data/minutes_cache.db.tmp /data/minutes_cache.db" 2>/dev/null || fail "Remote minutes cache swap failed"

    log "minutes_cache.db transfer complete."
else
    log "Skipping minutes_cache.db transfer."
fi

# --- 5. 시그널 사전 계산 트리거 ---
log "[7/7] Triggering signal pre-computation..."
if [ -n "${PRECOMPUTE_SECRET:-}" ]; then
    sleep 10  # 앱이 새 DB를 인식할 시간
    curl -s -X POST "https://applemango.fly.dev/api/signal-top/precompute" \
        -H "Authorization: Bearer $PRECOMPUTE_SECRET" \
        --max-time 30 || log "Warning: precompute trigger failed"
    log "Signal pre-computation triggered."
else
    log "PRECOMPUTE_SECRET not set. Skipping signal pre-computation."
fi

log "=== 크롤링 완료 ==="
