import sqlite3
import pandas as pd

# 남길 컬럼과 새 이름 매핑
columns = {
    "srnSaNo": "사건번호",
    "dspslUsgNm": "물건종류",
    "jimokList": "지목",
    "printSt": "주소",
    "daepyoLotno": "지번",
    "gamevalAmt": "감정평가액",
    "notifyMinmaePrice1": "최저매각가격",
    "notifyMinmaePricerate2": "%",
    "mulbigo": "비고",
    "maeGiil": "매각기일",
    "yuchalCnt": "유찰회수",
    "maegyuljgiil": "매각결정기일",
    "pjbBuldList": "건축물",
    "areaList": "면적",
    "land_use": "토지이용계획및제한상태",
    "jiwonNm": "담당법원",
    "jpDeptNm": "담당계",
    "tel": "전화번호",
    # "colMerge" : "컬럼병합"
}

db_path = "../auction-viewer/database/auction_data.db"
table = "auction_list"
new_table = "auction_list_cleaned"


conn = sqlite3.connect(db_path)
cur = conn.cursor()

# 1. (기존 테이블 삭제) 새 테이블 생성 전에!
cur.execute(f'DROP TABLE IF EXISTS {new_table};')

# 2. 새 테이블 생성
col_defs = ", ".join([f'"{v}" TEXT' for v in columns.values()])
cur.execute(f'CREATE TABLE IF NOT EXISTS {new_table} ({col_defs});')

# 3. 데이터 복사 (컬럼명 매핑)
col_select = ", ".join([f'"{k}"' for k in columns.keys()])
col_insert = ", ".join([f'"{v}"' for v in columns.values()])
cur.execute(f'INSERT INTO {new_table} ({col_insert}) SELECT {col_select} FROM {table};')

conn.commit()
conn.close()
print(f"완료! 새 테이블이 {db_path}에 생성되었습니다.")

# 미리보기 (원하는 경로 하나만)
conn = sqlite3.connect(db_path)
df = pd.read_sql_query(f"SELECT * FROM {new_table} LIMIT 5", conn)
print(df.head())
conn.close()