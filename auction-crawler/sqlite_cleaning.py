"""
SQLite data cleaning — transforms raw auction_list into auction_list_cleaned.
Uses SQLAlchemy ORM and the shared column mapping from src.models.
"""
import sys

import pandas as pd
from sqlalchemy import inspect, text

from src.db.engine import get_engine
from src.db.models import AuctionCleaned
from src.models import COLUMN_MAPPING
from src.settings import get_settings


def clean_auction_db(db_path: str | None = None) -> None:
    """
    원본 테이블(auction_list)에서 필요한 컬럼만 추출하여
    한글 이름으로 매핑된 새 테이블(auction_list_cleaned)을 생성합니다.
    SQLAlchemy ORM을 사용합니다.
    """
    if db_path is None:
        settings = get_settings()
        db_path = f"{settings.file.database_dir}/auction_data.db"

    engine = get_engine(db_path)
    inspector = inspect(engine)

    table = "auction_list"
    new_table = AuctionCleaned.__tablename__

    # 원본 테이블의 컬럼 목록 조회 (SQLAlchemy inspect 사용)
    existing_cols = {col["name"] for col in inspector.get_columns(table)}

    with engine.begin() as conn:
        # 기존 테이블 삭제 후 새 테이블 생성 (ORM 모델 기반)
        conn.execute(text(f'DROP TABLE IF EXISTS "{new_table}"'))
        AuctionCleaned.__table__.create(bind=engine, checkfirst=True)

        # 데이터 복사 (원본에 없는 컬럼은 NULL)
        select_parts = []
        for src_col in COLUMN_MAPPING:
            if src_col in existing_cols:
                select_parts.append(f'"{src_col}"')
            else:
                select_parts.append(f'NULL AS "{src_col}"')

        col_select = ", ".join(select_parts)
        col_insert = ", ".join([f'"{v}"' for v in COLUMN_MAPPING.values()])

        conn.execute(text(
            f'INSERT INTO "{new_table}" ({col_insert}) SELECT {col_select} FROM "{table}"'
        ))

    print(f"완료! 새 테이블이 {db_path}에 생성되었습니다.")

    # 미리보기
    df = pd.read_sql_query(f'SELECT * FROM "{new_table}" LIMIT 5', engine)
    print(df.head())


if __name__ == "__main__":
    path = sys.argv[1] if len(sys.argv) > 1 else None
    clean_auction_db(path)
