# 법원 경매 크롤러

법원 경매 사이트에서 토지 정보를 크롤링하고, PNU(필지고유번호)를 생성하여 토지이용정보를 조회하는 프로젝트입니다.

## 프로젝트 구조

```
.
├── config.py                # 설정 파일
├── court_auction_crawler.py # 경매 크롤러
├── pnu_generator.py         # PNU 생성기
├── utils.py                 # 유틸리티 모듈
├── sqlite_cleaning.py       # DB 정리 스크립트
└── requirements.txt         # 의존성 패키지 목록
 
```

## 주요 의존성 패키지

- requests
- beautifulsoup4
- pandas
- lxml
- selenium
- webdriver-manager
- python-dotenv
- openpyxl
- aiohttp
- tqdm

## 설치 및 실행 방법

1. **필수 패키지 설치**

```bash
pip install -r requirements.txt
```

2. **크롬 드라이버 준비**
- `chromedriver/` 폴더에 드라이버가 있거나, 직접 설치 후 `config.py`에서 경로를 지정하세요.

3. **설정 파일 수정**
- `config.py`에서 API 키 등 필요한 설정값을 수정하세요.

4. **크롤러 실행**

```bash
python court_auction_crawler.py
```

## 기타 유틸리티
- DB 정리: `python sqlite_cleaning.py`

## 출력/로그/캐시/DB
- `auction-database/output/`: 크롤링 결과 엑셀 파일
- `./logs/`: 일별 로그 파일
- `auction-database/cache/`: API 응답 캐시
- `auction-database/database/auction_data.db`: SQLite DB

## 주의사항
- API 호출 제한, 대기 시간, 크롬 드라이버 버전, 디렉토리 권한 등에 유의하세요.

## 라이선스

이 프로젝트는 MIT 라이선스를 따릅니다. 