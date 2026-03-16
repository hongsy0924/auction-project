"""
Storage module — Excel and SQLite persistence.
Handles saving auction data to files and database.
Uses SQLAlchemy engine for database operations.
"""
from __future__ import annotations

import asyncio
import datetime
import logging
import os
import re
from typing import Any, cast

import aiohttp
import pandas as pd
from tqdm import tqdm

from src.db.engine import get_engine
from src.settings import get_settings

logger = logging.getLogger("auction_crawler.storage")


async def enrich_with_land_use(
    df: pd.DataFrame,
    batch_size: int,
    request_delay: float,
) -> tuple[pd.DataFrame, list[dict[str, Any]]]:
    """
    VWorld API를 통해 토지이용정보를 조회하여 데이터를 보강합니다.

    Returns:
        (enriched_df, failed_cases)
    """
    # pnu_generator는 기존 모듈을 그대로 사용
    from pnu_generator import PNUGenerator, process_batch

    generator = PNUGenerator()  # type: ignore[no-untyped-call]
    all_results: list[dict[str, Any]] = []
    failed_cases: list[dict[str, Any]] = []

    for start_idx in tqdm(range(0, len(df), batch_size), desc="토지이용정보 조회 중"):
        try:
            batch_results = await process_batch(generator, df, start_idx, batch_size)
            for result in batch_results:
                original_data = df.iloc[result['original_index']].to_dict()
                land_use_1 = result.get('land_use_1', '')
                land_use_2 = result.get('land_use_2', '')
                land_use_3 = result.get('land_use_3', '')
                combined = ', '.join([v for v in [land_use_1, land_use_2, land_use_3] if v])

                # PNU 실패/API 오류와 관계없이 항상 메인 결과에 포함
                all_results.append({
                    **original_data,
                    'pnu': result.get('pnu', ''),
                    'land_use_1': land_use_1,
                    'land_use_2': land_use_2,
                    'land_use_3': land_use_3,
                    'land_use_combined': combined,
                })

                # 실패 케이스는 별도 기록 (디버깅용)
                if result.get('error'):
                    failed_cases.append({
                        **original_data,
                        'pnu': result.get('pnu', ''),
                        'error': result['error'],
                    })
            await asyncio.sleep(request_delay)
        except Exception as e:
            logger.error(f"배치 처리 중 오류 발생: {e}")
            for idx in range(start_idx, min(start_idx + batch_size, len(df))):
                data_dict = cast(dict[str, Any], df.iloc[idx].to_dict())
                # 배치 전체 오류도 메인 결과에 포함 (토지이용 공란)
                all_results.append({
                    **data_dict,
                    'pnu': '',
                    'land_use_1': '',
                    'land_use_2': '',
                    'land_use_3': '',
                    'land_use_combined': '',
                })
                failed_cases.append({**data_dict, 'error': str(e)})

    if all_results:
        enriched_df = pd.DataFrame(all_results)
    else:
        logger.warning("토지이용정보 조회 결과가 없어 기본 데이터만 사용합니다.")
        enriched_df = df

    return enriched_df, failed_cases


