import pandas as pd
import time
import os
import asyncio
import aiohttp
from pnu_generator import PNUGenerator, process_batch
from concurrent.futures import ThreadPoolExecutor
from typing import List, Dict
import datetime
from config import API_CONFIG, CRAWLING_CONFIG, FILE_CONFIG
from utils import logger, retry_with_backoff
from tqdm import tqdm

class CourtAuctionCrawler:
    def __init__(self):
        self.base_url = API_CONFIG['base_url']
        self.api_url = API_CONFIG['api_url']
    
    async def get_auction_list(self, page: int, session: aiohttp.ClientSession) -> (List[Dict], Dict):
        """경매 목록과 페이지 정보를 함께 반환"""
        try:
            today = datetime.datetime.now().strftime('%Y%m%d')
            two_weeks_later = (datetime.datetime.now() + datetime.timedelta(days=14)).strftime('%Y%m%d')
            
            data = {
                "dma_pageInfo": {"pageNo": page, "pageSize": CRAWLING_CONFIG['page_size'], "totalYn": "Y"},
                "dma_srchGdsDtlSrchInfo": {
                    "bidDvsCd": "000331", "mvprpRletDvsCd": "00031R", "cortAuctnSrchCondCd": "0004601",
                    "lclDspslGdsLstUsgCd": "10000", "mclDspslGdsLstUsgCd": "10100", "cortStDvs": "1",
                    "statNum": 1, "bidBgngYmd": today, "bidEndYmd": two_weeks_later, "cortCd": "",
                    "cortNm": "", "jpDeptCd": "", "jpDeptNm": "", "rletGdsLoc": "", "rletGdsNo": "",
                    "rletAucDscn": "", "rletGdsUsg": "", "rletGdsApprAmt": "", "rletGdsMinAmt": "",
                    "rletAucDscnDt": "", "rletAucSts": ""
                }
            }
            
            headers = {
                "Content-Type": "application/json;charset=UTF-8",
                "Accept": "application/json, text/plain, */*",
                "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
                "X-Requested-With": "XMLHttpRequest",
                "Referer": self.base_url
            }
            
            async with session.post(self.api_url, json=data, headers=headers, ssl=False, timeout=aiohttp.ClientTimeout(total=30)) as response:
                response.raise_for_status()
                result = await response.json()
                data_node = result.get('data', {})
                return data_node.get('dlt_srchResult', []), data_node.get('dma_pageInfo', {})

        except Exception as e:
            logger.error(f"경매 목록 조회 중 오류 발생 (페이지: {page}): {e}")
            raise

    async def save_to_excel(self, data: List[Dict]):
        """데이터를 Excel 파일과 SQLite DB로 저장"""
        if not data:
            logger.warning("저장할 데이터가 없습니다.")
            return

        try:
            os.makedirs(FILE_CONFIG['output_dir'], exist_ok=True)
            os.makedirs(FILE_CONFIG['database_dir'], exist_ok=True)
            
            timestamp = datetime.datetime.now().strftime(FILE_CONFIG['timestamp_format'])
            df = pd.DataFrame(data)
            
            # 환경변수로 VWorld API 호출 여부 제어
            skip_vworld_api = os.getenv('SKIP_VWORLD_API', 'false').lower() == 'true'
            
            if skip_vworld_api:
                logger.info("VWorld API 호출을 건너뛰고 기본 경매 데이터만 저장합니다.")
                result_df = df
            else:
                generator = PNUGenerator()
                
                all_results, failed_cases = [], []
                batch_size = CRAWLING_CONFIG['batch_size']
                
                for start_idx in tqdm(range(0, len(df), batch_size), desc="토지이용정보 조회 중"):
                    try:
                        batch_results = await process_batch(generator, df, start_idx, batch_size)
                        for result in batch_results:
                            original_data = df.iloc[result['original_index']].to_dict()
                            if result.get('error') and not any([result.get('land_use_1'), result.get('land_use_2'), result.get('land_use_3')]):
                                failed_cases.append({**original_data, 'error': result['error']})
                            else:
                                land_use_1 = result.get('land_use_1', '')
                                land_use_2 = result.get('land_use_2', '')
                                land_use_3 = result.get('land_use_3', '')
                                # 합친 필드도 참고용으로 제공
                                combined = ', '.join([v for v in [land_use_1, land_use_2, land_use_3] if v])
                                all_results.append({
                                    **original_data,
                                    'pnu': result.get('pnu', ''),
                                    'land_use_1': land_use_1,
                                    'land_use_2': land_use_2,
                                    'land_use_3': land_use_3,
                                    'land_use_combined': combined
                                })
                        await asyncio.sleep(CRAWLING_CONFIG['request_delay'])
                    except Exception as e:
                        logger.error(f"배치 처리 중 오류 발생: {e}")
                        for idx in range(start_idx, min(start_idx + batch_size, len(df))):
                            failed_cases.append({**df.iloc[idx].to_dict(), 'error': str(e)})

                if all_results:
                    result_df = pd.DataFrame(all_results)
                else:
                    logger.warning("토지이용정보 조회 결과가 없어 기본 데이터만 저장합니다.")
                    result_df = df

                if failed_cases:
                    failed_df = pd.DataFrame(failed_cases)
                    failed_file = os.path.join(FILE_CONFIG['output_dir'], f"failed_cases_{timestamp}.xlsx")
                    failed_df.to_excel(failed_file, index=False)
                    logger.warning(f"실패 케이스 {len(failed_cases)}건 저장 완료: {failed_file}")
            
            # 결과 저장
            output_file = os.path.join(FILE_CONFIG['output_dir'], f"auction_list_{timestamp}.xlsx")
            result_df.to_excel(output_file, index=False)
            logger.info(f"경매 목록 {len(result_df)}건 저장 완료: {output_file}")
            
            # --- SQLite DB 저장 ---
            import sqlite3
            db_file = os.path.join("../auction-viewer/database", 'auction_data.db')
            os.makedirs(os.path.dirname(db_file), exist_ok=True)
            with sqlite3.connect(db_file) as conn:
                result_df.to_sql('auction_list', conn, if_exists='replace', index=False)
            logger.info(f"DB 저장 완료: {db_file}")
            
        except Exception as e:
            logger.error(f"데이터 저장 중 오류 발생: {e}")
            raise

