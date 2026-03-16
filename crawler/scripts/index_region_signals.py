"""
배치 사전 인덱싱: auction_list_cleaned의 고유한 (시군구, 동) 조합에 대해
CLIK API로 회의록 검색 → region_signals 캐시 테이블에 저장.

크롤러 실행 후 트리거:
  python -m scripts.index_region_signals [--db-path path/to/auction.db]
"""

import argparse
import json
import logging
import os
import sqlite3
import sys
import time
from typing import Any

import requests

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from src.settings import get_settings

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)

# 시도 약칭 → COUNCILS 맵 키 접두사
SIDO_ALIAS: dict[str, str] = {
    "서울특별시": "서울", "부산광역시": "부산", "대구광역시": "대구",
    "인천광역시": "인천", "광주광역시": "광주", "대전광역시": "대전",
    "울산광역시": "울산", "세종특별자치시": "세종",
    "경기도": "경기", "강원도": "강원", "강원특별자치도": "강원",
    "충청북도": "충북", "충청남도": "충남",
    "전라북도": "전북", "전북특별자치도": "전북", "전라남도": "전남",
    "경상북도": "경북", "경상남도": "경남",
    "제주특별자치도": "제주", "제주도": "제주",
}

# councils.ts와 동일한 매핑 (Python 버전)
COUNCILS: dict[str, str] = {
    "서울": "002001", "부산": "051001", "대구": "053001", "인천": "032001",
    "광주": "062001", "대전": "042001", "울산": "052001", "세종": "044001",
    "경기": "031001", "강원": "033001", "충북": "043001", "충남": "041001",
    "전북": "063001", "전남": "061001", "경북": "054001", "경남": "055001",
    "제주": "064001",
    "충남 서산시": "041009", "충남 아산시": "041011", "충남 천안시": "041013",
    "충남 당진시": "041006", "충남 공주시": "041003", "충남 논산시": "041005",
    "충남 보령시": "041007", "충남 예산군": "041012", "충남 청양군": "041014",
    "충남 태안군": "041015", "충남 계룡시": "041002",
    "경기 수원시": "031014", "경기 성남시": "031013", "경기 고양시": "031003",
    "경기 용인시": "031024", "경기 화성시": "031032", "경기 안산시": "031016",
    "경기 평택시": "031029", "경기 김포시": "031009", "경기 파주시": "031028",
    "경기 남양주시": "031010", "경기 부천시": "031012", "경기 광명시": "031005",
    "경기 시흥시": "031015", "경기 안양시": "031018", "경기 하남시": "031031",
    "경기 이천시": "031027", "경기 여주시": "031021", "경기 양주시": "031019",
    "경기 포천시": "031030", "경기 오산시": "031023", "경기 안성시": "031017",
    "경기 동두천시": "031011", "경기 과천시": "031004", "경기 광주시": "031006",
    "경기 구리시": "031007", "경기 군포시": "031008", "경기 의왕시": "031025",
    "경기 의정부시": "031026",
}

# 투자 관련 검색 키워드
SIGNAL_KEYWORDS = ["보상", "편입", "수용", "개발", "착공", "도시계획", "도로", "택지"]

_council_settings = get_settings().api
CLIK_BASE_URL = _council_settings.council_api_url
CLIK_API_KEY = _council_settings.council_api_key


def get_auction_regions(db_path: str) -> list[tuple[str, str, str]]:
    """auction_list_cleaned에서 고유한 (시도, 시군구, 동) 조합 추출."""
    conn = sqlite3.connect(db_path)
    try:
        rows = conn.execute(
            "SELECT DISTINCT 시도, 시군구, 동 FROM auction_list_cleaned WHERE 시도 IS NOT NULL AND 시도 != ''"
        ).fetchall()
        return [(r[0] or "", r[1] or "", r[2] or "") for r in rows]
    finally:
        conn.close()


def resolve_council_code(sido: str, sigungu: str) -> list[str]:
    """시도/시군구 → 의회코드 리스트."""
    sido_short = SIDO_ALIAS.get(sido, sido)
    codes = []

    # 시군구 의회
    if sigungu:
        key = f"{sido_short} {sigungu}"
        if key in COUNCILS:
            codes.append(COUNCILS[key])

    # 도/광역시 의회
    if sido_short in COUNCILS:
        codes.append(COUNCILS[sido_short])

    return codes


