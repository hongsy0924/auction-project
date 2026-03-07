import asyncio
import re

import aiohttp
import pandas as pd
from tqdm import tqdm

from bjdong_code import lookup_bjdong_code
from config import API_CONFIG
from utils import logger, retry_with_backoff


# ── 행정코드 매핑 (hjguSido → daepyoSidoCd 변환용) ──────────────────
# hjgu 필드(한글 시도명)로부터 행정코드를 역산하기 위한 매핑
SIDO_CODE_MAP: dict[str, str] = {
    "서울특별시": "11", "서울": "11",
    "부산광역시": "26", "부산": "26",
    "대구광역시": "27", "대구": "27",
    "인천광역시": "28", "인천": "28",
    "광주광역시": "29", "광주": "29",
    "대전광역시": "30", "대전": "30",
    "울산광역시": "31", "울산": "31",
    "세종특별자치시": "36", "세종": "36",
    "경기도": "41", "경기": "41",
    "강원도": "42", "강원특별자치도": "42", "강원": "42",
    "충청북도": "43", "충북": "43",
    "충청남도": "44", "충남": "44",
    "전라북도": "45", "전북특별자치도": "52", "전북": "52",
    "전라남도": "46", "전남": "46",
    "경상북도": "47", "경북": "47",
    "경상남도": "48", "경남": "48",
    "제주특별자치도": "50", "제주": "50",
}


def _safe_code(val: object, expected_len: int) -> str | None:
    """
    pandas에서 읽은 행정코드 값을 안전하게 문자열로 변환.
    - float(44.0) → "44"
    - int(760) → "760"
    - str("390") → "390"
    - NaN / None / 비숫자 → None
    """
    if val is None or (isinstance(val, float) and pd.isna(val)):
        return None
    # float → int → str  (44.0 → 44 → "44")
    if isinstance(val, float):
        val = int(val)
    s = str(val).strip()
    # "00" 같은 엑셀 지수 표기 오류 ("0E") 등 필터링
    if not s.isdigit():
        return None
    s = s.zfill(expected_len)
    if len(s) != expected_len:
        return None
    return s


def _clean_lotno(raw: str) -> list[str]:
    """
    daepyoLotno를 정제하여 순수 지번 문자열 리스트로 반환.

    처리하는 케이스:
    1. 괄호 안 내용 제거:  "1160-6(현1564-1)" → "1160-6"
    2. 건물/동호수 제거:   "1209 2동호" → "1209"
    3. 쉼표 구분자:       "213,214,94-2" → ["213", "214", "94-2"]
    4. ^ 구분자:          "123-45^678-90" → ["123-45", "678-90"]
    5. 비지번 텍스트:     "토지, 건물", "제1동 외 15필지" → 필터링
    """
    if not raw or not raw.strip():
        return []

    text = str(raw).strip()

    # 1) 괄호 안 내용 제거 (가장 먼저)
    #    "1160-6(현1564-1)" → "1160-6"
    #    "(가중리, 은남로20번길 44-24)" → ""  (전체가 괄호면 빈 문자열)
    text = re.sub(r"\([^)]*\)", "", text).strip()

    if not text:
        return []

    # 2) ^ 와 , 모두 구분자로 사용하여 분할
    parts = re.split(r"[\^,]", text)
    parts = [p.strip() for p in parts if p.strip()]

    results = []
    for part in parts:
        # 3) 건물/동호수 접미사 제거
        #    "1209 2동호" → "1209"
        #    "1268 3동"   → "1268"
        #    "1613 1호"   → "1613"
        #    "1021 제1호" → "1021"
        #    "1104 휴아림타운하우스 103동호" → "1104"
        #    "제1동 외 15필지" → ""  (필터링됨)
        cleaned = re.sub(
            r"\s+(?:"
            r"\S*타운하우스.*"       # "휴아림타운하우스 103동호"
            r"|제?\d*동호?"          # "2동호", "제1동", "3동"
            r"|제?\d+호"            # "1호", "제2호"
            r"|주\d+동"             # "주1동"
            r")(?:\s+외\s+\d+필지)?$",  # optional "외 N필지" suffix
            "",
            part,
        ).strip()
        # Standalone "외 N필지" (without 동호 prefix)
        cleaned = re.sub(r"\s+외\s+\d+필지$", "", cleaned).strip()

        # 4) 순수 비지번 텍스트 필터링 ("토지", "건물" 등)
        if not cleaned:
            continue
        # 최소한 숫자가 하나는 있어야 지번
        if not re.search(r"\d", cleaned):
            continue

        results.append(cleaned)

    return results


