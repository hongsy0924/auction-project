#!/bin/bash
# =============================================================================
# Naver Cloud Platform (NCP) Ubuntu VM 초기 환경 구성 스크립트
# OS: Ubuntu 22.04 LTS (x86_64)
# Recommended: Compact (2 vCPU, 4GB RAM)
#
# 사용법:
#   1. VM에 SSH 접속: ssh root@<PUBLIC_IP>
#   2. 유저 생성 후 이 스크립트 실행:
#      scp setup-ncp.sh crawler@<IP>:~ && ssh crawler@<IP> 'bash setup-ncp.sh'
# =============================================================================
set -euo pipefail

# --- 설정 ---
DEPLOY_USER="${DEPLOY_USER:-crawler}"
APP_DIR="/home/$DEPLOY_USER/auction-project"

echo "=========================================="
echo "  Auction Crawler NCP Setup (Ubuntu)"
echo "  User: $DEPLOY_USER"
echo "=========================================="

# --- 1. 스왑 메모리 설정 (4GB RAM이지만 Chromium이 무거움) ---
echo "[1/7] Setting up 2GB swap..."
if [ ! -f /swapfile ]; then
    sudo fallocate -l 2G /swapfile
    sudo chmod 600 /swapfile
    sudo mkswap /swapfile
    sudo swapon /swapfile
    echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
    echo "Swap created and enabled."
else
    echo "Swap already exists, skipping."
fi
free -m

# --- 2. 시스템 패키지 설치 (Ubuntu/apt) ---
echo "[2/7] Installing system packages..."
sudo apt update -qq
sudo apt upgrade -y -qq
sudo apt install -y -qq \
    git curl wget unzip \
    software-properties-common \
    build-essential \
    python3.11 python3.11-venv python3.11-dev \
    libgbm1 libnss3 libatk1.0-0 libatk-bridge2.0-0 \
    libcups2 libdrm2 libxkbcommon0 libxcomposite1 \
    libxdamage1 libxrandr2 libpango-1.0-0 libcairo2 \
    libasound2 libxshmfence1 libglu1-mesa \
    fonts-noto-cjk \
    cron

# Python 3.11이 없으면 deadsnakes PPA에서 설치
if ! command -v python3.11 &> /dev/null; then
    sudo add-apt-repository ppa:deadsnakes/ppa -y
    sudo apt install -y python3.11 python3.11-venv python3.11-dev
fi

# --- 3. 프로젝트 클론 + Python 환경 설정 ---
echo "[3/7] Cloning project and setting up Python environment..."
if [ ! -d "$APP_DIR" ]; then
    git clone https://github.com/hongsy0924/auction-project.git "$APP_DIR"
else
    echo "Project already cloned, pulling latest..."
    cd "$APP_DIR" && git pull origin main
fi

cd "$APP_DIR/crawler"
python3.11 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip -q
pip install -r requirements.txt -q
pip install -e . -q

# --- 4. Playwright + Chromium 설치 ---
echo "[4/7] Installing Playwright and Chromium..."
playwright install chromium
playwright install-deps chromium 2>/dev/null || true

# --- 5. Fly.io CLI 설치 ---
echo "[5/7] Installing Fly.io CLI..."
if ! command -v flyctl &> /dev/null; then
    curl -L https://fly.io/install.sh | sh
    FLYCTL_DIR="/home/$DEPLOY_USER/.fly"
    echo "export FLYCTL_INSTALL=\"$FLYCTL_DIR\"" >> "/home/$DEPLOY_USER/.bashrc"
    echo "export PATH=\"$FLYCTL_DIR/bin:\$PATH\"" >> "/home/$DEPLOY_USER/.bashrc"
    export FLYCTL_INSTALL="$FLYCTL_DIR"
    export PATH="$FLYCTL_DIR/bin:$PATH"
else
    echo "flyctl already installed."
fi

# --- 6. 환경변수 설정 (.env 파일) ---
echo "[6/7] Setting up environment variables..."
ENV_FILE="$APP_DIR/crawler/.env"
if [ ! -f "$ENV_FILE" ]; then
    cat > "$ENV_FILE" << ENVEOF
# === Crawler Settings ===
VWORLD_API_KEY=your-vworld-api-key-here
SKIP_VWORLD_API=false
PAGE_SIZE=40
BATCH_SIZE=50
REQUEST_DELAY=1.5
CONCURRENCY_LIMIT=1
MAX_RETRIES=3

# === AI ===
AI_PROVIDER=gemini
AI_API_KEY=your-gemini-key-here
AI_MODEL=gemini-3-flash-preview

# === Council Minutes ===
COUNCIL_API_KEY=your-council-api-key-here
COUNCIL_API_BASE_URL=https://clik.nanet.go.kr/openapi/minutes.do

# === Fly.io ===
FLY_API_TOKEN=your-fly-api-token-here
PRECOMPUTE_SECRET=your-precompute-secret-here

# === Paths ===
DATABASE_DIR=/home/$DEPLOY_USER/auction-project/crawler/output
ENVEOF
    echo ""
    echo "⚠️  중요: $ENV_FILE 파일을 편집하여 API 키를 설정하세요:"
    echo "   nano $ENV_FILE"
    echo ""
else
    echo ".env already exists, skipping."
fi

# --- 7. Cron 등록 ---
echo "[7/7] Setting up cron job..."
CRON_SCRIPT="$APP_DIR/crawler/deploy/run-crawl.sh"
chmod +x "$CRON_SCRIPT"

# 기존 cron에 이미 등록되어 있는지 확인
if crontab -l 2>/dev/null | grep -q "run-crawl.sh"; then
    echo "Cron job already registered."
else
    # 매일 오전 5시 KST (= UTC 20:00)
    (crontab -l 2>/dev/null; echo "0 20 * * * $CRON_SCRIPT >> /home/$DEPLOY_USER/crawler.log 2>&1") | crontab -
    echo "Cron job registered: daily at 05:00 KST"
fi

# --- cron 서비스 시작 ---
sudo systemctl enable cron
sudo systemctl start cron

echo ""
echo "=========================================="
echo "  Setup Complete!"
echo "=========================================="
echo ""
echo "다음 단계:"
echo "  1. .env 파일 편집: nano $ENV_FILE"
echo "  2. Fly.io 인증: flyctl auth login"
echo "  3. 수동 테스트: bash $CRON_SCRIPT"
echo "  4. 크론 확인: crontab -l"
echo "  5. 이 서버의 공인 IP를 토지이음(EUM)에 등록 요청"
echo ""
echo "서버 공인 IP 확인:"
curl -s ifconfig.me || echo "(확인 불가)"
echo ""
