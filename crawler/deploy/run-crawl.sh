#!/bin/bash
# =============================================================================
# 경매 크롤링 자동 실행 스크립트
# crontab에 의해 매일 오전 5시 KST에 실행됩니다.
#
# 순서:
#   1. 크롤링 실행 (python -m src.main)
#   2. SQLite 정리  (python sqlite_cleaning.py)
#   3. DB 파일을 Fly.io 웹 앱으로 전송 (flyctl sftp)
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
echo "$LOG_PREFIX [1/4] Pulling latest code..."
cd "$APP_DIR"
git pull origin main --ff-only 2>/dev/null || echo "$LOG_PREFIX Git pull skipped (not on main or conflicts)"

# --- 2. 크롤링 실행 ---
echo "$LOG_PREFIX [2/4] Running crawler..."
cd "$CRAWLER_DIR"
source "$VENV"

# output 디렉토리 생성
mkdir -p "$CRAWLER_DIR/output"

# DATABASE_DIR을 로컬 output으로 설정
export DATABASE_DIR="$CRAWLER_DIR/output"

python -m src.main
echo "$LOG_PREFIX Crawling complete."

# --- 3. SQLite 정리 ---
echo "$LOG_PREFIX [3/4] Cleaning SQLite database..."
python sqlite_cleaning.py "$OUTPUT_DB"
echo "$LOG_PREFIX SQLite cleaning complete."

# --- 4. Fly.io로 DB 전송 ---
echo "$LOG_PREFIX [4/4] Transferring DB to Fly.io..."
FLY_APP="applemango"

if command -v flyctl &> /dev/null && [ -n "${FLY_API_TOKEN:-}" ]; then
    export FLY_ACCESS_TOKEN="$FLY_API_TOKEN"
    
    # Fly.io 앱이 stopped 상태일 수 있으므로 먼저 시작
    FLY_MACHINE_ID="d89954db022e78"
    flyctl machines start "$FLY_MACHINE_ID" -a "$FLY_APP" 2>/dev/null || true
    sleep 15
    
    # Fly.io 앱의 /data/ 디렉토리로 DB 파일 전송
    flyctl ssh sftp shell -a "$FLY_APP" <<SFTP
put $OUTPUT_DB /data/auction_data.db
SFTP
    
    echo "$LOG_PREFIX DB transfer to Fly.io complete."
else
    echo "$LOG_PREFIX ⚠️ flyctl not found or FLY_API_TOKEN not set. Skipping transfer."
    echo "$LOG_PREFIX DB saved locally at: $OUTPUT_DB"
fi

echo "$LOG_PREFIX === 크롤링 완료 ==="
