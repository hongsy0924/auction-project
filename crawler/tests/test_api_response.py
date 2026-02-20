"""
실제 API 응답 형식 확인 스크립트
API가 반환하는 실제 데이터 구조를 확인합니다.
"""
import asyncio
import json

import aiohttp
import pytest

from config import API_CONFIG


@pytest.mark.real_api
@pytest.mark.asyncio
async def test_api_response():
    """실제 API 응답 형식 확인"""
    print("=" * 60)
    print("실제 API 응답 형식 확인")
    print("=" * 60)

    # 테스트용 PNU (서울특별시 관악구 신림동 655-46)
    test_pnu = "1162010200106550046"

    params = {
        'key': API_CONFIG['vworld_api_key'],
        'pnu': test_pnu,
        'domain': 'api.vworld.kr',
        'format': 'json'
    }

    print("\n1. API 호출 정보:")
    print(f"   - URL: {API_CONFIG['vworld_url']}")
    print(f"   - PNU: {test_pnu}")
    print(f"   - Params: {params}")

    try:
        async with aiohttp.ClientSession(connector=aiohttp.TCPConnector(ssl=False)) as session:
            # cnflcAt 없이 호출
            print("\n2. cnflcAt 없이 호출:")
            async with session.get(API_CONFIG['vworld_url'], params=params, ssl=False) as response:
                print(f"   - Status: {response.status}")
                data1 = await response.json()
                print("   - 응답 데이터:")
                print(json.dumps(data1, indent=2, ensure_ascii=False))

            # cnflcAt=1로 호출
            print("\n3. cnflcAt=1로 호출:")
            params_with_cnflc = {**params, 'cnflcAt': '1'}
            async with session.get(API_CONFIG['vworld_url'], params=params_with_cnflc, ssl=False) as response:
                print(f"   - Status: {response.status}")
                data2 = await response.json()
                print("   - 응답 데이터:")
                print(json.dumps(data2, indent=2, ensure_ascii=False))

            # cnflcAt=2로 호출
            print("\n4. cnflcAt=2로 호출:")
            params_with_cnflc = {**params, 'cnflcAt': '2'}
            async with session.get(API_CONFIG['vworld_url'], params=params_with_cnflc, ssl=False) as response:
                print(f"   - Status: {response.status}")
                data3 = await response.json()
                print("   - 응답 데이터:")
                print(json.dumps(data3, indent=2, ensure_ascii=False))

            # cnflcAt=3로 호출
            print("\n5. cnflcAt=3로 호출:")
            params_with_cnflc = {**params, 'cnflcAt': '3'}
            async with session.get(API_CONFIG['vworld_url'], params=params_with_cnflc, ssl=False) as response:
                print(f"   - Status: {response.status}")
                data4 = await response.json()
                print("   - 응답 데이터:")
                print(json.dumps(data4, indent=2, ensure_ascii=False))

            print("\n" + "=" * 60)
            print("응답 형식 확인 완료")
            print("=" * 60)

            # 데이터 구조 분석
            print("\n6. 데이터 구조 분석:")
            if 'landUses' in data1:
                print("   - landUses 키 존재: ✅")
                if 'field' in data1['landUses']:
                    print("   - field 키 존재: ✅")
                    print(f"   - field 개수: {len(data1['landUses']['field'])}")
                    if data1['landUses']['field']:
                        print("   - 첫 번째 항목 구조:")
                        print(json.dumps(data1['landUses']['field'][0], indent=2, ensure_ascii=False))
                else:
                    print("   - field 키 없음: ❌")
            else:
                print("   - landUses 키 없음: ❌")
                print(f"   - 실제 키들: {list(data1.keys())}")

    except Exception as e:
        print(f"❌ API 호출 실패: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    asyncio.run(test_api_response())

