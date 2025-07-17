# Auction Project

경매 물건 정보를 크롤링하고 웹 애플리케이션으로 제공하는 프로젝트입니다.

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

