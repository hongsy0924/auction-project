from selenium import webdriver
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from webdriver_manager.chrome import ChromeDriverManager
import pandas as pd
import time
import os
import asyncio
import aiohttp
from pnu_generator import PNUGenerator, process_batch
from concurrent.futures import ThreadPoolExecutor
from typing import List, Dict
from datetime import datetime
from config import API_CONFIG, CRAWLING_CONFIG, BROWSER_CONFIG, FILE_CONFIG
from utils import logger, cache, retry_with_backoff
from tqdm import tqdm
from selenium.common.exceptions import TimeoutException, NoSuchElementException

class CourtAuctionCrawler:
    def __init__(self):
        self.base_url = API_CONFIG['base_url']
        self.api_url = API_CONFIG['api_url']
        self.driver = None
        self.cookies = None
    
    def setup_driver(self):
        """Chrome WebDriver 설정"""
        try:
            options = Options()
            if BROWSER_CONFIG['headless']:
                options.add_argument('--headless')
            options.add_argument(f'--window-size={BROWSER_CONFIG["window_size"][0]},{BROWSER_CONFIG["window_size"][1]}')
            options.add_argument('--no-sandbox')
            options.add_argument('--disable-dev-shm-usage')
            options.add_argument('--disable-gpu')
            options.add_argument('--disable-extensions')
            options.add_argument('--disable-infobars')
            
            # ChromeDriver 자동 업데이트
            service = Service(ChromeDriverManager().install())
            self.driver = webdriver.Chrome(service=service, options=options)
            logger.info("ChromeDriver initialized successfully")
            
            # 초기 쿠키 설정
            self._setup_cookies()
            
        except Exception as e:
            logger.error(f"Error setting up ChromeDriver: {e}")
            raise
    
    def _setup_cookies(self):
        """초기 쿠키 설정"""
        try:
            self.driver.get(self.base_url)
            time.sleep(2)  # 페이지 로딩 대기
            
            # WebSquare가 로드될 때까지 대기
            WebDriverWait(self.driver, BROWSER_CONFIG['timeout']).until(
                lambda driver: driver.execute_script('return typeof WebSquare !== "undefined"')
            )
            
            # 필요한 Selenium 작업 수행
            operations = [
                (By.XPATH, '//*[@id="mf_wfm_mainFrame_rad_rletSrchBtn"]/li[1]/label', "법원/담당계 라디오 버튼"),
                (By.XPATH, '//*[@id="mf_wfm_mainFrame_sbx_rletCortOfc"]/option[1]', "법원 선택"),
                (By.XPATH, '//*[@id="mf_wfm_mainFrame_sbx_rletLclLst"]/option[2]', "토지 선택"),
                (By.XPATH, '//*[@id="mf_wfm_mainFrame_sbx_rletMclLst"]/option[2]', "지목 선택"),
                (By.XPATH, '//*[@id="mf_wfm_mainFrame_btn_gdsDtlSrch"]', "검색 버튼")
            ]
            
            for by, value, description in operations:
                if not self.wait_and_click(by, value):
                    logger.error(f"{description} 클릭 실패")
                    raise Exception(f"Selenium 작업 실패: {description}")
                time.sleep(1)  # 각 작업 사이에 대기
            
            # 결과가 로드될 때까지 대기
            time.sleep(3)
            
            # 쿠키 저장
            self.cookies = self.driver.get_cookies()
            logger.info("초기 쿠키 설정 완료")
            
        except Exception as e:
            logger.error(f"초기 쿠키 설정 중 오류 발생: {e}")
            raise

    def wait_and_click(self, by, value, timeout=BROWSER_CONFIG['timeout']):
        """요소가 클릭 가능할 때까지 대기 후 클릭"""
        try:
            element = WebDriverWait(self.driver, timeout).until(
                EC.element_to_be_clickable((by, value))
            )
            element.click()
            return True
        except (TimeoutException, NoSuchElementException) as e:
            logger.error(f"요소 클릭 실패: {e}")
            return False

    async def get_auction_list(self, page: int, session: aiohttp.ClientSession) -> List[Dict]:
        """경매 목록 조회"""
        # 캐시 확인
        cache_key = f"auction_list_page_{page}"
        cached_data = cache.get(cache_key)
        if cached_data:
            logger.debug(f"캐시에서 경매 목록을 가져왔습니다. (페이지: {page})")
            return cached_data
        
        try:
            # 쿠키가 없는 경우 재설정
            if not self.cookies:
                logger.info("쿠키가 없어 재설정합니다.")
                self._setup_cookies()
            
            # 쿠키를 딕셔너리로 변환
            cookie_dict = {cookie['name']: cookie['value'] for cookie in self.cookies}
            session.cookie_jar.update_cookies(cookie_dict)
            
            # API 요청 데이터
            data = {
                "dma_pageInfo": {
                    "pageNo": page,
                    "pageSize": CRAWLING_CONFIG['page_size'],
                    "totalYn": "Y"
                },
                "dma_srchGdsDtlSrchInfo": {
                    "bidDvsCd": "000331",
                    "mvprpRletDvsCd": "00031R",
                    "cortAuctnSrchCondCd": "0004601",
                    "lclDspslGdsLstUsgCd": "10000",
                    "mclDspslGdsLstUsgCd": "10100",
                    "cortStDvs": "1",
                    "statNum": 1,
                    "bidBgngYmd": "",
                    "bidEndYmd": "",
                    "cortCd": "",
                    "cortNm": "",
                    "jpDeptCd": "",
                    "jpDeptNm": "",
                    "rletGdsLoc": "",
                    "rletGdsNo": "",
                    "rletAucDscn": "",
                    "rletGdsUsg": "",
                    "rletGdsApprAmt": "",
                    "rletGdsMinAmt": "",
                    "rletAucDscnDt": "",
                    "rletAucSts": ""
                }
            }
            
            # API 요청 헤더
            headers = {
                "Content-Type": "application/json;charset=UTF-8",
                "Accept": "application/json, text/plain, */*",
                "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
                "X-Requested-With": "XMLHttpRequest",
                "Referer": self.base_url
            }
            
            async with session.post(
                self.api_url,
                json=data,
                headers=headers,
                ssl=False,
                timeout=aiohttp.ClientTimeout(total=30)
            ) as response:
                if response.status != 200:
                    logger.error(f"API 요청 실패: {response.status}")
                    return []
                
                try:
                    result = await response.json()
                    if 'data' in result and 'dlt_srchResult' in result['data']:
                        auction_list = result['data']['dlt_srchResult']
                        # 결과를 캐시에 저장
                        cache.set(cache_key, auction_list)
                        return auction_list
                    return []
                except Exception as e:
                    logger.error(f"JSON 파싱 실패: {e}")
                    return []
                    
        except Exception as e:
            logger.error(f"경매 목록 조회 중 오류 발생 (페이지: {page}): {e}")
            # 오류 발생 시 쿠키 초기화
            self.cookies = None
            raise

    async def save_to_excel(self, data: List[Dict]):
        """데이터를 Excel 파일과 SQLite DB로 저장"""
        try:
            # 출력 디렉토리 생성
            os.makedirs(FILE_CONFIG['output_dir'], exist_ok=True)
            # DB 디렉토리 생성
            os.makedirs(FILE_CONFIG['database_dir'], exist_ok=True)
            
            # 타임스탬프 생성
            timestamp = datetime.now().strftime(FILE_CONFIG['timestamp_format'])
            
            # DataFrame 생성
            df = pd.DataFrame(data)
            
            # PNU 생성기 초기화
            generator = PNUGenerator()
            
            # 배치 처리
            all_results = []
            failed_cases = []
            batch_size = CRAWLING_CONFIG['batch_size']
            
            for start_idx in tqdm(range(0, len(df), batch_size), desc="토지이용정보 조회 중"):
                try:
                    batch_results = await process_batch(generator, df, start_idx, batch_size)
                    
                    # 결과 분류
                    for result in batch_results:
                        if result.get('error'):
                            failed_cases.append({
                                **df.iloc[result['original_index']].to_dict(),
                                'error': result['error']
                            })
                        else:
                            # 원본 데이터와 PNU, 토지이용정보를 병합
                            merged_result = {
                                **df.iloc[result['original_index']].to_dict(),
                                'pnu': result.get('pnu', ''),
                                'land_use': result.get('land_use', '')
                            }
                            all_results.append(merged_result)
                    
                    # 요청 간 지연
                    await asyncio.sleep(CRAWLING_CONFIG['request_delay'])
                    
                except Exception as e:
                    logger.error(f"배치 처리 중 오류 발생: {e}")
                    # 실패한 경우 원본 데이터를 실패 케이스에 추가
                    for idx in range(start_idx, min(start_idx + batch_size, len(df))):
                        failed_cases.append({
                            **df.iloc[idx].to_dict(),
                            'error': str(e)
                        })
            
            # 결과 저장
            if all_results:
                result_df = pd.DataFrame(all_results)
                output_file = os.path.join(
                    FILE_CONFIG['output_dir'],
                    f"auction_list_{timestamp}.xlsx"
                )
                result_df.to_excel(output_file, index=False)
                logger.info(f"경매 목록이 저장되었습니다: {output_file}")
                logger.info(f"총 {len(all_results)}개의 데이터가 저장되었습니다.")
                
                # --- SQLite DB 저장 ---
                import sqlite3
                os.makedirs(FILE_CONFIG['database_dir'], exist_ok=True)
                db_file = os.path.join(FILE_CONFIG['database_dir'], 'auction_data.db')
                conn = sqlite3.connect(db_file)
                result_df.to_sql('auction_list', conn, if_exists='replace', index=False)
                conn.close()
                logger.info(f"경매 목록이 DB에도 저장되었습니다: {db_file} (테이블명: auction_list)")
            
            # 실패 케이스 저장
            if failed_cases:
                failed_df = pd.DataFrame(failed_cases)
                failed_file = os.path.join(
                    FILE_CONFIG['output_dir'],
                    f"failed_cases_{timestamp}.xlsx"
                )
                try:
                    failed_df.to_excel(failed_file, index=False)
                except Exception as e:
                    logger.error(f"실패 케이스 Excel 저장 실패: {e}")
                    # Excel 저장 실패 시 CSV로 저장
                    failed_file = failed_file.replace('.xlsx', '.csv')
                    failed_df.to_csv(failed_file, index=False)
                logger.info(f"실패 케이스가 저장되었습니다: {failed_file}")
                logger.info(f"총 {len(failed_cases)}개의 실패 케이스가 있습니다.")
            
        except Exception as e:
            logger.error(f"데이터 저장 중 오류 발생: {e}")
            raise

