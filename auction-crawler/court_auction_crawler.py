"""
Court Auction Crawler — Entry Point
This file delegates to the modular src.pipeline module.
Kept for backward compatibility with existing scripts (run-crawler.sh, deploy.sh).
"""
import asyncio
import logging
import os
import sys
from datetime import datetime

from src.settings import get_settings


def setup_logging() -> None:
    """로깅 설정"""
    settings = get_settings()
    os.makedirs(settings.file.log_dir, exist_ok=True)

    log_file = os.path.join(
        settings.file.log_dir,
        f"court_auction_crawler_{datetime.now().strftime('%Y%m%d')}.log",
    )

    logging.basicConfig(
        level=getattr(logging, settings.logging.level, logging.INFO),
        format=settings.logging.log_format,
        datefmt=settings.logging.date_format,
        handlers=[
            logging.FileHandler(log_file, encoding='utf-8'),
            logging.StreamHandler(),
        ],
    )


if __name__ == "__main__":
    setup_logging()

    from src.pipeline import main
    asyncio.run(main())