# UK Car Advisor

Local Windows 11 used-car advisor. Enter a UK postcode, search listings, compare cars, inspect trade dealers, and read model advice (average price, maintenance, common issues).

The older ToR Inventory PWA remains in this repository; see [docs/tor-inventory-pwa.md](docs/tor-inventory-pwa.md).

## Features

- Streamlit UI on `http://localhost:8501`
- UK postcode validation and Postcodes.io geocoding
- Straight-line distance (haversine) to dealer postcodes
- Demo listings offline, plus best-effort Playwright scrapers for AutoTrader, Motors.co.uk, and Carwow
- SQLite storage in `cars.db`
- Optional DVLA Vehicle Enquiry Service (MOT / tax / Euro status → ULEZ hint)
- Dealer dossier: address, contact, other stock
- Model advisor: local price stats plus curated maintenance notes
- Side-by-side comparison with ULEZ / MOT badges and listing links (opens in Microsoft Edge on Windows)

Live portal scraping is **best-effort personal use**, rate-limited, and may fail if a site blocks automation. There is **no stealth / bot-bypass**. Prefer **Demo data** for a reliable local run.

## Windows 11 setup (PowerShell)

```powershell
cd path\to\this-repo
py -3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
python -m playwright install chromium
copy .env.example .env
streamlit run app.py
```

Then open `http://localhost:8501`. Optional: set `DVLA_API_KEY` in `.env` (register at the [DVLA developer portal](https://developer-portal.driver-vehicle-licensing.api.gov.uk/)).

WSL2 / Command Prompt work the same with `python3 -m venv .venv` and `source .venv/bin/activate` (WSL) or `.venv\Scripts\activate.bat` (cmd).

## Usage

1. Enter a UK postcode (default `M1 1AE`), radius, max budget, and fuel types.
2. Keep **Demo data (offline)** selected for a full walkthrough without live sites.
3. Search, then pick a listing:
   - **Trade seller** → dealer address, phone, website, other cars on sale
   - **Any listing** → local average/median price vs this car, service notes, common issues, viewing checks
4. Multi-select 2–3 cars for a comparison table.
5. **Open listing** uses Microsoft Edge on Windows (`microsoft-edge:`), otherwise the default browser.

Headed Playwright (visible browser) defaults **on** for Windows and **off** on other OS. Use it only for live portals.

## Project layout

- `app.py` — Streamlit entrypoint
- `uk_car_advisor/` — postcode, distance, SQLite, DVLA, scrapers, dealer dossier, model advice
- `uk_car_advisor/data/model_advice.json` — offline maintenance / common-issue notes
- `cars.db` — created on first search (gitignored)
- `tests/` — offline unit tests

```powershell
python -m pytest
```

## Data model

Search parameters and each `vehicle_result` follow the project JSON schema (make, model, trim, year, mileage, price, dealer location, specifications, features, listing URL), with `seller_type` and dealer records in SQLite.
