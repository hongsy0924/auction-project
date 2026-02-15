"""
HTTP fetcher with session management, retry logic, and block detection.
Handles all network communication with the court auction API.
"""
from __future__ import annotations

import asyncio
import logging
from typing import Any

import aiohttp

from src.models import AuctionApiRequest, CrawlResult
from src.settings import get_settings

logger = logging.getLogger("auction_crawler.fetcher")

# HTTP 요청 헤더
DEFAULT_HEADERS = {
    "Content-Type": "application/json;charset=UTF-8",
    "Accept": "application/json, text/plain, */*",
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/122.0.0.0 Safari/537.36"
    ),
    "X-Requested-With": "XMLHttpRequest",
}



def is_blocked_response(result: dict[str, Any]) -> bool:
    """API 차단 여부 확인"""
    error_message = result.get('error') or result.get('message', '')
    return '차단' in str(error_message) or '비정상적인 접속' in str(error_message)


async def fetch_auction_page(
    session: aiohttp.ClientSession,
    request: AuctionApiRequest,
    page: int,
) -> tuple[list[Any], dict[str, Any]]:
    """
    단일 페이지의 경매 데이터를 API에서 가져옵니다.

    Returns:
        (auctions, page_info) 튜플
    Raises:
        Exception: API 차단 또는 네트워크 오류 시
    """
    settings = get_settings()
    headers = {
        **DEFAULT_HEADERS,
        "Referer": settings.api.base_url,
    }

    async with session.post(
        settings.api.api_url,
        json=request.model_dump(),
        headers=headers,
        ssl=False,
        timeout=aiohttp.ClientTimeout(total=30),
    ) as response:
        response.raise_for_status()
        result = await response.json()

        data_node = result.get('data', {})
        auctions = data_node.get('dlt_srchResult', [])
        page_info = data_node.get('dma_pageInfo', {})

        # API 차단 감지
        if is_blocked_response(result):
            error_message = result.get('error') or result.get('message', '')
            logger.warning(f"페이지 {page} API 차단 감지: {error_message}")
            raise Exception(f"API 차단: {error_message}")

        # 데이터가 없을 때 디버그 로깅
        if not auctions:
            logger.debug(
                f"페이지 {page} 응답 구조: status={response.status}, "
                f"result_keys={list(result.keys())}, "
                f"data_keys={list(data_node.keys()) if data_node else 'None'}"
            )
            if 'error' in result or 'message' in result:
                logger.warning(
                    f"페이지 {page} API 에러 응답: "
                    f"{result.get('error', result.get('message', 'Unknown error'))}"
                )

        return auctions, page_info


async def fetch_page_safe(
    session: aiohttp.ClientSession,
    page_num: int,
    page_size: int,
) -> CrawlResult:
    """
    안전하게 페이지를 가져옵니다 (예외 발생 안함).
    모든 에러를 CrawlResult로 감싸서 반환합니다.
    """
    settings = get_settings()
    try:
        await asyncio.sleep(settings.crawling.request_delay)
        request = AuctionApiRequest.create(page_num, page_size)
        auctions, page_info = await fetch_auction_page(session, request, page_num)
        return CrawlResult(
            page_num=page_num,
            auctions=auctions if auctions else [],
            page_info=page_info,
        )
    except asyncio.TimeoutError:
        logger.error(f"페이지 {page_num} 타임아웃 발생")
        return CrawlResult(page_num=page_num, auctions=[], error="timeout")
    except aiohttp.ClientError as e:
        logger.error(f"페이지 {page_num} 네트워크 오류: {e}")
        return CrawlResult(page_num=page_num, auctions=[], error=str(e))
    except Exception as e:
        error_str = str(e)
        if '차단' in error_str or '비정상적인 접속' in error_str:
            logger.error(f"페이지 {page_num} API 차단: {error_str}")
            return CrawlResult(page_num=page_num, is_blocked=True, error=error_str)
        logger.error(f"페이지 {page_num} 크롤링 중 오류 발생: {type(e).__name__}: {e}")
        return CrawlResult(page_num=page_num, auctions=[], error=str(e))


def create_session(concurrency_limit: int = 1) -> aiohttp.ClientSession:
    """aiohttp 세션 생성"""
    connector = aiohttp.TCPConnector(ssl=False, limit=concurrency_limit)
    return aiohttp.ClientSession(connector=connector)
