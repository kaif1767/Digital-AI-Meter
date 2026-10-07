 Digital AI Meter — MLH Hackathon MVP

Working prototype with electricity/water dashboard, anomaly detection, prediction endpoint, possible leakage/fault insights, AI-style explanations, alerts, Ask AI, and time-slot analysis.

## Run on Windows
```powershell
cd digital-ai-meter
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn app.main:app --reload
```
Open **http://127.0.0.1:8000**.

The included meter data is simulated for a reliable hackathon demo. It contains 90 days of hourly electricity and water readings (July 10 through October 7, 2026; the latest day is partial). Simulated readings are for demonstration only and are not live utility measurements. Leakage/fault messages indicate possible patterns, not confirmed physical faults. The AI explanation layer is local in this MVP, so no API key is required.

## Deploy on Render

This project includes a Render Blueprint in `render.yaml`. To publish it:

1. Push this project folder to a GitHub repository you control.
2. In Render, choose **New + → Blueprint**, connect that repository, and select `render.yaml`.
3. Review the service settings and create the web service. Render will build and deploy the app.
4. Open the public `onrender.com` URL shown on the service page and share it.

The hosted demo uses the bundled simulated meter readings. Do not add credentials to the repository; configure any optional Snowflake credentials as Render environment variables in the service settings.