class PNUGenerator:
    def __init__(self):
        self.base_url = API_CONFIG['vworld_url']
        self.api_key = API_CONFIG['vworld_api_key']

    def create_pnu(
        self,
        daepyoSidoCd: object,
        daepyoSiguCd: object,
        daepyoDongCd: object,
        daepyoRdCd: object | None,
        daepyoLotno: str,
    ) -> list[str | None]:
        """PNU(필지고유번호)를 생성합니다."""
        try:
            # 행정코드 안전 변환 (float→int→str, NaN 처리)
            sido = _safe_code(daepyoSidoCd, 2)
            sigu = _safe_code(daepyoSiguCd, 3)
            dong = _safe_code(daepyoDongCd, 3)

            if not sido or not sigu or not dong:
                return [None]

            ri = _safe_code(daepyoRdCd, 2) or "00"
            pnu_prefix = f"{sido}{sigu}{dong}{ri}"
            if len(pnu_prefix) != 10 or not pnu_prefix.isdigit():
                return [None]

            # 지번 정제
            lot_numbers = _clean_lotno(daepyoLotno)
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

    def create_pnu_from_address(
        self,
        hjguSido: str | None,
        hjguSigu: str | None,
        hjguDong: str | None,
        daepyoLotno: str,
        printSt: str | None = None,
        hjguRd: str | None = None,
    ) -> list[str | None]:
        """
        Fallback: hjgu 필드(한글 행정구역명) + 법정동코드 DB로 PNU를 생성합니다.
        daepyoSidoCd 등이 NaN일 때 사용합니다.
        """
        try:
            # 법정동코드 조회 → 10자리 접두사
            bjdong_code = lookup_bjdong_code(
                hjguSido, hjguSigu, hjguDong, hjguRd, daepyoLotno,
            )
            if not bjdong_code:
                logger.debug(
                    f"PNU fallback 실패 (법정동코드 미매칭): "
                    f"{hjguSido} {hjguSigu} {hjguDong}, "
                    f"지번: {daepyoLotno}, 주소: {printSt}"
                )
                return [None]

            pnu_prefix = bjdong_code  # 10자리

            # 지번 정제 — daepyoLotno + printSt에서 추출
            # 리 이름이 지번 앞에 붙어있으면 제거 (예: "야촌리 483-39" → "483-39")
            # 쉼표 구분된 각 항목에서도 제거 (예: "상리 725, 상리 726")
            lotno_for_clean = re.sub(
                r"[가-힣]+리\s+", "", daepyoLotno.strip()
            ) if daepyoLotno else daepyoLotno
            lot_numbers = _clean_lotno(lotno_for_clean)

            # daepyoLotno가 전체 괄호이거나 비지번인 경우 printSt에서 추출 시도
            if not lot_numbers and printSt:
                lot_numbers = self._extract_lotno_from_printst(printSt)

            if not lot_numbers:
                logger.debug(
                    f"PNU fallback: 법정동코드 {bjdong_code} 매칭, "
                    f"지번 추출 실패: {daepyoLotno}"
                )
                return [None]

            pnu_list = []
            for num in lot_numbers:
                land_type = "2" if "산" in num else "1"
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
            logger.error(f"PNU fallback 중 오류: {e}")
            return [None]

    @staticmethod
    def _extract_lotno_from_printst(printSt: str) -> list[str]:
        """printSt(주소 문자열)에서 지번 부분만 추출."""
        if not printSt:
            return []
        # "소재지 : ... 동/리 123-45 ..." 에서 지번 추출
        # 동/리 이름 뒤의 숫자 패턴 찾기
        m = re.search(
            r"(?:동\d*가?|리)\s+(산?\s*\d+(?:-\d+)?(?:\s*(?:,\s*산?\s*\d+(?:-\d+)?))*)",
            printSt,
        )
        if m:
            return _clean_lotno(m.group(1))
        return []

    @retry_with_backoff()
    async def get_land_use_info(self, pnu: str, session: aiohttp.ClientSession, cnflcAt: str | None = None) -> dict:
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

async def process_batch(generator: PNUGenerator, df: pd.DataFrame, start_idx: int, batch_size: int) -> list[dict]:
    """배치 단위로 PNU 생성 및 토지이용정보 조회"""
    end_idx = min(start_idx + batch_size, len(df))
    batch_df = df.iloc[start_idx:end_idx]

    tasks = []
    task_info = []

    for idx, row in batch_df.iterrows():
        # riCd가 없거나 빈 값인 경우 None으로 처리
        riCd = row.get('daepyoRdCd') if pd.notna(row.get('daepyoRdCd')) and str(row.get('daepyoRdCd')).strip() else None

        # 1차: 행정코드 기반 PNU 생성
        pnus = generator.create_pnu(
            row.get('daepyoSidoCd'),
            row.get('daepyoSiguCd'),
            row.get('daepyoDongCd'),
            riCd,
            str(row.get('daepyoLotno', '')),
        )

        # 2차 fallback: 행정코드가 NaN이면 hjgu 필드로 시도
        if pnus == [None] and pd.isna(row.get('daepyoSidoCd')):
            pnus = generator.create_pnu_from_address(
                row.get('hjguSido'),
                row.get('hjguSigu'),
                row.get('hjguDong'),
                str(row.get('daepyoLotno', '')),
                row.get('printSt'),
                row.get('hjguRd'),
            )

        for pnu in pnus:
            if pnu:
                task_info.append({'pnu': pnu, 'original_index': idx})
            else:
                task_info.append({'pnu': None, 'original_index': idx, 'error': 'PNU 생성 실패'})

    # 세 가지 cnflcAt 값에 대한 호출을 준비
    cnflc_values = ["1", "2", "3"]
    task_meta: list[dict] = []

    async with aiohttp.ClientSession(connector=aiohttp.TCPConnector(ssl=False)) as session:
        for info in task_info:
            if info.get('pnu'):
                for cval in cnflc_values:
                    tasks.append(generator.get_land_use_info(info['pnu'], session, cval))
                    task_meta.append({'original_index': info['original_index'], 'pnu': info['pnu'], 'cnflcAt': cval})

        api_results = await asyncio.gather(*tasks, return_exceptions=True)

    # 결과를 original_index, pnu 기준으로 집계하여 land_use_1/2/3 필드로 합치기
    aggregated: dict[str, dict] = {}
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
    final_results: list[dict] = []
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
