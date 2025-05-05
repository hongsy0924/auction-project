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
├── excel_to_sqlite.py       # 엑셀→DB 변환 스크립트
├── dump.py                  # DB 덤프 스크립트
├── console.py               # 콘솔 유틸리티
├── requirements.txt         # 의존성 패키지 목록
├── output/                  # 결과 파일 저장 디렉토리
├── cache/                   # 캐시 파일 저장 디렉토리
├── logs/                    # 로그 파일 저장 디렉토리
├── database/                # DB 파일 저장 디렉토리
├── chromedriver/            # 크롬 브라우저 및 드라이버 디렉토리
└── ...
```

## 주요 모듈/스크립트 설명

### 1. config.py
- 프로젝트의 모든 설정을 관리하는 모듈입니다.
- API, 크롤링, 브라우저, 파일 관련 설정 포함

### 2. court_auction_crawler.py
- 법원 경매 사이트에서 데이터를 크롤링하는 메인 모듈입니다.
- **주요 클래스:** `CourtAuctionCrawler`
  - `__init__()`: 크롤러 초기화
  - `setup_driver()`: Chrome WebDriver 설정
  - `_setup_cookies()`: 쿠키 설정
  - `wait_and_click(by, value, timeout)`: 요소 클릭 대기 및 실행
  - `get_auction_list(page, session)`: 경매 목록 조회 (비동기)
  - `save_to_excel(data)`: 데이터를 Excel 파일로 저장 (비동기)
  - `main()`: 전체 크롤링 실행 (비동기)

### 3. pnu_generator.py
- PNU(필지고유번호) 생성 및 토지이용정보 조회 모듈입니다.
- **주요 클래스:** `PNUGenerator`
  - `__init__()`: PNU 생성기 초기화
  - `create_pnu(daepyoSidoCd, daepyoSiguCd, daepyoDongCd, daepyoRdCd, daepyoLotno)`: PNU 생성
  - `get_land_use_info(pnu, session)`: 토지이용정보 조회 (비동기)
- **주요 함수:**
  - `process_batch(generator, df, start_idx, batch_size)`: 배치 단위로 PNU 처리 (비동기)

### 4. utils.py
- 프로젝트 전반에서 사용되는 유틸리티 모듈입니다.
- **Cache 클래스**: 캐시 관리
  - `__init__()`, `get(key)`, `set(key, value, expiry_days)`, `_cleanup_old_cache()`
- **Logger 클래스**: 로깅
  - `__init__(name)`, `info(message)`, `error(message)`, `warning(message)`, `debug(message)`
- **함수**
  - `retry_with_backoff(...)`: 지수 백오프 재시도 데코레이터

### 5. 기타 스크립트
- `sqlite_cleaning.py`: DB 정리 및 관리
- `excel_to_sqlite.py`: 엑셀 파일을 SQLite DB로 변환
- `dump.py`: DB 덤프
- `console.py`: 콘솔 유틸리티

## 설치 및 실행 방법

1. **필수 패키지 설치**

```bash
pip install -r requirements.txt
```

2. **Chrome WebDriver 및 브라우저 준비**
- `chromedriver/` 폴더에 크롬 브라우저와 드라이버가 포함되어 있습니다.
- 환경에 맞는 경로를 `config.py`에서 지정하거나, 직접 설치 후 경로를 지정하세요.

3. **설정 파일 수정**
- `config.py`에서 API 키 등 필요한 설정값을 수정하세요.

4. **크롤러 실행**

```bash
python court_auction_crawler.py
```

5. **데이터베이스/엑셀 변환 및 관리**
- 엑셀→DB 변환: `python excel_to_sqlite.py`
- DB 정리: `python sqlite_cleaning.py`
- DB 덤프: `python dump.py`

## 출력 파일

- `output/auction_list_YYYYMMDD_HHMMSS.xlsx`: 성공적으로 처리된 경매 목록
- `output/failed_cases_YYYYMMDD_HHMMSS.xlsx`: 처리 실패한 케이스 목록

## 로그 파일

- `logs/court_auction_crawler_YYYYMMDD.log`: 일별 로그 파일

## 캐시

- `cache/`: API 응답 캐시 파일 저장
- 캐시는 설정된 기간(기본 7일) 후 자동 삭제

## 데이터베이스

- `database/auction_data.db`: 경매 데이터 저장용 SQLite DB

## 주의사항

1. API 호출 제한에 주의
2. 적절한 대기 시간 설정 필요
3. Chrome WebDriver 및 브라우저 버전 확인
4. 필요한 디렉토리 권한 설정

## 라이선스

이 프로젝트는 MIT 라이선스를 따릅니다. 