import requests
import json
from urllib.parse import quote

def get_soil_info(mgtNo: str, api_key: str):
    """
    환경영향평가 토양정보 API 호출 (JSON 형식)
    
    Args:
        mgtNo: 관리번호 (필수)
        api_key: 공공데이터포털 서비스 인증키 (필수)
    
    Returns:
        dict: API 응답 JSON 데이터
    """
    url = "https://apis.data.go.kr/1480523/SoilService/getInfo"
    
    # serviceKey는 URL 인코딩이 필요할 수 있음
    params = {
        "serviceKey": api_key,
        "mgtNo": mgtNo,
        "type": "json"  # JSON 형식으로 응답 받기
    }
    
    try:
        response = requests.get(url, params=params, timeout=30)
        
        # HTTP 상태 코드 확인
        print(f"📡 HTTP 상태 코드: {response.status_code}")
        print(f"📡 응답 헤더: {dict(response.headers)}")
        print()
        
        response_text = response.text
        
        # HTTP 에러가 있어도 서버 응답 내용은 반환
        if response.status_code != 200:
            print(f"⚠️ HTTP 에러 발생 (상태 코드: {response.status_code})")
            print(f"서버 응답 내용:")
            print("-" * 60)
            print(response_text)
            print("-" * 60)
            # JSON 파싱 시도
            try:
                return response.json()
            except:
                return {"raw_response": response_text}
        
        # JSON 파싱하여 응답 구조 확인
        try:
            result = response.json()
            
            # 공공데이터포털 API 응답 구조 확인
            if "response" in result:
                response_body = result["response"]
                if "header" in response_body:
                    header = response_body["header"]
                    result_code = header.get("resultCode", "")
                    result_msg = header.get("resultMsg", "")
                    
                    if result_code != "00":
                        print(f"⚠️ API 오류: {result_code} - {result_msg}")
                        print(f"서버 응답 전체 내용:")
                        print("-" * 60)
                        print(json.dumps(result, indent=2, ensure_ascii=False))
                        print("-" * 60)
                        # 에러가 있어도 응답 내용은 반환
                        return result
                    
                    print(f"✅ API 호출 성공: {result_msg}")
                
                if "body" in response_body:
                    body = response_body["body"]
                    total_count = body.get("totalCount", 0)
                    print(f"📊 총 데이터 수: {total_count}")
                    
                    if "items" in body:
                        items = body["items"]
                        if isinstance(items, list):
                            print(f"📋 반환된 항목 수: {len(items)}")
                        elif isinstance(items, dict) and "item" in items:
                            item_list = items["item"]
                            if isinstance(item_list, list):
                                print(f"📋 반환된 항목 수: {len(item_list)}")
                            else:
                                print(f"📋 반환된 항목 수: 1")
                        else:
                            print(f"📋 반환된 항목 수: 0")
            
            return result
        
        except json.JSONDecodeError as e:
            print(f"⚠️ JSON 파싱 경고: {e}")
            print(f"서버 응답 원본 내용:")
            print("-" * 60)
            print(response_text)
            print("-" * 60)
            return {"raw_response": response_text, "parse_error": str(e)}
        
    except requests.exceptions.RequestException as e:
        print(f"❌ API 요청 실패: {e}")
        print(f"요청 URL: {url}")
        print(f"요청 파라미터: {params}")
        # 예외 발생 시에도 가능한 정보 출력
        if hasattr(e, 'response') and e.response is not None:
            print(f"서버 응답 상태 코드: {e.response.status_code}")
            print(f"서버 응답 내용: {e.response.text}")
        return None
    except Exception as e:
        print(f"❌ 예상치 못한 오류: {e}")
        import traceback
        print("상세 오류 정보:")
        traceback.print_exc()
        return None


if __name__ == "__main__":
    # 공공데이터포털에서 발급받은 실제 서비스 인증키를 입력하세요
    api_key = "3bb05367eb39fe1aace887eaed1f159cb087d8b3e5ed12e896248d47e3e13483"
    
    # 테스트용 관리번호 (실제 관리번호로 변경 필요)
    mgtNo = "GG2021E008"
    
    print("=" * 60)
    print("환경영향평가 토양정보 API 테스트")
    print("=" * 60)
    print(f"관리번호: {mgtNo}")
    print()
    
    # API 호출
    result = get_soil_info(mgtNo=mgtNo, api_key=api_key)
    
    if result:
        print()
        print("=" * 60)
        print("서버 응답 전체 내용 (JSON):")
        print("=" * 60)
        
        # JSON을 보기 좋게 포맷팅하여 출력
        if isinstance(result, dict):
            print(json.dumps(result, indent=2, ensure_ascii=False))
        else:
            print(result)
    else:
        print("\n❌ API 호출 실패 - 응답을 받지 못했습니다")