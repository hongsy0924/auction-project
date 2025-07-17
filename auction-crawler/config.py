import os
from typing import Dict, Any
from dotenv import load_dotenv

# .env 파일 로드
load_dotenv()

# API 설정
API_CONFIG: Dict[str, Any] = {
    'base_url': 'https://www.courtauction.go.kr',
    'api_url': 'https://www.courtauction.go.kr/RetrieveRealEstateList.laf',
    'vworld_url': 'https://api.vworld.kr/req/data',
    'vworld_api_key': os.getenv('VWORLD_API_KEY', 'your_vworld_api_key_here')
}

# 크롤링 설정
CRAWLING_CONFIG: Dict[str, Any] = {
    'page_size': int(os.getenv('PAGE_SIZE', '20')),
    'batch_size': int(os.getenv('BATCH_SIZE', '50')),
    'request_delay': float(os.getenv('REQUEST_DELAY', '1')),
    'concurrency_limit': int(os.getenv('CONCURRENCY_LIMIT', '10'))
}

# 브라우저 설정
BROWSER_CONFIG: Dict[str, Any] = {
    'headless': os.getenv('HEADLESS', 'true').lower() == 'true',
    'window_size': (1920, 1080),
    'timeout': int(os.getenv('TIMEOUT', '30'))
}

# 파일 설정
FILE_CONFIG: Dict[str, Any] = {
    'output_dir': os.getenv('OUTPUT_DIR', 'output'),
    'cache_dir': 'auction-database/cache',
    'log_dir': 'logs',
    'database_dir': os.getenv('DATABASE_DIR', '../auction-viewer/database'),
    'timestamp_format': os.getenv('TIMESTAMP_FORMAT', '%Y%m%d_%H%M%S')
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