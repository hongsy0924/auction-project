#!/bin/bash

echo "🚀 경매 크롤러 실행 및 배포 시작..."

# 1. 크롤러 실행
echo "📊 경매 데이터 크롤링 중..."
cd auction-crawler
python court_auction_crawler.py

if [ $? -eq 0 ]; then
    echo "✅ 크롤링 완료!"
else
    echo "❌ 크롤링 실패!"
    exit 1
fi

# 2. SQLite 정리
echo "🗄️ SQLite 데이터 정리 중..."
python sqlite_cleaning.py

if [ $? -eq 0 ]; then
    echo "✅ SQLite 정리 완료!"
else
    echo "❌ SQLite 정리 실패!"
    exit 1
fi

cd ..

# 3. 변경사항 커밋
echo "📝 변경사항 커밋 중..."
git add auction-viewer/database/
git commit -m "Update auction data $(date +'%Y-%m-%d %H:%M:%S')"
git push origin main

if [ $? -eq 0 ]; then
    echo "✅ 커밋 완료!"
else
    echo "❌ 커밋 실패!"
    exit 1
fi

# 4. Fly.io 배포
echo "🚀 Fly.io 배포 중..."
cd auction-viewer
flyctl deploy --remote-only

if [ $? -eq 0 ]; then
    echo "✅ 배포 완료!"
else
    echo "❌ 배포 실패!"
    exit 1
fi

echo "�� 모든 작업이 완료되었습니다!" 