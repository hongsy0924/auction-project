import pandas as pd
import time
from typing import List, Dict, Optional
import os
import aiohttp
import asyncio
from tqdm import tqdm
from config import API_CONFIG, CRAWLING_CONFIG
from utils import logger, cache, retry_with_backoff

class PNUGenerator:
    def __init__(self):
        self.base_url = API_CONFIG['vworld_url']
        self.api_key = API_CONFIG['vworld_api_key']
        
    def create_pnu(self, daepyoSidoCd: str, daepyoSiguCd: str, daepyoDongCd: str, daepyoRdCd: str, daepyoLotno: str) -> List[Optional[str]]:
        """
        PNU(필지고유번호)를 생성합니다.
        ^로 구분된 여러 필지번호가 있는 경우 각각의 PNU를 생성하여 반환합니다.
        """
        try:
            # 입력값 정제
            daepyoSidoCd = str(daepyoSidoCd).zfill(2)
            daepyoSiguCd = str(daepyoSiguCd).zfill(3)
            daepyoDongCd = str(daepyoDongCd).zfill(3)
            daepyoRdCd = str(daepyoRdCd).zfill(2)
            daepyoLotno = str(daepyoLotno).strip()
            
            # 1. 첫 10자리: 시도+시군구+읍면동+리/도로
            pnu_prefix = f"{daepyoSidoCd}{daepyoSiguCd}{daepyoDongCd}{daepyoRdCd}"
            if len(pnu_prefix) != 10 or not pnu_prefix.isdigit():
                return [None]
            
            # 2. 여러 필지번호 처리
            lot_numbers = [num.strip() for num in daepyoLotno.split('^') if num.strip()]
            if not lot_numbers:
                return [None]
            
            pnu_list = []
            for lot_number in lot_numbers:
                # 2. 필지구분코드: '산' 포함시 2, 아니면 1
                land_type = "2" if "산" in lot_number else "1"
                # '산' 제거
                lot_number_clean = lot_number.replace("산", "")
                # 본번/부번 분리
                parts = lot_number_clean.split('-')
                if len(parts) > 2:
                    continue
                # 본번(4자리)
                main_number = ''.join(filter(str.isdigit, parts[0]))
                if not main_number:
                    continue
                main_number = main_number.zfill(4)[:4]
                # 부번(4자리)
                sub_number = "0000"
                if len(parts) > 1:
                    sub_number = ''.join(filter(str.isdigit, parts[1]))
                    if not sub_number:
                        sub_number = "0000"
                    sub_number = sub_number.zfill(4)[:4]
                # 3. 조합
                pnu = f"{pnu_prefix}{land_type}{main_number}{sub_number}"
                if len(pnu) == 19 and pnu.isdigit():
                    pnu_list.append(pnu)
            return pnu_list if pnu_list else [None]
        except Exception as e:
            logger.error(f"PNU 생성 중 오류 발생: {e}")
            return [None]

    @retry_with_backoff()
    async def get_land_use_info(self, pnu: str, session: aiohttp.ClientSession) -> Dict:
        """
        vworld API를 호출하여 토지이용정보를 가져옵니다.
        """
        # 캐시 확인
        cache_key = f"land_use_{pnu}"
        cached_data = cache.get(cache_key)
        if cached_data:
            logger.debug(f"캐시에서 토지이용정보를 가져왔습니다. (PNU: {pnu})")
            return cached_data
        
        params = {
            'key': self.api_key,
            'pnu': pnu,
            'domain': 'api.vworld.kr',
            'format': 'json'
        }
        
        try:
            async with session.get(self.base_url, params=params, ssl=False) as response:
                if response.status != 200:
                    text = await response.text()
                    logger.error(f"API 오류: status={response.status}, content={text[:200]}")
                    return {
                        'pnu': pnu,
                        'land_use': None,
                        'error': f"API status {response.status}: {text[:200]}"
                    }
                data = await response.json()
                
                land_use_info = []
                if 'landUses' in data and 'field' in data['landUses']:
                    for item in data['landUses']['field']:
                        if 'prposAreaDstrcCodeNm' in item:
                            land_use_info.append(item['prposAreaDstrcCodeNm'])
                
                result = {
                    'pnu': pnu,
                    'land_use': ', '.join(land_use_info) if land_use_info else None
                }
                
                # 결과를 캐시에 저장
                cache.set(cache_key, result)
                return result
                    
        except Exception as e:
            logger.error(f"토지이용정보 조회 중 오류 발생 (PNU: {pnu}): {e}")
            return {
                'pnu': pnu,
                'land_use': None,
                'error': str(e)
            }

@retry_with_backoff()
async def process_batch(generator: PNUGenerator, df: pd.DataFrame, start_idx: int, batch_size: int) -> List[Dict]:
    """배치 단위로 PNU 생성 및 토지이용정보 조회"""
    end_idx = min(start_idx + batch_size, len(df))
    batch_df = df.iloc[start_idx:end_idx]
    
    # PNU 생성 및 원본 데이터 매핑
    batch_pnus = []
    original_indices = []  # 원본 DataFrame의 인덱스를 저장
    
    for idx, row in batch_df.iterrows():
        pnus = generator.create_pnu(
            row['daepyoSidoCd'],
            row['daepyoSiguCd'],
            row['daepyoDongCd'],
            row['daepyoRdCd'],
            row['daepyoLotno']
        )
        batch_pnus.extend(pnus)
        # 각 PNU에 대해 원본 인덱스를 저장
        original_indices.extend([idx] * len(pnus))
    
    # 토지이용정보 조회
    connector = aiohttp.TCPConnector(ssl=False)
    async with aiohttp.ClientSession(connector=connector) as session:
        # 모든 PNU에 대한 요청을 동시에 생성
        tasks = []
        for pnu in batch_pnus:
            if pnu:  # PNU가 생성된 경우에만 API 요청
                task = generator.get_land_use_info(pnu, session)
                tasks.append(task)
        
        # 모든 요청을 동시에 실행
        results = await asyncio.gather(*tasks, return_exceptions=True)
    
    # 결과 처리
    batch_results = []
    for pnu, result, original_idx in zip(batch_pnus, results, original_indices):
        if not pnu:  # PNU 생성 실패
            batch_results.append({
                'original_index': original_idx,
                'pnu': None,
                'land_use': None,
                'error': 'PNU 생성 실패'
            })
        elif isinstance(result, Exception):  # API 요청 실패
            batch_results.append({
                'original_index': original_idx,
                'pnu': pnu,
                'land_use': None,
                'error': str(result)
            })
        else:  # 성공
            result['original_index'] = original_idx
            batch_results.append(result)
    
    return batch_results

