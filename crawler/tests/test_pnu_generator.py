from unittest.mock import AsyncMock, MagicMock, patch

import aiohttp
import pandas as pd
import pytest

from pnu_generator import PNUGenerator, _clean_lotno, _safe_code, process_batch


class AsyncContextManager:
    """async with 구문을 위한 컨텍스트 매니저"""
    def __init__(self, return_value):
        self.return_value = return_value

    async def __aenter__(self):
        return self.return_value

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        return False


# ── _safe_code 단위 테스트 ─────────────────────────────────────────

class TestSafeCode:
    """행정코드 변환 유틸리티 테스트"""

    def test_string_passthrough(self):
        assert _safe_code("44", 2) == "44"
        assert _safe_code("760", 3) == "760"

    def test_float_to_int(self):
        """pandas에서 읽은 float 값 → 정수 문자열"""
        assert _safe_code(44.0, 2) == "44"
        assert _safe_code(760.0, 3) == "760"
        assert _safe_code(26.0, 2) == "26"

    def test_int_value(self):
        assert _safe_code(44, 2) == "44"
        assert _safe_code(1, 2) == "01"

    def test_zfill(self):
        """짧은 값은 0으로 채움"""
        assert _safe_code("1", 2) == "01"
        assert _safe_code(1.0, 3) == "001"

    def test_nan_returns_none(self):
        assert _safe_code(None, 2) is None
        assert _safe_code(float("nan"), 2) is None

    def test_non_digit_returns_none(self):
        """숫자가 아닌 값 (엑셀 지수표기 오류 등)"""
        assert _safe_code("0E", 2) is None
        assert _safe_code("10M", 3) is None
        assert _safe_code("0M", 2) is None
        assert _safe_code("ABC", 3) is None

    def test_too_long_after_zfill(self):
        """zfill 후 길이가 expected_len을 초과"""
        assert _safe_code("12345", 3) is None  # "12345" → len 5 != 3


# ── _clean_lotno 단위 테스트 ───────────────────────────────────────

class TestCleanLotno:
    """지번 정제 함수 테스트"""

    def test_basic(self):
        assert _clean_lotno("123-45") == ["123-45"]

    def test_caret_delimiter(self):
        """^ 구분자"""
        assert _clean_lotno("123-45^678-90") == ["123-45", "678-90"]

    def test_comma_delimiter(self):
        """쉼표 구분자"""
        assert _clean_lotno("213,214,94-2") == ["213", "214", "94-2"]

    def test_comma_with_spaces(self):
        assert _clean_lotno("506-41, 506-8") == ["506-41", "506-8"]

    def test_strip_dongho(self):
        """동호수 제거"""
        assert _clean_lotno("1209 2동호") == ["1209"]
        assert _clean_lotno("1268 3동") == ["1268"]

    def test_strip_ho(self):
        """호수 제거"""
        assert _clean_lotno("1613 1호") == ["1613"]
        assert _clean_lotno("2891 17호") == ["2891"]

    def test_strip_je_ho(self):
        """제N호 제거"""
        assert _clean_lotno("1021 제1호") == ["1021"]
        assert _clean_lotno("1021 제2호") == ["1021"]

    def test_strip_townhouse(self):
        """타운하우스 건물명 제거"""
        assert _clean_lotno("1104 휴아림타운하우스 103동호") == ["1104"]

    def test_strip_multiple_lots_suffix(self):
        """외 N필지 제거"""
        result = _clean_lotno("183-11 제1동 외 15필지")
        # "183-11" 뒤에 "제1동 외 15필지"가 제거되어야 함
        assert result == ["183-11"]

    def test_parenthesized_content_removed(self):
        """괄호 안 내용 제거"""
        assert _clean_lotno("1160-6(현1564-1)") == ["1160-6"]
        assert _clean_lotno("908 1동(2동)호") == ["908"]

    def test_fully_parenthesized(self):
        """전체가 괄호인 경우 → 빈 리스트"""
        assert _clean_lotno("(가중리, 은남로20번길 44-24 )") == []
        assert _clean_lotno("(반천리)") == []
        assert _clean_lotno("(만사리 629-7)") == []

    def test_non_lot_text(self):
        """비지번 텍스트 필터링"""
        assert _clean_lotno("토지, 건물") == []

    def test_empty(self):
        assert _clean_lotno("") == []
        assert _clean_lotno("   ") == []

    def test_mountain_preserved(self):
        """산 지번은 유지 (create_pnu에서 처리)"""
        assert _clean_lotno("산50-7") == ["산50-7"]

    def test_ju_dong(self):
        """주N동 제거"""
        # "(신화리 516, 516-4, 516-5, 516 주1동)" → 괄호 제거 → ""
        assert _clean_lotno("(신화리 516, 516-4, 516-5, 516 주1동)") == []
        # 괄호 없이 주동 접미사
        assert _clean_lotno("516 주1동") == ["516"]


