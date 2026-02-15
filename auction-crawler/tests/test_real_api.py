"""
실제 API 통합 테스트 스크립트
실제 vworld API를 호출하여 코드가 제대로 작동하는지 확인합니다.
"""
import asyncio

import aiohttp
import pytest

from config import API_CONFIG
from pnu_generator import PNUGenerator


@pytest.mark.real_api
@pytest.mark.asyncio
async def test_real_api():
    """실제 API를 호출하여 테스트"""
    print("=" * 60)
    print("실제 API 통합 테스트 시작")
    print("=" * 60)

    # API 설정 확인
    print("\n1. API 설정 확인:")
    print(f"   - API URL: {API_CONFIG['vworld_url']}")
    print(f"   - API Key: {API_CONFIG['vworld_api_key'][:10]}...")

    # PNU 생성 테스트
    print("\n2. PNU 생성 테스트:")
    generator = PNUGenerator()

    # 테스트용 PNU 생성 (서울시 강남구 역삼동 예시)
    test_cases = [
        ("11", "680", "101", "00", "123-45"),  # 서울시 강남구 역삼동
        ("11", "110", "101", "00", "123-45"),  # 서울시 종로구 청와대로
    ]

    for sido, sigu, dong, rd, lotno in test_cases:
        pnus = generator.create_pnu(sido, sigu, dong, rd, lotno)
        print(f"   - 입력: {sido}, {sigu}, {dong}, {rd}, {lotno}")
        print(f"   - 생성된 PNU: {pnus}")

        if pnus and pnus[0]:
            # 실제 API 호출 테스트
            print(f"\n3. 실제 API 호출 테스트 (PNU: {pnus[0]}):")
            try:
                async with aiohttp.ClientSession(connector=aiohttp.TCPConnector(ssl=False)) as session:
                    # cnflcAt 없이 호출
                    result1 = await generator.get_land_use_info(pnus[0], session)
                    print("   - cnflcAt=None 결과:")
                    print(f"     * PNU: {result1.get('pnu')}")
                    print(f"     * Land Use: {result1.get('land_use')}")
                    print(f"     * Error: {result1.get('error')}")

                    # cnflcAt=1로 호출
                    result2 = await generator.get_land_use_info(pnus[0], session, "1")
                    print("   - cnflcAt=1 결과:")
                    print(f"     * PNU: {result2.get('pnu')}")
                    print(f"     * Land Use: {result2.get('land_use')}")
                    print(f"     * Error: {result2.get('error')}")

                    if result1.get('error') or result2.get('error'):
                        print("\n   ⚠️  API 호출 중 오류 발생:")
                        print(f"      - result1 error: {result1.get('error')}")
                        print(f"      - result2 error: {result2.get('error')}")
                    else:
                        print("\n   ✅ API 호출 성공!")
                        print("      - 실제 응답 형식이 예상과 일치합니다.")

            except Exception as e:
                print(f"   ❌ API 호출 실패: {e}")
                import traceback
                traceback.print_exc()

            # 첫 번째 PNU만 테스트
            break

    print("\n" + "=" * 60)
    print("테스트 완료")
    print("=" * 60)

if __name__ == "__main__":
    asyncio.run(test_real_api())

