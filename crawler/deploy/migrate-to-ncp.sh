#!/bin/bash
# =============================================================================
# OPC → NCP 마이그레이션 스크립트
# 로컬 맥에서 실행합니다.
#
# 사전 조건:
#   1. NCP에 Ubuntu 22.04 서버 생성 + 공인 IP 할당
#   2. SSH 키 생성: ssh-keygen -t ed25519 -f ~/.ssh/ncp_key
#   3. ~/.ssh/config에 NCP 호스트 IP 설정
#   4. root 비밀번호로 첫 접속하여 유저 생성:
#      ssh root@<NCP_IP>
#      > adduser crawler
#      > usermod -aG sudo crawler
#      > mkdir -p /home/crawler/.ssh
#      > cat >> /home/crawler/.ssh/authorized_keys  (로컬의 ~/.ssh/ncp_key.pub 내용 붙여넣기)
#      > chown -R crawler:crawler /home/crawler/.ssh
#      > chmod 700 /home/crawler/.ssh && chmod 600 /home/crawler/.ssh/authorized_keys
#
# 사용법:
#   bash crawler/deploy/migrate-to-ncp.sh
# =============================================================================
set -euo pipefail

NCP_HOST="ncp"  # ~/.ssh/config의 Host명
PROJECT_DIR="$HOME/Desktop/auction-project"

echo "=========================================="
echo "  OPC → NCP Migration"
echo "=========================================="

# --- 1. SSH 연결 확인 ---
echo "[1/5] Testing SSH connection to NCP..."
if ! ssh -o ConnectTimeout=5 "$NCP_HOST" "echo 'SSH OK'" 2>/dev/null; then
    echo "❌ SSH 연결 실패. ~/.ssh/config에 NCP IP가 설정되었는지 확인하세요."
    echo "   현재 설정:"
    grep -A 4 "Host ncp" ~/.ssh/config
    exit 1
fi
echo "✅ SSH connection OK"

# --- 2. 셋업 스크립트 전송 & 실행 ---
echo "[2/5] Uploading and running setup script..."
scp "$PROJECT_DIR/crawler/deploy/setup-ncp.sh" "$NCP_HOST:~/setup-ncp.sh"
ssh "$NCP_HOST" "bash ~/setup-ncp.sh"

# --- 3. .env 파일 전송 (API 키 포함) ---
echo "[3/5] Uploading .env with API keys..."
ENV_FILE="$PROJECT_DIR/crawler/.env"

# Fly.io 토큰 가져오기
FLY_TOKEN=$(cd "$PROJECT_DIR/web" && fly auth token 2>/dev/null || echo "")

# PRECOMPUTE_SECRET 가져오기
PRECOMPUTE_SECRET=$(cd "$PROJECT_DIR/web" && fly secrets list -a applemango 2>/dev/null | grep PRECOMPUTE_SECRET | awk '{print $1}' || echo "")

# .env 생성 (로컬 .env 기반 + 추가 변수)
ssh "$NCP_HOST" "cat > /home/crawler/auction-project/crawler/.env" << ENVEOF
# === Crawler Settings ===
VWORLD_API_KEY=REDACTED_VWORLD_KEY
SKIP_VWORLD_API=false
PAGE_SIZE=40
BATCH_SIZE=50
REQUEST_DELAY=1.5
CONCURRENCY_LIMIT=1
MAX_RETRIES=3

# === AI ===
AI_PROVIDER=gemini
AI_API_KEY=REDACTED_GEMINI_KEY
AI_MODEL=gemini-3-flash-preview

# === Council Minutes ===
COUNCIL_API_KEY=REDACTED_COUNCIL_KEY
COUNCIL_API_BASE_URL=https://clik.nanet.go.kr/openapi/minutes.do

# === Fly.io ===
FLY_API_TOKEN=${FLY_TOKEN}
PRECOMPUTE_SECRET=

# === Paths ===
DATABASE_DIR=/home/crawler/auction-project/crawler/output
ENVEOF

echo "✅ .env uploaded"
echo ""
echo "⚠️  PRECOMPUTE_SECRET은 수동으로 설정해야 합니다:"
echo "   ssh ncp 'nano /home/crawler/auction-project/crawler/.env'"
echo ""

# --- 4. NCP 공인 IP 확인 ---
echo "[4/5] Checking NCP public IP..."
NCP_IP=$(ssh "$NCP_HOST" "curl -s ifconfig.me")
echo "✅ NCP Public IP: $NCP_IP"
echo ""
echo "이 IP를 다음 서비스에 화이트리스트 등록하세요:"
echo "  - 토지이음 (EUM API): $NCP_IP"
echo "  - VWorld API (필요 시): $NCP_IP"

# --- 5. 테스트 실행 ---
echo "[5/5] Running test crawl..."
echo ""
echo "수동 테스트를 실행하려면:"
echo "  ssh ncp"
echo "  cd ~/auction-project/crawler"
echo "  source .venv/bin/activate"
echo "  python -m src.main"
echo ""

echo "=========================================="
echo "  Migration Complete!"
echo "=========================================="
echo ""
echo "NCP Public IP: $NCP_IP"
echo ""
echo "남은 작업:"
echo "  1. ssh ncp 'nano ~/auction-project/crawler/.env' → PRECOMPUTE_SECRET 설정"
echo "  2. 토지이음에 IP 화이트리스트 요청: $NCP_IP"
echo "  3. 수동 테스트 크롤링 실행"
echo "  4. 성공 확인 후 OPC 크론 비활성화"
echo "  5. ~/.ssh/config에서 ncp HostName 확인"
echo ""