async def main():
    """메인 함수"""
    crawler = CourtAuctionCrawler()
    try:
        # ChromeDriver 설정
        crawler.setup_driver()
        
        # aiohttp 세션 생성
        connector = aiohttp.TCPConnector(ssl=False, limit=5)
        async with aiohttp.ClientSession(connector=connector) as session:
            # 모든 페이지의 경매 목록을 가져오기
            all_auctions = []
            page = 1
            max_retries = 3
            consecutive_failures = 0
            max_consecutive_failures = 3
            no_more_data = False
            
            while not no_more_data:
                retry_count = 0
                while retry_count < max_retries:
                    try:
                        logger.info(f"페이지 {page}의 경매 목록을 가져오는 중...")
                        auctions = await crawler.get_auction_list(page, session)
                        
                        if not auctions:
                            logger.info(f"페이지 {page}에서 더 이상 데이터가 없습니다.")
                            no_more_data = True
                            break
                        
                        all_auctions.extend(auctions)
                        logger.info(f"페이지 {page}에서 {len(auctions)}개의 경매 목록을 가져왔습니다.")
                        
                        # 성공적으로 데이터를 가져왔으므로 다음 페이지로
                        page += 1
                        consecutive_failures = 0
                        break
                        
                    except Exception as e:
                        retry_count += 1
                        consecutive_failures += 1
                        logger.error(f"페이지 {page} 요청 실패 (재시도 {retry_count}/{max_retries}): {e}")
                        
                        if consecutive_failures >= max_consecutive_failures:
                            logger.error("연속된 실패로 인해 크롤링을 중단합니다.")
                            no_more_data = True
                            break
                            
                        if retry_count < max_retries:
                            # 재시도 전 대기 시간 (지수 백오프)
                            wait_time = 2 ** retry_count
                            logger.info(f"{wait_time}초 후 재시도합니다...")
                            await asyncio.sleep(wait_time)
                        else:
                            logger.error(f"페이지 {page} 요청이 최대 재시도 횟수를 초과했습니다.")
                            break
                
                if retry_count >= max_retries or consecutive_failures >= max_consecutive_failures:
                    no_more_data = True
                
                # 요청 간 지연 (서버 부하 방지)
                await asyncio.sleep(1)
            
            if not all_auctions:
                logger.error("경매 목록을 가져오지 못했습니다.")
                return
            
            logger.info(f"총 {len(all_auctions)}개의 경매 목록을 가져왔습니다.")
            
            # 결과 저장
            await crawler.save_to_excel(all_auctions)
            
    except Exception as e:
        logger.error(f"오류 발생: {e}")
    finally:
        if crawler.driver:
            crawler.driver.quit()

if __name__ == "__main__":
    asyncio.run(main()) 