# Auction Project

경매 정보 크롤링 및 웹 애플리케이션

## 🚀 빠른 시작

### 로컬 크롤링 및 배포

```bash
# 전체 프로세스 실행 (크롤링 → 정리 → 커밋 → 배포)
./run-crawler.sh
```

### 수동 실행

```bash
# 1. 크롤러 실행
cd auction-crawler
python court_auction_crawler.py

# 2. SQLite 정리
python sqlite_cleaning.py

# 3. 변경사항 커밋
cd ..
git add auction-viewer/database/
git commit -m "Update auction data"
git push origin main

# 4. Fly.io 배포
cd auction-viewer
flyctl deploy --remote-only
```

## 📁 프로젝트 구조

```
auction-project/
├── auction-crawler/          # Python 크롤러
│   ├── court_auction_crawler.py
│   ├── pnu_generator.py
│   ├── sqlite_cleaning.py
│   └── requirements.txt
├── auction-viewer/           # Next.js 웹 애플리케이션
│   ├── src/
│   ├── public/
│   └── fly.toml
└── run-crawler.sh           # 자동화 스크립트
```

## 🔧 설정

### 환경 변수

`.env` 파일을 생성하고 다음 변수들을 설정하세요:

```env
VWORLD_API_KEY=your_vworld_api_key_here
```

### Fly.io 배포

1. Fly.io CLI 설치
2. `auction-viewer` 디렉토리에서 `flyctl launch` 실행
3. `flyctl deploy`로 배포

## 📊 데이터베이스

- SQLite 데이터베이스: `auction-viewer/database/auction_data.db`
- 크롤링된 경매 데이터와 토지이용정보 포함

## 🔄 자동화

GitHub Actions는 VWorld API 제한으로 인해 비활성화되어 있습니다.
로컬에서 `./run-crawler.sh` 스크립트를 사용하여 수동으로 실행하세요.

## 프로젝트 구조

```
auction-project/
├── auction-crawler/          # 크롤링 스크립트
├── auction-viewer/          # Next.js 웹 애플리케이션
└── .github/workflows/       # GitHub Actions 자동화
```

## 자동화 설정

### GitHub Actions 자동화

이 프로젝트는 GitHub Actions를 통해 자동으로 실행됩니다:

1. **매일 오전 2시 자동 실행**
2. **수동 실행 가능** (GitHub Actions 탭에서 "Run workflow" 버튼)

### 실행 순서

1. **크롤링**: `court_auction_crawler.py` 실행
2. **DB 정리**: `sqlite_cleaning.py` 실행
3. **자동 커밋**: 변경된 DB 파일들을 Git에 커밋
4. **Fly.io 배포**: 웹 애플리케이션 자동 배포

### 필요한 GitHub Secrets

GitHub 리포지토리 설정에서 다음 Secrets를 등록해야 합니다:

- `VWORLD_API_KEY`: VWorld API 키
- `FLY_API_TOKEN`: Fly.io API 토큰

### Fly.io API 토큰 생성

```bash
flyctl auth token
```

## 로컬 개발

### 크롤러 실행

```bash
cd auction-crawler
pip install -r requirements.txt
python court_auction_crawler.py
python sqlite_cleaning.py
```

### 웹 애플리케이션 실행

```bash
cd auction-viewer
npm install
npm run dev
```

## 배포

웹 애플리케이션은 Fly.io에 자동 배포됩니다:

```bash
cd auction-viewer
flyctl deploy
```