async def main():
    """메인 함수"""
    crawler = CourtAuctionCrawler()
    try:
        concurrency_limit = CRAWLING_CONFIG.get('concurrency_limit', 10)
        connector = aiohttp.TCPConnector(ssl=False, limit=concurrency_limit)
        
        async with aiohttp.ClientSession(connector=connector) as session:
            logger.info("첫 페이지를 가져와 전체 페이지 수를 확인합니다...")
            try:
                first_page_auctions, page_info = await crawler.get_auction_list(1, session)
                if not page_info or 'totalCnt' not in page_info:
                    logger.error("전체 페이지 수를 가져올 수 없습니다. 첫 페이지만 저장하고 종료합니다.")
                    if first_page_auctions:
                        await crawler.save_to_excel(first_page_auctions)
                    return
                
                total_cnt = int(page_info['totalCnt'])
                page_size = int(page_info['pageSize'])
                total_pages = (total_cnt + page_size - 1) // page_size
                logger.info(f"전체 물건 수: {total_cnt}, 전체 페이지 수: {total_pages}")
                all_auctions = first_page_auctions

            except Exception as e:
                logger.error(f"첫 페이지를 가져오는 데 실패했습니다: {e}")
                return

            if total_pages > 1:
                tasks = [crawler.get_auction_list(page, session) for page in range(2, total_pages + 1)]
                logger.info(f"총 {len(tasks)}개 페이지에 대해 동시 크롤링을 시작합니다. (동시 요청 수: {concurrency_limit})")
                
                for future in tqdm(asyncio.as_completed(tasks), total=len(tasks), desc="전체 페이지 크롤링"):
                    try:
                        auctions, _ = await future
                        if auctions:
                            all_auctions.extend(auctions)
                    except Exception as e:
                        logger.error(f"페이지 크롤링 중 오류 발생: {e}")

            if not all_auctions:
                logger.error("경매 목록을 가져오지 못했습니다.")
                return

            logger.info(f"총 {len(all_auctions)}개의 경매 목록을 가져왔습니다.")
            await crawler.save_to_excel(all_auctions)
            
    except Exception as e:
        logger.error(f"최상위 오류 발생: {e}")

if __name__ == "__main__":
    asyncio.run(main()) 