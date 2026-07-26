require('dotenv').config()

const express = require('express')
const cors = require('cors')
const morgan = require('morgan')
const { OAuth2Client } = require('google-auth-library')
const { google } = require('googleapis')
const { v4: uuidv4 } = require('uuid')

const db = require('./db')
const { createToken, requireAuth } = require('./auth')

const app = express()
const PORT = process.env.PORT || 4000
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || ''
const oauthClient = GOOGLE_CLIENT_ID ? new OAuth2Client(GOOGLE_CLIENT_ID) : null

app.use(cors())
app.use(express.json({ limit: '2mb' }))
app.use(morgan('dev'))

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'BhaBhu Inventory Backend' })
})

function isValidGmail(value) {
  return typeof value === 'string' && /^[a-z0-9._%+-]+@gmail\.com$/i.test(value.trim())
}

function normalizeStoreCode(value) {
  return String(value || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, '')
}

function getDrive(accessToken) {
  const client = new google.auth.OAuth2()
  client.setCredentials({ access_token: accessToken })
  return google.drive({ version: 'v3', auth: client })
}

async function findFileByName(drive, name) {
  const result = await drive.files.list({
    spaces: 'appDataFolder',
    q: `name='${name.replace(/'/g, "\\'")}' and 'appDataFolder' in parents and trashed=false`,
    fields: 'files(id,name)',
    pageSize: 1,
  })

  return result.data.files && result.data.files.length > 0 ? result.data.files[0] : null
}

async function createJsonFileIfMissing(drive, name, contentObj) {
  const existing = await findFileByName(drive, name)

  if (existing) {
    return existing
  }

  const created = await drive.files.create({
    requestBody: {
      name,
      parents: ['appDataFolder'],
      mimeType: 'application/json',
    },
    media: {
      mimeType: 'application/json',
      body: JSON.stringify(contentObj),
    },
    fields: 'id,name',
  })

  return created.data
}

async function ensureDriveFiles({ accessToken, storeCode }) {
  const drive = getDrive(accessToken)

  const inventoryFile = await createJsonFileIfMissing(drive, `${storeCode}-inventory.json`, {
    items: [],
    updatedAt: new Date().toISOString(),
  })

  const salesFile = await createJsonFileIfMissing(drive, `${storeCode}-sales-log.json`, {
    sales: [],
    updatedAt: new Date().toISOString(),
  })

  const snapshotFile = await createJsonFileIfMissing(drive, `${storeCode}-snapshot.json`, {
    inventoryCount: 0,
    salesCount: 0,
    updatedAt: new Date().toISOString(),
  })

  return {
    inventoryFileId: inventoryFile.id,
    salesFileId: salesFile.id,
    snapshotFileId: snapshotFile.id,
  }
}

async function pushStoreSnapshot({ accessToken, storeCode, ownerUserId }) {
  const drive = getDrive(accessToken)
  const now = new Date().toISOString()

  const items = db
    .prepare(
      `SELECT id, name, category, barcode, quantity, unit_price AS unitPrice, updated_at AS updatedAt
       FROM inventory_items
       WHERE owner_user_id = ?
       ORDER BY updated_at DESC`,
    )
    .all(ownerUserId)

  const sales = db
    .prepare(
      `SELECT id, item_id AS itemId, quantity, sold_price AS soldPrice, created_at AS soldAt
       FROM sales_transactions
       WHERE owner_user_id = ?
       ORDER BY created_at DESC
       LIMIT 500`,
    )
    .all(ownerUserId)

  const snapshotName = `${storeCode}-snapshot.json`
  const snapshotFile = await createJsonFileIfMissing(drive, snapshotName, {
    inventoryCount: 0,
    salesCount: 0,
    updatedAt: now,
  })

  await drive.files.update({
    fileId: snapshotFile.id,
    media: {
      mimeType: 'application/json',
      body: JSON.stringify(
        {
          storeCode,
          inventoryCount: items.length,
          salesCount: sales.length,
          syncedAt: now,
          items,
          sales,
        },
        null,
        2,
      ),
    },
  })

  return {
    snapshotFileId: snapshotFile.id,
    syncedAt: now,
    inventoryCount: items.length,
    salesCount: sales.length,
  }
}

