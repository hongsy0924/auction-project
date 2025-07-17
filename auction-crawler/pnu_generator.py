import pandas as pd
from typing import List, Dict, Optional
import aiohttp
import asyncio
from tqdm import tqdm
from config import API_CONFIG
from utils import logger, retry_with_backoff

class PNUGenerator:
    def __init__(self):
        self.base_url = API_CONFIG['vworld_url']
        self.api_key = API_CONFIG['vworld_api_key']
        
    def create_pnu(self, daepyoSidoCd: str, daepyoSiguCd: str, daepyoDongCd: str, daepyoRdCd: str, daepyoLotno: str) -> List[Optional[str]]:
        """PNU(필지고유번호)를 생성합니다."""
        try:
            pnu_prefix = f"{str(daepyoSidoCd).zfill(2)}{str(daepyoSiguCd).zfill(3)}{str(daepyoDongCd).zfill(3)}{str(daepyoRdCd).zfill(2)}"
            if len(pnu_prefix) != 10 or not pnu_prefix.isdigit(): return [None]
            
            lot_numbers = [num.strip() for num in str(daepyoLotno).split('^') if num.strip()]
            if not lot_numbers: return [None]
            
            pnu_list = []
            for lot_number in lot_numbers:
                land_type = "2" if "산" in lot_number else "1"
                lot_number_clean = lot_number.replace("산", "")
                parts = lot_number_clean.split('-')
                main_number = ''.join(filter(str.isdigit, parts[0]))
                if not main_number: continue
                sub_number = "0000"
                if len(parts) > 1:
                    sub_number = ''.join(filter(str.isdigit, parts[1]))
                    if not sub_number: sub_number = "0000"
                pnu = f"{pnu_prefix}{land_type}{main_number.zfill(4)}{sub_number.zfill(4)}"
                if len(pnu) == 19: pnu_list.append(pnu)
            return pnu_list if pnu_list else [None]
        except Exception as e:
            logger.error(f"PNU 생성 중 오류: {e}")
            return [None]

    @retry_with_backoff()
    async def get_land_use_info(self, pnu: str, session: aiohttp.ClientSession) -> Dict:
        """vworld API로 토지이용정보를 가져옵니다."""
        params = {'key': self.api_key, 'pnu': pnu, 'domain': 'api.vworld.kr', 'format': 'json'}
        try:
            async with session.get(self.base_url, params=params, ssl=False) as response:
                response.raise_for_status()
                data = await response.json()
                land_uses = [item['prposAreaDstrcCodeNm'] for item in data.get('landUses', {}).get('field', []) if 'prposAreaDstrcCodeNm' in item]
                return {'pnu': pnu, 'land_use': ', '.join(land_uses) if land_uses else None}
        except Exception as e:
            logger.error(f"토지이용정보 조회 실패 (PNU: {pnu}): {e}")
            return {'pnu': pnu, 'land_use': None, 'error': str(e)}

async def process_batch(generator: PNUGenerator, df: pd.DataFrame, start_idx: int, batch_size: int) -> List[Dict]:
    """배치 단위로 PNU 생성 및 토지이용정보 조회"""
    end_idx = min(start_idx + batch_size, len(df))
    batch_df = df.iloc[start_idx:end_idx]
    
    tasks = []
    task_info = []

    for idx, row in batch_df.iterrows():
        pnus = generator.create_pnu(row['daepyoSidoCd'], row['daepyoSiguCd'], row['daepyoDongCd'], row['daepyoRdCd'], row['daepyoLotno'])
        for pnu in pnus:
            if pnu:
                task_info.append({'pnu': pnu, 'original_index': idx})
            else:
                task_info.append({'pnu': None, 'original_index': idx, 'error': 'PNU 생성 실패'})

    async with aiohttp.ClientSession(connector=aiohttp.TCPConnector(ssl=False)) as session:
        for info in task_info:
            if info.get('pnu'):
                tasks.append(generator.get_land_use_info(info['pnu'], session))
        
        api_results = await asyncio.gather(*tasks, return_exceptions=True)

    final_results = []
    api_result_index = 0
    for info in task_info:
        if 'error' in info:
            final_results.append(info)
        else:
            result = api_results[api_result_index]
            if isinstance(result, Exception):
                final_results.append({'original_index': info['original_index'], 'pnu': info['pnu'], 'land_use': None, 'error': str(result)})
            else:
                final_results.append({'original_index': info['original_index'], **result})
            api_result_index += 1
            
    return final_results

async def main():
    """메인 함수 (테스트용)"""
    try:
        df = pd.read_excel('auction_list.xlsx')
        generator = PNUGenerator()
        
        all_results, failed_cases = [], []
        batch_size = 200
        
        with tqdm(total=len(df), desc="토지이용정보 조회 중") as pbar:
            for start_idx in range(0, len(df), batch_size):
                batch_results = await process_batch(generator, df, start_idx, batch_size)
                for result in batch_results:
                    if result.get('error') or not result.get('land_use'):
                        original_row = df.iloc[result['original_index']]
                        failed_cases.append({**original_row.to_dict(), 'pnu': result.get('pnu'), 'error': result.get('error', 'API 응답 없음')})
                    else:
                        all_results.append(result)
                pbar.update(min(batch_size, len(df) - start_idx))
        
        if all_results:
            result_df = pd.DataFrame(all_results)
            result_df.to_excel('auction_list_with_land_use.xlsx', index=False)
            print(f"\n성공 {len(all_results)}건 -> auction_list_with_land_use.xlsx")
        
        if failed_cases:
            failed_df = pd.DataFrame(failed_cases)
            failed_df.to_excel('failed_cases.xlsx', index=False)
            print(f"실패 {len(failed_cases)}건 -> failed_cases.xlsx")
        
    except FileNotFoundError:
        print("auction_list.xlsx 파일을 찾을 수 없습니다.")
    except Exception as e:
        print(f"오류 발생: {e}")

if __name__ == "__main__":
    asyncio.run(main()) 