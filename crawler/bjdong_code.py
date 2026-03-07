"""
법정동코드 조회 모듈.

법정동코드 전체자료 TXT 파일(data/bjdong_code.txt)을 파싱하여
한글 행정구역명 → 10자리 법정동코드를 반환합니다.

사용 예:
    from bjdong_code import lookup_bjdong_code
    code = lookup_bjdong_code("충청남도", "서산시", "성연면", "일람리")
    # → "4421036021"
"""
from __future__ import annotations

import os
import re
from functools import lru_cache
from pathlib import Path


# ── 시도명 정규화 ──────────────────────────────────────────────
# 약칭 → 정식 명칭 (법정동코드 파일에서 사용하는 이름)
SIDO_NORMALIZE: dict[str, str] = {
    "서울": "서울특별시",
    "부산": "부산광역시",
    "대구": "대구광역시",
    "인천": "인천광역시",
    "광주": "광주광역시",
    "대전": "대전광역시",
    "울산": "울산광역시",
    "세종": "세종특별자치시",
    "경기": "경기도",
    "강원": "강원도",
    "충북": "충청북도",
    "충남": "충청남도",
    "전북": "전라북도",
    "전남": "전라남도",
    "경북": "경상북도",
    "경남": "경상남도",
    "제주": "제주특별자치도",
    # 신설 명칭 → 법정동코드 파일 기준 이름
    "강원특별자치도": "강원도",
    "전북특별자치도": "전라북도",
}

# 법정동코드 파일에서 사용하는 시도명 → 현행 시도코드 (PNU 앞 2자리)
# 전북특별자치도(52)처럼 코드 체계가 변경된 경우를 대비
# 현재 법정동코드 파일은 전라북도=45를 사용하지만,
# 실제 PNU/VWorld API는 52를 기대할 수 있음.
# 일단 파일 기준 코드를 그대로 사용 (45).
# 추후 전북 코드 변경이 확정되면 여기서 오버라이드.


# ── 데이터 파일 경로 ───────────────────────────────────────────
_DATA_FILE = Path(__file__).parent / "data" / "bjdong_code.txt"

# ── 내부 DB (lazy-loaded) ─────────────────────────────────────
# key: 법정동명 전체 문자열 (예: "충청남도 서산시 성연면 일람리")
# value: 10자리 법정동코드
_CODE_BY_FULLNAME: dict[str, str] = {}

# key: 시군구명 (예: "서산시")
# value: 시도 정식명칭 (예: "충청남도")
_SIDO_BY_SIGUNGU: dict[str, str] = {}

# 초기화 여부
_LOADED = False


def _load_db() -> None:
    """법정동코드 파일을 파싱하여 내부 딕셔너리에 적재."""
    global _LOADED
    if _LOADED:
        return

    path = os.environ.get("BJDONG_CODE_PATH", str(_DATA_FILE))
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("법정동코드"):
                continue
            parts = line.split("\t")
            if len(parts) < 3:
                continue
            code, name, status = parts[0], parts[1], parts[2]
            if status != "존재":
                continue
            if len(code) != 10 or not code.isdigit():
                continue

            _CODE_BY_FULLNAME[name] = code

            # 시군구 → 시도 역방향 매핑 구축
            tokens = name.split()
            if len(tokens) >= 2:
                sido, sigungu = tokens[0], tokens[1]
                if sigungu not in _SIDO_BY_SIGUNGU:
                    _SIDO_BY_SIGUNGU[sigungu] = sido

    _LOADED = True


def _normalize_sido(raw: str) -> str:
    """시도명 약칭/변경명을 법정동코드 파일 기준 정식 명칭으로 변환."""
    s = raw.strip()
    return SIDO_NORMALIZE.get(s, s)


def _extract_dong_from_road_address(hjguDong: str, daepyoLotno: str) -> str | None:
    """
    도로명 주소인 경우 daepyoLotno 괄호 안의 동/리 이름을 추출.

    예: hjguDong="범방2로 18", daepyoLotno="(범방동)" → "범방동"
        hjguDong="해오름길 101", daepyoLotno="(신월리)" → "신월리"
    """
    if not daepyoLotno:
        return None
    m = re.search(r"\(([^)]+)\)", daepyoLotno)
    if not m:
        return None
    inside = m.group(1).strip()
    # 괄호 안이 실제 동/리 이름인지 확인 (동, 리, 가로 끝나야 함)
    if re.search(r"(?:동|리|가)$", inside) and not re.search(r"길|로|번길", inside):
        return inside
    return None


def _extract_dong_ri_from_lotno_parens(daepyoLotno: str) -> str | None:
    """
    daepyoLotno 괄호 안에서 동/리 이름 추출.
    예: "(유곡리)" → "유곡리"
        "(장기리)" → "장기리"
        "(노원동3가 1087-5)" → "노원동3가"
        "(토지 및 건물)" → None
    """
    if not daepyoLotno:
        return None
    m = re.search(r"\(([^)]+)\)", daepyoLotno)
    if not m:
        return None
    inside = m.group(1).strip()
    # 쉼표로 분리된 경우 첫 토큰
    first_part = inside.split(",")[0].strip()
    # 동/리/가로 끝나는 토큰 추출
    tokens = first_part.split()
    for t in tokens:
        t = t.rstrip(",")
        if re.search(r"(?:동\d*가?|리|가)$", t) and not re.search(r"로|길|번길", t):
            return t
    return None