async function verifyGoogleIfPossible({ idToken, gmail }) {
  if (GOOGLE_CLIENT_ID && !idToken) {
    throw new Error('Google sign-in token is required.')
  }

  if (!idToken || !oauthClient) {
    return { verified: false }
  }

  const ticket = await oauthClient.verifyIdToken({
    idToken,
    audience: GOOGLE_CLIENT_ID,
  })
  const payload = ticket.getPayload()

  if (!payload || !payload.email || payload.email.toLowerCase() !== gmail.toLowerCase()) {
    throw new Error('Google identity mismatch')
  }

  if (!payload.email_verified) {
    throw new Error('Google email not verified')
  }

  return { verified: true }
}

app.post('/api/auth/google-signin', async (req, res) => {
  try {
    const gmail = (req.body.gmail || '').trim()
    const displayName = (req.body.displayName || '').trim() || 'User'
    const storeCode = normalizeStoreCode(req.body.storeCode)
    const idToken = req.body.idToken
    const googleAccessToken = req.body.googleAccessToken

    if (!isValidGmail(gmail)) {
      return res.status(400).json({ error: 'Please enter a valid Gmail address.' })
    }

    if (!storeCode) {
      return res.status(400).json({ error: 'Store code is required.' })
    }

    try {
      await verifyGoogleIfPossible({ idToken, gmail })
    } catch (error) {
      return res.status(401).json({ error: error.message })
    }

    const now = new Date().toISOString()
    let user = db
      .prepare('SELECT id, gmail, display_name, drive_database_key, created_at FROM users WHERE gmail = ?')
      .get(gmail)

    if (!user) {
      user = {
        id: uuidv4(),
        gmail,
        display_name: displayName,
        drive_database_key: `drive-appdata/${gmail.toLowerCase().replace(/[^a-z0-9]/g, '_')}/inventory.db`,
        created_at: now,
      }

      db.prepare(
        'INSERT INTO users (id, gmail, display_name, drive_database_key, created_at) VALUES (?, ?, ?, ?, ?)',
      ).run(user.id, user.gmail, user.display_name, user.drive_database_key, user.created_at)
    }

    let store = db
      .prepare('SELECT id, code, data_owner_user_id, drive_database_key FROM stores WHERE code = ?')
      .get(storeCode)

    if (!store) {
      store = {
        id: uuidv4(),
        code: storeCode,
        data_owner_user_id: user.id,
        drive_database_key: `drive-appdata/store-${storeCode.toLowerCase()}/inventory.db`,
        created_at: now,
      }

      db.prepare(
        'INSERT INTO stores (id, code, data_owner_user_id, drive_database_key, created_at) VALUES (?, ?, ?, ?, ?)',
      ).run(store.id, store.code, store.data_owner_user_id, store.drive_database_key, store.created_at)
    }

    const membership = db
      .prepare('SELECT role FROM store_members WHERE store_id = ? AND user_id = ?')
      .get(store.id, user.id)

    if (!membership) {
      const memberCount = db
        .prepare('SELECT COUNT(*) AS total FROM store_members WHERE store_id = ?')
        .get(store.id).total

      if (memberCount >= 3) {
        return res.status(403).json({ error: 'This store already has 3 active phone users.' })
      }

      const role = store.data_owner_user_id === user.id ? 'admin' : 'salesperson'
      db.prepare('INSERT INTO store_members (store_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)').run(
        store.id,
        user.id,
        role,
        now,
      )
    }

    const finalRole = db
      .prepare('SELECT role FROM store_members WHERE store_id = ? AND user_id = ?')
      .get(store.id, user.id)?.role

    const token = createToken({
      ...user,
      activeStoreId: store.id,
      activeStoreCode: store.code,
      dataOwnerUserId: store.data_owner_user_id,
      role: finalRole,
    })

    let driveSetup = {
      initialized: false,
      note: 'Grant Drive permission in app to auto-create Drive database files.',
    }

    if (googleAccessToken) {
      try {
        const driveInfo = await ensureDriveFiles({
          accessToken: googleAccessToken,
          storeCode: store.code,
        })

        driveSetup = {
          initialized: true,
          files: driveInfo,
          note: 'Drive appDataFolder files are ready.',
        }
      } catch (_error) {
        driveSetup = {
          initialized: false,
          note: 'Google sign-in succeeded, but Drive setup failed. Grant Drive scope and sync again.',
        }
      }
    }

    return res.json({
      token,
      user: {
        id: user.id,
        gmail: user.gmail,
        displayName: user.display_name,
        role: finalRole,
      },
      store: {
        id: store.id,
        code: store.code,
      },
      driveDatabase: {
        key: store.drive_database_key,
        initialized: driveSetup.initialized,
        files: driveSetup.files || null,
        note: driveSetup.note,
      },
    })
  } catch (error) {
    return res.status(500).json({ error: 'Unable to sign in right now.' })
  }
})

