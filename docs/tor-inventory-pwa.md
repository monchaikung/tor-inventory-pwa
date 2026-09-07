# ToR Inventory PWA

Mobile-first PWA for UK Transfer of Residence (ToR1) item logging and packing.

## Live App

https://monchaikung.github.io/tor-inventory-pwa/

## Features

- Log items with iPhone camera or photo import
- AI auto-fill via Gemini Vision (proxied through Google Apps Script)
- Shipped boxes (寄箱) and hand-carry bags (手提)
- Full inventory search and packing status workflow
- Family-only Google Sign-In access

## Setup

1. Paste `Code.gs` into Apps Script (Extensions → Apps Script from your Sheet)
2. Add Script Properties:
   - `GEMINI_API_KEY` — your Gemini API key
   - `ALLOWED_EMAILS` — `monchai.kung@gmail.com,kristintsang@gmail.com`
3. Deploy as Web App (Execute as: Me, Anyone) → copy URL to `app.js` as `GAS_API_URL`
4. Enable GitHub Pages: Settings → Pages → branch `main`

## Family Access

- OAuth Test users in Google Cloud Console
- `ALLOWED_EMAILS` in Apps Script must match

See [CHANGELOG.md](../CHANGELOG.md) for version history.
