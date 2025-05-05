import os
from typing import Dict, Any

# API 설정
API_CONFIG: Dict[str, Any] = {
    'base_url': "https://www.courtauction.go.kr/pgj/index.on?w2xPath=/pgj/ui/pgj100/PGJ151F00.xml",
    'api_url': "https://www.courtauction.go.kr/pgj/pgjsearch/searchControllerMain.on",
    'vworld_url': "https://api.vworld.kr/ned/data/getLandUseAttr",
    'vworld_api_key': "98CFE216-411C-3151-8C9A-5B3997CC4CCD"
}

# 크롤링 설정
CRAWLING_CONFIG: Dict[str, Any] = {
    'concurrent_pages': 10,  # 동시에 가져올 페이지 수
    'page_size': 40,  # 한 페이지당 항목 수
    'retry_delay': 5,  # 재시도 대기 시간 (초)
    'request_delay': 1,  # 요청 간 대기 시간 (초)
    'max_retries': 3,  # 최대 재시도 횟수
    'batch_size': 200  # PNU 처리 배치 크기
}

# 브라우저 설정
BROWSER_CONFIG: Dict[str, Any] = {
    'headless': True,
    'window_size': (1920, 1080),
    'timeout': 20  # 초
}

# 파일 설정
FILE_CONFIG: Dict[str, Any] = {
    'output_dir': 'output',
    'cache_dir': 'cache',
    'log_dir': 'logs',
    'timestamp_format': '%Y%m%d_%H%M%S'
}

# 로깅 설정
LOGGING_CONFIG: Dict[str, Any] = {
    'level': 'INFO',
    'format': '%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    'date_format': '%Y-%m-%d %H:%M:%S'
}

# 캐시 설정
CACHE_CONFIG: Dict[str, Any] = {
    'enabled': True,
    'expiry_days': 7,
    'max_size': 1000  # 최대 캐시 항목 수
}

# 디렉토리 생성
for directory in [FILE_CONFIG['output_dir'], FILE_CONFIG['cache_dir'], FILE_CONFIG['log_dir']]:
    os.makedirs(directory, exist_ok=True) 