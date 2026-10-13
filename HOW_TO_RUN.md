# Nexora dashboard — how to run (Windows + VS Code)

The project has two parts:
- **Dashboard** (React + Vite, folder `src/`) – the screens.
- **Server** (Python FastAPI + SQLite, folder `backend/`) – sign-in, uploads, alerts, action tracking, savings, live feeds, bills, complaints and reports.

## One-time setup
1. Install **Node.js 22 LTS** from https://nodejs.org.
2. Install **Python 3.12 or 3.13** from https://www.python.org (tick “Add python.exe to PATH”).
3. Unzip this folder anywhere.

## Start it – one file: `Nexora.bat`
Double-click **`Nexora.bat`** in this folder and type a number:

| # | Option | What it does |
|---|---|---|
| **1** | **Start the dashboard** | Installs or updates whatever is missing, builds, starts the server and opens **http://localhost:8000**. Keep the window open; close it to stop. |
| 2 | Developer mode | Server in its own window plus live-reload dashboard on http://localhost:5173 (for editing code). |
| 3 | Install / repair packages | Forces a fresh install of Python and npm packages. |
| 4 | Run the tests | Backend test suite. |
| 5 | Add or edit keys | Creates or updates `backend\.env` (new settings are added for you) and opens it in Notepad: Groq for Indi, Google sign-in, WhatsApp, SMS, data.gov.in. |
| 6 | Check my setup | Versions, packages, which keys are set (never their values), ports and database. Send this output if something fails. |
| 7 | Stop Nexora | Frees ports 8000 and 5173. |
| 8 | Reset all data | Moves `backend\data` to a dated backup and starts fresh. Type RESET to confirm. |
| 9 | Open the guide | This file. |
| 10 | Head account on this PC | Creates or repairs the head’s account (`HEAD_EMAIL`) with a password – use it if Google sign-in is not set up yet. Works only on the server PC. |

From a terminal the same options work as words: `Nexora.bat start`, `dev`, `install`, `test`, `keys`, `check`, `stop`, `reset`.
When an update adds new packages, option 1 notices the changed `backend\requirements.txt` / `package-lock.json` and installs them by itself – no commands to type.
The first run takes a few minutes. You are then asked to create the **administrator** account (with your email). Afterwards, go to **Staff & access** to add staff, and to **Admin & alerts** for alert recipients and each site’s profile (people served, floor area, tariff). Each person lands on **Today**.