app.get('/api/auth/me', requireAuth, (req, res) => {
  const user = db
    .prepare('SELECT id, gmail, display_name, drive_database_key FROM users WHERE id = ?')
    .get(req.auth.userId)

  if (!user) {
    return res.status(404).json({ error: 'User not found' })
  }

  const store = db
    .prepare('SELECT id, code, data_owner_user_id, drive_database_key FROM stores WHERE id = ?')
    .get(req.auth.activeStoreId)

  return res.json({
    user: {
      id: user.id,
      gmail: user.gmail,
      displayName: user.display_name,
      role: req.auth.role,
    },
    store: store
      ? {
          id: store.id,
          code: store.code,
        }
      : null,
    driveDatabase: {
      key: store ? store.drive_database_key : user.drive_database_key,
      initialized: true,
    },
  })
})

app.get('/api/inventory', requireAuth, (req, res) => {
  const items = db
    .prepare(
      `SELECT id, name, category, barcode, photo_url AS photoUrl, quantity, unit_price AS unitPrice, updated_at AS updatedAt
       FROM inventory_items
       WHERE owner_user_id = ?
       ORDER BY updated_at DESC`,
    )
     .all(req.auth.dataOwnerUserId || req.auth.userId)

  return res.json({ items })
})

app.post('/api/inventory', requireAuth, (req, res) => {
  const { name, category, barcode, quantity, unitPrice, photoUrl } = req.body

  if (!name || !category) {
    return res.status(400).json({ error: 'Name and category are required.' })
  }

  const qty = Number(quantity)
  const price = Number(unitPrice)

  if (!Number.isFinite(qty) || qty < 0) {
    return res.status(400).json({ error: 'Quantity must be 0 or higher.' })
  }

  if (!Number.isFinite(price) || price < 0) {
    return res.status(400).json({ error: 'Unit price must be 0 or higher.' })
  }

  const now = new Date().toISOString()
  const item = {
    id: uuidv4(),
    ownerUserId: req.auth.dataOwnerUserId || req.auth.userId,
    name: String(name).trim(),
    category: String(category).trim(),
    barcode: barcode ? String(barcode).trim() : null,
    photoUrl: photoUrl ? String(photoUrl).trim() : null,
    quantity: Math.floor(qty),
    unitPrice: price,
    createdAt: now,
    updatedAt: now,
  }

  db.prepare(
    `INSERT INTO inventory_items
    (id, owner_user_id, name, category, barcode, photo_url, quantity, unit_price, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    item.id,
    item.ownerUserId,
    item.name,
    item.category,
    item.barcode,
    item.photoUrl,
    item.quantity,
    item.unitPrice,
    item.createdAt,
    item.updatedAt,
  )

  return res.status(201).json({ item })
})

app.patch('/api/inventory/:id', requireAuth, (req, res) => {
  const { id } = req.params
  const current = db
    .prepare('SELECT * FROM inventory_items WHERE id = ? AND owner_user_id = ?')
    .get(id, req.auth.dataOwnerUserId || req.auth.userId)

  if (!current) {
    return res.status(404).json({ error: 'Item not found.' })
  }

  const nextName = req.body.name ? String(req.body.name).trim() : current.name
  const nextCategory = req.body.category ? String(req.body.category).trim() : current.category
  const nextBarcode = req.body.barcode !== undefined ? req.body.barcode : current.barcode
  const nextQty = req.body.quantity !== undefined ? Number(req.body.quantity) : current.quantity
  const nextPrice = req.body.unitPrice !== undefined ? Number(req.body.unitPrice) : current.unit_price

  if (!Number.isFinite(nextQty) || nextQty < 0) {
    return res.status(400).json({ error: 'Quantity must be valid.' })
  }

  if (!Number.isFinite(nextPrice) || nextPrice < 0) {
    return res.status(400).json({ error: 'Unit price must be valid.' })
  }

  const updatedAt = new Date().toISOString()

  db.prepare(
    `UPDATE inventory_items
     SET name = ?, category = ?, barcode = ?, quantity = ?, unit_price = ?, updated_at = ?
     WHERE id = ? AND owner_user_id = ?`,
  ).run(
    nextName,
    nextCategory,
    nextBarcode,
    Math.floor(nextQty),
    nextPrice,
    updatedAt,
    id,
    req.auth.dataOwnerUserId || req.auth.userId,
  )

  const item = db
    .prepare(
      `SELECT id, name, category, barcode, photo_url AS photoUrl, quantity, unit_price AS unitPrice, updated_at AS updatedAt
       FROM inventory_items
       WHERE id = ? AND owner_user_id = ?`,
    )
    .get(id, req.auth.dataOwnerUserId || req.auth.userId)

  return res.json({ item })
})

app.post('/api/inventory/:id/sell', requireAuth, (req, res) => {
  const { id } = req.params
  const quantityToSell = Number(req.body.quantity)

  if (!Number.isFinite(quantityToSell) || quantityToSell <= 0) {
    return res.status(400).json({ error: 'Sell quantity must be greater than zero.' })
  }

  const item = db
    .prepare('SELECT * FROM inventory_items WHERE id = ? AND owner_user_id = ?')
    .get(id, req.auth.dataOwnerUserId || req.auth.userId)

  if (!item) {
    return res.status(404).json({ error: 'Item not found.' })
  }

  if (item.quantity < quantityToSell) {
    return res.status(400).json({ error: 'Not enough stock for this sale.' })
  }

  const saleQty = Math.floor(quantityToSell)
  const now = new Date().toISOString()
  const nextQty = item.quantity - saleQty

  const tx = db.transaction(() => {
    db.prepare('UPDATE inventory_items SET quantity = ?, updated_at = ? WHERE id = ? AND owner_user_id = ?').run(
      nextQty,
      now,
      id,
      req.auth.dataOwnerUserId || req.auth.userId,
    )

    db.prepare(
      `INSERT INTO sales_transactions (id, owner_user_id, item_id, quantity, sold_price, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(uuidv4(), req.auth.dataOwnerUserId || req.auth.userId, id, saleQty, item.unit_price, now)
  })

  tx()

  const updatedItem = db
    .prepare(
      `SELECT id, name, category, barcode, quantity, unit_price AS unitPrice, updated_at AS updatedAt
       FROM inventory_items
       WHERE id = ? AND owner_user_id = ?`,
    )
    .get(id, req.auth.dataOwnerUserId || req.auth.userId)

  return res.json({
    message: 'Sale recorded.',
    item: updatedItem,
  })
})

