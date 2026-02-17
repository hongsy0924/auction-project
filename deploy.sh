#!/bin/bash

# deploy.sh
# Legacy script wrapper utilizing Makefile

echo "🚀 경매 데이터 배포 시작 (크롤링 제외)..."
echo "⚠️  This script is a wrapper around 'make'. Please consider using 'make deploy' directly."

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# 1. SQLite 정리
echo "🗄️ SQLite 데이터 정리 중..."
make db-clean
if [ $? -ne 0 ]; then
    echo "❌ SQLite 정리 실패!"
    exit 1
fi

# 2. 변경사항 커밋
echo "📝 변경사항 커밋 중..."
git add auction-viewer/database/
git commit -m "Deploy auction data $(date +'%Y-%m-%d %H:%M:%S')"
git push origin main

# 3. Fly.io 배포
echo "🚀 Fly.io 배포 중..."
cd auction-viewer
flyctl deploy --remote-only
