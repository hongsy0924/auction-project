'''Deprecated'''


# import pandas as pd
# import sqlite3
# import os

# # 엑셀 파일 경로 지정 (예시)
# EXCEL_FILE = 'output/auction_list_20250505_181249.xlsx'  # 필요시 파일명 변경
# DB_FILE = 'database/auction_data.db'
# TABLE_NAME = 'auction_list'

# # 엑셀 파일 존재 확인
# if not os.path.exists(EXCEL_FILE):
#     raise FileNotFoundError(f"엑셀 파일이 존재하지 않습니다: {EXCEL_FILE}")

# # 데이터프레임 읽기
# print(f"엑셀 파일 읽는 중: {EXCEL_FILE}")
# df = pd.read_excel(EXCEL_FILE)

# # SQLite DB 연결
# os.makedirs(os.path.dirname(DB_FILE), exist_ok=True)
# conn = sqlite3.connect(DB_FILE)

# # 데이터 저장
# print(f"SQLite DB에 저장 중: {DB_FILE} (테이블명: {TABLE_NAME})")
# df.to_sql(TABLE_NAME, conn, if_exists='replace', index=False)

# conn.close()
# print(f"완료! {len(df)}건이 DB에 저장되었습니다.") 