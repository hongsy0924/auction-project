"""
Pytest configuration and fixtures.
"""
import os
import sys

import pytest

# src 모듈을 찾을 수 있도록 경로 추가
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

def pytest_addoption(parser):
    """Add command line options."""
    parser.addoption(
        "--run-real-api",
        action="store_true",
        default=False,
        help="Run tests that call real external APIs",
    )

def pytest_configure(config):
    """Configure pytest."""
    config.addinivalue_line("markers", "real_api: mark test as calling real external API")

def pytest_collection_modifyitems(config, items):
    """Skip real_api tests unless --run-real-api is given."""
    if config.getoption("--run-real-api"):
        # --run-real-api given in cli: do not skip real_api tests
        return

    skip_real_api = pytest.mark.skip(reason="need --run-real-api option to run")
    for item in items:
        if "real_api" in item.keywords:
            item.add_marker(skip_real_api)
