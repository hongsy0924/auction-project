"""
Main crawl pipeline — orchestrates fetching, pagination, retries, and storage.
Updated to use Playwright (BrowserFetcher) instead of aiohttp.
"""
from __future__ import annotations

import asyncio
import logging
from typing import Any, List, Set

from tqdm import tqdm

from src.browser_fetcher import BrowserFetcher
from src.models import SearchParams
from src.settings import get_settings
from src.storage import save_auction_data

logger = logging.getLogger("auction_crawler.pipeline")


class CrawlPipeline:
    """경매 크롤링 파이프라인 (Playwright 기반)"""

    def __init__(self) -> None:
        self.settings = get_settings()
        self.fetcher = BrowserFetcher()
        self.all_auctions: List[dict[str, Any]] = []
        self.successful_pages: Set[int] = set()
        self.failed_pages: List[int] = []
        self.blocked_pages: List[int] = []
        self._total_cnt = 0

    async def run(self) -> None:
        """전체 크롤링 파이프라인 실행"""
        try:
            # 브라우저 초기화
            await self.fetcher.initialize()

            # 1단계: 첫 페이지로 전체 크기 파악
            total_pages = await self._fetch_first_page()
            if total_pages is None:
                return

            # 2단계: 나머지 페이지 크롤링
            if total_pages > 1:
                await self._fetch_remaining_pages(total_pages)

            # 3단계: 실패/차단 페이지 재시도
            await self._retry_failed_pages()

            # 4단계: 결과 검증 및 저장
            await self._validate_and_save(total_pages)

        except Exception as e:
            logger.error(f"최상위 오류 발생: {e}")
            import traceback
            traceback.print_exc()
        finally:
            # 브라우저 종료
            await self.fetcher.close()

    async def _fetch_first_page(self) -> int | None:
        """첫 페이지를 가져와서 전체 페이지 수를 반환"""
        logger.info("첫 페이지를 가져와 전체 페이지 수를 확인합니다...")
        try:
            # Payload construction
            params = SearchParams.with_date_range(14)
            payload = {
                "dma_pageInfo": {"pageNo": 1, "pageSize": self.settings.crawling.page_size, "totalYn": "Y"},
                "dma_srchGdsDtlSrchInfo": params.model_dump()
            }

            auctions, page_info = await self.fetcher.fetch_auction_list(1, payload)

            if not page_info or 'totalCnt' not in page_info:
                logger.error("전체 페이지 수를 가져올 수 없습니다.")
                if auctions:
                    self.all_auctions.extend(auctions)
                    await save_auction_data(self.all_auctions)
                return None

            total_cnt = int(page_info['totalCnt'])
            page_size = int(page_info['pageSize'])
            total_pages = (total_cnt + page_size - 1) // page_size
            logger.info(f"전체 물건 수: {total_cnt}, 전체 페이지 수: {total_pages}")

            self.all_auctions.extend(auctions)
            self.successful_pages.add(1)
            self._total_cnt = total_cnt
            return total_pages

        except Exception as e:
            logger.error(f"첫 페이지를 가져오는 데 실패했습니다: {e}")
            return None

    async def _fetch_remaining_pages(self, total_pages: int) -> None:
        """나머지 페이지들을 크롤링 (Sequential for Browser Safety)"""
        pages = list(range(2, total_pages + 1))
        
        logger.info(
            f"총 {len(pages)}개 페이지를 순차적으로 크롤링합니다. "
            f"(요청 사이 딜레이: {self.settings.crawling.request_delay}초)"
        )
        
        # Playwright should be run sequentially to avoid detection and resource issues
        for idx, page_num in enumerate(tqdm(pages, desc="페이지 크롤링"), 1):
            try:
                # Construct Payload
                params = SearchParams.with_date_range(14)
                payload = {
                    "dma_pageInfo": {"pageNo": page_num, "pageSize": self.settings.crawling.page_size, "totalYn": "Y"},
                    "dma_srchGdsDtlSrchInfo": params.model_dump()
                }

                auctions, page_info = await self.fetcher.fetch_auction_list(page_num, payload)

                # Check for blocking
                if page_info.get('blocked'):
                    self.blocked_pages.append(page_num)
                    wait_time = self.settings.crawling.blocked_wait_time
                    logger.warning(f"페이지 {page_num} 차단 감지됨. {wait_time}초 대기...")
                    await asyncio.sleep(wait_time)
                    continue
                
                if auctions:
                    self.all_auctions.extend(auctions)
                    self.successful_pages.add(page_num)
                else:
                    self.failed_pages.append(page_num)
                    logger.warning(f"페이지 {page_num}: 데이터가 없습니다.")

            except Exception as e:
                logger.error(f"페이지 {page_num} 처리 중 오류: {e}")
                self.failed_pages.append(page_num)

            # Delay between requests
            await asyncio.sleep(self.settings.crawling.request_delay)

            # Batch Delay (optional, but good for safety)
            if idx % 10 == 0:
                await asyncio.sleep(self.settings.crawling.batch_delay)

    async def _retry_failed_pages(self) -> None:
        """실패/차단된 페이지 재시도"""
        retry_pages = self.failed_pages + self.blocked_pages
        if not retry_pages:
            return

        retry_delay = self.settings.crawling.retry_delay
        logger.warning(
            f"실패/차단된 {len(retry_pages)}개 페이지를 재시도합니다: "
            f"{retry_pages[:10]}{'...' if len(retry_pages) > 10 else ''}"
        )
        logger.info(f"재시도 전 {retry_delay}초 대기...")
        await asyncio.sleep(retry_delay)

        for page_num in retry_pages:
            try:
                params = SearchParams.with_date_range(14)
                payload = {
                    "dma_pageInfo": {"pageNo": page_num, "pageSize": self.settings.crawling.page_size, "totalYn": "Y"},
                    "dma_srchGdsDtlSrchInfo": params.model_dump()
                }

                auctions, page_info = await self.fetcher.fetch_auction_list(page_num, payload)

                if page_info.get('blocked'):
                     logger.error(f"페이지 {page_num} 재시도: 여전히 차단됨.")
                elif auctions:
                    self.all_auctions.extend(auctions)
                    self.successful_pages.add(page_num)
                    logger.info(f"페이지 {page_num} 재시도 성공")
                else:
                    logger.warning(f"페이지 {page_num} 재시도: 여전히 데이터가 없습니다.")
                    
                await asyncio.sleep(self.settings.crawling.request_delay * 1.5)

            except Exception as e:
                logger.error(f"페이지 {page_num} 재시도 실패: {e}")

    async def _validate_and_save(self, total_pages: int) -> None:
        """결과 검증 및 저장"""
        logger.info(f"성공한 페이지: {len(self.successful_pages)}개 / 전체: {total_pages}개")

        if not self.all_auctions:
            logger.error("경매 목록을 가져오지 못했습니다.")
            self.all_auctions = [] # Ensure it's a list even if empty

        total_cnt = self._total_cnt
        actual_count = len(self.all_auctions)

        if actual_count < total_cnt:
            missing = total_cnt - actual_count
            logger.warning(
                f"⚠️  전체 물건 수({total_cnt}개)보다 적은 데이터({actual_count}개)를 "
                f"가져왔습니다. 누락: {missing}개"
            )
        elif actual_count > total_cnt:
            logger.warning(
                f"⚠️  전체 물건 수({total_cnt}개)보다 많은 데이터({actual_count}개)를 "
                f"가져왔습니다."
            )
        else:
            logger.info(f"✅ 전체 물건 수({total_cnt}개)와 일치합니다.")

        logger.info(f"총 {actual_count}개의 경매 목록을 가져왔습니다.")
        await save_auction_data(self.all_auctions)

async def main() -> None:
    """메인 진입점"""
    pipeline = CrawlPipeline()
    await pipeline.run()