# def preprocess_dataframe(df: pd.DataFrame) -> pd.DataFrame:
    """
    DataFrame을 전처리하여 엣지 케이스를 처리합니다.
    1. srchHjguRdCd에 여러 값이 있는 경우 처리
    2. srchHjguLotno에 여러 값이 있는 경우 처리 (^ 또는 ,로 구분)
    """
    processed_rows = []
    
    for _, row in df.iterrows():
        # srchHjguRdCd 처리
        srchHjguRdCd_values = str(row['srchHjguRdCd']).split(',')
        srchHjguRdCd_values = [v.strip() for v in srchHjguRdCd_values if v.strip()]
        
        # 8자리 숫자 제거
        srchHjguRdCd_values = [v for v in srchHjguRdCd_values if len(v) != 8]
        
        # srchHjguLotno 처리
        # 먼저 ^로 분리
        lotno_parts = str(row['srchHjguLotno']).split('^')
        lotno_parts = [v.strip() for v in lotno_parts if v.strip()]
        
        # 각 부분에서 ,로 분리
        srchHjguLotno_values = []
        for part in lotno_parts:
            sub_parts = part.split(',')
            sub_parts = [v.strip() for v in sub_parts if v.strip()]
            srchHjguLotno_values.extend(sub_parts)
        
        # 모든 조합 생성
        for rd_cd in srchHjguRdCd_values:
            for lot_no in srchHjguLotno_values:
                new_row = row.copy()
                new_row['srchHjguRdCd'] = rd_cd
                new_row['srchHjguLotno'] = lot_no
                processed_rows.append(new_row)
    
    return pd.DataFrame(processed_rows)

async def main():
    """메인 함수"""
    try:
        # 경매 목록 파일 읽기
        df = pd.read_excel('auction_list.xlsx')
        
        # PNU 생성기 초기화
        generator = PNUGenerator()
        
        # 결과를 저장할 리스트
        all_results = []
        failed_cases = []
        
        # 배치 크기 증가 (200개씩 처리)
        batch_size = 200
        
        # 전체 진행률 표시
        with tqdm(total=len(df), desc="토지이용정보 조회 중") as pbar:
            for start_idx in range(0, len(df), batch_size):
                # 배치 단위로 처리
                batch_results = await process_batch(generator, df, start_idx, batch_size)
                
                # 성공/실패 케이스 분리
                for result in batch_results:
                    if result.get('error') or not result.get('land_use'):
                        # 실패 케이스에 원본 데이터 추가
                        original_row = df.iloc[result['original_index']]
                        failed_case = {
                            'daepyoSidoCd': original_row['daepyoSidoCd'],
                            'daepyoSiguCd': original_row['daepyoSiguCd'],
                            'daepyoDongCd': original_row['daepyoDongCd'],
                            'daepyoRdCd': original_row['daepyoRdCd'],
                            'daepyoLotno': original_row['daepyoLotno'],
                            'pnu': result.get('pnu'),
                            'error': result.get('error', 'API 응답 없음')
                        }
                        failed_cases.append(failed_case)
                    else:
                        all_results.append(result)
                
                pbar.update(min(batch_size, len(df) - start_idx))
        
        # 결과를 DataFrame으로 변환
        result_df = pd.DataFrame(all_results)
        
        # 실패 케이스를 별도 파일로 저장
        if failed_cases:
            failed_df = pd.DataFrame(failed_cases)
            try:
                with pd.ExcelWriter('failed_cases.xlsx', engine='openpyxl') as writer:
                    failed_df.to_excel(writer, index=False, sheet_name='Sheet1')
                print(f"\n실패한 {len(failed_cases)}개의 케이스가 failed_cases.xlsx에 저장되었습니다.")
            except Exception as e:
                print(f"실패 케이스 Excel 파일 저장 중 오류 발생: {e}")
                failed_df.to_csv('failed_cases.csv', index=False, encoding='utf-8-sig')
                print(f"실패 케이스가 failed_cases.csv에 저장되었습니다.")
        
        # 결과를 새로운 엑셀 파일로 저장
        try:
            with pd.ExcelWriter('auction_list_with_land_use.xlsx', engine='openpyxl') as writer:
                result_df.to_excel(writer, index=False, sheet_name='Sheet1')
            print(f"\n처리가 완료되었습니다. 결과가 auction_list_with_land_use.xlsx에 저장되었습니다.")
        except Exception as e:
            print(f"Excel 파일 저장 중 오류 발생: {e}")
            # CSV 파일로도 저장 (백업)
            result_df.to_csv('auction_list_with_land_use.csv', index=False, encoding='utf-8-sig')
            print(f"CSV 파일로도 저장되었습니다: auction_list_with_land_use.csv")
        
    except Exception as e:
        print(f"오류 발생: {e}")

if __name__ == "__main__":
    asyncio.run(main()) 