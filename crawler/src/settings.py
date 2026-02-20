"""
Application settings using Pydantic models + os.getenv.
No pydantic-settings dependency needed — uses dotenv + os.getenv directly.
"""
from __future__ import annotations

import os
from dataclasses import dataclass

from dotenv import load_dotenv

# .env 파일 자동 로드
load_dotenv()


@dataclass
class ApiSettings:
    """API 엔드포인트 설정"""
    base_url: str = "https://www.courtauction.go.kr/pgj/index.on?w2xPath=/pgj/ui/pgj100/PGJ151F00.xml"
    api_url: str = "https://www.courtauction.go.kr/pgj/pgjsearch/searchControllerMain.on"
    vworld_url: str = "https://api.vworld.kr/ned/data/getLandUseAttr"
    vworld_api_key: str = ""

    def __post_init__(self) -> None:
        self.vworld_api_key = os.getenv('VWORLD_API_KEY', self.vworld_api_key)


@dataclass
class CrawlingSettings:
    """크롤링 동작 설정"""
    page_size: int = 40
    batch_size: int = 50
    request_delay: float = 1.5
    concurrency_limit: int = 1
    batch_delay: float = 3.0
    max_retries: int = 3
    retry_delay: float = 10.0
    blocked_wait_time: float = 120.0
    skip_vworld_api: bool = False

    def __post_init__(self) -> None:
        self.page_size = int(os.getenv('PAGE_SIZE', str(self.page_size)))
        self.batch_size = int(os.getenv('BATCH_SIZE', str(self.batch_size)))
        self.request_delay = float(os.getenv('REQUEST_DELAY', str(self.request_delay)))
        self.concurrency_limit = int(os.getenv('CONCURRENCY_LIMIT', str(self.concurrency_limit)))
        self.batch_delay = float(os.getenv('BATCH_DELAY', str(self.batch_delay)))
        self.max_retries = int(os.getenv('MAX_RETRIES', str(self.max_retries)))
        self.retry_delay = float(os.getenv('RETRY_DELAY', str(self.retry_delay)))
        self.blocked_wait_time = float(os.getenv('BLOCKED_WAIT_TIME', str(self.blocked_wait_time)))
        self.skip_vworld_api = os.getenv('SKIP_VWORLD_API', 'false').lower() == 'true'


@dataclass
class FileSettings:
    """파일/디렉토리 경로 설정"""
    output_dir: str = "data/output"
    cache_dir: str = "data/cache"
    log_dir: str = "data/logs"
    database_dir: str = "../web/database"
    timestamp_format: str = "%Y%m%d_%H%M%S"

    def __post_init__(self) -> None:
        self.output_dir = os.getenv('OUTPUT_DIR', self.output_dir)
        self.database_dir = os.getenv('DATABASE_DIR', self.database_dir)

    def ensure_dirs(self) -> None:
        """필요한 디렉토리 생성"""
        for directory in [self.output_dir, self.cache_dir, self.log_dir]:
            os.makedirs(directory, exist_ok=True)


@dataclass
class LoggingSettings:
    """로깅 설정"""
    level: str = "INFO"
    log_format: str = "%(asctime)s - %(name)s - %(levelname)s - %(message)s"
    date_format: str = "%Y-%m-%d %H:%M:%S"


@dataclass
class CacheSettings:
    """캐시 설정"""
    enabled: bool = True
    expiry_days: int = 7
    max_size: int = 1000


@dataclass
class BrowserSettings:
    """브라우저 설정"""
    headless: bool = True
    window_width: int = 1920
    window_height: int = 1080
    timeout: int = 30000

    def __post_init__(self) -> None:
        self.headless = os.getenv('HEADLESS', 'true').lower() == 'true'
        self.timeout = int(os.getenv('TIMEOUT', str(self.timeout)))


class Settings:
    """통합 설정 — 모든 설정을 하나로 묶어서 제공"""

    def __init__(self) -> None:
        self.api = ApiSettings()
        self.crawling = CrawlingSettings()
        self.file = FileSettings()
        self.logging = LoggingSettings()
        self.cache = CacheSettings()
        self.browser = BrowserSettings()
        self.file.ensure_dirs()


# 싱글톤
_settings: Settings | None = None


def get_settings() -> Settings:
    """설정 싱글톤 반환"""
    global _settings
    if _settings is None:
        _settings = Settings()
    return _settings
