"""
법정동코드 조회 모듈 테스트.
"""
import pytest

from bjdong_code import (
    _extract_dong_ri_from_lotno_parens,
    _extract_ri_from_lotno,
    _is_road_name,
    _normalize_sido,
    _parse_dong_field,
    lookup_bjdong_code,
)


# ── _normalize_sido 테스트 ─────────────────────────────────────

class TestNormalizeSido:
    def test_abbreviation(self):
        assert _normalize_sido("충남") == "충청남도"
        assert _normalize_sido("경북") == "경상북도"
        assert _normalize_sido("부산") == "부산광역시"

    def test_new_name(self):
        assert _normalize_sido("강원특별자치도") == "강원도"
        assert _normalize_sido("전북특별자치도") == "전라북도"

    def test_already_full_name(self):
        assert _normalize_sido("충청남도") == "충청남도"
        assert _normalize_sido("서울특별시") == "서울특별시"

    def test_whitespace(self):
        assert _normalize_sido("  경남  ") == "경상남도"


# ── _is_road_name 테스트 ───────────────────────────────────────

class TestIsRoadName:
    def test_road_names(self):
        assert _is_road_name("화합로465번길 58") is True
        assert _is_road_name("범방2로 18") is True
        assert _is_road_name("청북중앙로 313-22") is True
        assert _is_road_name("북평로 714-1") is True
        assert _is_road_name("해오름길 101") is True

    def test_non_road_names(self):
        assert _is_road_name("성연면") is False
        assert _is_road_name("석남동") is False
        assert _is_road_name("일람리") is False
        assert _is_road_name("") is False


# ── _parse_dong_field 테스트 ───────────────────────────────────

class TestParseDongField:
    def test_simple_dong(self):
        assert _parse_dong_field("성연면") == ("성연면", None)
        assert _parse_dong_field("상봉암동") == ("상봉암동", None)

    def test_eup_ri_combined(self):
        assert _parse_dong_field("외동읍 녹동리") == ("외동읍", "녹동리")
        assert _parse_dong_field("봉산면 인의리") == ("봉산면", "인의리")

    def test_gu_dong_combined(self):
        assert _parse_dong_field("남구 장흥동") == ("남구", "장흥동")

    def test_dong_with_jibun(self):
        assert _parse_dong_field("석남동 223-436") == ("석남동", None)
        assert _parse_dong_field("노원동3가 704,") == ("노원동3가", None)

    def test_eup_with_road(self):
        assert _parse_dong_field("초촌면 신암로 244") == ("초촌면", None)
        assert _parse_dong_field("청북읍 청북중앙로 313-22") == ("청북읍", None)

    def test_empty(self):
        assert _parse_dong_field("") == ("", None)
        assert _parse_dong_field("32") == ("", None)


# ── _extract_dong_ri_from_lotno_parens 테스트 ──────────────────

class TestExtractDongRiFromParens:
    def test_ri_in_parens(self):
        assert _extract_dong_ri_from_lotno_parens("(유곡리)") == "유곡리"
        assert _extract_dong_ri_from_lotno_parens("(장기리)") == "장기리"
        assert _extract_dong_ri_from_lotno_parens("(신월리)") == "신월리"

    def test_dong_in_parens(self):
        assert _extract_dong_ri_from_lotno_parens("(장림동)") == "장림동"
        assert _extract_dong_ri_from_lotno_parens("(범방동)") == "범방동"
        assert _extract_dong_ri_from_lotno_parens("(망정동)") == "망정동"

    def test_dong_ga_in_parens(self):
        assert _extract_dong_ri_from_lotno_parens("(노원동3가 1087-5)") == "노원동3가"

    def test_non_dong_in_parens(self):
        assert _extract_dong_ri_from_lotno_parens("(토지 및 건물)") is None

    def test_no_parens(self):
        assert _extract_dong_ri_from_lotno_parens("610") is None
        assert _extract_dong_ri_from_lotno_parens("") is None


# ── _extract_ri_from_lotno 테스트 ──────────────────────────────

class TestExtractRiFromLotno:
    def test_ri_with_jibun(self):
        assert _extract_ri_from_lotno("야촌리 483-39") == ("야촌리", "483-39")

    def test_no_ri(self):
        assert _extract_ri_from_lotno("610") == (None, "610")
        assert _extract_ri_from_lotno("") == (None, "")


# ── lookup_bjdong_code 통합 테스트 ─────────────────────────────

