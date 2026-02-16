
import sqlite3
import datetime
import os

def insert_test_data():
    db_path = '../auction-viewer/database/auction_data.db'
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()

    # Ensure table exists
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS auction_list (
        docid TEXT PRIMARY KEY,
        srnSaNo TEXT,
        maeGiil TEXT,
        dspslUsgNm TEXT,
        printSt TEXT,
        gamevalAmt TEXT,
        notifyMinmaePrice1 TEXT,
        daepyoLotno TEXT,
        jiwonNm TEXT
    )
    ''')
    
    today = datetime.datetime.now().strftime('%Y%m%d')
    timestamp = datetime.datetime.now().strftime('%H:%M:%S')

    print(f"Inserting test data at {timestamp}...")

    test_data = [
        (f"TEST-{today}-01", "2026타경1001", "2026-03-01", "아파트", "서울 강남구 테스트동 101", "1000000000", "800000000", "123-45", "서울중앙지방법원"),
        (f"TEST-{today}-02", "2026타경1002", "2026-03-01", "빌라", "서울 서초구 테스트동 202", "500000000", "400000000", "678-90", "서울중앙지방법원"),
        (f"TEST-{today}-03", "2026타경1003", "2026-03-02", "상가", "서울 송파구 테스트동 303", "2000000000", "1500000000", "111-22", "서울동부지방법원"),
        (f"TEST-{today}-04", "2026타경1004", "2026-03-02", "토지", "경기 성남시 테스트동 404", "300000000", "200000000", "333-44", "수원지방법원"),
        (f"TEST-{today}-05", "2026타경1005", "2026-03-03", "공장", "경기 용인시 테스트동 505", "5000000000", "3500000000", "555-66", "수원지방법원"),
    ]

    for item in test_data:
        # Insert or Replace
        cursor.execute('''
        INSERT OR REPLACE INTO auction_list (
            docid, srnSaNo, maeGiil, dspslUsgNm, printSt, gamevalAmt, notifyMinmaePrice1, daepyoLotno, jiwonNm
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ''', item)

    conn.commit()
    conn.close()
    print("Test data inserted successfully.")

if __name__ == "__main__":
    insert_test_data()