# ── PNUGenerator 테스트 ────────────────────────────────────────────

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

    def test_create_pnu_multiple_lots_caret(self):
        """여러 지번이 ^로 구분된 경우"""
        result = self.generator.create_pnu("11", "110", "101", "00", "123-45^678-90")
        assert len(result) == 2
        assert result[0] == "1111010100101230045"
        assert result[1] == "1111010100106780090"

    def test_create_pnu_multiple_lots_comma(self):
        """여러 지번이 쉼표로 구분된 경우 (신규)"""
        result = self.generator.create_pnu("44", "760", "440", None, "213,214,94-2")
        assert len(result) == 3
        assert result[0].endswith("10213" + "0000")  # 213
        assert result[1].endswith("10214" + "0000")  # 214
        assert result[2].endswith("10094" + "0002")  # 94-2

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
        """잘못된 prefix (숫자가 아닌 경우)"""
        # 숫자가 아닌 문자가 포함된 경우
        result2 = self.generator.create_pnu("11", "ABC", "101", "00", "123-45")
        assert result2 == [None]

    def test_create_pnu_short_code_gets_zfilled(self):
        """짧은 코드는 zero-pad됨 (예: "1" → "01")"""
        result = self.generator.create_pnu("1", "110", "101", "00", "123-45")
        assert result[0] is not None
        assert result[0].startswith("01110101")

    def test_create_pnu_empty_lotno(self):
        """빈 지번 번호"""
        result = self.generator.create_pnu("11", "110", "101", "00", "")
        assert result == [None]

    def test_create_pnu_invalid_lotno(self):
        """유효하지 않은 지번 번호 (숫자가 없는 경우)"""
        result = self.generator.create_pnu("11", "110", "101", "00", "abc-def")
        assert result == [None]

    def test_create_pnu_zfill(self):
        """zfill 테스트 - 짧은 코드도 zero-pad되어 성공"""
        # "1" → "01", "1" → "001" 등으로 패딩
        result = self.generator.create_pnu("1", "1", "1", "0", "1-2")
        assert result[0] is not None

        # 명시적 zero-padded도 동일 결과
        result2 = self.generator.create_pnu("01", "001", "001", "00", "1-2")
        assert result2[0] is not None
        assert result[0] == result2[0]

    # ── 실패 사례 재현 테스트 (신규) ──────────────────────────────

    def test_float_sido_code(self):
        """pandas float 행정코드 (44.0 → "44") (신규)"""
        result = self.generator.create_pnu(44.0, 760.0, 440.0, None, "213")
        assert result[0] is not None
        assert result[0].startswith("44760440")

    def test_float_with_ricd(self):
        """float 행정코드 + float riCd (신규)"""
        result = self.generator.create_pnu(48.0, 840.0, 390.0, 26.0, "1209")
        assert result[0] is not None
        assert result[0].startswith("4884039026")

    def test_dongho_stripped(self):
        """동호수가 포함된 지번에서 PNU 정상 생성 (신규)"""
        result = self.generator.create_pnu(48.0, 840.0, 390.0, 26.0, "1209 2동호")
        assert len(result) == 1
        assert result[0] is not None
        # "1209"만 지번으로 인식, "2동호"는 제거
        assert result[0].endswith("112090000")

    def test_ho_stripped(self):
        """호수가 포함된 지번 (신규)"""
        result = self.generator.create_pnu(50.0, 130.0, 259.0, 22.0, "1613 1호")
        assert result[0] is not None
        assert result[0].endswith("116130000")

    def test_parenthesized_lotno(self):
        """괄호 안 내용 제거 후 정상 PNU 생성 (신규)"""
        result = self.generator.create_pnu(48.0, 270.0, 102.0, "00", "1160-6(현1564-1)")
        assert result[0] is not None
        assert result[0].endswith("111600006")

    def test_non_digit_dongcd(self):
        """비숫자 동코드 ("10M") → None (신규)"""
        result = self.generator.create_pnu(41.0, 390.0, "10M", "00", "산50-7")
        assert result == [None]

    def test_non_digit_rdcd(self):
        """비숫자 리코드 ("0E") → 기본값 "00" 사용 (신규)"""
        result = self.generator.create_pnu(47.0, 230.0, 401.0, "0E", "813")
        assert result[0] is not None
        # "0E"는 _safe_code에서 None → ri 기본값 "00"
        assert result[0].startswith("4723040100")

    def test_nan_codes_return_none(self):
        """NaN 행정코드 → [None] (신규)"""
        result = self.generator.create_pnu(float("nan"), float("nan"), float("nan"), None, "213")
        assert result == [None]

    def test_comma_separated_with_spaces(self):
        """공백+쉼표 구분 지번 (신규)"""
        result = self.generator.create_pnu(46.0, 860.0, 380.0, 25.0, "506-41, 506-8")
        assert len(result) == 2

    def test_text_only_lotno(self):
        """비지번 텍스트 ('토지, 건물') → [None] (신규)"""
        result = self.generator.create_pnu(47.0, 820.0, 340.0, 39.0, "토지, 건물")
        assert result == [None]


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
            'daepyoSidoCd': ['XX'],  # 숫자가 아닌 값
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

    @pytest.mark.asyncio
    async def test_process_batch_nan_fallback(self):
        """NaN 행정코드에서 hjgu fallback 시도 (신규)"""
        df = pd.DataFrame({
            'daepyoSidoCd': [float('nan')],
            'daepyoSiguCd': [float('nan')],
            'daepyoDongCd': [float('nan')],
            'daepyoRdCd': [None],
            'daepyoLotno': ['(가중리, 은남로20번길 44-24 )'],
            'hjguSido': ['충청남도'],
            'hjguSigu': ['부여군'],
            'hjguDong': ['은산면'],
            'printSt': ['소재지 : 충남 부여군 은산면 (가중리, 은남로20번길 44-24 )'],
        })

        generator = PNUGenerator()

        with patch('aiohttp.ClientSession') as mock_session_class:
            mock_session = AsyncMock()
            mock_session_class.return_value = mock_session

            results = await process_batch(generator, df, 0, 1)

            # hjgu fallback은 현재 코드 DB가 없으므로 여전히 실패
            # 하지만 에러가 발생하지 않고 정상 흐름이어야 함
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

    def test_previously_failing_cases(self):
        """이전에 실패했던 실제 사례 테스트 (신규)"""
        generator = PNUGenerator()

        # Case: float codes + 동호수
        result = generator.create_pnu(48.0, 840.0, 390.0, 26.0, "1209 2동호")
        assert result[0] is not None
        assert len(result[0]) == 19

        # Case: float codes + comma-separated lots
        result = generator.create_pnu(44.0, 760.0, 440.0, None, "213,214,94-2")
        assert len(result) == 3

        # Case: parenthesized content
        result = generator.create_pnu(48.0, 270.0, 102.0, "00", "1160-6(현1564-1)")
        assert result[0] is not None
        assert result[0].endswith("111600006")

        # Case: 제N호
        result = generator.create_pnu(50.0, 110.0, 330.0, 21.0, "1021 제1호")
        assert result[0] is not None

        # Case: non-digit RdCd → fallback to "00"
        result = generator.create_pnu(47.0, 230.0, 401.0, "0E", "813")
        assert result[0] is not None


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
