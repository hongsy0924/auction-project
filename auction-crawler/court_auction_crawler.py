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
                
                # API 응답 상세 로깅 (데이터가 없을 때만)
                data_node = result.get('data', {})
                auctions = data_node.get('dlt_srchResult', [])
                page_info = data_node.get('dma_pageInfo', {})
                
                # API 차단 감지
                error_message = result.get('error') or result.get('message', '')
                if '차단' in str(error_message) or '비정상적인 접속' in str(error_message):
                    logger.warning(f"페이지 {page} API 차단 감지: {error_message}")
                    raise Exception(f"API 차단: {error_message}")
                
                # 데이터가 없을 때 응답 구조 확인
                if not auctions:
                    logger.debug(f"페이지 {page} 응답 구조: status={response.status}, result_keys={list(result.keys())}, data_keys={list(data_node.keys()) if data_node else 'None'}")
                    if 'error' in result or 'message' in result:
                        logger.warning(f"페이지 {page} API 에러 응답: {result.get('error', result.get('message', 'Unknown error'))}")
                    if 'dlt_srchResult' in data_node:
                        logger.debug(f"페이지 {page}: dlt_srchResult는 존재하지만 빈 배열입니다.")
                    else:
                        logger.debug(f"페이지 {page}: dlt_srchResult 키가 없습니다. data_node: {data_node}")
                
                return auctions, page_info

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
                successful_pages = {1}  # 첫 페이지는 성공

            except Exception as e:
                logger.error(f"첫 페이지를 가져오는 데 실패했습니다: {e}")
                return

            if total_pages > 1:
                # successful_pages는 이미 위에서 초기화됨
                # 페이지 번호와 함께 태스크 생성
                async def get_page_with_retry(page_num: int) -> tuple[int, List[Dict], Dict]:
                    """페이지 번호와 함께 결과 반환"""
                    try:
                        # 요청 사이 딜레이
                        await asyncio.sleep(CRAWLING_CONFIG['request_delay'])
                        auctions, page_info = await crawler.get_auction_list(page_num, session)
                        # 빈 배열인 경우도 정상 응답일 수 있으므로 그대로 반환
                        return page_num, auctions, page_info
                    except asyncio.TimeoutError:
                        logger.error(f"페이지 {page_num} 타임아웃 발생")
                        return page_num, [], {}
                    except aiohttp.ClientError as e:
                        logger.error(f"페이지 {page_num} 네트워크 오류: {e}")
                        return page_num, [], {}
                    except Exception as e:
                        error_str = str(e)
                        # API 차단 감지
                        if '차단' in error_str or '비정상적인 접속' in error_str:
                            logger.error(f"페이지 {page_num} API 차단: {error_str}")
                            # 차단된 경우 특별한 마커 반환
                            return page_num, None, {'blocked': True}
                        logger.error(f"페이지 {page_num} 크롤링 중 오류 발생: {type(e).__name__}: {e}")
                        import traceback
                        logger.debug(f"페이지 {page_num} 상세 오류:\n{traceback.format_exc()}")
                        return page_num, [], {}
                
                # 순차 처리 또는 배치 단위로 처리하여 차단 방지
                all_pages = list(range(2, total_pages + 1))
                failed_pages = []
                blocked_pages = []
                successful_pages = set()
                
                if concurrency_limit == 1:
                    # 순차 처리 (동시 요청 수가 1인 경우)
                    logger.info(f"총 {len(all_pages)}개 페이지를 순차적으로 크롤링합니다. (요청 사이 딜레이: {CRAWLING_CONFIG['request_delay']}초)")
                    
                    for idx, page_num in enumerate(tqdm(all_pages, desc="페이지 크롤링"), 1):
                        try:
                            await asyncio.sleep(CRAWLING_CONFIG['request_delay'])
                            auctions, page_info = await crawler.get_auction_list(page_num, session)
                            
                            if auctions:
                                all_auctions.extend(auctions)
                                successful_pages.add(page_num)
                            else:
                                failed_pages.append(page_num)
                                if page_info and 'totalCnt' in page_info:
                                    logger.debug(f"페이지 {page_num}: 정상 응답이지만 데이터가 없습니다.")
                                else:
                                    logger.warning(f"페이지 {page_num}: 데이터가 없습니다.")
                        except Exception as e:
                            error_str = str(e)
                            if '차단' in error_str or '비정상적인 접속' in error_str:
                                blocked_pages.append(page_num)
                                wait_time = CRAWLING_CONFIG.get('blocked_wait_time', 120)
                                logger.warning(f"페이지 {page_num} 차단 감지됨. {wait_time}초 대기 후 계속 진행합니다...")
                                await asyncio.sleep(wait_time)
                            else:
                                failed_pages.append(page_num)
                                logger.error(f"페이지 {page_num} 크롤링 중 오류 발생: {e}")
                        
                        # 일정 간격마다 배치 딜레이 추가
                        if idx % 10 == 0 and idx < len(all_pages):
                            await asyncio.sleep(CRAWLING_CONFIG.get('batch_delay', 3))
                else:
                    # 배치 단위 처리 (동시 요청 수가 1보다 큰 경우)
                    batch_size = concurrency_limit * 3  # 배치 크기 줄임
                    logger.info(f"총 {len(all_pages)}개 페이지를 배치 단위로 크롤링합니다. (배치 크기: {batch_size}, 동시 요청 수: {concurrency_limit})")
                    
                    for batch_start in range(0, len(all_pages), batch_size):
                        batch_pages = all_pages[batch_start:batch_start + batch_size]
                        logger.info(f"배치 {batch_start // batch_size + 1}/{(len(all_pages) + batch_size - 1) // batch_size}: 페이지 {batch_pages[0]}~{batch_pages[-1]} 처리 중...")
                        
                        # 태스크를 생성하여 취소 가능하도록 함
                        tasks = [asyncio.create_task(get_page_with_retry(page)) for page in batch_pages]
                        
                        batch_blocked = False
                        completed_count = 0
                        
                        for future in tqdm(asyncio.as_completed(tasks), total=len(tasks), desc=f"배치 {batch_start // batch_size + 1}"):
                            try:
                                page_num, auctions, page_info = await future
                                
                                # 차단 감지
                                if page_info and page_info.get('blocked'):
                                    blocked_pages.append(page_num)
                                    batch_blocked = True
                                    logger.warning(f"페이지 {page_num} 차단 감지됨")
                                    # 차단 감지 시 나머지 태스크 취소
                                    for task in tasks:
                                        if not task.done():
                                            task.cancel()
                                    # 취소된 태스크들 처리
                                    for task in tasks:
                                        if not task.done():
                                            try:
                                                await task
                                            except asyncio.CancelledError:
                                                pass
                                    break
                                elif auctions:
                                    all_auctions.extend(auctions)
                                    successful_pages.add(page_num)
                                else:
                                    failed_pages.append(page_num)
                                    if page_info and 'totalCnt' in page_info:
                                        logger.debug(f"페이지 {page_num}: 정상 응답이지만 데이터가 없습니다.")
                                    else:
                                        logger.warning(f"페이지 {page_num}: 데이터가 없습니다.")
                                
                                completed_count += 1
                            except asyncio.CancelledError:
                                logger.debug("태스크가 취소되었습니다.")
                                break
                            except Exception as e:
                                logger.error(f"페이지 크롤링 중 오류 발생: {e}")
                        
                        # 차단이 감지되면 대기
                        if batch_blocked:
                            wait_time = CRAWLING_CONFIG.get('blocked_wait_time', 120)
                            logger.warning(f"차단 감지됨. {wait_time}초 대기 후 계속 진행합니다...")
                            await asyncio.sleep(wait_time)
                        
                        # 배치 사이 딜레이
                        if batch_start + batch_size < len(all_pages):
                            await asyncio.sleep(CRAWLING_CONFIG.get('batch_delay', 3))
                
                # 실패한 페이지 및 차단된 페이지 재시도
                retry_pages = failed_pages + blocked_pages
                if retry_pages:
                    retry_delay = CRAWLING_CONFIG.get('retry_delay', 5)
                    logger.warning(f"실패/차단된 {len(retry_pages)}개 페이지를 재시도합니다: {retry_pages[:10]}{'...' if len(retry_pages) > 10 else ''}")
                    logger.info(f"재시도 전 {retry_delay}초 대기...")
                    await asyncio.sleep(retry_delay)
                    
                    for page in retry_pages:
                        try:
                            await asyncio.sleep(CRAWLING_CONFIG['request_delay'] * 2)  # 재시도 시 더 긴 딜레이
                            auctions, page_info = await crawler.get_auction_list(page, session)
                            if auctions:
                                all_auctions.extend(auctions)
                                successful_pages.add(page)
                                logger.info(f"페이지 {page} 재시도 성공")
                            else:
                                logger.warning(f"페이지 {page} 재시도: 여전히 데이터가 없습니다.")
                        except Exception as e:
                            error_str = str(e)
                            if '차단' in error_str or '비정상적인 접속' in error_str:
                                logger.error(f"페이지 {page} 재시도: 여전히 차단됨. {retry_delay * 2}초 대기 후 다시 시도...")
                                await asyncio.sleep(retry_delay * 2)
                            else:
                                logger.error(f"페이지 {page} 재시도 실패: {e}")
                
                logger.info(f"성공한 페이지: {len(successful_pages)}개 / 전체: {total_pages}개")

            if not all_auctions:
                logger.error("경매 목록을 가져오지 못했습니다.")
                return

            # 실제 가져온 데이터 수와 totalCnt 비교
            if len(all_auctions) < total_cnt:
                missing_count = total_cnt - len(all_auctions)
                logger.warning(f"⚠️  경고: 전체 물건 수({total_cnt}개)보다 적은 데이터({len(all_auctions)}개)를 가져왔습니다. 누락된 데이터: {missing_count}개")
                logger.warning("이유: 일부 페이지 크롤링 실패, API 응답 오류, 또는 데이터 필터링 등이 원인일 수 있습니다.")
            elif len(all_auctions) > total_cnt:
                logger.warning(f"⚠️  경고: 전체 물건 수({total_cnt}개)보다 많은 데이터({len(all_auctions)}개)를 가져왔습니다.")
            else:
                logger.info(f"✅ 전체 물건 수({total_cnt}개)와 일치합니다.")

            logger.info(f"총 {len(all_auctions)}개의 경매 목록을 가져왔습니다.")
            await crawler.save_to_excel(all_auctions)
            
    except Exception as e:
        logger.error(f"최상위 오류 발생: {e}")

if __name__ == "__main__":
    asyncio.run(main()) 