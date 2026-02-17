from unittest.mock import AsyncMock, MagicMock, patch

import aiohttp
import pandas as pd
import pytest

from pnu_generator import PNUGenerator, process_batch


class AsyncContextManager:
    """async with 구문을 위한 컨텍스트 매니저"""
    def __init__(self, return_value):
        self.return_value = return_value

    async def __aenter__(self):
        return self.return_value

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        return False


class TestPNUGenerator:
    """PNUGenerator 클래스 테스트"""

    def setup_method(self):
        """각 테스트 전에 실행"""
        self.generator = PNUGenerator()

    # create_pnu 테스트 케이스
    def test_create_pnu_basic(self):
        """기본적인 PNU 생성 테스트"""
        result = self.generator.create_pnu("11", "110", "101", "00", "123-45")
        assert result is not None
        assert len(result) > 0
        assert result[0] is not None
        assert len(result[0]) == 19
        assert result[0] == "1111010100101230045"

    def test_create_pnu_with_mountain(self):
        """산 지번 처리 테스트"""
        result = self.generator.create_pnu("11", "110", "101", "00", "산123-45")
        assert result is not None
        assert len(result) > 0
        assert result[0] is not None
        assert result[0][10] == "2"  # 산은 land_type "2"
        assert result[0] == "1111010100201230045"

    def test_create_pnu_mountain_variations(self):
        """산 지번 다양한 형식 테스트"""
        # "산1-3" 형식
        result1 = self.generator.create_pnu("11", "110", "101", "00", "산1-3")
        assert result1[0] is not None

        # "산 1-3" 형식 (공백 포함)
        result2 = self.generator.create_pnu("11", "110", "101", "00", "산 1-3")
        assert result2[0] is not None

        # "산-1" 형식
        result3 = self.generator.create_pnu("11", "110", "101", "00", "산-1")
        assert result3[0] is not None

    def test_create_pnu_multiple_lots(self):
        """여러 지번이 ^로 구분된 경우"""
        result = self.generator.create_pnu("11", "110", "101", "00", "123-45^678-90")
        assert len(result) == 2
        assert result[0] == "1111010100101230045"
        assert result[1] == "1111010100106780090"

    def test_create_pnu_without_sub_number(self):
        """부번이 없는 경우"""
        result = self.generator.create_pnu("11", "110", "101", "00", "123")
        assert result[0] is not None
        assert result[0].endswith("1230000")

    def test_create_pnu_riCd_optional(self):
        """riCd가 None인 경우 기본값 "00" 사용"""
        result1 = self.generator.create_pnu("11", "110", "101", None, "123-45")
        result2 = self.generator.create_pnu("11", "110", "101", "00", "123-45")
        assert result1[0] == result2[0]

    def test_create_pnu_riCd_empty_string(self):
        """riCd가 빈 문자열인 경우"""
        result = self.generator.create_pnu("11", "110", "101", "", "123-45")
        assert result[0] is not None
        assert result[0].startswith("1111010100")

    def test_create_pnu_invalid_prefix(self):
        """잘못된 prefix (길이 또는 숫자가 아닌 경우)"""
        # 길이가 짧은 경우
        result1 = self.generator.create_pnu("1", "110", "101", "00", "123-45")
        assert result1 == [None]

        # 숫자가 아닌 문자가 포함된 경우
        result2 = self.generator.create_pnu("11", "ABC", "101", "00", "123-45")
        assert result2 == [None]

    def test_create_pnu_empty_lotno(self):
        """빈 지번 번호"""
        result = self.generator.create_pnu("11", "110", "101", "00", "")
        assert result == [None]

    def test_create_pnu_invalid_lotno(self):
        """유효하지 않은 지번 번호 (숫자가 없는 경우)"""
        result = self.generator.create_pnu("11", "110", "101", "00", "abc-def")
        assert result == [None]

    def test_create_pnu_zfill(self):
        """zfill 테스트 - 한 자리 숫자도 올바르게 채워지는지"""
        result = self.generator.create_pnu("1", "1", "1", "0", "1-2")
        # 길이가 짧아서 None이 반환되어야 함
        assert result == [None]

        # 올바른 형식
        result2 = self.generator.create_pnu("01", "001", "001", "00", "1-2")
        assert result2[0] is not None


