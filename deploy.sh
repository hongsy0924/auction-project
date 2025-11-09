#!/bin/bash

echo "🚀 경매 데이터 배포 시작 (크롤링 제외)..."

# 현재 디렉토리 확인
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
echo "📁 스크립트 디렉토리: $SCRIPT_DIR"

# 가상환경의 Python 직접 사용 (절대 경로)
PYTHON_PATH="$SCRIPT_DIR/.venv/bin/python"

# Python 경로 확인
echo "🔍 Python 경로 확인 중..."
echo "Python 경로: $PYTHON_PATH"
$PYTHON_PATH --version

# 1. SQLite 정리
echo "🗄️ SQLite 데이터 정리 중..."
cd "$SCRIPT_DIR/auction-crawler"
$PYTHON_PATH sqlite_cleaning.py

if [ $? -eq 0 ]; then
    echo "✅ SQLite 정리 완료!"
else
    echo "❌ SQLite 정리 실패!"
    exit 1
fi

cd "$SCRIPT_DIR"

# 2. 변경사항 커밋
echo "📝 변경사항 커밋 중..."
git add auction-viewer/database/
git commit -m "Deploy auction data $(date +'%Y-%m-%d %H:%M:%S')"
git push origin main

if [ $? -eq 0 ]; then
    echo "✅ 커밋 완료!"
else
    echo "❌ 커밋 실패!"
    exit 1
fi

# 3. Fly.io 배포
echo "🚀 Fly.io 배포 중..."
cd "$SCRIPT_DIR/auction-viewer"
flyctl deploy --remote-only

if [ $? -eq 0 ]; then
    echo "✅ 배포 완료!"
else
    echo "❌ 배포 실패!"
    exit 1
fi

echo "🎉 모든 작업이 완료되었습니다!"

