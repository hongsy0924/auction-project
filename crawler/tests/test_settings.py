"""Verify settings singleton works and all config values are accessible."""
from src.settings import get_settings


def test_settings_singleton():
    s1 = get_settings()
    s2 = get_settings()
    assert s1 is s2


def test_vworld_key_accessible():
    s = get_settings()
    assert hasattr(s.api, "vworld_api_key")
    assert hasattr(s.api, "vworld_url")


def test_council_api_accessible():
    s = get_settings()
    assert hasattr(s.api, "council_api_url")
    assert hasattr(s.api, "council_api_key")


def test_crawling_defaults():
    s = get_settings()
    assert s.crawling.page_size > 0
    assert s.crawling.request_delay > 0