async def enrich_with_land_price(
    df: pd.DataFrame,
    batch_size: int,
    request_delay: float,
) -> pd.DataFrame:
    """
    VWorld 개별공시지가 API를 통해 공시지가 및 시설경과연수를 조회하여 데이터를 보강합니다.
    """
    from datetime import datetime

    from pnu_generator import PNUGenerator

    generator = PNUGenerator()

    # Parse area from areaList (e.g. "123.45㎡" → 123.45)
    def parse_area(area_str: str | None) -> float | None:
        if not area_str:
            return None
        # Match first number (possibly decimal)
        m = re.search(r'([\d,]+\.?\d*)', str(area_str))
        if m:
            return float(m.group(1).replace(',', ''))
        return None

    results = []
    total = len(df)
    current_year = str(datetime.now().year)

    async with aiohttp.ClientSession(connector=aiohttp.TCPConnector()) as session:
        for idx in tqdm(range(total), desc="공시지가 조회 중"):
            row = df.iloc[idx]
            pnu = str(row.get('pnu', ''))
            result = row.to_dict()

            if not pnu or pnu == 'nan':
                result['land_price_per_sqm'] = None
                result['land_price_year'] = None
                result['land_price_total'] = None
                result['min_to_official_ratio'] = None
                result['facility_regist_dt'] = None
                result['facility_age_years'] = None
                results.append(result)
                continue

            try:
                # Get land price (pass current year to get latest, fallback to previous year)
                price_data = await generator.get_land_price(pnu, session, stdr_year=current_year)
                if not price_data.get('pblntfPclnd'):
                    price_data = await generator.get_land_price(pnu, session, stdr_year=str(int(current_year) - 1))
                price_per_sqm = price_data.get('pblntfPclnd')
                price_year = price_data.get('stdrYear')

                if price_per_sqm:
                    price_per_sqm = int(price_per_sqm)
                    area_sqm = parse_area(str(row.get('areaList', '')))
                    if area_sqm and area_sqm > 0:
                        price_total = int(price_per_sqm * area_sqm)
                        min_price = row.get('minmaePrice') or row.get('notifyMinmaePrice1')
                        if min_price:
                            try:
                                min_val = int(str(min_price).replace(',', ''))
                                ratio = round(min_val / price_total, 4) if price_total > 0 else None
                            except (ValueError, ZeroDivisionError):
                                ratio = None
                        else:
                            ratio = None
                    else:
                        price_total = None
                        ratio = None
                else:
                    price_per_sqm = None
                    price_total = None
                    ratio = None

                result['land_price_per_sqm'] = price_per_sqm
                result['land_price_year'] = price_year
                result['land_price_total'] = price_total
                result['min_to_official_ratio'] = ratio

                # Get facility age (registDt) — only if property has land use data (urban facility overlap)
                land_use = str(row.get('land_use_combined', ''))
                if land_use and land_use != 'nan':
                    detail = await generator.get_land_use_detail(pnu, session)
                    regist_dt = detail.get('registDt')
                    if regist_dt:
                        result['facility_regist_dt'] = regist_dt
                        try:
                            # registDt format: YYYYMMDD or YYYY-MM-DD
                            dt_clean = regist_dt.replace('-', '')
                            dt_obj = datetime.strptime(dt_clean[:8], '%Y%m%d')
                            age = (datetime.now() - dt_obj).days / 365.25
                            result['facility_age_years'] = round(age, 1)
                        except (ValueError, TypeError):
                            result['facility_age_years'] = None
                    else:
                        result['facility_regist_dt'] = None
                        result['facility_age_years'] = None
                else:
                    result['facility_regist_dt'] = None
                    result['facility_age_years'] = None

            except Exception as e:
                logger.error(f"공시지가 보강 실패 (PNU: {pnu}): {e}")
                result['land_price_per_sqm'] = None
                result['land_price_year'] = None
                result['land_price_total'] = None
                result['min_to_official_ratio'] = None
                result['facility_regist_dt'] = None
                result['facility_age_years'] = None

            results.append(result)

            if idx % batch_size == 0 and idx > 0:
                await asyncio.sleep(request_delay)

    return pd.DataFrame(results)


async def save_auction_data(data: list[dict[str, Any]]) -> None:
    """
    경매 데이터를 Excel 파일과 SQLite DB에 저장합니다.
    VWorld API 호출 여부는 설정에 따라 결정됩니다.
    SQLAlchemy engine을 통해 DB에 저장합니다.
    """
    if not data:
        logger.warning("저장할 데이터가 없습니다.")
        return

    settings = get_settings()

    try:
        os.makedirs(settings.file.output_dir, exist_ok=True)
        os.makedirs(settings.file.database_dir, exist_ok=True)

        timestamp = datetime.datetime.now().strftime(settings.file.timestamp_format)
        df = pd.DataFrame(data)

        if settings.crawling.skip_vworld_api:
            logger.info("VWorld API 호출을 건너뛰고 기본 경매 데이터만 저장합니다.")
            result_df = df
        else:
            result_df, failed_cases = await enrich_with_land_use(
                df,
                batch_size=settings.crawling.batch_size,
                request_delay=settings.crawling.request_delay,
            )
            if failed_cases:
                failed_df = pd.DataFrame(failed_cases)
                failed_file = os.path.join(
                    settings.file.output_dir,
                    f"failed_cases_{timestamp}.xlsx",
                )
                failed_df.to_excel(failed_file, index=False)
                logger.warning(f"실패 케이스 {len(failed_cases)}건 저장 완료: {failed_file}")

            # 공시지가 보강
            logger.info("공시지가 조회 시작...")
            result_df = await enrich_with_land_price(
                result_df,
                batch_size=settings.crawling.batch_size,
                request_delay=settings.crawling.request_delay,
            )
            logger.info("공시지가 조회 완료")

        # Excel 저장
        output_file = os.path.join(
            settings.file.output_dir,
            f"auction_list_{timestamp}.xlsx",
        )
        result_df.to_excel(output_file, index=False)
        logger.info(f"경매 목록 {len(result_df)}건 저장 완료: {output_file}")

        # SQLite DB 저장 — SQLAlchemy engine 사용
        db_path = os.path.join(settings.file.database_dir, 'auction_data.db')
        engine = get_engine(db_path)
        result_df.to_sql('auction_list', engine, if_exists='replace', index=False)
        logger.info(f"DB 저장 완료: {db_path}")

    except Exception as e:
        logger.error(f"데이터 저장 중 오류 발생: {e}")
        raise