def _extract_ri_from_lotno(daepyoLotno: str) -> tuple[str | None, str]:
    """
    daepyoLotno에서 리 이름을 분리.
    예: "야촌리 483-39" → ("야촌리", "483-39")
        "610" → (None, "610")
    """
    if not daepyoLotno:
        return None, daepyoLotno or ""
    s = daepyoLotno.strip()
    m = re.match(r"^([가-힣]+리)\s+(.+)$", s)
    if m:
        return m.group(1), m.group(2)
    return None, daepyoLotno


def lookup_bjdong_code(
    sido: str | None,
    sigungu: str | None,
    dong: str | None,
    ri: str | None = None,
    daepyoLotno: str | None = None,
) -> str | None:
    """
    한글 행정구역명으로 법정동코드(10자리)를 조회합니다.

    Parameters
    ----------
    sido : 시도 (예: "충청남도", "경기도", "대구", "경남")
    sigungu : 시군구 (예: "서산시", "달성군")
    dong : 읍면동 (예: "성연면", "외동읍 녹동리", "노원동3가 704,")
    ri : 리 (예: "일람리") — hjguRd 필드
    daepyoLotno : 대표지번 — 도로명주소 fallback 시 괄호 안 동명 추출용

    Returns
    -------
    10자리 법정동코드 문자열 or None
    """
    _load_db()

    if not sido or not str(sido).strip():
        # sido가 없으면 sigungu로 역조회 시도
        if sigungu and str(sigungu).strip():
            sido_found = _SIDO_BY_SIGUNGU.get(str(sigungu).strip())
            if sido_found:
                sido = sido_found
            else:
                return None
        else:
            return None

    sido_norm = _normalize_sido(str(sido).strip())
    sigungu_str = str(sigungu).strip() if sigungu and str(sigungu).strip() else ""
    dong_str = str(dong).strip() if dong and str(dong).strip() else ""
    ri_str = str(ri).strip() if ri and str(ri).strip() else ""

    # sido가 실은 시군구명인 경우 (예: "경산시", "안동시", "평택시")
    if sido_norm not in [v for v in SIDO_NORMALIZE.values()] and sido_norm not in _get_all_sido_names():
        real_sido = _SIDO_BY_SIGUNGU.get(sido_norm)
        if real_sido:
            # sido자리에 있던 값을 sigungu로 밀기
            # 기존 sigungu는 dong으로, 기존 dong은 ri로
            ri_str = dong_str if not ri_str else ri_str
            dong_str = sigungu_str
            sigungu_str = sido_norm
            sido_norm = real_sido

    # dong 필드 정제: 도로명+번지 제거, 리 분리, "구 동" 처리
    dong_clean, ri_from_dong = _parse_dong_field(dong_str)

    if ri_from_dong and not ri_str:
        ri_str = ri_from_dong

    # ri_str이 도로명이면 무효화 (sido 밀기로 인한 잘못된 ri)
    if ri_str and _is_road_name(ri_str):
        ri_str = ""

    # daepyoLotno에서 리 이름 추출 시도 (두 가지 방식)
    lotno_s = str(daepyoLotno).strip() if daepyoLotno else ""
    ri_from_lotno, _ = _extract_ri_from_lotno(lotno_s)
    if ri_from_lotno and not ri_str:
        ri_str = ri_from_lotno

    # 괄호 안의 동/리 이름 추출 시도
    dong_ri_from_parens = _extract_dong_ri_from_lotno_parens(lotno_s)
    if dong_ri_from_parens and not ri_str:
        # 괄호 안 값이 리인지 동인지 판별
        if dong_ri_from_parens.endswith("리"):
            ri_str = dong_ri_from_parens
        elif not dong_clean or _is_road_name(dong_clean):
            # dong이 비어있거나 도로명이면 이 값을 dong으로 사용
            dong_clean = dong_ri_from_parens

    # 도로명 주소인 경우 dong을 lotno 괄호에서 추출 시도
    if _is_road_name(dong_clean) and daepyoLotno:
        extracted = _extract_dong_from_road_address(dong_clean, str(daepyoLotno))
        if extracted:
            dong_clean = extracted
            ri_str = ""  # 괄호에서 추출한 게 dong이면 ri는 리셋

    # 포항시 남구 같은 "구" 케이스: sigungu에 "시"가 있고 dong에 "구"가 있으면
    # sigungu를 "시 구"로 합치고, ri → dong으로 승격
    if dong_clean and dong_clean.endswith("구") and sigungu_str.endswith("시"):
        combined_sigungu = f"{sigungu_str} {dong_clean}"
        test_key = f"{sido_norm} {combined_sigungu}"
        if test_key in _CODE_BY_FULLNAME:
            sigungu_str = combined_sigungu
            dong_clean = ri_str  # "장흥동" 등을 dong으로 승격
            ri_str = ""

    # 조회 시도 (구체적 → 추상적 순서)
    candidates = _build_lookup_keys(sido_norm, sigungu_str, dong_clean, ri_str)
    for key in candidates:
        if key in _CODE_BY_FULLNAME:
            return _CODE_BY_FULLNAME[key]

    return None


