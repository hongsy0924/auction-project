"""
경매 API 응답 확인 스크립트
실패한 페이지의 API 응답을 확인하여 데이터가 없는 것인지, API 차단인지 확인합니다.
"""
import asyncio
import datetime
import json

import aiohttp
import pytest

from config import API_CONFIG, CRAWLING_CONFIG


@pytest.mark.real_api
@pytest.mark.asyncio
async def test_auction_api_response(page: int = 1):
    """특정 페이지의 API 응답 확인"""
    print(f"\n{'='*60}")
    print(f"페이지 {page} API 응답 확인")
    print(f"{'='*60}")

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
        "Referer": API_CONFIG['base_url']
    }

    try:
        async with aiohttp.ClientSession() as session:
            # 1. 메인 페이지 방문하여 쿠키 획득
            main_url = "https://www.courtauction.go.kr/pgj/index.on"
            print(f"   - 메인 페이지 방문: {main_url}")
            async with session.get(main_url, headers=headers, ssl=False) as main_response:
                print(f"   - 메인 페이지 응답: {main_response.status}")
                print("   - 쿠키 획득 완료")

            # 2. API 호출
            async with session.post(
                API_CONFIG['api_url'],
                json=data,
                headers=headers,
                ssl=False,
                timeout=aiohttp.ClientTimeout(total=30)
            ) as response:
                print(f"\n1. HTTP 상태 코드: {response.status}")
                print("2. 응답 헤더:")
                for key, value in response.headers.items():
                    print(f"   {key}: {value}")

                result = await response.json()

                print("\n3. 응답 JSON 구조:")
                print(f"   - 최상위 키들: {list(result.keys())}")

                if 'data' in result:
                    data_node = result['data']
                    print("   - data 키 존재: ✅")
                    print(f"   - data 내부 키들: {list(data_node.keys()) if isinstance(data_node, dict) else 'Not a dict'}")

                    if 'dlt_srchResult' in data_node:
                        auctions = data_node['dlt_srchResult']
                        print(f"   - dlt_srchResult 타입: {type(auctions)}")
                        if isinstance(auctions, list):
                            print(f"   - dlt_srchResult 길이: {len(auctions)}")
                            if len(auctions) == 0:
                                print("   ⚠️  빈 배열 반환 (데이터 없음)")
                            else:
                                print(f"   ✅ 데이터 존재: {len(auctions)}개")
                        else:
                            print(f"   ⚠️  예상과 다른 타입: {auctions}")
                    else:
                        print("   ⚠️  dlt_srchResult 키가 없습니다")

                    if 'dma_pageInfo' in data_node:
                        page_info = data_node['dma_pageInfo']
                        print(f"   - dma_pageInfo: {page_info}")

                else:
                    print("   ⚠️  data 키가 없습니다")

                if 'error' in result:
                    print("\n⚠️  에러 응답 발견:")
                    print(f"   {result['error']}")

                if 'message' in result:
                    print("\n⚠️  메시지 응답 발견:")
                    print(f"   {result['message']}")

                print("\n4. 전체 응답 (처음 1000자):")
                response_str = json.dumps(result, indent=2, ensure_ascii=False)
                print(response_str[:1000])
                if len(response_str) > 1000:
                    print(f"\n   ... (총 {len(response_str)}자, 나머지 생략)")

    except Exception as e:
        print(f"\n❌ API 호출 실패: {e}")
        import traceback
        traceback.print_exc()

async def main():
    """여러 페이지 테스트"""
    # 성공한 페이지와 실패한 페이지 비교
    test_pages = [1, 2, 39, 40, 41]  # 1, 2는 성공할 가능성, 39-41은 실패한 페이지

    for page in test_pages:
        await test_auction_api_response(page)
        await asyncio.sleep(1)  # API 부하 방지

if __name__ == "__main__":
    asyncio.run(main())

