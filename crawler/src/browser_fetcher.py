import asyncio
import logging
from typing import Any

from playwright.async_api import Browser, Page, Playwright, async_playwright

from src.settings import get_settings

logger = logging.getLogger("auction_crawler.browser_fetcher")


class BrowserFetcher:
    """
    Playwright-based fetcher to bypass 400 Bad Request / bot detection.
    Manages a persistent browser context and page.
    """

    def __init__(self) -> None:
        self.settings = get_settings()
        self.playwright: Playwright | None = None
        self.browser: Browser | None = None
        self.context = None
        self.page: Page | None = None
        self._initialized = False

    async def initialize(self) -> None:
        """Start the browser and navigate to the main page to set cookies."""
        if self._initialized:
            return

        logger.info("Initializing Playwright Browser...")
        self.playwright = await async_playwright().start()

        self.browser = await self.playwright.chromium.launch(
            headless=self.settings.browser.headless,
            args=["--no-sandbox", "--disable-setuid-sandbox"],
        )

        self.context = await self.browser.new_context(
            viewport={
                "width": self.settings.browser.window_width,
                "height": self.settings.browser.window_height,
            },
            user_agent=(
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/122.0.0.0 Safari/537.36"
            ),
        )

        self.page = await self.context.new_page()

        main_url = "https://www.courtauction.go.kr/pgj/index.on"
        wait_until = "domcontentloaded"
        timeout = self.settings.browser.timeout
        logger.info(
            "Visiting main page to establish session: %s "
            "(wait_until=%s, timeout=%sms)",
            main_url,
            wait_until,
            timeout,
        )
        try:
            await self.page.goto(main_url, wait_until=wait_until, timeout=timeout)
            logger.info("Successfully loaded main page.")
        except Exception:
            logger.exception(
                "Failed to load main page: url=%s wait_until=%s timeout=%sms",
                main_url,
                wait_until,
                timeout,
            )
            raise

        self._initialized = True

    async def fetch_auction_list(
        self,
        page_num: int,
        payload: dict[str, Any],
    ) -> tuple[list[dict[str, Any]], dict[str, Any]]:
        """
        Fetch an auction list page with the page request context so cookies from
        the browser session are sent with the API request.
        """
        if not self._initialized or not self.page:
            await self.initialize()

        api_url = self.settings.api.api_url

        try:
            await asyncio.sleep(0.5)

            response = await self.page.request.post(
                api_url,
                data=payload,
                headers={
                    "Content-Type": "application/json;charset=UTF-8",
                    "Accept": "application/json, text/plain, */*",
                    "X-Requested-With": "XMLHttpRequest",
                    "Referer": "https://www.courtauction.go.kr/pgj/index.on",
                },
                timeout=self.settings.browser.timeout,
            )

            if response.status != 200:
                logger.error(
                    "API returned status %s on page %s: %s",
                    response.status,
                    page_num,
                    response.status_text,
                )
                return [], {"blocked": True}

            result = await response.json()

            if "error" in result or "message" in result:
                msg = result.get("error") or result.get("message")
                if msg and "검색 결과가 조회되었습니다" not in str(msg):
                    logger.warning("API Application Error on page %s: %s", page_num, msg)

                if msg and "차단" in str(msg):
                    return [], {"blocked": True}

            data_node = result.get("data", {})
            auctions = data_node.get("dlt_srchResult", [])
            page_info = data_node.get("dma_pageInfo", {})

            return auctions, page_info

        except Exception:
            logger.exception("Error fetching page %s", page_num)
            return [], {}

    async def close(self) -> None:
        """Cleanup resources."""
        if self.context:
            await self.context.close()
        if self.browser:
            await self.browser.close()
        if self.playwright:
            await self.playwright.stop()
        self._initialized = False
        logger.info("Browser closed.")
