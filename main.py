from pathlib import Path
from datetime import datetime
import csv, statistics
import os
from functools import lru_cache
from dotenv import load_dotenv
load_dotenv()

from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
try:
    from sklearn.ensemble import IsolationForest
    SK=True
except Exception: SK=False
BASE=Path(__file__).resolve().parent.parent; DATA=BASE/'data'/'meter_data.csv'; STATIC=BASE/'app'/'static'
app=FastAPI(title='Digital AI Meter',version='1.0.0')

@lru_cache(maxsize=4)
def load_local(resource, modified_ns, file_size):
    with DATA.open(newline="", encoding="utf-8") as file:
        rows = csv.DictReader(file)
        return [
            {
                "timestamp": (dt := datetime.fromisoformat(row["timestamp"])).isoformat(),
                "meter_id": row["meter_id"],
                "resource": row["resource"],
                "consumption": float(row["consumption"]),
                "dt": dt,
            }
            for row in rows
            if resource is None or row["resource"] == resource
        ]

def snowflake_connection():
    import snowflake.connector

    return snowflake.connector.connect(
        account=os.getenv("SNOWFLAKE_ACCOUNT"),
        user=os.getenv("SNOWFLAKE_USER"),
        password=os.getenv("SNOWFLAKE_PASSWORD"),
        warehouse=os.getenv("SNOWFLAKE_WAREHOUSE"),
        database=os.getenv("SNOWFLAKE_DATABASE"),
        schema=os.getenv("SNOWFLAKE_SCHEMA")
    )

@app.get('/snowflake-test')
def snowflake_test():
    conn = snowflake_connection()
    cur = conn.cursor()

    cur.execute("SELECT COUNT(*) FROM METER_DATA")
    count = cur.fetchone()[0]

    cur.close()
    conn.close()

    return {
        "snowflake": "connected",
        "meter_rows": count
    }

app.add_middleware(CORSMiddleware,allow_origins=['*'],allow_credentials=True,allow_methods=['*'],allow_headers=['*'])

def load(resource=None):
    if not os.getenv("SNOWFLAKE_ACCOUNT"):
        stat = DATA.stat()
        return load_local(resource, stat.st_mtime_ns, stat.st_size)

    conn = snowflake_connection()
    cur = conn.cursor()

    if resource:
        cur.execute("""
            SELECT TIMESTAMP, METER_ID, RESOURCE, CONSUMPTION
            FROM METER_DATA
            WHERE RESOURCE = %s
            ORDER BY TIMESTAMP
        """, (resource,))
    else:
        cur.execute("""
            SELECT TIMESTAMP, METER_ID, RESOURCE, CONSUMPTION
            FROM METER_DATA
            ORDER BY TIMESTAMP
        """)

    rows = cur.fetchall()

    cur.close()
    conn.close()

    d = []

    for timestamp, meter_id, resource_name, consumption in rows:
        d.append({
            'timestamp': timestamp.isoformat() if hasattr(timestamp, 'isoformat') else str(timestamp),
            'meter_id': meter_id,
            'resource': resource_name,
            'consumption': float(consumption),
            'dt': timestamp
        })

    return d

@lru_cache(maxsize=16)
def anomaly_indices(values):
    if len(values)<10:return ()
    if SK: labels=IsolationForest(contamination=.06,random_state=42).fit_predict([[x] for x in values])
    else:
        m=statistics.mean(values); s=statistics.pstdev(values) or 1; labels=[-1 if abs(x-m)>2.7*s else 1 for x in values]
    return tuple(index for index,label in enumerate(labels) if label==-1)

def anomalies(d):
    vals=tuple(r['consumption'] for r in d)
    mean=statistics.mean(vals) if vals else 0
    return [{'timestamp':d[i]['timestamp'],'consumption':vals[i],'severity':'high' if vals[i]>mean*2.2 else 'medium'} for i in anomaly_indices(vals)]
def insight(resource,d,a):
    label='electricity' if resource=='electricity' else 'water'; vals=[r['consumption'] for r in d]; avg=sum(vals)/len(vals); recent=sum(vals[-6:])/6
    if a:
        x=a[-1]
        return (f'Unusual water usage was detected around {x["timestamp"]}. Continuous overnight usage may indicate a possible leakage pattern. Check taps, tanks and connected lines.' if resource=='water' else f'An unusual electricity spike was detected around {x["timestamp"]}. Check high-load appliances and equipment for unexpected usage.')
    return f'Recent {label} consumption is above the historical average. Consider checking the latest time slots and reducing avoidable usage.' if recent>avg*1.15 else f'{label.capitalize()} consumption is broadly within its recent range. Keep monitoring peak time slots for unusual changes.'
