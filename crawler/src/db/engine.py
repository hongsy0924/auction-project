"""
Database engine and session management.
Provides SQLAlchemy Engine and Session factory backed by project settings.
"""
from __future__ import annotations

import os
from collections.abc import Generator
from functools import lru_cache

from sqlalchemy import create_engine, event
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from src.settings import get_settings


@event.listens_for(Engine, "connect")
def _set_sqlite_pragma(dbapi_connection, connection_record):  # type: ignore[no-untyped-def]
    """Enable WAL mode and foreign keys for every SQLite connection."""
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA journal_mode=WAL;")
    cursor.execute("PRAGMA foreign_keys=ON;")
    cursor.close()


@lru_cache(maxsize=1)
def get_engine(db_path: str | None = None) -> Engine:
    """
    싱글톤 SQLAlchemy Engine을 반환합니다.

    Args:
        db_path: SQLite DB 파일 경로. None이면 settings에서 가져옵니다.
    """
    if db_path is None:
        settings = get_settings()
        db_path = os.path.join(settings.file.database_dir, "auction_data.db")

    os.makedirs(os.path.dirname(os.path.abspath(db_path)), exist_ok=True)

    return create_engine(
        f"sqlite:///{db_path}",
        echo=False,
        pool_pre_ping=True,
    )


def get_session(db_path: str | None = None) -> Generator[Session, None, None]:
    """
    SQLAlchemy Session 컨텍스트 매니저.

    Usage::

        with next(get_session()) as session:
            session.query(AuctionCleaned).all()
    """
    engine = get_engine(db_path)
    factory = sessionmaker(bind=engine)
    session = factory()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()
