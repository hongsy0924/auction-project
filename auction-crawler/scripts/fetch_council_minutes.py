
import argparse
import json
import logging
import os
import sys
import time
from datetime import datetime, timedelta
from typing import Any

import requests

# Add parent directory to path to import config
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from config import COUNCIL_API_CONFIG

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

class CouncilCrawler:
    def __init__(self):
        self.api_key = COUNCIL_API_CONFIG['api_key']
        self.base_url = COUNCIL_API_CONFIG['base_url']
        self.timeout = COUNCIL_API_CONFIG['timeout']

        if not self.api_key:
            logger.warning("No API Key found in configuration. API calls may fail.")


    # Region ID Mapping (Partial list from user provided image)
    RASMBLY_ID_MAP = {
        '서울특별시의회': '002001',
        '부산광역시의회': '051001',
        '대구광역시의회': '053001',
        '인천광역시의회': '032001',
        '광주광역시의회': '062001',
        '대전광역시의회': '042001',
        '울산광역시의회': '052001',
        '세종특별자치시의회': '044001',
        '경기도의회': '031001',
        '강원도의회': '033001',
        '충청북도의회': '043001',
        '충청남도의회': '041001',
        '전라북도의회': '063001',
        '전라남도의회': '061001',
        '경상북도의회': '054001',
        '경상남도의회': '055001',
        '제주특별자치도의회': '064001',
        '거제시의회': '055002'
    }

    def fetch_minutes(self,
                     region: str,
                     start_date: str,
                     end_date: str,
                     page_size: int = 100,
                     limit: int = 0,
                     search_type: str = 'RASMBLY_NM',
                     search_keyword: str | None = None) -> list[dict]:
        """
        Fetch council minutes for a specific region and date range.
        If search_keyword is provided, it uses that for searching.
        Otherwise defaults to searching by region name.
        """
        all_results = []
        page_index = 1

        region_id = self.RASMBLY_ID_MAP.get(region)
        if not region_id:
            logger.error(f"Unknown region: {region}")
            return []

        logger.info(f"Fetching minutes for {region} ({region_id}) from {start_date} to {end_date}")
        if search_keyword:
             logger.info(f"Search Type: {search_type}, Keyword: {search_keyword}")

        while True:
            params = {
                'key': self.api_key,
                'type': 'json',
                'startCount': (page_index - 1) * page_size + 1,
                'listCount': page_size,
                'RASMBLY_ID': region_id,
                'displayType': 'list',
                'searchType': search_type if search_keyword else 'RASMBLY_NM',
                'searchKeyword': search_keyword if search_keyword else region
            }

            try:
                response = requests.get(self.base_url, params=params, timeout=self.timeout)
                response.raise_for_status()

                try:
                    data = response.json()
                except json.JSONDecodeError:
                    logger.error(f"Failed to decode JSON. Response text: {response.text[:200]}")
                    break

                if 'INFO-000' in str(data): # "No Data" common code
                    logger.info("No more data found.")
                    break

                logger.info(f"Fetched page {page_index}...")

                items = self._parse_items(data)
                if not items:
                    break

                detailed_items = []
                for item in items:
                    row = item.get('ROW', item)

                    # Client-side filtering: The API might return results from other councils
                    # when using broad search types (e.g. searchType='ALL').
                    # We explicitly filter by RASMBLY_ID to ensure accuracy.
                    item_rasmbly_id = row.get('RASMBLY_ID')
                    if region_id and item_rasmbly_id and item_rasmbly_id != region_id:
                        continue

                    doc_id = row.get('DOCID')

                    if doc_id:
                        try:
                            logger.info(f"Fetching detail for {doc_id}...")
                            detail_params = {
                                'key': self.api_key,
                                'type': 'json',
                                'displayType': 'detail',
                                'docid': doc_id
                            }
                            detail_resp = requests.get(self.base_url, params=detail_params, timeout=self.timeout)
                            if detail_resp.status_code == 200:
                                detail_data = detail_resp.json()
                                if isinstance(detail_data, list) and len(detail_data) > 0:
                                    row.update(detail_data[0])
                        except Exception as e:
                            logger.warning(f"Failed to fetch detail for {doc_id}: {e}")

                    detailed_items.append(row)

                    if limit > 0 and len(all_results) + len(detailed_items) >= limit:
                        break

                all_results.extend(detailed_items)

                if limit > 0 and len(all_results) >= limit:
                    logger.info(f"Reached limit of {limit} items.")
                    break

                if len(items) < page_size:
                    break

                page_index += 1
                time.sleep(0.5)

            except requests.exceptions.RequestException as e:
                logger.error(f"Request failed: {e}")
                break

        return all_results

    def _parse_items(self, data: Any) -> list[dict]:
        """
        Helper to extract items list from various response structures.
        """
        if isinstance(data, list):
            if len(data) > 0 and 'LIST' in data[0]:
                return data[0]['LIST']
            return data

        if isinstance(data, dict):
            if 'LIST' in data:
                return data['LIST']

            for key in ['items', 'row', 'data', 'list']:
                if key in data and isinstance(data[key], list):
                    return data[key]

        return []

    def save_results(self, data: list[dict], filename: str):
        filepath = os.path.join('data/council/raw', filename)
        with open(filepath, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        logger.info(f"Saved {len(data)} items to {filepath}")

def main():
    parser = argparse.ArgumentParser(description='Fetch Local Council Minutes')
    parser.add_argument('--region', type=str, required=True, help='Region Name (e.g. "서울특별시의회")')
    parser.add_argument('--days', type=int, default=730, help='Number of days to look back')
    parser.add_argument('--limit', type=int, default=0, help='Max number of items to fetch (0 for all)')
    parser.add_argument('--search_type', type=str, default='RASMBLY_NM', help='Search Type (e.g. ALL, RASMBLY_NM)')
    parser.add_argument('--search_keyword', type=str, help='Search Keyword (e.g. 예산)')

    args = parser.parse_args()

    end_date = datetime.now()
    start_date = end_date - timedelta(days=args.days)

    crawler = CouncilCrawler()
    results = crawler.fetch_minutes(
        region=args.region,
        start_date=start_date.strftime('%Y%m%d'),
        end_date=end_date.strftime('%Y%m%d'),
        limit=args.limit,
        search_type=args.search_type,
        search_keyword=args.search_keyword
    )

    if results:
        crawler.save_results(results, f"{args.region}_{start_date.strftime('%Y%m%d')}_{end_date.strftime('%Y%m%d')}.json")
    else:
        logger.info("No results found.")

if __name__ == "__main__":
    main()
