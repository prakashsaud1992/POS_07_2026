# Install on 2 iPhones + 1 Android (No Play Store)

This guide installs the app directly to Android and iPhone devices without Play Store, and uses internet backend so all 3 phones scan and update the same inventory.

## 1. Current Project Status

- Frontend: React + Capacitor Android + iOS wrappers ready
- Backend: Express + SQLite API ready
- Shared mode: 3 users can join one store using same store code
- Scanner: Phone camera barcode scanning included in Sell screen

## 2. Backend Internet Deployment (Required)

All 3 phones must talk to one internet backend URL.

### Option A: Deploy backend with Docker on VPS

From backend folder:

```bash
cd backend
cp .env.example .env
# Edit JWT_SECRET and GOOGLE_CLIENT_ID

docker build -t bhabhu-backend .
docker run -d --name bhabhu-backend -p 4000:4000 --env-file .env bhabhu-backend
```

### Google OAuth Setup (Required)

1. In Google Cloud Console, create OAuth Web Client credentials.
2. Add authorized origins for your frontend domain.
3. Put same client ID in both env files:

Backend `.env`:

```env
GOOGLE_CLIENT_ID=your-google-oauth-web-client-id
```

Frontend `.env`:

```env
VITE_GOOGLE_CLIENT_ID=your-google-oauth-web-client-id
```

Then expose with domain + HTTPS (example: https://api.yourdomain.com).

### Option B: Deploy Node backend on cloud Node host

- Upload backend folder
- Set env vars from `.env.example`
- Start command: `npm start`
- Use HTTPS URL

## 3. Connect Mobile App to Internet Backend

In frontend folder:

```bash
cd frontend
cp .env.example .env
```

Set in `.env`:

```env
VITE_API_BASE_URL=https://your-backend-domain.com/api
VITE_GOOGLE_CLIENT_ID=your-google-oauth-web-client-id
```

Then sync app:

```bash
npm install
npm run android:sync
npm run ios:sync
```

## 4. Build Android App (No Play Store)

1. Open Android project:

```bash
cd frontend
npm run android:open
```

2. In Android Studio:
- Wait for Gradle sync
- Build -> Build Bundle(s) / APK(s) -> Build APK(s)
- APK output location usually:
  - `frontend/android/app/build/outputs/apk/debug/app-debug.apk`

## 5. Build iPhone App (No App Store)

1. Open iOS project:

```bash
cd frontend
npm run ios:open
```

2. In Xcode:
- Select your Apple Team in Signing & Capabilities
- Connect iPhone by cable
- Choose your device target
- Product -> Run (installs directly on connected iPhone)

Note: iPhone installation requires Apple developer signing. If free Apple ID is used, you may need to trust developer profile on device settings.

## 6. Install on 3 Phones

For Android phone:

1. Copy APK by USB/Drive/WhatsApp file transfer.
2. Enable install from unknown apps.
3. Install APK.

For each iPhone (2 phones):

1. Install by running from Xcode to connected device.
2. Open app and sign in with Gmail.

For all 3 phones:

1. Tap `Grant Drive Access`.
2. Use same Store Code on all 3 phones (example: `BHABHU-STORE`).

Now all 3 phones use one shared inventory.

## 7. Daily Usage

- Add item from Inventory tab.
- Sell item from Sell tab:
  - Tap `Scan with Camera` to scan barcode.
  - Enter quantity and complete sale.
- Tap `Sync to Drive` to upload latest snapshot and logs to Google Drive appDataFolder.
- Quantity updates instantly for shared store.

## 8. Important Notes

- Internet is required for real-time shared updates.
- First user joining a new store code becomes admin role.
- Store code currently allows max 3 users.
- SQLite is currently server-side local DB; plan migration to PostgreSQL for higher reliability.

## 9. Production Next Hardening (Recommended)

- Add real Google OAuth token flow in frontend
- Add Google Drive API file create/sync per store
- Add HTTPS reverse proxy and backup strategy
- Add device approval/revoke screen for admin