def _parse_dong_field(dong: str) -> tuple[str, str | None]:
    """
    hjguDong 필드를 파싱하여 (dong_or_eup_myeon, ri_or_none) 반환.

    케이스:
    - "성연면" → ("성연면", None)
    - "외동읍 녹동리" → ("외동읍", "녹동리")
    - "봉산면 인의리" → ("봉산면", "인의리")
    - "남구 장흥동" → ("남구", "장흥동")  — 구가 있는 경우
    - "석남동 223-436" → ("석남동", None)  — 지번 제거
    - "노원동3가 704," → ("노원동3가", None)
    - "초촌면 신암로 244" → ("초촌면", None)  — 도로명 제거
    - "청북읍 청북중앙로 313-22" → ("청북읍", None)
    """
    if not dong:
        return "", None

    tokens = dong.split()
    if not tokens:
        return "", None

    # 단일 토큰
    if len(tokens) == 1:
        # 지번 숫자만 있으면 빈 문자열
        t = tokens[0].rstrip(",")
        if re.match(r"^\d+(-\d+)?$", t):
            return "", None
        return t, None

    first = tokens[0]
    second = tokens[1] if len(tokens) > 1 else ""

    # "읍/면 + 리" 패턴
    if re.search(r"[읍면]$", first) and re.search(r"리$", second):
        return first, second

    # "구 + 동/가" 패턴 (포항시 남구 장흥동)
    if re.search(r"구$", first) and re.search(r"(?:동\d*가?|가)$", second):
        # first is 구 name, second is 동 name
        # 이 경우 "구"는 sigungu 레벨 → dong=second 반환
        # 호출자에서 sigungu+구 결합 처리
        return first, second

    # "동 + 지번" 패턴 (석남동 223-436, 노원동3가 704,)
    if re.search(r"(?:동\d*가?|리)$", first):
        return first, None

    # "읍/면 + 도로명" 패턴 (초촌면 신암로 244, 청북읍 청북중앙로)
    if re.search(r"[읍면]$", first) and _is_road_name(second):
        return first, None

    # 기타: 첫 토큰만 사용
    return first, None


def _is_road_name(s: str) -> bool:
    """문자열이 도로명인지 판별 (로, 길, 번길 등으로 끝나거나 숫자+길/로)."""
    if not s:
        return False
    return bool(re.search(r"(?:로|길|번길)\s*\d*[-]?\d*$", s))


def _eup_myeon_variants(dong: str) -> list[str]:
    """읍↔면 변환 후보를 반환. 법정동코드 파일이 구버전일 때 대비."""
    if dong.endswith("읍"):
        return [dong, dong[:-1] + "면"]
    if dong.endswith("면"):
        return [dong, dong[:-1] + "읍"]
    return [dong]


def _build_lookup_keys(
    sido: str, sigungu: str, dong: str, ri: str
) -> list[str]:
    """조회할 키를 구체적 → 추상적 순서로 생성. 읍↔면 변환 포함."""
    keys = []

    dong_variants = _eup_myeon_variants(dong) if dong else [""]

    for dv in dong_variants:
        # 1. sido + sigungu + dong + ri (4단계)
        if sido and sigungu and dv and ri:
            keys.append(f"{sido} {sigungu} {dv} {ri}")

    for dv in dong_variants:
        # 2. sido + sigungu + dong (3단계)
        if sido and sigungu and dv:
            keys.append(f"{sido} {sigungu} {dv}")

    # 3. sido + sigungu (2단계) — 동 레벨 없이 시군구만
    if sido and sigungu:
        keys.append(f"{sido} {sigungu}")

    return keys


@lru_cache(maxsize=1)
def _get_all_sido_names() -> set[str]:
    """법정동코드 파일에 있는 모든 시도 이름 집합."""
    _load_db()
    names = set()
    for fullname in _CODE_BY_FULLNAME:
        tokens = fullname.split()
        if tokens:
            names.add(tokens[0])
    return names


def get_pnu_prefix(
    sido: str | None,
    sigungu: str | None,
    dong: str | None,
    ri: str | None = None,
    daepyoLotno: str | None = None,
) -> str | None:
    """
    한글 행정구역명 → PNU 10자리 접두사 반환.
    lookup_bjdong_code()의 편의 래퍼.
    """
    code = lookup_bjdong_code(sido, sigungu, dong, ri, daepyoLotno)
    return code
