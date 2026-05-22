# Oasis Dental Dashboard

## Security-first configuration

All runtime configuration is env-based. No API keys are hardcoded in source.

### Frontend env (`.env.local`)

Copy `.env.example` and fill:

- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_AUTH_DOMAIN`
- `VITE_FIREBASE_PROJECT_ID`
- `VITE_FIREBASE_STORAGE_BUCKET`
- `VITE_FIREBASE_MESSAGING_SENDER_ID`
- `VITE_FIREBASE_APP_ID`
- `VITE_FIREBASE_FUNCTIONS_REGION` (optional, defaults to `us-central1`)

`src/lib/firebase.ts` now fails fast if required env vars are missing.

### Wix secrets (server-side only)

Wix credentials are consumed by Firebase Functions only, not by the browser:

```bash
firebase functions:secrets:set WIX_API_KEY
# Use your Wix **Meta Site ID** (Oasis Dental):
firebase functions:secrets:set WIX_SITE_ID
# When prompted, paste: 49642a86-09d4-465d-8a14-ccc3df507f41
```

Verify secrets:

```bash
firebase functions:secrets:access WIX_SITE_ID
```

The functions `syncWixInquiries` (manual, from dashboard) and `syncWixInquiriesScheduled` (every 5 minutes) handle:

- Pulling **Wix Forms** submissions (`wix.form_app.form` namespace) — primary website inquiries
- Supplementing with Wix **contacts** from form/chat sources (deduped by phone)
- Upserting `wixInquiries` in Firestore (live on Inquiries + dashboard counts)
- Excluding inquiries whose phone matches an existing active patient
- Removing legacy dummy/seed inquiry rows

Do **not** create `functions/.env.falls-dashboard` with `WIX_SITE_ID` — that conflicts with the secret at deploy time.

After changing secrets, redeploy functions:

```bash
npm run functions:build
npm run functions:deploy
```

- **Scheduled job**: runs every **5 minutes**, checks the last **24 hours** for new submissions (Inquiries page updates live from Firestore)

## Production commands

```bash
# frontend
npm run build

# functions
npm --prefix functions install
npm run functions:build
npm run functions:deploy
```