def search_clik(keyword: str, council_code: str) -> list[dict[str, Any]]:
    """CLIK API 회의록 검색."""
    params = {
        "key": CLIK_API_KEY,
        "type": "json",
        "displayType": "list",
        "searchType": "ALL",
        "searchKeyword": keyword,
        "rasmblyId": council_code,
        "listCount": "10",
        "startCount": "0",
    }

    try:
        resp = requests.get(CLIK_BASE_URL, params=params, timeout=15)
        resp.raise_for_status()
        data = resp.json()

        if isinstance(data, list) and len(data) > 0:
            result = data[0]
            if result.get("RESULT_CODE") == "SUCCESS":
                items = result.get("LIST", [])
                return [item.get("ROW", item) if isinstance(item, dict) else item for item in items]
        return []
    except Exception as e:
        logger.warning(f"CLIK search failed for '{keyword}' at {council_code}: {e}")
        return []


def save_signals(cache_db_path: str, entries: list[dict[str, Any]]) -> None:
    """region_signals 테이블에 결과 저장."""
    conn = sqlite3.connect(cache_db_path)
    try:
        conn.execute("""CREATE TABLE IF NOT EXISTS region_signals (
            council_code TEXT NOT NULL,
            dong_name TEXT NOT NULL DEFAULT '',
            keyword TEXT NOT NULL,
            signal_summary TEXT,
            doc_ids TEXT,
            doc_count INTEGER DEFAULT 0,
            last_updated INTEGER NOT NULL,
            PRIMARY KEY (council_code, dong_name, keyword)
        )""")

        now = int(time.time() * 1000)
        for entry in entries:
            conn.execute(
                """INSERT OR REPLACE INTO region_signals
                   (council_code, dong_name, keyword, signal_summary, doc_ids, doc_count, last_updated)
                   VALUES (?, ?, ?, ?, ?, ?, ?)""",
                (
                    entry["council_code"],
                    entry["dong_name"],
                    entry["keyword"],
                    entry.get("signal_summary"),
                    json.dumps(entry.get("doc_ids", [])),
                    entry["doc_count"],
                    now,
                ),
            )
        conn.commit()
        logger.info(f"Saved {len(entries)} signal entries to cache")
    finally:
        conn.close()


def main():
    parser = argparse.ArgumentParser(description="Pre-index region signals from CLIK API")
    parser.add_argument("--db-path", default="database/auction.db", help="Path to auction SQLite DB")
    parser.add_argument("--cache-path", default="database/minutes_cache.db", help="Path to cache DB")
    args = parser.parse_args()

    if not os.path.exists(args.db_path):
        # Try web directory
        web_db = os.path.join("web", args.db_path)
        if os.path.exists(web_db):
            args.db_path = web_db

    if not os.path.exists(args.db_path):
        logger.error(f"Database not found: {args.db_path}")
        sys.exit(1)

    regions = get_auction_regions(args.db_path)
    logger.info(f"Found {len(regions)} unique regions in auction data")

    all_entries: list[dict[str, Any]] = []

    for sido, sigungu, dong in regions:
        council_codes = resolve_council_code(sido, sigungu)
        if not council_codes:
            continue

        dong_name = dong or ""

        for council_code in council_codes:
            for keyword in SIGNAL_KEYWORDS:
                # Combine dong + keyword for more specific search
                search_term = f"{dong_name} {keyword}".strip() if dong_name else keyword

                results = search_clik(search_term, council_code)
                doc_count = len(results)

                if doc_count > 0:
                    doc_ids = [r.get("DOCID", "") for r in results if isinstance(r, dict)]
                    all_entries.append({
                        "council_code": council_code,
                        "dong_name": dong_name,
                        "keyword": keyword,
                        "doc_count": doc_count,
                        "doc_ids": doc_ids,
                    })
                    logger.info(f"  [{sido} {sigungu}] {council_code} + '{search_term}' → {doc_count}건")

                # Rate limit
                time.sleep(0.3)

    if all_entries:
        cache_db = args.cache_path
        if not os.path.exists(os.path.dirname(cache_db)):
            os.makedirs(os.path.dirname(cache_db), exist_ok=True)
        save_signals(cache_db, all_entries)

    logger.info(f"Indexing complete. Total: {len(all_entries)} signal entries")


if __name__ == "__main__":
    main()
