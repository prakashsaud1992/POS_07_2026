import { Html5Qrcode } from 'html5-qrcode'
import { useEffect, useMemo, useRef, useState } from 'react'
import './App.css'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000/api'
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || ''

function parseJwtPayload(token) {
  try {
    const part = token.split('.')[1]
    const padded = part.replace(/-/g, '+').replace(/_/g, '/')
    const decoded = atob(padded)
    return JSON.parse(decoded)
  } catch (_error) {
    return null
  }
}

async function apiRequest(path, method = 'GET', token = '', body) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })

  const data = await response.json()

  if (!response.ok) {
    throw new Error(data.error || 'Request failed')
  }

  return data
}

function App() {
  const [auth, setAuth] = useState({ token: '', user: null, store: null, driveDatabase: null })
  const [signInForm, setSignInForm] = useState({
    gmail: '',
    displayName: '',
    storeCode: 'BHABHU-STORE',
  })
  const [activeTab, setActiveTab] = useState('inventory')
  const [inventory, setInventory] = useState([])
  const [sales, setSales] = useState([])
  const [status, setStatus] = useState('')
  const [loading, setLoading] = useState(false)

  const [addForm, setAddForm] = useState({
    name: '',
    category: 'Food',
    barcode: '',
    quantity: 0,
    unitPrice: 0,
    photoUrl: '',
  })

  const [sellForm, setSellForm] = useState({ barcode: '', itemId: '', quantity: 1 })
  const [scannerOpen, setScannerOpen] = useState(false)
  const [googleIdToken, setGoogleIdToken] = useState('')
  const [googleAccessToken, setGoogleAccessToken] = useState('')
  const [googleReady, setGoogleReady] = useState(false)
  const [autoDriveSync, setAutoDriveSync] = useState(true)
  const googleTokenClientRef = useRef(null)
  const scannerRef = useRef(null)

  const lowStockItems = useMemo(
    () => inventory.filter((item) => Number(item.quantity) <= 3),
    [inventory],
  )

  useEffect(() => {
    let mounted = true

    async function startScanner() {
      if (!scannerOpen) {
        return
      }

      try {
        const scanner = new Html5Qrcode('barcode-reader')
        scannerRef.current = scanner

        await scanner.start(
          { facingMode: 'environment' },
          { fps: 10, qrbox: { width: 220, height: 220 } },
          async (decodedText) => {
            if (!mounted) {
              return
            }

            setSellForm((prev) => ({ ...prev, barcode: decodedText, itemId: '' }))
            setStatus('Barcode detected. Review quantity and complete sale.')
            setScannerOpen(false)
          },
          () => {},
        )
      } catch (_error) {
        setStatus('Unable to start camera scanner. Check camera permission.')
        setScannerOpen(false)
      }
    }

    async function stopScanner() {
      if (!scannerRef.current) return

      try {
        await scannerRef.current.stop()
      } catch (_error) {
        // Scanner may already be stopped.
      }

      try {
        await scannerRef.current.clear()
      } catch (_error) {
        // Scanner cleanup fallback.
      }

      scannerRef.current = null
    }

    startScanner()

    if (!scannerOpen) {
      stopScanner()
    }

    return () => {
      mounted = false
      stopScanner()
    }
  }, [scannerOpen])

  useEffect(() => {
    if (!GOOGLE_CLIENT_ID) {
      return
    }

    const script = document.createElement('script')
    script.src = 'https://accounts.google.com/gsi/client'
    script.async = true
    script.defer = true
    script.onload = () => {
      if (!window.google?.accounts) {
        setStatus('Google sign-in script could not be loaded.')
        return
      }

      window.google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: (response) => {
          const payload = parseJwtPayload(response.credential)
          setGoogleIdToken(response.credential)

          if (payload?.email) {
            setSignInForm((prev) => ({
              ...prev,
              gmail: payload.email,
              displayName: payload.name || prev.displayName,
            }))
            setStatus('Google account selected. Now grant Drive access and sign in.')
          }
        },
      })

      window.google.accounts.id.renderButton(document.getElementById('google-signin-button'), {
        theme: 'outline',
        size: 'large',
        width: 260,
      })

      googleTokenClientRef.current = window.google.accounts.oauth2.initTokenClient({
        client_id: GOOGLE_CLIENT_ID,
        scope: 'https://www.googleapis.com/auth/drive.appdata',
        callback: (response) => {
          if (response.access_token) {
            setGoogleAccessToken(response.access_token)
            setStatus('Drive access granted.')
          }
        },
      })

      setGoogleReady(true)
    }

    document.body.appendChild(script)

    return () => {
      document.body.removeChild(script)
    }
  }, [])

  async function refreshData(token) {
    const [itemsRes, salesRes] = await Promise.all([
      apiRequest('/inventory', 'GET', token),
      apiRequest('/sales/recent', 'GET', token),
    ])

    setInventory(itemsRes.items)
    setSales(salesRes.sales)
  }

  async function handleSignIn(event) {
    event.preventDefault()
    setStatus('Signing in...')
    setLoading(true)

    try {
      const data = await apiRequest('/auth/google-signin', 'POST', '', {
        gmail: signInForm.gmail,
        displayName: signInForm.displayName,
        storeCode: signInForm.storeCode,
        idToken: googleIdToken,
        googleAccessToken,
      })

      setAuth({ token: data.token, user: data.user, store: data.store, driveDatabase: data.driveDatabase })
      await refreshData(data.token)
      setStatus('Signed in and database linked successfully.')
    } catch (error) {
      setStatus(error.message)
    } finally {
      setLoading(false)
    }
  }

  async function runDriveSync({ showLoading = true, statusPrefix = 'Drive sync' } = {}) {
    if (!auth.token) {
      return { ok: false, reason: 'No active session.' }
    }

    if (!googleAccessToken) {
      return { ok: false, reason: 'Grant Google Drive access first.' }
    }

    if (showLoading) {
      setLoading(true)
      setStatus('Syncing with Google Drive...')
    }

    try {
      const data = await apiRequest('/drive/sync', 'POST', auth.token, {
        googleAccessToken,
      })

      const syncedAt = new Date(data.result.syncedAt).toLocaleTimeString()
      setStatus(`${statusPrefix} complete at ${syncedAt}.`)
      return { ok: true, syncedAt }
    } catch (error) {
      if (showLoading) {
        setStatus(error.message)
      }
      return { ok: false, reason: error.message }
    } finally {
      if (showLoading) {
        setLoading(false)
      }
    }
  }

  async function handleDriveSync() {
    await runDriveSync({ showLoading: true, statusPrefix: 'Drive sync' })
  }

  function requestDriveAccess() {
    if (!googleTokenClientRef.current) {
      setStatus('Google token client not ready.')
      return
    }

    googleTokenClientRef.current.requestAccessToken({ prompt: 'consent' })
  }

  async function handleAddItem(event) {
    event.preventDefault()
    if (!auth.token) return

    setStatus('Adding item...')
    setLoading(true)

    try {
      await apiRequest('/inventory', 'POST', auth.token, addForm)
      await refreshData(auth.token)
      setAddForm({
        name: '',
        category: 'Food',
        barcode: '',
        quantity: 0,
        unitPrice: 0,
        photoUrl: '',
      })

      if (autoDriveSync) {
        const syncResult = await runDriveSync({
          showLoading: false,
          statusPrefix: 'Item added and Drive sync',
        })

        if (!syncResult.ok) {
          setStatus(`Item added to inventory. Auto-sync pending: ${syncResult.reason}`)
        }
      } else {
        setStatus('Item added to inventory.')
      }
    } catch (error) {
      setStatus(error.message)
    } finally {
      setLoading(false)
    }
  }

  async function handleSellItem(event) {
    event.preventDefault()
    if (!auth.token) return

    const selectedItem = sellForm.itemId
      ? inventory.find((item) => item.id === sellForm.itemId)
      : inventory.find((item) => item.barcode && item.barcode === sellForm.barcode.trim())

    if (!selectedItem) {
      setStatus('Item not found. Use item list or enter a valid barcode.')
      return
    }

    setStatus('Recording sale...')
    setLoading(true)

    try {
      await apiRequest(`/inventory/${selectedItem.id}/sell`, 'POST', auth.token, {
        quantity: Number(sellForm.quantity),
      })
      await refreshData(auth.token)
      setSellForm({ barcode: '', itemId: '', quantity: 1 })

      if (autoDriveSync) {
        const syncResult = await runDriveSync({
          showLoading: false,
          statusPrefix: 'Sale completed and Drive sync',
        })

        if (!syncResult.ok) {
          setStatus(`Sale completed and stock updated. Auto-sync pending: ${syncResult.reason}`)
        }
      } else {
        setStatus('Sale completed and stock updated.')
      }
    } catch (error) {
      setStatus(error.message)
    } finally {
      setLoading(false)
    }
  }

  function renderSignInScreen() {
    return (
      <div className="card">
        <h1>BhaBhu Pet Store</h1>
        <p className="subtext">Sign in with Gmail, then use one common store code across 3 phones to share inventory.</p>

        <form className="grid" onSubmit={handleSignIn}>
          <div className="google-row">
            <div id="google-signin-button" />
            <button
              type="button"
              className="ghost-button"
              onClick={requestDriveAccess}
              disabled={!googleReady}
            >
              Grant Drive Access
            </button>
          </div>

          <label>
            Gmail Address
            <input
              type="email"
              value={signInForm.gmail}
              onChange={(event) => setSignInForm((prev) => ({ ...prev, gmail: event.target.value }))}
              placeholder="example@gmail.com"
              required
            />
          </label>

          <label>
            Display Name
            <input
              type="text"
              value={signInForm.displayName}
              onChange={(event) =>
                setSignInForm((prev) => ({ ...prev, displayName: event.target.value }))
              }
              placeholder="Your Name"
              required
            />
          </label>

          <label>
            Store Code (use same code on all 3 phones)
            <input
              type="text"
              value={signInForm.storeCode}
              onChange={(event) =>
                setSignInForm((prev) => ({ ...prev, storeCode: event.target.value.toUpperCase() }))
              }
              placeholder="BHABHU-STORE"
              required
            />
          </label>

          <button disabled={loading} type="submit">
            {loading ? 'Please wait...' : 'Sign In with Gmail'}
          </button>
        </form>
      </div>
    )
  }

  function renderInventoryTab() {
    return (
      <section className="split">
        <div className="card">
          <h2>Add Inventory</h2>
          <form className="grid" onSubmit={handleAddItem}>
            <label>
              Item Name
              <input
                type="text"
                value={addForm.name}
                onChange={(event) => setAddForm((prev) => ({ ...prev, name: event.target.value }))}
                required
              />
            </label>

            <label>
              Category
              <select
                value={addForm.category}
                onChange={(event) => setAddForm((prev) => ({ ...prev, category: event.target.value }))}
              >
                <option>Food</option>
                <option>Shelter</option>
                <option>Fish</option>
                <option>Medicine</option>
                <option>Accessories</option>
              </select>
            </label>

            <label>
              Barcode (for camera scan)
              <input
                type="text"
                value={addForm.barcode}
                onChange={(event) => setAddForm((prev) => ({ ...prev, barcode: event.target.value }))}
              />
            </label>

            <label>
              Quantity
              <input
                type="number"
                min="0"
                value={addForm.quantity}
                onChange={(event) => setAddForm((prev) => ({ ...prev, quantity: Number(event.target.value) }))}
                required
              />
            </label>

            <label>
              Unit Price
              <input
                type="number"
                min="0"
                step="0.01"
                value={addForm.unitPrice}
                onChange={(event) => setAddForm((prev) => ({ ...prev, unitPrice: Number(event.target.value) }))}
                required
              />
            </label>

            <label>
              Photo URL (or uploaded file link)
              <input
                type="url"
                value={addForm.photoUrl}
                onChange={(event) => setAddForm((prev) => ({ ...prev, photoUrl: event.target.value }))}
              />
            </label>

            <button disabled={loading} type="submit">
              Add Item
            </button>
          </form>
        </div>

        <div className="card">
          <h2>Current Inventory</h2>
          <div className="list">
            {inventory.map((item) => (
              <article className="row" key={item.id}>
                <div>
                  <strong>{item.name}</strong>
                  <p>
                    {item.category} | Barcode: {item.barcode || 'N/A'}
                  </p>
                </div>
                <div className="right">
                  <p>Qty: {item.quantity}</p>
                  <p>Rs {Number(item.unitPrice).toFixed(2)}</p>
                </div>
              </article>
            ))}
            {inventory.length === 0 ? <p>No inventory yet.</p> : null}
          </div>
        </div>
      </section>
    )
  }

  function renderSellTab() {
    return (
      <section className="split">
        <div className="card">
          <h2>Sell Item</h2>
          <p className="subtext">Use barcode from phone camera scanner output or pick from list.</p>

          <div className="scan-actions">
            <button
              type="button"
              className="ghost-button"
              onClick={() => setScannerOpen((prev) => !prev)}
            >
              {scannerOpen ? 'Stop Camera Scan' : 'Scan with Camera'}
            </button>
          </div>

          {scannerOpen ? <div id="barcode-reader" className="scanner-box" /> : null}

          <form className="grid" onSubmit={handleSellItem}>
            <label>
              Barcode
              <input
                type="text"
                value={sellForm.barcode}
                onChange={(event) =>
                  setSellForm((prev) => ({ ...prev, barcode: event.target.value, itemId: '' }))
                }
                placeholder="Scan result"
              />
            </label>

            <label>
              Or Select Item
              <select
                value={sellForm.itemId}
                onChange={(event) => setSellForm((prev) => ({ ...prev, itemId: event.target.value, barcode: '' }))}
              >
                <option value="">Select inventory item</option>
                {inventory.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name} (qty: {item.quantity})
                  </option>
                ))}
              </select>
            </label>

            <label>
              Quantity Sold
              <input
                type="number"
                min="1"
                value={sellForm.quantity}
                onChange={(event) => setSellForm((prev) => ({ ...prev, quantity: Number(event.target.value) }))}
                required
              />
            </label>

            <button disabled={loading} type="submit">
              Complete Sale
            </button>
          </form>
        </div>

        <div className="card">
          <h2>Recent Sales</h2>
          <div className="list">
            {sales.map((sale) => (
              <article className="row" key={sale.id}>
                <div>
                  <strong>{sale.itemName}</strong>
                  <p>{new Date(sale.soldAt).toLocaleString()}</p>
                </div>
                <div className="right">
                  <p>Qty: {sale.quantity}</p>
                  <p>Rs {Number(sale.soldPrice).toFixed(2)}</p>
                </div>
              </article>
            ))}
            {sales.length === 0 ? <p>No sales recorded yet.</p> : null}
          </div>
        </div>
      </section>
    )
  }

  return (
    <main className="app-shell">
      {!auth.token ? (
        renderSignInScreen()
      ) : (
        <>
          <header className="topbar card">
            <div>
              <h1>Inventory Dashboard</h1>
              <p className="subtext">
                {auth.user.displayName} | {auth.user.gmail} | Store: {auth.store?.code}
              </p>
            </div>
            <div className="drive-actions">
              <div className="pill">Drive DB: {auth.driveDatabase?.key}</div>
              <label className="toggle-inline">
                <input
                  type="checkbox"
                  checked={autoDriveSync}
                  onChange={(event) => setAutoDriveSync(event.target.checked)}
                />
                Auto-sync
              </label>
              <button type="button" className="ghost-button" onClick={handleDriveSync} disabled={loading}>
                Sync to Drive
              </button>
            </div>
          </header>

          <section className="summary-grid">
            <article className="card metric">
              <h3>Total Items</h3>
              <p>{inventory.length}</p>
            </article>
            <article className="card metric">
              <h3>Low Stock</h3>
              <p>{lowStockItems.length}</p>
            </article>
            <article className="card metric">
              <h3>Sales (recent)</h3>
              <p>{sales.length}</p>
            </article>
          </section>

          <nav className="tabs card" aria-label="Inventory sections">
            <button
              className={activeTab === 'inventory' ? 'tab active' : 'tab'}
              onClick={() => setActiveTab('inventory')}
              type="button"
            >
              Inventory
            </button>
            <button
              className={activeTab === 'sell' ? 'tab active' : 'tab'}
              onClick={() => setActiveTab('sell')}
              type="button"
            >
              Sell
            </button>
          </nav>

          {activeTab === 'inventory' ? renderInventoryTab() : renderSellTab()}
        </>
      )}

      <footer className="status card" role="status">
        <p>{status || 'Ready.'}</p>
      </footer>
    </main>
  )
}

export default App
