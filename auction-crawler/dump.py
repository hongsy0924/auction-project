import sqlite3
import pandas as pd

conn = sqlite3.connect('database/auction_data.db')
df = pd.read_sql_query('SELECT * FROM auction_list', conn)


print(df.columns.tolist())

conn.close()