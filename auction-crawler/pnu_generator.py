import pandas as pd
from typing import List, Dict, Optional
import aiohttp
import asyncio
import re
from tqdm import tqdm
from config import API_CONFIG
from utils import logger, retry_with_backoff

class PNUGenerator:
    def __init__(self):
        self.base_url = API_CONFIG['vworld_url']
        self.api_key = API_CONFIG['vworld_api_key']
        
    def create_pnu(self, daepyoSidoCd: str, daepyoSiguCd: str, daepyoDongCd: str, daepyoRdCd: Optional[str], daepyoLotno: str) -> List[Optional[str]]:
        """PNU(필지고유번호)를 생성합니다."""
        try:
            # 원본 길이 검증 (zfill 전에 검증)
            if len(str(daepyoSidoCd)) != 2 or not str(daepyoSidoCd).isdigit():
                return [None]
            if len(str(daepyoSiguCd)) != 3 or not str(daepyoSiguCd).isdigit():
                return [None]
            if len(str(daepyoDongCd)) != 3 or not str(daepyoDongCd).isdigit():
                return [None]
            
            riCd = str(daepyoRdCd or "00").zfill(2)
            pnu_prefix = f"{str(daepyoSidoCd).zfill(2)}{str(daepyoSiguCd).zfill(3)}{str(daepyoDongCd).zfill(3)}{riCd}"
            if len(pnu_prefix) != 10 or not pnu_prefix.isdigit():
                return [None]
            
            lot_numbers = [num.strip() for num in str(daepyoLotno).split('^') if num.strip()]
            if not lot_numbers:
                return [None]
            
            pnu_list = []
            for num in lot_numbers:
                land_type = "2" if "산" in num else "1"
                # "산1-3", "산 1-3", "산-1" 등 처리
                num_clean = re.sub(r"산\s*-*\s*", "", num)
                parts = re.split(r"[-\s]", num_clean)
                main = ''.join(filter(str.isdigit, parts[0])) if parts else ""
                sub = ''.join(filter(str.isdigit, parts[1])) if len(parts) > 1 else "0000"
                if not main:
                    continue
                pnu = f"{pnu_prefix}{land_type}{main.zfill(4)}{sub.zfill(4)}"
                if len(pnu) == 19:
                    pnu_list.append(pnu)
            return pnu_list if pnu_list else [None]
        except Exception as e:
            logger.error(f"PNU 생성 중 오류: {e}")
            return [None]

    @retry_with_backoff()
    async def get_land_use_info(self, pnu: str, session: aiohttp.ClientSession, cnflcAt: Optional[str] = None) -> Dict:
        """vworld API로 토지이용정보를 가져옵니다. cnflcAt이 주어지면 해당 옵션으로 조회합니다."""
        params = {'key': self.api_key, 'pnu': pnu, 'domain': 'api.vworld.kr', 'format': 'json'}
        if cnflcAt:
            params['cnflcAt'] = cnflcAt
        try:
            async with session.get(self.base_url, params=params, ssl=False) as response:
                response.raise_for_status()
                data = await response.json()
                land_uses = [item['prposAreaDstrcCodeNm'] for item in data.get('landUses', {}).get('field', []) if 'prposAreaDstrcCodeNm' in item]
                return {
                    'pnu': pnu,
                    'cnflcAt': cnflcAt,
                    'land_use': ', '.join(land_uses) if land_uses else None
                }
        except Exception as e:
            logger.error(f"토지이용정보 조회 실패 (PNU: {pnu}, cnflcAt: {cnflcAt}): {e}")
            return {'pnu': pnu, 'cnflcAt': cnflcAt, 'land_use': None, 'error': str(e)}

async def process_batch(generator: PNUGenerator, df: pd.DataFrame, start_idx: int, batch_size: int) -> List[Dict]:
    """배치 단위로 PNU 생성 및 토지이용정보 조회"""
    end_idx = min(start_idx + batch_size, len(df))
    batch_df = df.iloc[start_idx:end_idx]
    
    tasks = []
    task_info = []

    for idx, row in batch_df.iterrows():
        # riCd가 없거나 빈 값인 경우 None으로 처리
        riCd = row.get('daepyoRdCd') if pd.notna(row.get('daepyoRdCd')) and str(row.get('daepyoRdCd')).strip() else None
        pnus = generator.create_pnu(row['daepyoSidoCd'], row['daepyoSiguCd'], row['daepyoDongCd'], riCd, row['daepyoLotno'])
        for pnu in pnus:
            if pnu:
                task_info.append({'pnu': pnu, 'original_index': idx})
            else:
                task_info.append({'pnu': None, 'original_index': idx, 'error': 'PNU 생성 실패'})

    # 세 가지 cnflcAt 값에 대한 호출을 준비
    cnflc_values = ["1", "2", "3"]
    task_meta: List[Dict] = []

    async with aiohttp.ClientSession(connector=aiohttp.TCPConnector(ssl=False)) as session:
        for info in task_info:
            if info.get('pnu'):
                for cval in cnflc_values:
                    tasks.append(generator.get_land_use_info(info['pnu'], session, cval))
                    task_meta.append({'original_index': info['original_index'], 'pnu': info['pnu'], 'cnflcAt': cval})
        
        api_results = await asyncio.gather(*tasks, return_exceptions=True)

    # 결과를 original_index, pnu 기준으로 집계하여 land_use_1/2/3 필드로 합치기
    aggregated: Dict[str, Dict] = {}
    for meta, res in zip(task_meta, api_results):
        key = f"{meta['original_index']}|{meta['pnu']}"
        if key not in aggregated:
            aggregated[key] = {
                'original_index': meta['original_index'],
                'pnu': meta['pnu'],
                'land_use_1': None,
                'land_use_2': None,
                'land_use_3': None
            }
        # 에러인 경우는 건너뛰고, 빈 값으로 유지
        if isinstance(res, Exception):
            continue
        land_value = None if res is None else res.get('land_use')
        if meta['cnflcAt'] == '1':
            aggregated[key]['land_use_1'] = land_value
        elif meta['cnflcAt'] == '2':
            aggregated[key]['land_use_2'] = land_value
        elif meta['cnflcAt'] == '3':
            aggregated[key]['land_use_3'] = land_value

    # PNU 생성 실패 등의 케이스 포함하여 최종 결과 배열 구성
    final_results: List[Dict] = []
    success_keys = set(aggregated.keys())
    for info in task_info:
        if 'error' in info:
            final_results.append(info)
        else:
            key = f"{info['original_index']}|{info['pnu']}"
            if key in success_keys:
                entry = aggregated[key]
                final_results.append(entry)
            else:
                final_results.append({'original_index': info['original_index'], 'pnu': info['pnu'], 'land_use_1': None, 'land_use_2': None, 'land_use_3': None, 'error': 'API 응답 없음'})
            
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