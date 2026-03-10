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

# --- 경로 설정 ---
APP_DIR="/home/opc/auction-project"
CRAWLER_DIR="$APP_DIR/crawler"
VENV="$CRAWLER_DIR/.venv/bin/activate"
OUTPUT_DB="$CRAWLER_DIR/output/auction_data.db"
LOG_PREFIX="[$(date '+%Y-%m-%d %H:%M:%S')]"

# Fly.io CLI 경로
export FLYCTL_INSTALL="/home/opc/.fly"
export PATH="$FLYCTL_INSTALL/bin:$PATH"

# --- 환경 변수 로드 ---
if [ -f "$CRAWLER_DIR/.env" ]; then
    set -a
    source "$CRAWLER_DIR/.env"
    set +a
fi

echo "$LOG_PREFIX === 크롤링 시작 ==="

# --- 1. 최신 코드 pull ---
echo "$LOG_PREFIX [1/7] Pulling latest code..."
cd "$APP_DIR"
git pull origin main --ff-only 2>/dev/null || echo "$LOG_PREFIX Git pull skipped (not on main or conflicts)"

# --- 2. 크롤링 실행 ---
echo "$LOG_PREFIX [2/7] Running crawler..."
cd "$CRAWLER_DIR"
source "$VENV"

# output 디렉토리 생성
mkdir -p "$CRAWLER_DIR/output"

# DATABASE_DIR을 로컬 output으로 설정
export DATABASE_DIR="$CRAWLER_DIR/output"

python -m src.main
echo "$LOG_PREFIX Crawling complete."

# --- 3. SQLite 정리 ---
echo "$LOG_PREFIX [3/7] Cleaning SQLite database..."
python sqlite_cleaning.py "$OUTPUT_DB"
echo "$LOG_PREFIX SQLite cleaning complete."

# --- 4. Fly.io로 DB 전송 ---
echo "$LOG_PREFIX [4/7] Transferring DB to Fly.io..."
FLY_APP="applemango"

if command -v flyctl &> /dev/null && [ -n "${FLY_API_TOKEN:-}" ]; then
    export FLY_ACCESS_TOKEN="$FLY_API_TOKEN"
    
    # Fly.io 앱이 stopped 상태일 수 있으므로 먼저 시작
    FLY_MACHINE_ID="d89954db022e78"
    flyctl machines start "$FLY_MACHINE_ID" -a "$FLY_APP" 2>/dev/null || true
    sleep 15
    
    # 기존 DB 삭제 (sftp put은 덮어쓰기 불가)
    flyctl ssh console -a "$FLY_APP" -C "rm -f /data/auction_data.db" 2>/dev/null || true
    
    # Fly.io 앱의 /data/ 디렉토리로 DB 파일 전송 (persistent volume)
    flyctl ssh sftp shell -a "$FLY_APP" <<SFTP
put $OUTPUT_DB /data/auction_data.db
SFTP
    
    echo "$LOG_PREFIX DB transfer to Fly.io complete."
else
    echo "$LOG_PREFIX ⚠️ flyctl not found or FLY_API_TOKEN not set. Skipping transfer."
    echo "$LOG_PREFIX DB saved locally at: $OUTPUT_DB"
fi

# --- 4.5 지역 시그널 인덱싱 ---
echo "$LOG_PREFIX [5/7] Indexing region signals..."
cd "$CRAWLER_DIR"
export MINUTES_CACHE_PATH="$CRAWLER_DIR/output/minutes_cache.db"
python scripts/index_region_signals.py --db-path "$OUTPUT_DB" --cache-path "$MINUTES_CACHE_PATH" || echo "$LOG_PREFIX Warning: region signal indexing failed"

# --- 4.6 minutes_cache.db 전송 ---
echo "$LOG_PREFIX [6/7] Transferring minutes_cache.db to Fly.io..."
CACHE_DB="$CRAWLER_DIR/output/minutes_cache.db"
if [ -f "$CACHE_DB" ] && command -v flyctl &> /dev/null && [ -n "${FLY_API_TOKEN:-}" ]; then
    flyctl ssh console -a "$FLY_APP" -C "rm -f /data/minutes_cache.db" 2>/dev/null || true
    flyctl ssh sftp shell -a "$FLY_APP" <<SFTP
put $CACHE_DB /data/minutes_cache.db
SFTP
    echo "$LOG_PREFIX minutes_cache.db transfer complete."
else
    echo "$LOG_PREFIX Skipping minutes_cache.db transfer."
fi

# --- 5. 시그널 사전 계산 트리거 ---
echo "$LOG_PREFIX [7/7] Triggering signal pre-computation..."
if [ -n "${PRECOMPUTE_SECRET:-}" ]; then
    sleep 10  # 앱이 새 DB를 인식할 시간
    curl -s -X POST "https://applemango.fly.dev/api/signal-top/precompute" \
        -H "Authorization: Bearer $PRECOMPUTE_SECRET" \
        --max-time 30 || echo "$LOG_PREFIX Warning: precompute trigger failed"
    echo "$LOG_PREFIX Signal pre-computation triggered."
else
    echo "$LOG_PREFIX PRECOMPUTE_SECRET not set. Skipping signal pre-computation."
fi

echo "$LOG_PREFIX === 크롤링 완료 ==="