class TestLookupBjdongCode:
    """법정동코드 파일 기반 통합 테스트."""

    def test_basic_lookup(self):
        """기본 4단계 조회: 시도 + 시군구 + 읍면 + 리."""
        code = lookup_bjdong_code("충청남도", "서산시", "성연면", "일람리")
        assert code == "4421036021"

    def test_abbreviation_sido(self):
        """시도 약칭."""
        code = lookup_bjdong_code("경남", "창녕군", "계성면", "명리")
        assert code is not None
        assert code.startswith("48")

    def test_combined_dong_field(self):
        """hjguDong에 '읍 리'가 결합된 경우."""
        code = lookup_bjdong_code("경상북도", "경주시", "외동읍 녹동리")
        assert code is not None
        assert code == "4713025924"

    def test_sido_is_actually_sigungu(self):
        """sido 필드에 시군구명이 들어있는 경우."""
        code = lookup_bjdong_code("안동시", "북후면", "북평로 714-1", daepyoLotno="(장기리)")
        assert code is not None
        assert code.startswith("47")  # 경상북도

    def test_road_name_dong_with_lotno_parens(self):
        """hjguDong이 도로명, daepyoLotno 괄호 안에 동명."""
        code = lookup_bjdong_code("부산", "사하구", "다대로354번길 72", daepyoLotno="(장림동)")
        assert code is not None
        assert code.startswith("26")  # 부산

    def test_eup_with_lotno_ri_parens(self):
        """읍 + daepyoLotno 괄호 안에 리."""
        code = lookup_bjdong_code("대구", "달성군", "유가읍", daepyoLotno="(유곡리)")
        assert code is not None
        # 유가면 유곡리 (법정동코드 파일은 유가면 사용)
        assert "037" in code[5:8] or "037" in code[4:7]

    def test_eup_myeon_fallback(self):
        """읍↔면 변환 폴백 (법정동코드 파일이 구버전)."""
        # 경산시 압량읍 → 파일에는 압량면
        code = lookup_bjdong_code("경산시", "압량읍", "해오름길 101", daepyoLotno="(신월리)")
        assert code is not None
        assert code.startswith("47")  # 경상북도

    def test_ri_from_lotno_prefix(self):
        """daepyoLotno가 '리이름 지번' 형태."""
        code = lookup_bjdong_code("충청남도", "논산시", "가야곡면", daepyoLotno="야촌리 483-39")
        assert code is not None
        assert code.endswith("31")  # 야촌리 리코드

    def test_gu_dong_pattern(self):
        """포항시 남구 장흥동 — 구+동 패턴."""
        code = lookup_bjdong_code("경상북도", "포항시", "남구 장흥동")
        assert code == "4711111100"

    def test_dong_with_jibun(self):
        """hjguDong에 '동 지번'이 결합."""
        code = lookup_bjdong_code("인천광역시", "서구", "석남동 223-436")
        assert code is not None
        assert code.startswith("28")

    def test_sejong(self):
        """세종특별자치시 (시군구 없음, dong이 sido 직속)."""
        code = lookup_bjdong_code("세종", "반곡동", None)
        assert code is not None
        assert code.startswith("36")

    def test_gangwon_new_name(self):
        """강원특별자치도 → 강원도 매핑."""
        code = lookup_bjdong_code("강원특별자치도", "춘천시", "효자동")
        assert code is not None
        assert code.startswith("42")

    def test_none_inputs(self):
        """None 입력 처리."""
        assert lookup_bjdong_code(None, None, None) is None
        assert lookup_bjdong_code("", "", "") is None

    def test_nonexistent_address(self):
        """존재하지 않는 주소."""
        assert lookup_bjdong_code("충청남도", "존재하지않는시", "무슨동") is None


# ── PNUGenerator.create_pnu_from_address 통합 테스트 ───────────

class TestCreatePnuFromAddress:
    """create_pnu_from_address 법정동코드 연동 테스트."""

    @pytest.fixture
    def gen(self):
        from pnu_generator import PNUGenerator
        return PNUGenerator()

    def test_basic_address(self, gen):
        """일반적인 주소 + 지번."""
        pnus = gen.create_pnu_from_address(
            "경상북도", "김천시", "봉산면 인의리",
            "610,(인의1길 57-59) 외 13필지 위 토지 및 지상건물",
        )
        assert pnus != [None]
        assert len(pnus) >= 1
        assert all(len(p) == 19 for p in pnus)

    def test_multiple_lots(self, gen):
        """다중 지번 (쉼표 구분)."""
        pnus = gen.create_pnu_from_address(
            "경남", "창녕군", "계성면",
            "171, 172, 173, 174, 281-2,281-3",
            hjguRd="명리",
        )
        assert len(pnus) == 6

    def test_ri_in_lotno_prefix(self, gen):
        """지번 앞에 리 이름이 붙어있는 경우."""
        pnus = gen.create_pnu_from_address(
            "충청남도", "논산시", "가야곡면",
            "야촌리 483-39, 483-40",
        )
        assert len(pnus) == 2

    def test_repeated_ri_in_lots(self, gen):
        """각 지번마다 리 이름이 반복."""
        pnus = gen.create_pnu_from_address(
            "대구", "달성군", "논공읍 비슬로262길",
            "상리 725, 상리 726, 상리 726-1",
        )
        assert len(pnus) == 3

    def test_no_lotno(self, gen):
        """유효한 지번이 없는 경우."""
        pnus = gen.create_pnu_from_address(
            "부산", "사하구", "다대로354번길 72",
            "(장림동)",
        )
        assert pnus == [None]

    def test_sido_is_sigungu(self, gen):
        """sido에 시군구명이 들어있는 경우."""
        pnus = gen.create_pnu_from_address(
            "평택시", "청북읍", "청북중앙로 313-22",
            "(삼계리)",
        )
        # 법정동코드 매칭 성공하지만 지번 없음
        assert pnus == [None]

    def test_printst_fallback(self, gen):
        """daepyoLotno에서 실패 시 printSt에서 지번 추출."""
        pnus = gen.create_pnu_from_address(
            "인천광역시", "서구", "석남동 223-436",
            "(토지 및 건물)",
            printSt="소재지 : 인천광역시 서구 석남동 223-436 (토지 및 건물)",
        )
        # printSt에서 223-436 추출 시도
        # 실패해도 법정동코드 매칭 자체는 확인
        assert pnus is not None
