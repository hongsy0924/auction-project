import os
from typing import Any

from dotenv import load_dotenv

# .env 파일 로드
load_dotenv()

# API 설정
API_CONFIG: dict[str, Any] = {
    'base_url': "https://www.courtauction.go.kr/pgj/index.on?w2xPath=/pgj/ui/pgj100/PGJ151F00.xml",
    'api_url': "https://www.courtauction.go.kr/pgj/pgjsearch/searchControllerMain.on",
    'vworld_url': "https://api.vworld.kr/ned/data/getLandUseAttr",
    'vworld_api_key': os.getenv('VWORLD_API_KEY', '')
}

# 크롤링 설정
CRAWLING_CONFIG: dict[str, Any] = {
    'page_size': int(os.getenv('PAGE_SIZE', '40')),
    'batch_size': int(os.getenv('BATCH_SIZE', '50')),
    'request_delay': float(os.getenv('REQUEST_DELAY', '1.5')),  # 각 요청 사이 딜레이 (초) - 1.5초로 증가
    'concurrency_limit': int(os.getenv('CONCURRENCY_LIMIT', '1')),  # 동시 요청 수를 1로 줄임 (순차 처리)
    'batch_delay': float(os.getenv('BATCH_DELAY', '3')),  # 배치 사이 딜레이 (초) - 3초로 증가
    'max_retries': int(os.getenv('MAX_RETRIES', '3')),
    'retry_delay': float(os.getenv('RETRY_DELAY', '10')),  # 재시도 시 더 긴 딜레이 - 10초로 증가
    'blocked_wait_time': float(os.getenv('BLOCKED_WAIT_TIME', '120'))  # 차단 감지 시 대기 시간 (초) - 120초로 증가
}

# 브라우저 설정
BROWSER_CONFIG: dict[str, Any] = {
    'headless': os.getenv('HEADLESS', 'true').lower() == 'true',
    'window_size': (1920, 1080),
    'timeout': int(os.getenv('TIMEOUT', '30'))
}

# 파일 설정
FILE_CONFIG: dict[str, Any] = {
    'output_dir': os.getenv('OUTPUT_DIR', 'output'),
    'cache_dir': 'auction-database/cache',
    'log_dir': 'logs',
    'database_dir': os.getenv('DATABASE_DIR', '../auction-viewer/database'),
    'timestamp_format': os.getenv('TIMESTAMP_FORMAT', '%Y%m%d_%H%M%S')
}

# 로깅 설정
LOGGING_CONFIG: dict[str, Any] = {
    'level': 'INFO',
    'format': '%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    'date_format': '%Y-%m-%d %H:%M:%S'
}

# 캐시 설정
CACHE_CONFIG: dict[str, Any] = {
    'enabled': True,
    'expiry_days': 7,
    'max_size': 1000  # 최대 캐시 항목 수
}

# 디렉토리 생성
for directory in [FILE_CONFIG['output_dir'], FILE_CONFIG['cache_dir'], FILE_CONFIG['log_dir']]:
    os.makedirs(directory, exist_ok=True)