@app.get('/')
def home(): return FileResponse(STATIC/'index.html')
@app.get('/health')
def health(): return {'status':'ok','model':'Isolation Forest' if SK else 'statistical fallback'}
@app.get('/meter-data')
def meter_data(resource:str=Query('electricity')): return [{'timestamp':r['timestamp'],'consumption':r['consumption']} for r in load(resource)]
@app.get('/summary')
def summary(resource:str=Query('electricity')):
    d=load(resource); v=[r['consumption'] for r in d]; return {'resource':resource,'current':round(v[-1],2),'average':round(sum(v)/len(v),2),'peak':round(max(v),2),'last_24_total':round(sum(v[-24:]),2),'anomaly_count':len(anomalies(d)),'unit':'kWh' if resource=='electricity' else 'L'}
@app.get('/anomalies')
def get_anomalies(resource:str=Query('electricity')): return anomalies(load(resource))
@app.get('/prediction')
def prediction(resource:str=Query('electricity')):
    d=load(resource); v=[r['consumption'] for r in d[-12:]]; base=sum(v)/len(v); slope=(v[-1]-v[0])/max(1,len(v)-1); last=d[-1]['dt']
    return [{'timestamp':last.isoformat(),'predicted':round(max(0,base+slope*(i+1)),2)} for i in range(6)]

@app.get('/recommendation')
def recommendation(resource: str = Query('electricity')):
    d = load(resource)

    v = [r['consumption'] for r in d[-12:]]
    base = sum(v) / len(v)
    slope = (v[-1] - v[0]) / max(1, len(v) - 1)

    predicted = max(0, base + slope)

    if predicted > base * 1.15:
        if resource == 'electricity':
            action = "Predicted usage is increasing. Consider reducing high-consumption appliances during the upcoming hours."
        else:
            action = "Predicted water usage is increasing. Check taps, tanks and connected lines for unnecessary consumption."
    else:
        if resource == 'electricity':
            action = "Usage is expected to remain stable. Continue monitoring your consumption and avoid unnecessary appliance usage."
        else:
            action = "Water usage is expected to remain stable. Continue monitoring for unnecessary consumption."

    return {
        "resource": resource,
        "predicted": round(predicted, 2),
        "average": round(base, 2),
        "recommendation": action
    }

@app.get('/ai-insight')
def ai_insight(resource:str=Query('electricity')):
    d=load(resource); a=anomalies(d); return {'insight':insight(resource,d,a)}

@app.get('/ask-ai')
def ask_ai(question: str, resource: str = Query('electricity')):
    d = load(resource)
    a = anomalies(d)
    label = resource
    q = question.lower()
    u = 'kWh' if resource == 'electricity' else 'L'

    current = d[-1]['consumption']
    average = sum(r['consumption'] for r in d) / len(d)
    peak = max(d, key=lambda r: r['consumption'])
    last_24 = sum(r['consumption'] for r in d[-24:])

    if any(x in q for x in ['peak', 'highest', 'maximum']):
        return {
            'answer': f'The highest recorded {label} usage was {peak["consumption"]:.2f} {u} at {peak["timestamp"]}.'
        }

    if any(x in q for x in ['average', 'normal', 'usual']):
        return {
            'answer': f'The average {label} consumption is {average:.2f} {u} per hourly reading.'
        }

    if any(x in q for x in ['current', 'now', 'right now']):
        return {
            'answer': f'Your current {label} usage is {current:.2f} {u} per hour.'
        }

    if any(x in q for x in ['24', 'today', 'daily', 'last day']):
        return {
            'answer': f'Total recorded {label} consumption across the latest 24 hourly readings is {last_24:.2f} {u}.'
        }

    if any(x in q for x in ['anomal', 'unusual', 'abnormal', 'alert', 'spike']):
        if a:
            x = a[-1]
            return {
                'answer': f'I detected {len(a)} unusual {label} reading(s). The latest was {x["consumption"]:.2f} {u} at {x["timestamp"]}.'
            }
        return {
            'answer': f'No unusual {label} patterns were detected in the available readings.'
        }

    if any(x in q for x in ['saving', 'reduce', 'lower', 'waste']):
        if current > average * 1.15:
            return {
                'answer': f'Current {label} usage is above the historical average. Consider checking high-consumption appliances or recent time slots and reducing avoidable usage.'
            }
        return {
            'answer': f'Current {label} usage is within the recent range. Continue monitoring peak time slots to identify opportunities for saving.'
        }

    return {
        'answer': insight(resource, d, a)
    }

app.mount('/static',StaticFiles(directory=STATIC),name='static')
