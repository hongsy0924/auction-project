import json
import logging
import os
import time
from datetime import datetime, timedelta
from typing import Any, Dict, Optional, Callable, TypeVar, cast
import hashlib
import asyncio
from functools import wraps
from config import CACHE_CONFIG, FILE_CONFIG, LOGGING_CONFIG, CRAWLING_CONFIG

T = TypeVar('T')

def retry_with_backoff(
    max_retries: int = CRAWLING_CONFIG['max_retries'],
    base_delay: float = CRAWLING_CONFIG['retry_delay'],
    max_delay: float = 60.0
):
    """
    지수 백오프를 사용한 재시도 데코레이터
    """
    def decorator(func: Callable[..., T]) -> Callable[..., T]:
        @wraps(func)
        async def wrapper(*args, **kwargs) -> T:
            retries = 0
            while retries < max_retries:
                try:
                    return await func(*args, **kwargs)
                except Exception as e:
                    retries += 1
                    if retries == max_retries:
                        logger.error(f"최대 재시도 횟수({max_retries}) 초과: {str(e)}")
                        raise
                    
                    # 지수 백오프 계산
                    delay = min(base_delay * (2 ** (retries - 1)), max_delay)
                    logger.warning(f"재시도 {retries}/{max_retries} (대기 시간: {delay}초): {str(e)}")
                    await asyncio.sleep(delay)
            
            raise Exception("재시도 실패")
        
        return cast(Callable[..., T], wrapper)
    return decorator

class Cache:
    def __init__(self):
        self.cache_dir = FILE_CONFIG['cache_dir']
        self.enabled = CACHE_CONFIG['enabled']
        self.expiry_days = CACHE_CONFIG['expiry_days']
        self.max_size = CACHE_CONFIG['max_size']
        self._ensure_cache_dir()
    
    def _ensure_cache_dir(self):
        """캐시 디렉토리가 존재하는지 확인"""
        os.makedirs(self.cache_dir, exist_ok=True)
    
    def _get_cache_path(self, key: str) -> str:
        """캐시 키에 대한 파일 경로 생성"""
        hash_key = hashlib.md5(key.encode()).hexdigest()
        return os.path.join(self.cache_dir, f"{hash_key}.json")
    
    def _cleanup_old_cache(self):
        """오래된 캐시 파일 정리"""
        if not os.path.exists(self.cache_dir):
            return
        
        current_time = time.time()
        expiry_seconds = self.expiry_days * 24 * 60 * 60
        
        for filename in os.listdir(self.cache_dir):
            file_path = os.path.join(self.cache_dir, filename)
            if os.path.isfile(file_path):
                file_time = os.path.getmtime(file_path)
                if current_time - file_time > expiry_seconds:
                    os.remove(file_path)
    
    def get(self, key: str) -> Optional[Dict[str, Any]]:
        """캐시에서 데이터 가져오기"""
        if not self.enabled:
            return None
        
        cache_path = self._get_cache_path(key)
        if not os.path.exists(cache_path):
            return None
        
        try:
            with open(cache_path, 'r', encoding='utf-8') as f:
                data = json.load(f)
                if 'expiry' in data and datetime.fromisoformat(data['expiry']) < datetime.now():
                    os.remove(cache_path)
                    return None
                return data['value']
        except Exception:
            return None
    
    def set(self, key: str, value: Any, expiry_days: Optional[int] = None):
        """캐시에 데이터 저장"""
        if not self.enabled:
            return
        
        self._cleanup_old_cache()
        
        expiry = datetime.now() + timedelta(days=expiry_days or self.expiry_days)
        cache_data = {
            'value': value,
            'expiry': expiry.isoformat()
        }
        
        cache_path = self._get_cache_path(key)
        try:
            with open(cache_path, 'w', encoding='utf-8') as f:
                json.dump(cache_data, f, ensure_ascii=False)
        except Exception as e:
            logger.error(f"캐시 저장 실패: {e}")

class Logger:
    def __init__(self, name: str):
        self.logger = logging.getLogger(name)
        self.logger.setLevel(LOGGING_CONFIG['level'])
        
        # 로그 디렉토리 생성
        os.makedirs(FILE_CONFIG['log_dir'], exist_ok=True)
        
        # 파일 핸들러 설정
        log_file = os.path.join(
            FILE_CONFIG['log_dir'],
            f"{name}_{datetime.now().strftime('%Y%m%d')}.log"
        )
        file_handler = logging.FileHandler(log_file, encoding='utf-8')
        file_handler.setFormatter(logging.Formatter(
            LOGGING_CONFIG['format'],
            datefmt=LOGGING_CONFIG['date_format']
        ))
        
        # 콘솔 핸들러 설정
        console_handler = logging.StreamHandler()
        console_handler.setFormatter(logging.Formatter(
            LOGGING_CONFIG['format'],
            datefmt=LOGGING_CONFIG['date_format']
        ))
        
        # 핸들러 추가
        self.logger.addHandler(file_handler)
        self.logger.addHandler(console_handler)
    
    def info(self, message: str):
        self.logger.info(message)
    
    def error(self, message: str):
        self.logger.error(message)
    
    def warning(self, message: str):
        self.logger.warning(message)
    
    def debug(self, message: str):
        self.logger.debug(message)

# 전역 로거 인스턴스 생성
logger = Logger('court_auction_crawler')
cache = Cache() 