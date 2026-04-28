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
firebase functions:secrets:set WIX_SITE_ID
```

The callable function `syncWixInquiries` handles:

- Pulling contacts from Wix
- Filtering to likely inquiry sources
- Upserting `wixInquiries`
- Excluding inquiries whose phone matches an existing patient
- Removing legacy dummy/seed inquiry rows

## Production commands

```bash
# frontend
npm run build

# functions
npm --prefix functions install
npm run functions:build
npm run functions:deploy
```
