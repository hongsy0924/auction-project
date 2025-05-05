import pandas as pd

# 엑셀 파일 경로 지정 (예시: 'output/auction_list_20240627_153000.xlsx')
file_path = '/Users/soonyoung/Desktop/Auction/output/auction_list_20250504_003953.xlsx'

# 엑셀 파일 읽기
df = pd.read_excel(file_path)

# 컬럼명 리스트 출력
print(df.columns.tolist())