## From VS Code
`npm run dev` starts **both** the Python server and the dashboard (http://localhost:5173); `Ctrl+C` stops both.
Or `Ctrl+Shift+B` → **Nexora: run all**. Run option 3 of `Nexora.bat` once first so the packages exist.

## Part 1A features (operations)
| Feature | Where | Who |
|---|---|---|
| **Data upload** (CSV/Excel meter or bill readings) | *Data upload* | profiles with *Can change* |
| **Alerts** (in-app bell + WhatsApp/SMS, escalation) | bell icon; settings in *Admin & alerts* | everyone sees; *Can change* acknowledges |
| **Action tracker** (owner, due date, status, comments, photo/PDF proof) | *Recommendations* cards | *Can change* edits; read-only profiles view |
| **Savings tracker** (before/after, units and ₹) | *Savings tracker* | *Can change* |
| **Logins, job profiles and sites** | *Staff & access* | admins |

## Part 1B features
| Feature | Where | Notes |
|---|---|---|
| **Live air quality and weather** | *Command Center* (Live conditions) and *Today* | Official CPCB station data when `DATA_GOV_IN_API_KEY` is set; otherwise Open-Meteo’s **modelled** estimate, labelled “Modelled · not official”. Weather from Open-Meteo. Refreshed every 30 minutes; needs internet. |
| **Today** (plain-language summary) | first page after sign-in | Open alerts, overdue actions, urgent complaints, your assigned actions, poor air, heavy rain (IMD ≥ 64.5 mm/day) or ≥ 40 °C days, bill warnings, high deviations. |
| **Benchmarking + Sustainability & Risk Insights** | *Benchmarking* | Per person, per m², litres/person/day vs the CPHEEO 135 norm, Energy Performance Index (kWh/m²/year), peak vs contract demand, an explainable composite 0–100 sustainability score, waste-overflow risk proxy, equipment-maintenance risk proxy, and cross-metric anomaly co-occurrence. Needs *Site profiles* for meaningful normalized indicators. |
| **Bills & tariff** | *Bills & tariff* | Energy + demand + excess-demand penalty + fixed + water, and a 3-month forecast with bill-shock warnings. **You enter the tariff** in *Admin → Site profiles* (from your bill or OERC tariff order); nothing is assumed. |
| **Reports** | *Reports* | Monthly PDF for the Director/Commissioner; BRSR Principle 6 Excel pack (energy in GJ, water kL, waste tonnes) per financial year Apr–Mar. Demonstration figures stay labelled. |
| **Staff complaints** | *Staff complaints* | Anyone signed in files a complaint with category, severity, optional photo (≤ 8 MB) and map pin. Each becomes an action in *Recommendations* (High = P1). |

## Part 1C features
| Feature | Where | Notes |
|---|---|---|
| **Indi assistant (Groq AI)** | Right-hand panel on every page. Click the logo, the robot in the slim rail, or press **Ctrl + /** to open or close it | Answers questions about **your** dashboard: what's on screen plus a snapshot of your sites (latest readings with their evidence labels, alerts, actions, complaints, bills). Click any KPI or chart, then **Ask about this**. Needs a free Groq key: `Nexora.bat` → **5**, paste after `GROQ_API_KEY=`, then 7 and 1. Default model `openai/gpt-oss-120b`; set `GROQ_MODEL=openai/gpt-oss-20b` for faster answers. Without a key Indi stays in **Guide mode**. Limit: 20 questions per user per 5 minutes. |
| **Smooth scrolling + scroll rail** | Right edge of every page | Eased wheel scrolling. Drag the gradient thumb, click the track to jump, hover the gold dots to see section names and click one to glide there, and use **↑** for back to top. Maps keep normal zoom scrolling. |
| **Complaint location** | *Staff complaints* → *Where is it?* | Four ways: **Search place** (press Enter; OpenStreetMap search), **My location** (allow location in the browser; best on phones and laptops with Wi-Fi), **Coordinates** (`20.2961, 85.8245` or `20°17′46″N 85°49′28″E`), or **click the map**. The address is filled in automatically, and the form suggests the nearest site. |
| **Dismiss / delete complaints** | *Staff complaints* → *Open* / *Dismissed* tabs | **Dismiss** (with a reason) removes a complaint from Today, Recommendations, the action tracker and Indi, and lists it under *Dismissed*. Setting its action to *Dismissed* in Recommendations does the same. **Restore** brings it back. **Delete** (admins only) removes it permanently from everywhere – the record, photo, action history and proof files. Monthly PDF reports mark dismissed complaints. |
| **Photos of any type** | Complaints and action *Proof* | JPG, PNG, HEIC/HEIF (iPhone), WebP, GIF, BMP, TIFF, AVIF, JFIF, up to **8 MB**. HEIC, TIFF and BMP are converted to JPEG so everyone can see them. Proof can also be a PDF. |

## Staff, job profiles and sign-in (Part 1C)
**The opening screen has two tabs: _Sign in_ and _Create access ID_.**
- **Create access ID** – a new person fills in name, email, phone, job/department, chooses **Staff** or **Admin** access (and optionally their job) and a password. The request goes to the **head**.
- **The head – `viveksahusahu999@gmail.com` – approves every new staff or admin access**: sign-ups, “Sign in with Google” requests, staff proposed by other admins, and any promotion to an admin-level profile. Other admins can see and propose, but the *Approve* button works only for the head. A red number on *Staff & access* shows waiting requests.
- **How the head signs in**: with **Sign in with Google** using that Gmail (Google proves it is really the head), or by creating the very first account on this PC with that email, or with `Nexora.bat` → **10** on the server PC. A password sign-up using the head’s email is refused, so nobody can pretend to be the head. To hand over, change `HEAD_EMAIL` in `backend/.env` (Nexora.bat → 5).
- After approval, people sign in with their email (or staff ID) and the password they chose; Google requests sign in with Google; staff added by an admin get a one-time password from the head.

**Only registered emails can sign in.** Everyone is managed in **Operations → Staff & access**:

1. **Add staff** – name, email, job profile, sites. The dashboard makes a **staff ID** (e.g. `EIQ-0007`) and a **one-time password** (shown once – press *Copy* and send it privately). At first sign-in they must choose their own password.
2. **Sign-in options per person** – *Google or password* (default), *Google only*, or *Password only*. Staff can type their **email or staff ID**.
3. **Access requests** – someone whose Gmail is not registered can press **Sign in with Google** on the sign-in page. Google verifies their email and a request appears under *Access requests*. Pick their job profile and sites, then **Approve** (or Reject).
4. **Job profiles** decide what each job sees. Each profile has:
   - a **permission level** – *Read-only*, *Can change* (upload, actions, alerts, savings) or *Admin*;
   - its **pages** in the *Workspace* and *Operations* menus;
   - its **domains** (Energy, Water, Air Quality, Mobility, Buildings & Assets, Waste, Carbon, Climate & Resilience).

   Built-in profiles: Administrator, Estate / facility manager, Energy officer, Water & sanitation officer, Environment officer, Waste supervisor, Field staff, Director / commissioner, Auditor (read-only). Edit them, copy them, or make your own (e.g. *Pump house operator*).

   The menus hide everything else, and the server refuses it too: readings, alerts, uploads, bills, reports and Indi's answers are all limited to the profile's pages and domains. The MVP's base reference dataset is built into the dashboard, so domain limits are about *focus* rather than secrecy for that public/demonstration data. Uploaded measurements, alerts and costs are protected on the server.

**Turning on “Sign in with Google”** (free, about 5 minutes):
1. Go to <https://console.cloud.google.com> → create a project → **APIs & Services → OAuth consent screen**. Choose *External*, fill in the app name and your email, and add yourself as a test user while testing.
2. **APIs & Services → Credentials → Create credentials → OAuth client ID → Web application**. Under *Authorised JavaScript origins* add `http://localhost:8000` and `http://localhost:5173` (and your real address if you host it).
3. Copy the **Client ID** (ends in `.apps.googleusercontent.com`) → `Nexora.bat` → **5** → paste after `GOOGLE_CLIENT_ID=` → save → 7 and 1.
   The Google button then appears on the sign-in page. Without it, staff use email/staff ID and password.

Each person can also be limited to some **sites** (Palasuni, IRC Village, Khandagiri).

### Uploading readings
Use the template from the *Data upload* page. Long format `area,metric,month,value,note` or wide format `month,Electricity,Waste generated,…`.
Uploaded values are labelled **Measured**, replace demonstration values for the same month, and every uploaded month is screened with the MVP’s own rule (|z| ≥ 2 watch, ≥ 3 high deviation). Unusual readings create alerts. *Undo* removes an upload.

### Turning on WhatsApp / SMS
1. `Nexora.bat` → **5** opens `backend/.env` in Notepad. Fill in only what you use (never share or commit this file).
2. **WhatsApp:** Meta developer account → WhatsApp → API Setup gives `WHATSAPP_TOKEN` and `WHATSAPP_PHONE_NUMBER_ID`. For alerts to people who have not messaged you in the last 24 h, create an approved template with one variable `{{1}}` and set `WHATSAPP_TEMPLATE`.
3. **SMS:** `SMS_PROVIDER=twilio` (+ `TWILIO_*`) or `SMS_PROVIDER=msg91` (+ `MSG91_*`). Sending SMS in India needs DLT registration of your sender and template.
4. Restart, then *Admin & alerts* → add a recipient → **Test**. The result (sent / failed / not configured) is shown and logged.
Alerts still to be acknowledged after the escalation time (default 24 h) are re-sent once to recipients marked *Escalation contact*.

## Where data is stored
`backend/data/nexora.db` (users, readings, alerts, actions, savings, site profiles, complaints, live-data cache) and `backend/data/uploads/` (proof files and complaint photos). **Back up this folder.** Delete it to start fresh.

## Updating the MVP numbers
`src/nexora.json` (and `public/data/`) come from the Nexora Python MVP. After the MVP changes, from the MVP’s Python environment:
```powershell
python scripts\export_nexora.py "<path to Nexora_Bhubaneswar_MVP>" src\nexora.json
```
Then restart. Uploaded measured readings are kept and still override the export.

## Explainable Sustainability & Risk Insights
The *Benchmarking* page now includes four additional outputs:
- **Composite sustainability score (0–100):** equal-weight average of available component scores. Configured targets use `min(100, target/current × 100)`. When no target is configured, the component compares the latest value with the median of earlier available months (at least three earlier values); values at/below baseline score 100, and scores fall by 2 points per 1% above baseline. Missing components are excluded, never awarded a perfect score; coverage is displayed. Energy uses annual EPI only when the annual value and configured target are available.
- **Waste-overflow risk (0–100):** transparent monthly-waste change and open waste-complaint heuristic. This is not bin-level prediction; use bin fill sensors, time since pickup and collection schedule for that.
- **Equipment-maintenance risk (0–100):** rule-based proxy from peak demand, HVAC energy, leakage indicator and open maintenance complaints. This is not a trained failure-probability model; asset runtime, service records and fault history would improve it.
- **Cross-metric anomaly events:** groups Watch/High deviation screening flags from electricity, water and waste when they occur in the same area and month. Co-occurrence does not prove causation.

All scores and risk values are prototype decision-support estimates, not certified environmental ratings or calibrated probabilities. The interface shows scoring methods, signals, data coverage and limitations. Keep synthetic/modelled values clearly distinguished from measured facility uploads. API: `GET /api/critical-insights` (requires the existing Benchmarking page permission).

## Tests
`Nexora.bat` → 4, VS Code task **Nexora: backend tests**, or `npm run test:api` (42 tests: roles, uploads, screening parity with the MVP, WhatsApp/SMS payloads, escalation, actions, savings, AQI maths, live feeds with official→modelled fallback and offline handling, profiles, benchmarks, bills, complaints, PDF and BRSR exports, Indi via Groq (mocked), place search, every image type, database upgrade, job profiles, staff IDs, email/staff-ID and Google sign-in, access requests, upgrading an existing database, Create access ID, head approval, complaint dismiss/restore/permanent delete).

## Troubleshooting
| Problem | Fix |
|---|---|
| “The Nexora server is not running” | Double-click `Nexora.bat` → 1. In VS Code use `npm run dev` (starts both). Still failing: `Nexora.bat` → 6 and send the output |
| `'npm'` / `'python'` is not recognized | Install Node.js / Python, then reopen VS Code |
| Port 8000 in use | `Nexora.bat` → 7 (Stop), then 1 |
| A staff member forgot their password | Admin → *Staff & access* → key icon next to them → new one-time password |
| Forgot the only admin password | `Nexora.bat` → 8 (Reset; a backup is kept) |
| Google button missing on sign-in | `GOOGLE_CLIENT_ID` not set, or no internet |
| Google says “origin not allowed” | Add the exact address you open (e.g. `http://localhost:8000`) to *Authorised JavaScript origins* |
| “Request sent” after Google sign-in / “waiting for the head’s approval” | The head approves it in *Staff & access → Access requests* |
| Approve button is greyed out | Only the head can approve – sign in as the head with Google |
| Alert shows “not configured” | `Nexora.bat` → 5, fill the keys, save, then 7 and 1 |
| Map shows markers on white only | No internet, or the network blocks map servers |
| Live conditions say “unavailable” | No internet, or Open-Meteo / data.gov.in blocked by the network. The rest of the dashboard works offline |
| Air quality says “Modelled · not official” | Add `DATA_GOV_IN_API_KEY` to `backend/.env` and restart, then press *Refresh* |
| Indi says “Guide mode” | `Nexora.bat` → 5, add `GROQ_API_KEY`, then 7 and 1 |
| Indi: “Groq rejected the API key” / “model not available” | Re-copy the key from console.groq.com; or set `GROQ_MODEL=openai/gpt-oss-120b` |
| “My location” does nothing | Allow location for localhost in the browser’s address-bar icon; desktop PCs without Wi-Fi often have no location – use search or coordinates |
| A photo is refused | It must be an image up to 8 MB; for HEIC on an old install run `Nexora.bat` → 3 |
| Bills page says “No tariff is set” | Admin → *Site profiles* → enter energy rate and contract demand |