app.get('/api/sales/recent', requireAuth, (req, res) => {
  const sales = db
    .prepare(
      `SELECT s.id, s.quantity, s.sold_price AS soldPrice, s.created_at AS soldAt,
              i.name AS itemName, i.category AS itemCategory
       FROM sales_transactions s
       JOIN inventory_items i ON i.id = s.item_id
       WHERE s.owner_user_id = ?
       ORDER BY s.created_at DESC
       LIMIT 50`,
    )
     .all(req.auth.dataOwnerUserId || req.auth.userId)

  return res.json({ sales })
})

app.post('/api/drive/sync', requireAuth, async (req, res) => {
  try {
    const storeCode = req.auth.activeStoreCode
    const ownerUserId = req.auth.dataOwnerUserId || req.auth.userId
    const googleAccessToken = req.body.googleAccessToken

    if (!googleAccessToken) {
      return res.status(400).json({ error: 'Google Drive access token is required for sync.' })
    }

    if (!storeCode) {
      return res.status(400).json({ error: 'No active store found in session.' })
    }

    await ensureDriveFiles({ accessToken: googleAccessToken, storeCode })
    const result = await pushStoreSnapshot({
      accessToken: googleAccessToken,
      storeCode,
      ownerUserId,
    })

    return res.json({
      message: 'Google Drive sync complete.',
      result,
    })
  } catch (_error) {
    return res.status(500).json({ error: 'Google Drive sync failed.' })
  }
})

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Backend running on http://localhost:${PORT}`)
})
