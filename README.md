# BhaBhu Inventory App

Mobile-first inventory and sales app for BhaBhu Pet Store, with shared multi-device usage (2 iPhones + 1 Android), Gmail sign-in, camera barcode scanning, and Google Drive sync support.

## Features

- Gmail sign-in flow with Google Identity Services
- Shared store access using common Store Code (max 3 users)
- Add inventory items with quantity, category, barcode, and price
- Sell flow with barcode scanner and automatic stock deduction
- Local-first updates with Google Drive sync option
- Android and iOS wrappers via Capacitor

## Project Structure

- `frontend/` React + Vite app with Capacitor Android and iOS projects
- `backend/` Express + SQLite API with auth, inventory, sales, and Drive sync endpoints
- `PROJECT_DOCUMENTATION.md` Product and architecture documentation
- `INSTALL_APK_AND_3PHONES.md` Device install and rollout guide

## Quick Start (Local)

### Backend

```bash
cd backend
npm install
cp .env.example .env
npm run dev
```

### Frontend

```bash
cd frontend
npm install
cp .env.example .env
npm run dev
```

Open: `http://localhost:5173`

## Mobile Build

## Distribution Policy (Both Platforms Required)

- Android distribution method: APK download (GitHub Actions artifact or Releases)
- iOS distribution method: Xcode direct install or TestFlight
- Goal for this project: always keep both Android and iOS installable for staff devices

### Android

```bash
cd frontend
npm run android:sync
npm run android:open
```

Build APK in Android Studio.

Alternative (cloud build artifact):

- Open repository Actions and download artifact from the latest successful `Build Android APK` run

### iOS

```bash
cd frontend
npm run ios:sync
npm run ios:open
```

Install on iPhone from Xcode (requires Apple signing setup).

For non-technical iPhone users, publish through TestFlight.

## Environment Variables

### Backend `.env`

- `PORT=4000`
- `JWT_SECRET=replace-with-secure-secret`
- `GOOGLE_CLIENT_ID=your-google-oauth-web-client-id`

### Frontend `.env`

- `VITE_API_BASE_URL=https://your-backend-domain.com/api`
- `VITE_GOOGLE_CLIENT_ID=your-google-oauth-web-client-id`

## Notes

- Internet is required for live shared updates across devices.
- Use the same Store Code on all 3 phones to share one inventory.
- Current backend uses SQLite; production can migrate to PostgreSQL.
