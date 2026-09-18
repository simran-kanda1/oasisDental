# Oasis Dental Dashboard

Front-desk dashboard for Oasis Dental staff: appointments, follow-up queues, estimates, website inquiries, and daily checklists.

## For the office

1. Open the dashboard URL provided by your IT contact.
2. Sign in with your Oasis Dental email and password.
3. Use the sidebar to move between Checklist, Appointments, Queues, Estimates, and Inquiries.
4. Ask an admin if you need a new staff login (Admin → Users).

Patient and appointment information updates from the office practice software automatically. Website inquiries from the Oasis Dental site appear in Inquiries on their own.

## For IT / developers

Runtime config is environment-based. Copy `.env.example` to `.env` / `.env.local` and set the `VITE_FIREBASE_*` values.

### Website inquiry secrets (server only)

```bash
firebase functions:secrets:set WIX_API_KEY
firebase functions:secrets:set WIX_SITE_ID
```

Then rebuild and deploy functions:

```bash
npm run functions:build
npm run functions:deploy
```

### Frontend build

```bash
npm install
npm run build
```
