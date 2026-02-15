"""
Main crawl pipeline — orchestrates fetching, pagination, retries, and storage.
This replaces the monolithic main() function from court_auction_crawler.py.
"""
from __future__ import annotations

import asyncio
import logging
from typing import Any, Dict, List, Set

from tqdm import tqdm

from src.fetcher import create_session, fetch_auction_page, fetch_page_safe
from src.models import AuctionApiRequest, CrawlResult
from src.settings import get_settings
from src.storage import save_auction_data

logger = logging.getLogger("auction_crawler.pipeline")


class CrawlPipeline:
    """경매 크롤링 파이프라인"""

    def __init__(self) -> None:
        self.settings = get_settings()
        self.all_auctions: List[Dict[str, Any]] = []
        self.successful_pages: Set[int] = set()
        self.failed_pages: List[int] = []
        self.blocked_pages: List[int] = []

    async def run(self) -> None:
        """전체 크롤링 파이프라인 실행"""
        try:
            async with create_session(self.settings.crawling.concurrency_limit) as session:
                # 1단계: 첫 페이지로 전체 크기 파악
                total_pages = await self._fetch_first_page(session)
                if total_pages is None:
                    return

                # 2단계: 나머지 페이지 크롤링
                if total_pages > 1:
                    await self._fetch_remaining_pages(session, total_pages)

                # 3단계: 실패/차단 페이지 재시도
                await self._retry_failed_pages(session)

                # 4단계: 결과 검증 및 저장
                await self._validate_and_save(total_pages)

        except Exception as e:
            logger.error(f"최상위 오류 발생: {e}")

    async def _fetch_first_page(self, session: Any) -> int | None:
        """첫 페이지를 가져와서 전체 페이지 수를 반환"""
        logger.info("첫 페이지를 가져와 전체 페이지 수를 확인합니다...")
        try:
            request = AuctionApiRequest.create(1, self.settings.crawling.page_size)
            auctions, page_info = await fetch_auction_page(session, request, 1)

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

    async def _fetch_remaining_pages(self, session: Any, total_pages: int) -> None:
        """나머지 페이지들을 크롤링"""
        all_pages = list(range(2, total_pages + 1))
        concurrency = self.settings.crawling.concurrency_limit

        if concurrency == 1:
            await self._fetch_sequential(session, all_pages)
        else:
            await self._fetch_batched(session, all_pages, concurrency)

    async def _fetch_sequential(self, session: Any, pages: List[int]) -> None:
        """순차 처리"""
        logger.info(
            f"총 {len(pages)}개 페이지를 순차적으로 크롤링합니다. "
            f"(요청 사이 딜레이: {self.settings.crawling.request_delay}초)"
        )
        for idx, page_num in enumerate(tqdm(pages, desc="페이지 크롤링"), 1):
            result = await fetch_page_safe(
                session, page_num, self.settings.crawling.page_size
            )
            self._process_result(result)

            # 차단 감지 시 대기
            if result.is_blocked:
                wait_time = self.settings.crawling.blocked_wait_time
                logger.warning(f"페이지 {page_num} 차단 감지됨. {wait_time}초 대기...")
                await asyncio.sleep(wait_time)

            # 일정 간격마다 배치 딜레이
            if idx % 10 == 0 and idx < len(pages):
                await asyncio.sleep(self.settings.crawling.batch_delay)

    async def _fetch_batched(self, session: Any, pages: List[int], concurrency: int) -> None:
        """배치 단위 병렬 처리"""
        batch_size = concurrency * 3
        logger.info(
            f"총 {len(pages)}개 페이지를 배치 단위로 크롤링합니다. "
            f"(배치 크기: {batch_size}, 동시 요청 수: {concurrency})"
        )

        for batch_start in range(0, len(pages), batch_size):
            batch_pages = pages[batch_start:batch_start + batch_size]
            logger.info(
                f"배치 {batch_start // batch_size + 1}: "
                f"페이지 {batch_pages[0]}~{batch_pages[-1]} 처리 중..."
            )

            tasks = [
                asyncio.create_task(
                    fetch_page_safe(session, page, self.settings.crawling.page_size)
                )
                for page in batch_pages
            ]

            batch_blocked = False
            for future in tqdm(
                asyncio.as_completed(tasks),
                total=len(tasks),
                desc=f"배치 {batch_start // batch_size + 1}",
            ):
                try:
                    result = await future
                    self._process_result(result)

                    if result.is_blocked:
                        batch_blocked = True
                        logger.warning(f"페이지 {result.page_num} 차단 감지됨")
                        for task in tasks:
                            if not task.done():
                                task.cancel()
                        for task in tasks:
                            if not task.done():
                                try:
                                    await task
                                except asyncio.CancelledError:
                                    pass
                        break
                except asyncio.CancelledError:
                    logger.debug("태스크가 취소되었습니다.")
                    break
                except Exception as e:
                    logger.error(f"페이지 크롤링 중 오류 발생: {e}")

            if batch_blocked:
                wait_time = self.settings.crawling.blocked_wait_time
                logger.warning(f"차단 감지됨. {wait_time}초 대기 후 계속 진행합니다...")
                await asyncio.sleep(wait_time)

            if batch_start + batch_size < len(pages):
                await asyncio.sleep(self.settings.crawling.batch_delay)

    async def _retry_failed_pages(self, session: Any) -> None:
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

        for page in retry_pages:
            try:
                await asyncio.sleep(self.settings.crawling.request_delay * 2)
                request = AuctionApiRequest.create(page, self.settings.crawling.page_size)
                auctions, page_info = await fetch_auction_page(session, request, page)
                if auctions:
                    self.all_auctions.extend(auctions)
                    self.successful_pages.add(page)
                    logger.info(f"페이지 {page} 재시도 성공")
                else:
                    logger.warning(f"페이지 {page} 재시도: 여전히 데이터가 없습니다.")
            except Exception as e:
                error_str = str(e)
                if '차단' in error_str or '비정상적인 접속' in error_str:
                    logger.error(f"페이지 {page} 재시도: 여전히 차단됨. {retry_delay * 2}초 대기...")
                    await asyncio.sleep(retry_delay * 2)
                else:
                    logger.error(f"페이지 {page} 재시도 실패: {e}")

    async def _validate_and_save(self, total_pages: int) -> None:
        """결과 검증 및 저장"""
        logger.info(f"성공한 페이지: {len(self.successful_pages)}개 / 전체: {total_pages}개")

        if not self.all_auctions:
            logger.error("경매 목록을 가져오지 못했습니다.")
            return

        total_cnt = getattr(self, '_total_cnt', 0)
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

    def _process_result(self, result: CrawlResult) -> None:
        """CrawlResult를 처리하여 내부 상태 업데이트"""
        if result.is_blocked:
            self.blocked_pages.append(result.page_num)
        elif result.is_success:
            self.all_auctions.extend(result.auctions or [])
            self.successful_pages.add(result.page_num)
        else:
            self.failed_pages.append(result.page_num)
            if not result.error:
                logger.warning(f"페이지 {result.page_num}: 데이터가 없습니다.")


async def main() -> None:
    """메인 진입점"""
    pipeline = CrawlPipeline()
    await pipeline.run()
