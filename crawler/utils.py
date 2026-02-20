"""
Utility functions — retry decorator, caching, and logging setup.
Updated to use src.settings instead of old config.py dicts.
"""
import asyncio
import hashlib
import json
import logging
import os
from collections.abc import Awaitable, Callable
from datetime import datetime, timedelta
from functools import wraps
from typing import Any, TypeVar, cast

from src.settings import get_settings

T = TypeVar('T')


def retry_with_backoff(
    max_retries: int | None = None,
    base_delay: float | None = None,
    max_delay: float = 60.0,
) -> Callable[[Callable[..., Awaitable[T]]], Callable[..., Awaitable[T]]]:
    """
    Exponential backoff retry decorator for async functions.
    Uses settings for defaults if not provided.
    """
    # These will be the default values if not overridden by decorator arguments
    # They are captured in the closure of the decorator function
    settings = get_settings()
    _max_retries_default = settings.crawling.max_retries
    _base_delay_default = settings.crawling.retry_delay

    def decorator(func: Callable[..., Awaitable[T]]) -> Callable[..., Awaitable[T]]:
        @wraps(func)
        async def wrapper(*args: Any, **kwargs: Any) -> T:
            # Use decorator arguments if provided, otherwise use the defaults captured from settings
            current_retries = max_retries if max_retries is not None else _max_retries_default
            current_delay = base_delay if base_delay is not None else _base_delay_default

            last_exception = None

            for attempt in range(current_retries + 1): # +1 because range is exclusive, and we want to allow `current_retries` retries after the first attempt
                try:
                    return await func(*args, **kwargs)
                except Exception as e:
                    last_exception = e
                    if attempt == current_retries: # This is the last allowed attempt (0-indexed)
                        logger.error(f"Max retries ({current_retries}) reached for {func.__name__}. Last error: {e}")
                        raise last_exception

                    delay = min(current_delay * (2 ** attempt), max_delay)
                    logger.warning(f"Attempt {attempt + 1}/{current_retries + 1} failed for {func.__name__}: {e}. Retrying in {delay:.2f}s...")
                    await asyncio.sleep(delay)

            # This line should theoretically not be reached if an exception is always raised on the last attempt
            raise last_exception if last_exception else Exception("Retry failed without an explicit exception.")

        return wrapper
    return decorator


class Cache:
    """Simple JSON-based file cache"""

    def __init__(self) -> None:
        settings = get_settings()
        self.enabled = settings.cache.enabled
        self.cache_dir = ".cache"
        if self.enabled:
            self._ensure_cache_dir()
            self._cleanup_old_cache(settings.cache.expiry_days)

    def _ensure_cache_dir(self) -> None:
        if not os.path.exists(self.cache_dir):
            os.makedirs(self.cache_dir)

    def _get_cache_path(self, key: str) -> str:
        hashed_key = hashlib.md5(key.encode()).hexdigest()
        return os.path.join(self.cache_dir, f"{hashed_key}.json")

    def _cleanup_old_cache(self, expiry_days: int) -> None:
        """Clean up expired cache files"""
        if not os.path.exists(self.cache_dir):
            return

        now = datetime.now()
        for filename in os.listdir(self.cache_dir):
            file_path = os.path.join(self.cache_dir, filename)
            if os.path.isfile(file_path) and filename.endswith('.json'):
                try:
                    # Check file modification time first (optimization)
                    mtime = datetime.fromtimestamp(os.path.getmtime(file_path))
                    if (now - mtime).days > expiry_days:
                        os.remove(file_path)
                        continue

                    # Then check content expiry if needed
                    with open(file_path, encoding='utf-8') as f:
                        data = json.load(f)
                        if 'expiry' in data and datetime.fromisoformat(data['expiry']) < now:
                            os.remove(file_path)
                except (OSError, json.JSONDecodeError):
                    # Remove corrupted files
                    try:
                        os.remove(file_path)
                    except OSError:
                        pass

    def get(self, key: str) -> dict[str, Any] | None:
        if not self.enabled:
            return None

        cache_path = self._get_cache_path(key)
        if os.path.exists(cache_path):
            try:
                with open(cache_path, encoding='utf-8') as f:
                    data = json.load(f)
                    if 'expiry' in data and datetime.fromisoformat(data['expiry']) < datetime.now():
                        # Expired
                        os.remove(cache_path)
                        return None
                    return cast(dict[str, Any], data['value'])
            except Exception as e:
                logger.warning(f"Cache read error for key '{key}': {e}")
                return None
        return None

    def set(self, key: str, value: Any, expiry_days: int | None = None) -> None:
        if not self.enabled:
            return

        settings = get_settings()
        if expiry_days is None:
            expiry_days = settings.cache.expiry_days

        cache_path = self._get_cache_path(key)
        expiry = (datetime.now() + timedelta(days=expiry_days)).isoformat()

        data = {
            'value': value,
            'expiry': expiry
        }

        try:
            with open(cache_path, 'w', encoding='utf-8') as f:
                json.dump(data, f, ensure_ascii=False)
        except Exception as e:
            logger.warning(f"Cache write error for key '{key}': {e}")


# 전역 로거 (logging.basicConfig는 entry point에서 설정됨)
logger = logging.getLogger('court_auction_crawler')
cache = Cache()
