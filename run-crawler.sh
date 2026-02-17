#!/bin/bash

# run-crawler.sh
# Legacy script wrapper utilizing Makefile

echo "🚀 경매 크롤러 실행 및 배포 시작..."
echo "⚠️  This script is a wrapper around 'make'. Please consider using 'make crawl' and 'make deploy' directly."

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Define PROJECT_DIR for virtual environment pathing
PROJECT_DIR="$SCRIPT_DIR"

# 1. 크롤러 실행
echo "📊 경매 데이터 크롤링 중..."
make crawl
if [ -f "$PROJECT_DIR/.venv/bin/python3" ]; then
    PYTHON_CMD="$PROJECT_DIR/.venv/bin/python3"
fi
if [ $? -ne 0 ]; then
    echo "❌ 크롤링 실패!"
    exit 1
fi

# 2. SQLite 정리
echo "🗄️ SQLite 데이터 정리 중..."
make db-clean
if [ $? -ne 0 ]; then
    echo "❌ SQLite 정리 실패!"
    exit 1
fi

# 3. 변경사항 커밋
echo "📝 변경사항 커밋 중..."
git add auction-viewer/database/
git commit -m "Update auction data $(date +'%Y-%m-%d %H:%M:%S')"
git push origin main

# 4. Fly.io 배포
echo "🚀 Fly.io 배포 중..."
cd auction-viewer
flyctl deploy --remote-only