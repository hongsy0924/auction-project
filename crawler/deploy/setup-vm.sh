#!/bin/bash
# =============================================================================
# Oracle Cloud VM 초기 환경 구성 스크립트
# OS: Oracle Linux 9 (x86_64), VM.Standard.E2.1.Micro (1 OCPU, 1GB RAM)
#
# 사용법:
#   1. VM에 SSH 접속: ssh opc@<PUBLIC_IP>
#   2. 이 스크립트를 VM에 복사하거나 직접 실행:
#      curl -sL <raw_url> | bash
#   또는 로컬에서: scp setup-vm.sh opc@<IP>:~ && ssh opc@<IP> 'bash setup-vm.sh'
# =============================================================================
set -euo pipefail

echo "=========================================="
echo "  Auction Crawler VM Setup"
echo "=========================================="

# --- 1. 스왑 메모리 설정 (1GB RAM이라 2GB 스왑 필수) ---
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

# --- 2. 시스템 패키지 업데이트 ---
echo "[2/7] Updating system packages..."
sudo dnf update -y -q
sudo dnf install -y -q git python3.11 python3.11-pip python3.11-devel \
    gcc gcc-c++ make wget curl unzip \
    libX11 libXcomposite libXdamage libXrandr libXtst \
    cups-libs dbus-glib atk at-spi2-atk gtk3 \
    alsa-lib nss nspr libdrm mesa-libgbm \
    xorg-x11-fonts-Type1 xorg-x11-fonts-75dpi

# --- 3. Python 가상환경 + 크롤러 설치 ---
echo "[3/7] Cloning project and setting up Python environment..."
APP_DIR="/home/opc/auction-project"
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
    echo 'export FLYCTL_INSTALL="/home/opc/.fly"' >> ~/.bashrc
    echo 'export PATH="$FLYCTL_INSTALL/bin:$PATH"' >> ~/.bashrc
    export FLYCTL_INSTALL="/home/opc/.fly"
    export PATH="$FLYCTL_INSTALL/bin:$PATH"
else
    echo "flyctl already installed."
fi

# --- 6. 환경변수 설정 (.env 파일) ---
echo "[6/7] Setting up environment variables..."
ENV_FILE="$APP_DIR/crawler/.env"
if [ ! -f "$ENV_FILE" ]; then
    cat > "$ENV_FILE" << 'ENVEOF'
# === Crawler Settings ===
VWORLD_API_KEY=your-vworld-api-key-here
SKIP_VWORLD_API=false
PAGE_SIZE=40
BATCH_SIZE=50
REQUEST_DELAY=1.5
CONCURRENCY_LIMIT=1
MAX_RETRIES=3

# === Fly.io ===
FLY_API_TOKEN=your-fly-api-token-here

# === Paths ===
DATABASE_DIR=/home/opc/auction-project/crawler/output
ENVEOF
    echo ""
    echo "⚠️  중요: $ENV_FILE 파일을 편집하여 아래 값을 설정하세요:"
    echo "   - VWORLD_API_KEY: VWorld API 키"
    echo "   - FLY_API_TOKEN: Fly.io API 토큰 (로컬에서 'flyctl auth token' 으로 확인)"
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
    (crontab -l 2>/dev/null; echo "0 20 * * * $CRON_SCRIPT >> /home/opc/crawler.log 2>&1") | crontab -
    echo "Cron job registered: daily at 05:00 KST"
fi

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
echo ""
