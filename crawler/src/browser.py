import logging
import json
import asyncio
from typing import Optional, Dict, List, Any
from playwright.async_api import async_playwright, Browser, Page, Playwright
from src.settings import get_settings

logger = logging.getLogger("auction_crawler.browser_fetcher")

class BrowserFetcher:
    """
    Playwright-based fetcher to bypass 400 Bad Request / Bot Detection.
    Manages a persistent browser context and page.
    """
    def __init__(self):
        self.settings = get_settings()
        self.playwright: Optional[Playwright] = None
        self.browser: Optional[Browser] = None
        self.context = None
        self.page: Optional[Page] = None
        self._initialized = False

    async def initialize(self):
        """Start the browser and navigate to the main page to set cookies."""
        if self._initialized:
            return

        logger.info("Initializing Playwright Browser...")
        self.playwright = await async_playwright().start()
        
        # Launch browser (headless by default, but can be configured)
        headless = self.settings.browser.headless
        self.browser = await self.playwright.chromium.launch(
            headless=headless,
            args=["--no-sandbox", "--disable-setuid-sandbox"]
        )
        
        self.context = await self.browser.new_context(
            viewport={"width": 1920, "height": 1080},
            user_agent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
        )
        
        self.page = await self.context.new_page()

        # 1. Visit Main Page to get Session Cookies
        main_url = "https://www.courtauction.go.kr/pgj/index.on"
        logger.info(f"Visiting main page to establish session: {main_url}")
        try:
            await self.page.goto(main_url, wait_until="networkidle", timeout=30000)
            logger.info("Successfully loaded main page.")
        except Exception as e:
            logger.error(f"Failed to load main page: {e}")
            raise

        self._initialized = True

    async def fetch_auction_list(self, page_num: int, payload: Dict[str, Any]) -> tuple[List[Dict[str, Any]], Dict[str, Any]]:
        """
        Fetch auction list for a specific page using `page.evaluate` (JS execution)
        or by intercepting the network response.
        
        Here we use `page.evaluate` to trigger the AJAX request via existing JS functions if possible,
        OR we can just use `request.post` within the browser context to ensure cookies are sent.
        
        Actually, the easiest way with Playwright given we are already on the page is to use 
        `page.request.post` which shares the cookie jar with the page.
        """
        if not self._initialized or not self.page:
            await self.initialize()

        api_url = self.settings.api.api_url
        
        # We use the page's request context to send the POST request
        # This automatically attaches the cookies from the main page visit
        try:
            # Add a small random delay to mimic human behavior
            await asyncio.sleep(0.5)
            
            # API Call via page.request (shares cookies)
            response = await self.page.request.post(
                api_url,
                data=payload,
                headers={
                    "Content-Type": "application/json;charset=UTF-8",
                    "Accept": "application/json, text/plain, */*",
                    "X-Requested-With": "XMLHttpRequest",
                    "Referer": "https://www.courtauction.go.kr/pgj/index.on"
                },
                timeout=30000
            )

            if response.status != 200:
                logger.error(f"API returned status {response.status}: {response.status_text}")
                return [], {'blocked': True}

            result = await response.json()
            
            # Additional check for 200 OK but application-level error
            if 'error' in result or 'message' in result:
                 msg = result.get('error') or result.get('message')
                 # Ignore "Success" message masquerading as error
                 if msg and "검색 결과가 조회되었습니다" not in str(msg):
                     logger.warning(f"API Application Error: {msg}")
                 
                 if msg and '차단' in str(msg):
                     return [], {'blocked': True}

            data_node = result.get('data', {})
            auctions = data_node.get('dlt_srchResult', [])
            page_info = data_node.get('dma_pageInfo', {})

            return auctions, page_info

        except Exception as e:
            logger.error(f"Error fetching page {page_num}: {e}")
            return [], {}

    async def close(self):
        """Cleanup resources."""
        if self.context:
            await self.context.close()
        if self.browser:
            await self.browser.close()
        if self.playwright:
            await self.playwright.stop()
        self._initialized = False
        logger.info("Browser closed.")
