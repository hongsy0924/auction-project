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
from typing import Any, cast

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
                if result.get('error') and not any([
                    result.get('land_use_1'),
                    result.get('land_use_2'),
                    result.get('land_use_3'),
                ]):
                    failed_cases.append({**original_data, 'error': result['error']})
                else:
                    land_use_1 = result.get('land_use_1', '')
                    land_use_2 = result.get('land_use_2', '')
                    land_use_3 = result.get('land_use_3', '')
                    combined = ', '.join([v for v in [land_use_1, land_use_2, land_use_3] if v])
                    all_results.append({
                        **original_data,
                        'pnu': result.get('pnu', ''),
                        'land_use_1': land_use_1,
                        'land_use_2': land_use_2,
                        'land_use_3': land_use_3,
                        'land_use_combined': combined,
                    })
            await asyncio.sleep(request_delay)
        except Exception as e:
            logger.error(f"배치 처리 중 오류 발생: {e}")
            for idx in range(start_idx, min(start_idx + batch_size, len(df))):
                data_dict = cast(dict[str, Any], df.iloc[idx].to_dict())
                failed_cases.append({**data_dict, 'error': str(e)})

    if all_results:
        enriched_df = pd.DataFrame(all_results)
    else:
        logger.warning("토지이용정보 조회 결과가 없어 기본 데이터만 사용합니다.")
        enriched_df = df

    return enriched_df, failed_cases


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