class TestGetLandUseInfo:
    """get_land_use_info 메서드 테스트"""

    def setup_method(self):
        self.generator = PNUGenerator()

    @pytest.mark.asyncio
    async def test_get_land_use_info_success(self):
        """성공적인 API 호출 테스트"""
        mock_response = MagicMock()
        mock_response.status = 200
        mock_response.json = AsyncMock(return_value={
            'landUses': {
                'field': [
                    {'prposAreaDstrcCodeNm': '제1종일반주거지역'},
                    {'prposAreaDstrcCodeNm': '상업지역'}
                ]
            }
        })
        mock_response.raise_for_status = MagicMock()

        # session.get()이 반환하는 컨텍스트 매니저 객체 생성
        mock_context_manager = AsyncContextManager(mock_response)

        mock_session = AsyncMock()
        # session.get()이 호출되면 컨텍스트 매니저를 반환하도록 설정
        mock_session.get = lambda *args, **kwargs: mock_context_manager

        result = await self.generator.get_land_use_info("1111010100011230045", mock_session)

        assert result['pnu'] == "1111010100011230045"
        assert result['land_use'] == "제1종일반주거지역, 상업지역"
        assert 'error' not in result

    @pytest.mark.asyncio
    async def test_get_land_use_info_with_cnflcAt(self):
        """cnflcAt 파라미터 포함 테스트"""
        mock_response = MagicMock()
        mock_response.status = 200
        mock_response.json = AsyncMock(return_value={'landUses': {'field': []}})
        mock_response.raise_for_status = MagicMock()

        # session.get()이 반환하는 컨텍스트 매니저 객체 생성
        mock_context_manager = AsyncContextManager(mock_response)

        mock_session = AsyncMock()
        # session.get()이 호출되면 컨텍스트 매니저를 반환하도록 설정
        # call_args를 확인하기 위해 MagicMock 사용
        mock_session.get = MagicMock(return_value=mock_context_manager)

        result = await self.generator.get_land_use_info("1111010100011230045", mock_session, "1")

        assert result['cnflcAt'] == "1"
        # mock_session.get이 cnflcAt 파라미터를 받았는지 확인
        call_args = mock_session.get.call_args
        assert 'cnflcAt' in call_args[1]['params'] or 'cnflcAt' in call_args[0][1]

    @pytest.mark.asyncio
    async def test_get_land_use_info_empty_response(self):
        """빈 응답 테스트"""
        mock_response = MagicMock()
        mock_response.status = 200
        mock_response.json = AsyncMock(return_value={'landUses': {'field': []}})
        mock_response.raise_for_status = MagicMock()

        # session.get()이 반환하는 컨텍스트 매니저 객체 생성
        mock_context_manager = AsyncContextManager(mock_response)

        mock_session = AsyncMock()
        # session.get()이 호출되면 컨텍스트 매니저를 반환하도록 설정
        mock_session.get = lambda *args, **kwargs: mock_context_manager

        result = await self.generator.get_land_use_info("1111010100011230045", mock_session)

        assert result['land_use'] is None
        assert 'error' not in result

    @pytest.mark.asyncio
    async def test_get_land_use_info_api_error(self):
        """API 에러 처리 테스트"""
        mock_response = MagicMock()
        mock_response.raise_for_status = MagicMock(side_effect=aiohttp.ClientResponseError(
            request_info=MagicMock(),
            history=(),
            status=500,
            message="Internal Server Error"
        ))

        # session.get()이 반환하는 컨텍스트 매니저 객체 생성
        mock_context_manager = AsyncContextManager(mock_response)

        mock_session = AsyncMock()
        # session.get()이 호출되면 컨텍스트 매니저를 반환하도록 설정
        mock_session.get = lambda *args, **kwargs: mock_context_manager

        result = await self.generator.get_land_use_info("1111010100011230045", mock_session)

        assert result['land_use'] is None
        assert 'error' in result


class TestProcessBatch:
    """process_batch 함수 테스트"""

    @pytest.mark.asyncio
    async def test_process_batch_success(self):
        """성공적인 배치 처리 테스트"""
        # 테스트용 DataFrame 생성
        df = pd.DataFrame({
            'daepyoSidoCd': ['11', '11'],
            'daepyoSiguCd': ['110', '110'],
            'daepyoDongCd': ['101', '101'],
            'daepyoRdCd': ['00', None],
            'daepyoLotno': ['123-45', '678-90']
        })

        generator = PNUGenerator()

        # Mock API 응답
        mock_response = MagicMock()
        mock_response.status = 200
        mock_response.json = AsyncMock(return_value={
            'landUses': {
                'field': [
                    {'prposAreaDstrcCodeNm': '제1종일반주거지역'}
                ]
            }
        })
        mock_response.raise_for_status = MagicMock()

        # session.get()이 반환하는 컨텍스트 매니저 객체 생성
        mock_context_manager = AsyncContextManager(mock_response)

        with patch('aiohttp.ClientSession') as mock_session_class:
            mock_session = AsyncMock()
            # session.get()이 호출되면 컨텍스트 매니저를 반환하도록 설정
            mock_session.get = lambda *args, **kwargs: mock_context_manager
            mock_session_class.return_value = mock_session

            results = await process_batch(generator, df, 0, 2)

            # 결과 검증
            assert len(results) > 0
            for result in results:
                if 'error' not in result:
                    assert 'pnu' in result
                    assert 'land_use_1' in result
                    assert 'land_use_2' in result
                    assert 'land_use_3' in result

    @pytest.mark.asyncio
    async def test_process_batch_pnu_failure(self):
        """PNU 생성 실패 케이스"""
        df = pd.DataFrame({
            'daepyoSidoCd': ['1'],  # 잘못된 길이
            'daepyoSiguCd': ['110'],
            'daepyoDongCd': ['101'],
            'daepyoRdCd': ['00'],
            'daepyoLotno': ['123-45']
        })

        generator = PNUGenerator()

        with patch('aiohttp.ClientSession') as mock_session_class:
            mock_session = AsyncMock()
            mock_session_class.return_value = mock_session

            results = await process_batch(generator, df, 0, 1)

            # PNU 생성 실패로 인한 에러가 있어야 함
            assert len(results) > 0
            assert any('error' in r for r in results)


# 통합 테스트
class TestIntegration:
    """통합 테스트"""

    def test_create_pnu_real_world_examples(self):
        """실제 사용 예시 테스트"""
        generator = PNUGenerator()

        # 서울시 강남구 역삼동 예시
        result = generator.create_pnu("11", "680", "101", "00", "123-45")
        assert result[0] is not None
        assert result[0].startswith("1168010100")

        # 여러 지번이 있는 경우
        result2 = generator.create_pnu("11", "680", "101", "00", "123-45^678-90^111-22")
        assert len(result2) == 3


if __name__ == "__main__":
    pytest.main([__file__, "-v"])

