# Digital AI Meter

Digital AI Meter is an MLH-style MVP for monitoring utility consumption and detecting unusual electricity and water usage patterns in a simple, dashboard-driven interface.

This project combines a responsive frontend with a FastAPI backend to show consumption trends, AI-style insights, anomaly detection, forecasts, and utility alerts using simulated meter data.

## Live demo

- Production URL: https://digital-ai-meter.onrender.com

## Features

- Electricity and water dashboard overview
- AI usage score based on recent daily patterns
- Live-style consumption metrics and summary cards
- Unusual usage detection and alert summaries
- Appliance-level estimate breakdowns
- Forecasting for near-term usage and expected cost
- Usage analytics with period filters and comparisons
- Reports page with PDF export support
- Ask AI interaction for quick operational questions
- Mobile-friendly responsive interface

## Tech stack

- Backend: FastAPI
- Frontend: HTML, CSS, JavaScript
- Data source: bundled CSV demo dataset
- Optional analytics: Snowflake-ready integration
- Deployment: Render

## Run locally on Windows

```powershell
cd Digital-AI-Meter--main
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn app.main:app --reload
```

Then open:

- http://127.0.0.1:8000

## Project structure

```text
Digital-AI-Meter--main/
├── app/
│   ├── main.py
│   ├── static/
│   │   ├── index.html
│   │   ├── app.js
│   │   └── styles.css
│   └── __init__.py
├── data/
│   └── meter_data.csv
├── README.md
├── requirements.txt
├── render.yaml
├── test_snowflake.py
└── .gitignore
```

## Demo data and assumptions

The bundled sample data is simulated for demonstration purposes only. It contains 90 days of hourly electricity and water readings from July 10 through October 7, 2026, with the latest day partially populated.

The app is designed to behave like a smart utility dashboard for a hackathon demo, not as a real-time meter monitoring system. Leakage and fault warnings indicate possible patterns rather than confirmed physical issues. No external API key is required for the local demo flow.

## Deploy on Render

This project includes a Render Blueprint in `render.yaml`.

To deploy it:

1. Push this project folder to a GitHub repository you control.
2. Open Render and choose **New + → Blueprint**.
3. Connect the repository and select `render.yaml`.
4. Review the settings, then create the web service.
5. Render will build and deploy the app automatically.

Optional: configure Snowflake environment variables in Render if you want to enable the Snowflake-based data path instead of the included demo CSV.

Do not store credentials in the repository. Use Render environment variables instead.
