import os
import snowflake.connector
from dotenv import load_dotenv

load_dotenv()

print("Account:", os.getenv("SNOWFLAKE_ACCOUNT"))
print("User:", os.getenv("SNOWFLAKE_USER"))
print("Warehouse:", os.getenv("SNOWFLAKE_WAREHOUSE"))
print("Database:", os.getenv("SNOWFLAKE_DATABASE"))
print("Schema:", os.getenv("SNOWFLAKE_SCHEMA"))

conn = snowflake.connector.connect(
    account=os.getenv("SNOWFLAKE_ACCOUNT"),
    user=os.getenv("SNOWFLAKE_USER"),
    password=os.getenv("SNOWFLAKE_PASSWORD"),
    warehouse=os.getenv("SNOWFLAKE_WAREHOUSE"),
    database=os.getenv("SNOWFLAKE_DATABASE"),
    schema=os.getenv("SNOWFLAKE_SCHEMA")
)

cursor = conn.cursor()

cursor.execute("SELECT COUNT(*) FROM METER_DATA")

result = cursor.fetchone()

print("SUCCESS!")
print("Rows in Snowflake:", result[0])

cursor.close()
conn.close()