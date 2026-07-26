# BhaBhu Pet Store Inventory App - Project Documentation (v0.2)

## 1. Business Profile

- Business Name: BhaBhu Pet Store
- Location: Chandaka, Vola, Bhubaneshor, India
- Business Type: Pet store selling pet food, shelter items, fish supplies, and general pet products
- Operating Context: Inventory and sales tracking on mobile phones

## 2. Project Goal

Build a mobile-first inventory management app for local use that lets staff:

1. Add inventory items by taking photos and entering product details.
2. Scan or identify items at time of sale using phone camera.
3. Automatically reduce item quantity in inventory after each sale.
4. Keep data synced and backed up to Google Drive.
5. Support exactly 3 salesperson phones with admin-controlled access.
6. Require Gmail sign-in and auto-create the user's cloud database space in Google Drive.

## 3. Primary Users

- Admin
  - Controls phone access (authorizes 3 devices/users)
  - Manages inventory corrections and reports
  - Oversees backups and sync

- Salesperson (3 devices)
  - Adds products
  - Sells products by scanning camera input
  - Views available stock

## 4. Core Use Cases

### 4.1 Add New Inventory Item

- Salesperson opens app and taps "Add Item"
- Takes product photo
- Enters fields:
  - Item name
  - Category (food, shelter, fish, medicine, accessories, etc.)
  - SKU/barcode (if available)
  - Quantity
  - Unit price
  - Optional notes
- Saves item to local database
- Record is queued for Google Drive sync

### 4.2 Sell Item (Camera Scan)

- Salesperson opens "Sell Item"
- Scans barcode/QR or identifies product using camera-assisted flow
- App finds product in local database
- Salesperson enters sold quantity
- App validates stock availability
- App subtracts sold quantity immediately
- Sale transaction is recorded in sales history
- Updated inventory is queued for sync

### 4.3 Daily Auto Update

- App calculates stock based on all recorded sales and adjustments
- Inventory state is always updated in local database in real time
- Sync service uploads latest state and transaction log to Google Drive

### 4.4 Multi-Phone Access (3 Sales Phones)

- Admin approves three users/devices
- Only approved users can sign in and sync
- Changes from each phone merge via transaction records
- Conflict handling rules apply if same item is edited at same time

### 4.5 First Login (Gmail -> Auto Database Setup)

- User signs in with Google (Gmail account)
- App checks for app-specific database files in that user's Google Drive app folder
- If files do not exist, app creates:
  - Initial SQLite backup file
  - Initial inventory JSON snapshot
  - Empty transaction log file
- App downloads or initializes local database on the phone
- App links local database to that Gmail account for future sync

## 5. Functional Requirements

### 5.1 Inventory Management

- Create, read, update inventory items
- Soft delete or archive items
- Track quantity on hand
- Low-stock threshold alerts (optional in phase 2)

### 5.2 Sales Recording

- Fast item lookup by scan and text search
- Sell one or multiple quantities
- Prevent negative stock (unless admin override)
- Maintain immutable sales log

### 5.3 Camera Features

- Capture product photos
- Barcode/QR scanning for item selection
- Fallback manual search if scan fails

### 5.4 Offline-First Operation

- App must work locally without internet
- All operations write to local DB first
- Sync runs when internet is available

### 5.5 Google Drive Sync and Backup

- Google Gmail sign-in is mandatory
- On first sign-in, auto-provision database files inside that user's Google Drive app folder
- Store:
  - Encrypted backup snapshots
  - Incremental transaction files
  - Latest inventory summary file
- Automatic sync schedule (for example every 5 to 15 minutes and on app close)
- Every signed-in user gets their own isolated Drive-backed dataset by default

### 5.6 User and Access Control

- Admin role + salesperson role
- Maximum 3 salesperson accounts/devices active
- Device registration and revocation by admin
- Only Google-authenticated users can access the app

### 5.7 Personal Local-First Usage per Google Account

