"""
Utility functions — retry decorator, caching, and logging setup.
Updated to use src.settings instead of old config.py dicts.
"""
import json
import logging
import os
import time
import hashlib
import asyncio
from datetime import datetime, timedelta
from typing import Any, Dict, Optional, Callable, TypeVar, cast
from functools import wraps

from src.settings import get_settings

T = TypeVar('T')


def retry_with_backoff(
    max_retries: Optional[int] = None,
    base_delay: Optional[float] = None,
    max_delay: float = 60.0,
):
    """
    지수 백오프를 사용한 재시도 데코레이터.
    기본값은 settings에서 가져옵니다.
    """
    def decorator(func: Callable[..., T]) -> Callable[..., T]:
        @wraps(func)
        async def wrapper(*args, **kwargs) -> T:
            settings = get_settings()
            _max_retries = max_retries if max_retries is not None else settings.crawling.max_retries
            _base_delay = base_delay if base_delay is not None else settings.crawling.retry_delay

            retries = 0
            while retries < _max_retries:
                try:
                    return await func(*args, **kwargs)
                except Exception as e:
                    retries += 1
                    if retries == _max_retries:
                        logger.error(f"최대 재시도 횟수({_max_retries}) 초과: {str(e)}")
                        raise

                    delay = min(_base_delay * (2 ** (retries - 1)), max_delay)
                    logger.warning(f"재시도 {retries}/{_max_retries} (대기: {delay}초): {str(e)}")
                    await asyncio.sleep(delay)

            raise Exception("재시도 실패")

        return cast(Callable[..., T], wrapper)
    return decorator


class Cache:
    """파일 기반 캐시"""

    def __init__(self):
        settings = get_settings()
        self.cache_dir = settings.file.cache_dir
        self.enabled = settings.cache.enabled
        self.expiry_days = settings.cache.expiry_days
        self.max_size = settings.cache.max_size
        self._ensure_cache_dir()

    def _ensure_cache_dir(self):
        os.makedirs(self.cache_dir, exist_ok=True)

    def _get_cache_path(self, key: str) -> str:
        hash_key = hashlib.md5(key.encode()).hexdigest()
        return os.path.join(self.cache_dir, f"{hash_key}.json")

    def _cleanup_old_cache(self):
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
        if not self.enabled:
            return
        self._cleanup_old_cache()
        expiry = datetime.now() + timedelta(days=expiry_days or self.expiry_days)
        cache_data = {'value': value, 'expiry': expiry.isoformat()}
        cache_path = self._get_cache_path(key)
        try:
            with open(cache_path, 'w', encoding='utf-8') as f:
                json.dump(cache_data, f, ensure_ascii=False)
        except Exception as e:
            logger.error(f"캐시 저장 실패: {e}")


# 전역 로거 (logging.basicConfig는 entry point에서 설정됨)
logger = logging.getLogger('court_auction_crawler')
cache = Cache()