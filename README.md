# Nexora — Sustainable Facility & Estate Intelligence

Nexora is a local-first facility-intelligence dashboard for exploring energy, water, waste, environmental context, operational actions, and sustainability KPIs. The repository contains a React + TypeScript frontend and a FastAPI + SQLite backend.

## Quick start (Windows)
1. Install Node.js 22 LTS and Python 3.12 or 3.13.
2. Extract the repository.
3. Run `nexora.bat` and select **1 — Start the dashboard**.
4. Open <http://localhost:8000>. Keep the launcher window open while using the application.

For developer mode, use `npm run dev`. To run the backend tests, use `npm run test:api` after the dependencies have been installed. See [HOW_TO_RUN.md](HOW_TO_RUN.md) for account setup, environment variables, roles, data uploads, and troubleshooting.

## Critical Insights
The **Benchmarking** page includes an explainable prototype for four decision-support capabilities:

- **Sustainability scorecard (0–100):** an equal-weight average of available resource-intensity component scores. Configured targets and historical baselines are shown per component. Missing components reduce coverage and are not treated as perfect scores.
- **Waste-overflow risk:** a 0–100 rules-based screening estimate based on recent monthly waste totals and open waste-related complaints. It is not a bin-level prediction.
- **Equipment-maintenance risk:** a 0–100 rules-based prioritization proxy using available peak electrical demand, HVAC energy, leakage indicators, and open maintenance/equipment complaints. It is not a trained equipment-failure probability.
- **Cross-metric anomaly events:** groups independently screened electricity, water, and waste readings when at least two flags occur in the same area and reporting month. Co-occurrence is not proof of causation.

The API endpoint is `GET /api/critical-insights`; it uses the existing Benchmarking page access permission. All these outputs are prototypes and should not be described as calibrated predictions. Monthly demonstration/modelled data must be distinguished from measured facility uploads.

## Architecture
- `src/` — React dashboard and bundled demonstration/reference data.
- `backend/app.py` — FastAPI application, authentication, uploads, and core endpoints.
- `backend/ops.py` — benchmarking and operational API routes, including `/api/critical-insights`.
- `backend/engine/critical.py` — pure, testable scorecard, risk proxy, and cross-metric grouping logic.
- `backend/tests/test_critical.py` — tests for score bounds, missing-data handling, risk signal behavior, and compound-event grouping.
- `backend/data/` — local SQLite database and uploaded files, created at runtime.

## Data and limitations
The application includes historical/reference and demonstration/modelled values alongside user-uploaded measurements. A chart or score derived from demonstration data is not a live sensor reading. Risk values are heuristic scores, not calibrated probabilities. For operational deployment, provide validated facility targets, bin fill-level and collection data, asset identifiers and service/fault histories, and test the full ingestion-to-action workflow.

## Project test status
The critical-intelligence unit tests are in `backend/tests/test_critical.py`. The repository's complete backend suite currently includes an image-format test that requires `pillow-heif`, declared in `backend/requirements.txt`; ensure dependencies are installed before running the full suite.

## Mid-evaluation demo: simulated hourly intelligence

Open **Operations → Benchmarking → Sustainability & Risk Insights** and use the simulator controls. Select **Normal**, **Inject water leak**, **Inject energy spike**, or **Inject compound event**. The API returns repeatable synthetic hourly energy, water and waste readings, threshold events, a 24-hour hour-of-day-mean baseline forecast, retrospective MAE, and structured rule-based recommendations.

- API: `GET /api/demo-intelligence?scenario=normal|leak|energy_spike|compound`
- All demo values are labelled `SIMULATED`; they are not inserted into the measured facility dataset.
- Forecasting requires at least 24 hourly readings and uses a transparent baseline, not a trained prediction model.
- Recommendations explicitly list evidence, assumptions, expected benefit, confidence/limitations, and verification steps. Savings are not claimed without measured follow-up.
- Run focused tests from the repository root with `PYTHONPATH=backend python -m pytest backend/tests/test_hourly_demo.py backend/tests/test_critical.py -q`.