- Any user can use the app locally on their own phone after Gmail sign-in
- Local operations (add/sell/update) always work offline first
- Each user's data syncs to their own Google Drive account
- If needed later, shared-store mode can be added to let multiple users work on one common inventory

## 6. Non-Functional Requirements

- Simple and fast UI for shop floor usage
- Data safety against accidental app closure or battery loss
- Auditability of sales and stock adjustments
- Local language support can be considered later
- Android first (recommended), iOS optional later

## 7. Data Model (Draft)

### 7.1 Item

- item_id
- name
- category
- sku_or_barcode
- photo_path_or_url
- unit_price
- quantity_on_hand
- reorder_level
- is_active
- created_at
- updated_at

### 7.2 SaleTransaction

- txn_id
- item_id
- qty_sold
- unit_price_at_sale
- sold_by_user_id
- sold_at
- source_device_id
- sync_status

### 7.3 StockAdjustment

- adjustment_id
- item_id
- qty_delta
- reason
- adjusted_by_user_id
- adjusted_at

### 7.4 User

- user_id
- role (admin, salesperson)
- display_name
- phone_or_email
- is_active
- last_login_at

### 7.5 DeviceRegistration

- device_id
- user_id
- approved_by_admin
- approved_at
- revoked_at

## 8. Suggested Technical Architecture

- Mobile App: Android app (Flutter or React Native)
- Local Database: SQLite (or Drift/Room wrapper)
- Image Storage: Local file storage on phone
- Sync Layer: Background sync service
- Cloud Backup: Google Drive App Folder + JSON/SQLite backup files
- Merge Strategy: Transaction-based sync (append-only sales log) instead of full overwrite
- Identity: Google Sign-In (OAuth 2.0) with Drive file scope limited to app folder

Why transaction-based sync:
- Reduces conflicts across 3 phones
- Preserves audit history
- Makes recovery easier

## 9. Security and Data Protection

- Role-based access checks on all write actions
- Google account authentication for each user session
- Encrypt backup files before upload (recommended)
- Keep audit logs for sales and edits
- Restrict Google Drive folder scope to app-specific folder

## 10. Reporting (Phase 2+)

- Daily sales summary
- Category-wise sales
- Low-stock items list
- Stock valuation snapshot

## 11. Development Roadmap (Step-by-Step)

### Phase 1 - Foundation

1. Finalize requirements and edge cases
2. Choose stack (Flutter recommended)
3. Initialize project and local DB schema
4. Build Google sign-in auth flow and role model (admin + salesperson)

### Phase 2 - Inventory Core

1. Add item with photo
2. Item list and search
3. Edit quantity and details

### Phase 3 - Sales Flow

1. Barcode/QR scan integration
2. Sell flow with quantity subtraction
3. Sales transaction log

### Phase 4 - Multi-Device + Sync

1. Google sign-in and Drive API integration
2. Background sync and retry queue
3. Conflict resolution and merge testing with 3 phones
4. First-login auto database provisioning in Google Drive

### Phase 5 - Hardening

1. Backup/restore testing
2. Performance checks on low-end devices
3. Admin controls for device revoke/access

## 12. Assumptions and Open Questions

- "Works locally" means offline-first with optional sync whenever internet is available.
- Gmail sign-in is required before first app use.
- Scan method should prioritize barcode/QR. If many products have no barcode, we should add custom label generation later.
- Need final decision on platform:
  - Android only
  - Android + iOS
- Login method fixed: Google sign-in only
- Need product decision for data mode:
  - Personal mode only (each Gmail account has separate inventory)
  - Shared-store mode (approved users collaborate on one inventory)
- Need language preference for UI:
  - English only
  - English + Odia/Hindi

## 13. Definition of Success

- Staff can add products in less than 20 seconds per item.
- Sale can be completed in less than 10 seconds for known items.
- Inventory quantity remains accurate after full day operations.
- Three phones can operate without data loss.
- Daily backup is visible in Google Drive.

---

Document Owner: Project Team
Last Updated: 2026-07-26
Version: v0.2
