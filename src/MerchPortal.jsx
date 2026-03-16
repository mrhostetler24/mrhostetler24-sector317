// MerchPortal.jsx — Merchandise & Inventory Management
// Surfaces: MerchAdmin (manager/admin), MerchStaffSales (staff/ops), MerchStorefront (customer)
import { useState, useEffect, useMemo, useRef } from 'react'
import {
  fetchMerchCatalog, fetchMerchCategories, fetchStockLocations, fetchMerchOrders,
  fetchMerchDiscounts, fetchMerchGiftCodes, fetchMerchReturns,
  fetchMerchInventory, fetchMerchInventoryTransactions,
  upsertMerchCategory, upsertMerchProduct, upsertMerchVariant, deleteMerchVariant,
  upsertMerchDiscount, upsertStockLocation, upsertBundleComponents,
  fetchBundleComponents, uploadMerchImage,
  fetchMerchVendors, upsertMerchVendor, deleteMerchVendor,
  fetchPurchaseOrders, createPurchaseOrder, receivePOLine, updatePOStatus,
  fulfillMerchOrder, transferMerchInventory,
  adjustMerchInventory, validateMerchDiscount, createMerchOrder,
  processMerchReturn, voidGiftCode, updateMerchOrderStatus,
  fetchUserByPhone, createGuestUser, createPayment, deductUserCredits, linkOAuthUser,
} from './supabase.js'
import { emailMerchPurchase, emailSocialAuthInvite } from './emails.js'
import { processPayment } from './payments.js'

// ─── Helpers ─────────────────────────────────────────────────
const fmtMoney = n => '$' + Number(n || 0).toFixed(2)
const cleanPh = p => (p || '').replace(/\D/g, '')
const fmtDate = d => d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'
const TYPE_LABELS = { physical: 'Physical', bundle: 'Bundle', gift_card: 'Gift Card', gift_cert: 'Gift Cert' }
const TYPE_BADGE = { physical: 'b-coop', bundle: 'b-versus', gift_card: 'b-ok', gift_cert: 'b-private' }
const STATUS_BADGE = { paid: 'b-ok', fulfilled: 'b-coop', pending: 'b-open', cancelled: 'b-d', refunded: 'b-versus' }
const DISPOSITION_LABELS = { restock_sellable: 'Restock (Sellable)', restock_damaged: 'Restock (Damaged)', no_restock: 'No Restock' }

// Effective price for a variant: override or product base price
const variantPrice = (product, variant) =>
  variant?.priceOverride != null ? variant.priceOverride : product.basePrice

// ─── Shared: Product grid card ────────────────────────────────
function ProductCard({ product, onSelect, channel }) {
  const activeVariants = product.variants.filter(v =>
    channel === 'staff' ? v.staffVisible : channel === 'storefront' ? v.storefrontVisible : true
  )
  const minPrice = activeVariants.length
    ? Math.min(...activeVariants.map(v => variantPrice(product, v)))
    : product.basePrice
  const inStock = product.type === 'physical'
    ? activeVariants.some(v => v.inventory > 0)
    : true
  const hasVariants = product.type === 'physical' && activeVariants.length > 1
  const primaryImage = product.imageUrls?.[0] || product.imageUrl || null

  return (
    <div onClick={() => onSelect(product)}
      style={{ background: 'var(--surf)', border: '1px solid var(--bdr)', borderRadius: 10,
        padding: '1rem', cursor: 'pointer', opacity: (!inStock && product.type === 'physical') ? .55 : 1,
        transition: 'border-color .15s', position: 'relative' }}
      onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--acc)'}
      onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--bdr)'}>
      {product.type === 'bundle' && product.bundleSavingsPct > 0 && (
        <div style={{ position: 'absolute', top: 8, right: 8, background: 'var(--dangerL,#c44)', color: '#fff', fontSize: '.62rem', fontWeight: 800, padding: '2px 8px', borderRadius: 99, letterSpacing: '.03em', zIndex: 1 }}>
          {product.bundleSavingsPct}% OFF
        </div>
      )}
      {primaryImage
        ? <img src={primaryImage} alt={product.name} style={{ width: '100%', height: 120, objectFit: 'cover', borderRadius: 6, marginBottom: '.75rem' }} />
        : <div style={{ width: '100%', height: 100, background: 'var(--bg2)', borderRadius: 6, marginBottom: '.75rem', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '2rem' }}>
            {product.type === 'gift_card' ? '🎁' : product.type === 'gift_cert' ? '🎟' : product.type === 'bundle' ? '📦' : '🛍'}
          </div>}
      <div style={{ fontWeight: 700, fontSize: '.95rem', color: 'var(--txt)', marginBottom: '.2rem' }}>{product.name}</div>
      {product.categoryName && <div style={{ fontSize: '.72rem', color: 'var(--muted)', marginBottom: '.3rem' }}>{product.categoryName}</div>}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '.5rem' }}>
        <span style={{ fontWeight: 800, color: 'var(--acc)', fontSize: '1rem' }}>
          {hasVariants ? 'from ' : ''}{fmtMoney(minPrice)}
        </span>
        {product.type === 'physical' && !inStock && <span className="badge b-d" style={{ fontSize: '.65rem' }}>Out of Stock</span>}
        {product.type === 'physical' && inStock && <span style={{ fontSize: '.72rem', color: 'var(--muted)' }}>{activeVariants.reduce((s, v) => s + v.inventory, 0)} in stock</span>}
      </div>
    </div>
  )
}

// ─── Shared: Variant selector modal ──────────────────────────
function VariantModal({ product, channel, onAdd, onClose }) {
  const activeVariants = product.variants.filter(v =>
    channel === 'staff' ? v.staffVisible : channel === 'storefront' ? v.storefrontVisible : true
  )
  const [selected, setSelected] = useState(activeVariants[0]?.id || null)
  const [qty, setQty] = useState(1)
  const variant = activeVariants.find(v => v.id === selected)
  const price = variantPrice(product, variant)
  const inStock = product.type !== 'physical' || (variant?.inventory ?? 0) > 0

  const handleAdd = () => {
    if (!inStock) return
    onAdd({
      productId: product.id, productName: product.name, type: product.type,
      variantId: variant?.id || null, variantLabel: variant?.label || null,
      price, qty,
    })
    onClose()
  }

  return (
    <div className="mo" onClick={onClose}>
      <div className="mc" style={{ maxWidth: 400 }} onClick={e => e.stopPropagation()}>
        <div className="mt2">{product.name}</div>
        {product.description && <p style={{ color: 'var(--muted)', fontSize: '.88rem', marginBottom: '1rem' }}>{product.description}</p>}
        {activeVariants.length > 1 && (
          <div style={{ marginBottom: '1rem' }}>
            <label style={{ fontSize: '.78rem', color: 'var(--muted)', display: 'block', marginBottom: '.4rem' }}>Select Option</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.4rem' }}>
              {activeVariants.map(v => (
                <button key={v.id}
                  className={`btn btn-sm ${selected === v.id ? 'btn-p' : 'btn-s'}`}
                  style={{ fontSize: '.8rem', opacity: v.inventory <= 0 && product.type === 'physical' ? .45 : 1 }}
                  onClick={() => setSelected(v.id)}>
                  {v.label}{product.type === 'physical' ? ` (${v.inventory})` : ''}
                </button>
              ))}
            </div>
          </div>
        )}
        {activeVariants.length === 1 && variant && (
          <div style={{ marginBottom: '1rem', fontSize: '.9rem', color: 'var(--muted)' }}>
            {variant.label}{product.type === 'physical' ? ` · ${variant.inventory} in stock` : ''}
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1.25rem' }}>
          <div>
            <label style={{ fontSize: '.78rem', color: 'var(--muted)', display: 'block', marginBottom: '.3rem' }}>Qty</label>
            <input type="number" min={1} max={product.type === 'physical' ? (variant?.inventory || 1) : 99}
              value={qty} onChange={e => setQty(Math.max(1, parseInt(e.target.value) || 1))}
              style={{ width: 70, background: 'var(--bg2)', border: '1px solid var(--bdr)', borderRadius: 4, padding: '.35rem .5rem', color: 'var(--txt)', textAlign: 'center' }} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '.78rem', color: 'var(--muted)' }}>Price</div>
            <div style={{ fontSize: '1.3rem', fontWeight: 800, color: 'var(--acc)' }}>{fmtMoney(price * qty)}</div>
          </div>
        </div>
        {!inStock && <div style={{ color: 'var(--danger)', fontSize: '.85rem', marginBottom: '.75rem' }}>⚠ Out of stock</div>}
        <div className="ma">
          <button className="btn btn-s" onClick={onClose}>Cancel</button>
          <button className="btn btn-p" disabled={!inStock || !selected} onClick={handleAdd}>Add to Cart</button>
        </div>
      </div>
    </div>
  )
}

// ─── Shared: Receipt modal for merch ─────────────────────────
function MerchReceiptModal({ payment, onClose }) {
  const s = payment.snapshot || {}
  const printReceipt = () => {
    const w = window.open('', '_blank', 'width=680,height=820')
    if (!w) return
    const itemRows = (s.items || []).map(it =>
      `<div class="row"><span class="lbl">${it.name}${it.variant ? ' · ' + it.variant : ''} ×${it.qty}</span><span class="val">${fmtMoney(it.unitPrice * it.qty)}</span></div>`
    ).join('')
    w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Merch Receipt</title><style>
      body{font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;max-width:560px;margin:2rem auto;color:#111;font-size:14px;}
      .logo{font-size:1.5rem;font-weight:900;letter-spacing:.14em;color:#c8e03a;}
      .tagline{font-size:.72rem;color:#666;letter-spacing:.08em;text-transform:uppercase;margin-bottom:1.5rem;}
      .row{display:flex;justify-content:space-between;padding:.4rem 0;border-bottom:1px solid #eee;}
      .lbl{color:#666;}.val{font-weight:600;text-align:right;}
      .total-row{display:flex;justify-content:space-between;font-size:1.1rem;font-weight:700;padding:.75rem 0;border-top:2px solid #111;margin-top:.5rem;}
      .footer{font-size:.7rem;color:#888;margin-top:1.5rem;line-height:1.6;text-align:center;}
      @media print{body{padding:1.5rem 2rem;}}
    </style></head><body>
      <div class="logo">SECTOR 317</div>
      <div class="tagline">Indoor Tactical Experience · Noblesville, IN</div>
      <h2>Merchandise Receipt</h2>
      <div class="row"><span class="lbl">Reference #</span><span class="val" style="font-family:monospace">${s.refNum || '—'}</span></div>
      <div class="row"><span class="lbl">Customer</span><span class="val">${s.customerName || '—'}</span></div>
      ${itemRows}
      ${s.discount ? `<div class="row"><span class="lbl">Discount</span><span class="val">-${fmtMoney(s.discount)}</span></div>` : ''}
      ${s.shipping ? `<div class="row"><span class="lbl">Shipping</span><span class="val">${fmtMoney(s.shipping)}</span></div>` : ''}
      <div class="row"><span class="lbl">Fulfillment</span><span class="val">${s.fulfillmentType === 'ship' ? 'Shipped' : 'In-Store Pickup'}</span></div>
      <div class="row"><span class="lbl">Purchase Date</span><span class="val">${payment.createdAt ? new Date(payment.createdAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : '—'}</span></div>
      <div class="row"><span class="lbl">Purchase Time</span><span class="val">${payment.createdAt ? new Date(payment.createdAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }) : '—'}</span></div>
      ${s.cardLast4 ? `<div class="row"><span class="lbl">Card</span><span class="val">•••• •••• •••• ${s.cardLast4}${s.cardExpiry ? ' · Exp ' + s.cardExpiry : ''}</span></div><div class="row"><span class="lbl">Cardholder</span><span class="val">${s.cardHolder || '—'}</span></div>` : ''}
      ${(s.giftCodes || []).map(g => `<div class="row"><span class="lbl">${g.type === 'gift_card' ? 'Gift Card' : 'Gift Certificate'} Code</span><span class="val" style="font-family:monospace;font-weight:700">${g.code}</span></div>`).join('')}
      <div class="row"><span class="lbl">Status</span><span class="val">PAID</span></div>
      <div class="total-row"><span>Total Charged</span><span>${fmtMoney(payment.amount)}</span></div>
      <div class="footer">Sector 317 · sector317.com · Noblesville, IN<br/>Payment processed securely via GoDaddy Payments<br/><em>Please retain this receipt for your records.</em></div>
      <script>window.onload=()=>{window.print();}<\/script>
    </body></html>`)
    w.document.close()
  }

  return (
    <div className="mo"><div className="mc" style={{ maxWidth: 520 }}>
      <div className="mt2" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '.5rem' }}>
        <span>🧾 Merch Receipt</span>
        <span style={{ fontFamily: 'monospace', fontSize: '.75rem', color: 'var(--muted)', fontWeight: 400 }}>#{s.refNum}</span>
      </div>
      <div style={{ background: 'var(--bg2)', border: '1px solid var(--acc2)', borderRadius: 6, padding: '.85rem 1rem', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '.75rem' }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: 'var(--fd)', fontSize: '1.1rem', color: 'var(--acc)', letterSpacing: '.12em', fontWeight: 900 }}>SECTOR 317</div>
          <div style={{ fontSize: '.7rem', color: 'var(--muted)', letterSpacing: '.08em', textTransform: 'uppercase' }}>Merchandise</div>
        </div>
      </div>
      {[
        ['Reference #', <span style={{ fontFamily: 'monospace', fontSize: '.85rem' }}>{s.refNum}</span>],
        ['Customer', s.customerName || '—'],
        ...(s.items || []).map(it => [
          `${it.name}${it.variant ? ' · ' + it.variant : ''} ×${it.qty}`,
          fmtMoney(it.unitPrice * it.qty)
        ]),
        ...(s.discount ? [['Discount', <span style={{ color: 'var(--ok)' }}>-{fmtMoney(s.discount)}</span>]] : []),
        ...(s.shipping ? [['Shipping', fmtMoney(s.shipping)]] : []),
        ['Fulfillment', s.fulfillmentType === 'ship' ? 'Shipped' : 'In-Store Pickup'],
        ['Purchase Date', payment.createdAt ? new Date(payment.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'],
        ['Purchase Time', payment.createdAt ? new Date(payment.createdAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }) : '—'],
        ...(s.cardLast4 ? [['Card', '•••• •••• •••• ' + s.cardLast4 + (s.cardExpiry ? ' · Exp ' + s.cardExpiry : '')], ['Cardholder', s.cardHolder || '—']] : []),
        ...(s.giftCodes || []).map(g => [`${g.type === 'gift_card' ? '🎁 Gift Card' : '🎟 Gift Cert'} Code`, <span style={{ fontFamily: 'monospace', fontWeight: 700, color: 'var(--acc)' }}>{g.code}</span>]),
        ['Status', <span className="badge b-ok" style={{ textTransform: 'uppercase' }}>{payment.status}</span>],
      ].map(([lbl, val]) => (
        <div key={String(lbl)} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '.45rem 0', borderBottom: '1px solid var(--bdr)', fontSize: '.85rem' }}>
          <span style={{ color: 'var(--muted)' }}>{lbl}</span>
          <span style={{ fontWeight: 600, color: 'var(--txt)', textAlign: 'right' }}>{val}</span>
        </div>
      ))}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '.75rem 0', marginTop: '.25rem', borderTop: '2px solid var(--bdr)', fontSize: '1.05rem', fontWeight: 700 }}>
        <span>Total Charged</span>
        <span style={{ color: 'var(--acc)', fontFamily: 'var(--fd)', fontSize: '1.15rem' }}>{fmtMoney(payment.amount)}</span>
      </div>
      <div className="ma" style={{ marginTop: '1.25rem', gap: '.75rem' }}>
        <button className="btn btn-s" onClick={onClose}>Close</button>
        <button className="btn btn-p" onClick={printReceipt}>🖨 Print Receipt</button>
      </div>
    </div></div>
  )
}

// ================================================================
// MERCH ADMIN
// ================================================================
function MerchAdmin({ currentUser, isAdmin, users, setUsers, setPayments, onAlert }) {
  const [tab, setTab] = useState(isAdmin ? 'products' : 'inventory')
  const [saleOpen, setSaleOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [catalog, setCatalog] = useState([])
  const [categories, setCategories] = useState([])
  const [locations, setLocations] = useState([])
  const [vendors, setVendors] = useState([])
  const [discounts, setDiscounts] = useState([])
  const [orders, setOrders] = useState([])
  const [giftCodes, setGiftCodes] = useState([])
  const [returns, setReturns] = useState([])
  const [editProduct, setEditProduct] = useState(null) // null | {} | {id,...}
  const [editBundle, setEditBundle] = useState(null) // null | {} | {id,...}
  const [editVariant, setEditVariant] = useState(null) // null | {productId,...}
  const [editCategory, setEditCategory] = useState(null)
  const [editDiscount, setEditDiscount] = useState(null)
  const [editLocation, setEditLocation] = useState(null)
  const [editVendor, setEditVendor] = useState(null)
  const [purchaseOrders, setPurchaseOrders] = useState([])
  const [inventoryByVariant, setInventoryByVariant] = useState({}) // { variantId: [{locationId, locationName, quantity}] }
  const [adjustModal, setAdjustModal] = useState(null) // {variant, productName}
  const [transferModal, setTransferModal] = useState(null) // {variant, productName}
  const [fulfillModal, setFulfillModal] = useState(null) // order object
  const [purchaseOrderModal, setPurchaseOrderModal] = useState(null) // null | {} | {id,...}
  const [receivePOModal, setReceivePOModal] = useState(null) // {line, poId}
  const [expandedPO, setExpandedPO] = useState(null)
  const [poStatusFilter, setPoStatusFilter] = useState('')
  const [returnModal, setReturnModal] = useState(null) // {order, item}
  const [expandedProduct, setExpandedProduct] = useState(null)
  const [expandedOrder, setExpandedOrder] = useState(null)
  const [search, setSearch] = useState('')
  const [orderSearch, setOrderSearch] = useState('')
  const [orderStatusFilter, setOrderStatusFilter] = useState('')

  useEffect(() => { loadAll() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const loadAll = async () => {
    setLoading(true)
    try {
      const [p, c, l, v, d, o, gc, r, pos, inv] = await Promise.all([
        fetchMerchCatalog('all'),
        fetchMerchCategories(),
        fetchStockLocations(),
        fetchMerchVendors(),
        fetchMerchDiscounts(),
        fetchMerchOrders(),
        fetchMerchGiftCodes(),
        fetchMerchReturns(),
        fetchPurchaseOrders(),
        fetchMerchInventory(),
      ])
      setCatalog(p); setCategories(c); setLocations(l); setVendors(v)
      setDiscounts(d); setOrders(o); setGiftCodes(gc); setReturns(r)
      setPurchaseOrders(pos)
      // Build variantId → [{locationId, locationName, quantity}] lookup
      const byVariant = {}
      for (const row of inv) {
        const loc = l.find(x => x.id === row.locationId)
        if (!byVariant[row.variantId]) byVariant[row.variantId] = []
        byVariant[row.variantId].push({ locationId: row.locationId, locationName: loc?.name || row.locationId, quantity: row.quantity })
      }
      setInventoryByVariant(byVariant)
    } catch (e) { onAlert?.('Error loading merch data: ' + e.message) }
    setLoading(false)
  }

  const TABS = [
    ['products', '📦 Products'],
    ...(isAdmin ? [['bundles', '🎁 Bundles']] : []),
    ['inventory', '📊 Inventory'],
    ...(isAdmin ? [['purchasing', '🛒 Purchasing']] : []),
    ['orders', '🧾 Orders'],
    ['discounts', '🏷 Discounts'],
    ['returns', '↩ Returns'],
    ['gift-codes', '🎟 Gift Codes'],
    ...(isAdmin ? [['settings', '⚙ Settings']] : []),
  ]

  const filteredProducts = useMemo(() =>
    catalog.filter(p => !search || p.name.toLowerCase().includes(search.toLowerCase()) || (p.sku || '').toLowerCase().includes(search.toLowerCase())),
    [catalog, search]
  )

  const filteredOrders = useMemo(() =>
    orders.filter(o =>
      (!orderSearch || o.customerName.toLowerCase().includes(orderSearch.toLowerCase())) &&
      (!orderStatusFilter || o.status === orderStatusFilter)
    ), [orders, orderSearch, orderStatusFilter]
  )

  if (loading) return <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--muted)' }}>Loading merchandise data…</div>

  return (
    <div>
      <div style={{ display: 'flex', gap: '.4rem', flexWrap: 'wrap', marginBottom: '1.5rem' }}>
        {TABS.map(([key, label]) => (
          <button key={key} className={`btn btn-sm ${tab === key ? 'btn-p' : 'btn-s'}`}
            style={{ fontSize: '.8rem' }} onClick={() => setTab(key)}>{label}</button>
        ))}
        <button className="btn btn-sm btn-s" style={{ fontSize: '.8rem', marginLeft: 'auto' }} onClick={loadAll}>↻ Refresh</button>
        {!isAdmin && <button className="btn btn-sm btn-p" style={{ fontSize: '.8rem' }} onClick={() => setSaleOpen(true)}>+ New Sale</button>}
      </div>

      {/* ── Products Tab ────────────────────────────── */}
      {tab === 'products' && (<>
        <div style={{ display: 'flex', gap: '.75rem', marginBottom: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <input placeholder="Search name or SKU…" value={search} onChange={e => setSearch(e.target.value)}
            style={{ flex: 1, minWidth: 180, background: 'var(--bg2)', border: '1px solid var(--bdr)', borderRadius: 6, padding: '.4rem .75rem', color: 'var(--txt)', fontSize: '.88rem' }} />
          {isAdmin && <button className="btn btn-p btn-sm" onClick={() => setEditProduct({})}>+ New Product</button>}
        </div>
        {filteredProducts.length === 0 && <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--muted)' }}>No products yet. Create one to get started.</div>}
        {filteredProducts.map(p => (
          <div key={p.id} style={{ background: 'var(--surf)', border: `1px solid ${expandedProduct === p.id ? 'var(--acc)' : 'var(--bdr)'}`, borderRadius: 8, marginBottom: '.6rem', overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', padding: '.65rem 1rem', gap: '.75rem', cursor: 'pointer' }}
              onClick={() => setExpandedProduct(expandedProduct === p.id ? null : p.id)}>
              <span className={`badge ${TYPE_BADGE[p.type] || 'b-open'}`} style={{ fontSize: '.65rem' }}>{TYPE_LABELS[p.type] || p.type}</span>
              <span style={{ fontWeight: 600, flex: 1, color: 'var(--txt)' }}>{p.name}</span>
              {p.categoryName && <span style={{ fontSize: '.75rem', color: 'var(--muted)' }}>{p.categoryName}</span>}
              <span style={{ fontSize: '.9rem', fontWeight: 700, color: 'var(--acc)' }}>{fmtMoney(p.basePrice)}</span>
              {!p.active && <span className="badge b-d" style={{ fontSize: '.6rem' }}>Inactive</span>}
              {isAdmin && <div style={{ display: 'flex', gap: '.4rem' }}>
                <button className="btn btn-sm btn-s" onClick={e => { e.stopPropagation(); p.type === 'bundle' ? setEditBundle(p) : setEditProduct(p) }}>Edit</button>
              </div>}
            </div>
            {expandedProduct === p.id && (
              <div style={{ borderTop: '1px solid var(--bdr)', padding: '1rem' }}>
                {p.description && <p style={{ color: 'var(--muted)', fontSize: '.85rem', marginBottom: '.75rem' }}>{p.description}</p>}
                <div style={{ display: 'flex', gap: '.5rem', marginBottom: '.75rem', flexWrap: 'wrap', fontSize: '.78rem', color: 'var(--muted)' }}>
                  {p.sku && <span>SKU: {p.sku}</span>}
                  <span>Storefront: {p.storefrontVisible ? '✓' : '✗'}</span>
                  <span>Staff: {p.staffVisible ? '✓' : '✗'}</span>
                  <span>Returnable: {p.returnable ? `✓ (${p.returnWindowDays}d)` : '✗'}</span>
                  {p.pickupOnly && <span style={{ color: 'var(--warn)' }}>Pickup Only</span>}
                </div>
                <div style={{ fontWeight: 600, fontSize: '.8rem', marginBottom: '.5rem', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.06em' }}>Variants</div>
                {p.variants.length === 0 && <div style={{ fontSize: '.85rem', color: 'var(--muted)', marginBottom: '.5rem' }}>No variants — product sells at base price.</div>}
                {p.variants.map(v => (
                  <div key={v.id} style={{ display: 'flex', alignItems: 'center', gap: '.75rem', padding: '.4rem 0', borderBottom: '1px solid var(--bdr)', fontSize: '.85rem' }}>
                    <span style={{ flex: 1 }}>{v.label}</span>
                    {v.sku && <span style={{ color: 'var(--muted)', fontSize: '.75rem' }}>{v.sku}</span>}
                    <span style={{ color: 'var(--acc)', fontWeight: 700 }}>{v.priceOverride != null ? fmtMoney(v.priceOverride) : 'Base'}</span>
                    {p.type === 'physical' && <span style={{ minWidth: 60, textAlign: 'right', color: v.inventory <= 0 ? 'var(--danger)' : v.inventory < 5 ? 'var(--warn)' : 'var(--ok)' }}>{v.inventory} in stock</span>}
                    {p.type === 'physical' && isAdmin && <button className="btn btn-sm btn-s" style={{ fontSize: '.7rem' }}
                      onClick={() => setAdjustModal({ variant: v, productName: p.name, locationId: null })}>Adjust</button>}
                    {isAdmin && <button className="btn btn-sm btn-s" style={{ fontSize: '.7rem' }} onClick={() => setEditVariant({ ...v, productId: p.id })}>Edit</button>}
                  </div>
                ))}
                {isAdmin && <button className="btn btn-sm btn-s" style={{ marginTop: '.5rem', fontSize: '.75rem' }}
                  onClick={() => setEditVariant({ productId: p.id })}>+ Add Variant</button>}
              </div>
            )}
          </div>
        ))}
      </>)}

      {/* ── Bundles Tab ─────────────────────────────── */}
      {tab === 'bundles' && (<>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '1rem' }}>
          <button className="btn btn-p btn-sm" onClick={() => setEditBundle({})}>+ New Bundle</button>
        </div>
        {catalog.filter(p => p.type === 'bundle').length === 0 && (
          <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--muted)' }}>No bundles yet. Create one to get started.</div>
        )}
        {catalog.filter(p => p.type === 'bundle').map(b => (
          <div key={b.id} style={{ background: 'var(--surf)', border: '1px solid var(--bdr)', borderRadius: 8, marginBottom: '.6rem', display: 'flex', alignItems: 'center', padding: '.65rem 1rem', gap: '.75rem' }}>
            {b.imageUrls?.[0]
              ? <img src={b.imageUrls[0]} alt="" style={{ width: 52, height: 52, objectFit: 'cover', borderRadius: 6, flexShrink: 0 }} />
              : <div style={{ width: 52, height: 52, background: 'var(--bg2)', borderRadius: 6, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.4rem' }}>📦</div>
            }
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, color: 'var(--txt)' }}>{b.name}</div>
              {b.description && <div style={{ fontSize: '.78rem', color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.description}</div>}
              <div style={{ fontSize: '.72rem', color: 'var(--muted)', marginTop: '.15rem' }}>
                {b.imageUrls?.length > 0 ? `${b.imageUrls.length} image${b.imageUrls.length > 1 ? 's' : ''}` : 'No images'}
                {b.categoryName ? ` · ${b.categoryName}` : ''}
              </div>
            </div>
            {b.bundleSavingsPct > 0 && (
              <span style={{ background: 'var(--dangerL,#c44)', color: '#fff', fontSize: '.65rem', fontWeight: 800, padding: '2px 8px', borderRadius: 99 }}>{b.bundleSavingsPct}% OFF</span>
            )}
            <span style={{ fontWeight: 700, color: 'var(--acc)', whiteSpace: 'nowrap' }}>{fmtMoney(b.basePrice)}</span>
            {!b.active && <span className="badge b-d" style={{ fontSize: '.6rem' }}>Inactive</span>}
            {!b.storefrontVisible && b.active && <span className="badge b-open" style={{ fontSize: '.6rem' }}>Hidden</span>}
            <button className="btn btn-sm btn-s" onClick={() => setEditBundle(b)}>Edit</button>
          </div>
        ))}
      </>)}

      {/* ── Inventory Tab ───────────────────────────── */}
      {tab === 'inventory' && (() => {
        const physicals = catalog.filter(p => p.type === 'physical')
        const reorderNeeded = physicals.flatMap(p =>
          p.variants
            .filter(v => v.reorderPoint != null && v.inventory <= v.reorderPoint)
            .map(v => ({ ...v, productName: p.name, product: p }))
        ).sort((a, b) => a.inventory - b.inventory)
        return (
          <div>
            {reorderNeeded.length > 0 && (
              <div style={{ background: 'rgba(239,68,68,.08)', border: '1px solid rgba(239,68,68,.35)', borderRadius: 8, padding: '1rem', marginBottom: '1rem' }}>
                <div style={{ fontWeight: 700, color: 'var(--danger)', fontSize: '.8rem', letterSpacing: '.06em', textTransform: 'uppercase', marginBottom: '.6rem' }}>
                  ⚠ Reorder Needed — {reorderNeeded.length} variant{reorderNeeded.length !== 1 ? 's' : ''}
                </div>
                {reorderNeeded.map(v => (
                  <div key={v.id} style={{ background: 'var(--surf)', border: '1px solid var(--bdr)', borderRadius: 6, padding: '.6rem .85rem', marginBottom: '.5rem', fontSize: '.83rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '.75rem', flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 700 }}>{v.productName} · {v.label}</span>
                      <span style={{ color: v.inventory <= 0 ? 'var(--danger)' : 'var(--warn)', fontWeight: 700 }}>{v.inventory} in stock</span>
                      <span style={{ color: 'var(--muted)' }}>reorder at ≤{v.reorderPoint}</span>
                      {v.reorderQty && <span style={{ color: 'var(--accB)' }}>order {v.reorderQty} units</span>}
                      {isAdmin && <button className="btn btn-sm btn-s" style={{ fontSize: '.72rem', marginLeft: 'auto' }}
                        onClick={() => setAdjustModal({ variant: v, productName: v.productName, locationId: null })}>Adjust</button>}
                    </div>
                    {(v.vendorName || v.vendorSku || v.leadTimeDays) && (
                      <div style={{ display: 'flex', gap: '1rem', marginTop: '.35rem', color: 'var(--muted)', flexWrap: 'wrap' }}>
                        {v.vendorName && <span>Vendor: <span style={{ color: 'var(--txt)' }}>{v.vendorName}</span></span>}
                        {v.vendorEmail && <a href={`mailto:${v.vendorEmail}`} style={{ color: 'var(--accB)', textDecoration: 'none' }}>{v.vendorEmail}</a>}
                        {v.vendorPhone && <span>{v.vendorPhone}</span>}
                        {v.vendorSku && <span>SKU: <span style={{ color: 'var(--txt)', fontFamily: 'monospace' }}>{v.vendorSku}</span></span>}
                        {v.leadTimeDays && <span>{v.leadTimeDays}d lead time</span>}
                        {v.cost != null && <span>Cost: ${Number(v.cost).toFixed(2)}</span>}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
            {physicals.map(p => (
              <div key={p.id} style={{ background: 'var(--surf)', border: '1px solid var(--bdr)', borderRadius: 8, marginBottom: '.75rem', padding: '1rem' }}>
                <div style={{ fontWeight: 700, marginBottom: '.5rem' }}>{p.name}</div>
                {p.variants.map(v => {
                  const threshold = v.reorderPoint ?? 5
                  const vLocs = inventoryByVariant[v.id] || []
                  return (
                    <div key={v.id} style={{ padding: '.5rem 0', borderBottom: '1px solid var(--bdr)', fontSize: '.88rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '.75rem', flexWrap: 'wrap' }}>
                        <span style={{ flex: 1 }}>{v.label}</span>
                        {v.sku && <span style={{ color: 'var(--muted)', fontSize: '.75rem' }}>{v.sku}</span>}
                        {v.reorderPoint != null && <span style={{ fontSize: '.72rem', color: 'var(--muted)' }}>reorder ≤{v.reorderPoint}</span>}
                        <span style={{ fontWeight: 700, color: v.inventory <= 0 ? 'var(--danger)' : v.inventory <= threshold ? 'var(--warn)' : 'var(--ok)' }}>
                          {v.inventory} total
                        </span>
                        {isAdmin && <>
                          <button className="btn btn-sm btn-s" style={{ fontSize: '.72rem' }}
                            onClick={() => setAdjustModal({ variant: v, productName: p.name, locationId: null })}>Adjust / Stock</button>
                          {vLocs.length > 1 && <button className="btn btn-sm btn-s" style={{ fontSize: '.72rem' }}
                            onClick={() => setTransferModal({ variant: v, productName: p.name })}>Transfer</button>}
                        </>}
                        {!isAdmin && <button className="btn btn-sm btn-s" style={{ fontSize: '.75rem' }}
                          onClick={async () => {
                            if (!confirm(`Flag "${v.label}" for reorder?`)) return
                            try {
                              await adjustMerchInventory(v.id, null, 0, 'reorder_flag', 'Flagged for reorder', currentUser?.id)
                              onAlert?.('Flagged for reorder.')
                            } catch (e) { onAlert?.('Error: ' + e.message) }
                          }}>Flag Reorder</button>}
                      </div>
                      {vLocs.length > 0 && (
                        <div style={{ display: 'flex', gap: '.4rem', marginTop: '.3rem', flexWrap: 'wrap' }}>
                          {vLocs.map(loc => (
                            <span key={loc.locationId} style={{ fontSize: '.72rem', background: 'var(--bg2)', border: '1px solid var(--bdr)', borderRadius: 4, padding: '1px 7px', color: 'var(--muted)' }}>
                              {loc.locationName}: <strong style={{ color: 'var(--txt)' }}>{loc.quantity}</strong>
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })}
                {p.variants.length === 0 && <div style={{ fontSize: '.85rem', color: 'var(--muted)' }}>No variants defined.</div>}
              </div>
            ))}
            {physicals.length === 0 && (
              <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--muted)' }}>No physical products yet.</div>
            )}
          </div>
        )
      })()}

      {/* ── Purchasing Tab ──────────────────────────── */}
      {tab === 'purchasing' && (<>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '.5rem' }}>
          <select value={poStatusFilter} onChange={e => setPoStatusFilter(e.target.value)}
            style={{ background: 'var(--bg2)', border: '1px solid var(--bdr)', borderRadius: 6, padding: '.4rem .6rem', color: 'var(--txt)', fontSize: '.88rem' }}>
            <option value="">All Statuses</option>
            {['draft','sent','partially_received','received','cancelled'].map(s => <option key={s} value={s}>{s.replace(/_/g,' ')}</option>)}
          </select>
          <button className="btn btn-p btn-sm" onClick={() => setPurchaseOrderModal({})}>+ Create PO</button>
        </div>
        {purchaseOrders.filter(po => !poStatusFilter || po.status === poStatusFilter).length === 0 && (
          <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--muted)' }}>No purchase orders yet.</div>
        )}
        {purchaseOrders.filter(po => !poStatusFilter || po.status === poStatusFilter).map(po => {
          const totalLines = po.lines.length
          const receivedLines = po.lines.filter(l => l.qtyReceived >= l.qtyOrdered).length
          const totalOrdered = po.lines.reduce((s, l) => s + l.qtyOrdered, 0)
          const totalReceived = po.lines.reduce((s, l) => s + l.qtyReceived, 0)
          const PO_BADGE = { draft:'b-open', sent:'b-open', partially_received:'b-warn', received:'b-ok', cancelled:'b-closed' }
          return (
            <div key={po.id} style={{ background: 'var(--surf)', border: `1px solid ${expandedPO === po.id ? 'var(--acc)' : 'var(--bdr)'}`, borderRadius: 8, marginBottom: '.6rem', overflow: 'hidden' }}>
              <div style={{ display: 'flex', alignItems: 'center', padding: '.65rem 1rem', gap: '.75rem', cursor: 'pointer', flexWrap: 'wrap' }}
                onClick={() => setExpandedPO(expandedPO === po.id ? null : po.id)}>
                <span className={`badge ${PO_BADGE[po.status] || 'b-open'}`} style={{ fontSize: '.65rem' }}>{po.status.replace(/_/g,' ')}</span>
                <span style={{ fontWeight: 600, flex: 1 }}>{po.vendorName || 'Unknown Vendor'}</span>
                {po.expectedBy && <span style={{ fontSize: '.78rem', color: 'var(--muted)' }}>expected {po.expectedBy}</span>}
                <span style={{ fontSize: '.78rem', color: 'var(--muted)' }}>{totalReceived}/{totalOrdered} units · {receivedLines}/{totalLines} lines</span>
              </div>
              {expandedPO === po.id && (
                <div style={{ borderTop: '1px solid var(--bdr)', padding: '1rem' }}>
                  {po.notes && <div style={{ fontSize: '.82rem', color: 'var(--muted)', marginBottom: '.75rem' }}>{po.notes}</div>}
                  {po.lines.map(line => (
                    <div key={line.id} style={{ display: 'flex', alignItems: 'center', gap: '.75rem', padding: '.4rem 0', borderBottom: '1px solid var(--bdr)', fontSize: '.85rem', flexWrap: 'wrap' }}>
                      <span style={{ flex: 1 }}><strong>{line.productName}</strong> · {line.variantLabel}</span>
                      {line.unitCost != null && <span style={{ color: 'var(--muted)', fontSize: '.78rem' }}>${Number(line.unitCost).toFixed(2)}/unit</span>}
                      <span style={{ color: line.qtyReceived >= line.qtyOrdered ? 'var(--ok)' : line.qtyReceived > 0 ? 'var(--warn)' : 'var(--muted)' }}>
                        {line.qtyReceived}/{line.qtyOrdered} received
                      </span>
                      {po.status !== 'cancelled' && line.qtyReceived < line.qtyOrdered && (
                        <button className="btn btn-sm btn-ok" style={{ fontSize: '.72rem' }}
                          onClick={() => setReceivePOModal({ line, poId: po.id })}>Receive</button>
                      )}
                    </div>
                  ))}
                  <div style={{ display: 'flex', gap: '.5rem', marginTop: '.75rem' }}>
                    {po.status === 'draft' && <button className="btn btn-sm btn-s" style={{ fontSize: '.75rem' }}
                      onClick={async () => { try { await updatePOStatus(po.id, 'sent'); await loadAll() } catch (e) { onAlert?.('Error: ' + e.message) } }}>Mark Sent</button>}
                    {po.status !== 'cancelled' && po.status !== 'received' && (
                      <button className="btn btn-sm btn-d" style={{ fontSize: '.75rem' }}
                        onClick={async () => { if (!confirm('Cancel this PO?')) return; try { await updatePOStatus(po.id, 'cancelled'); await loadAll() } catch (e) { onAlert?.('Error: ' + e.message) } }}>Cancel PO</button>
                    )}
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </>)}

      {/* ── Orders Tab ──────────────────────────────── */}
      {tab === 'orders' && (<>
        <div style={{ display: 'flex', gap: '.75rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
          <input placeholder="Search customer…" value={orderSearch} onChange={e => setOrderSearch(e.target.value)}
            style={{ flex: 1, minWidth: 180, background: 'var(--bg2)', border: '1px solid var(--bdr)', borderRadius: 6, padding: '.4rem .75rem', color: 'var(--txt)', fontSize: '.88rem' }} />
          <select value={orderStatusFilter} onChange={e => setOrderStatusFilter(e.target.value)}
            style={{ background: 'var(--bg2)', border: '1px solid var(--bdr)', borderRadius: 6, padding: '.4rem .6rem', color: 'var(--txt)', fontSize: '.88rem' }}>
            <option value="">All Statuses</option>
            {['paid','fulfilled','pending','cancelled','refunded'].map(s => <option key={s} value={s}>{s.charAt(0).toUpperCase()+s.slice(1)}</option>)}
          </select>
        </div>
        {filteredOrders.length === 0 && <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--muted)' }}>No orders found.</div>}
        {filteredOrders.map(o => (
          <div key={o.id} style={{ background: 'var(--surf)', border: `1px solid ${expandedOrder === o.id ? 'var(--acc)' : 'var(--bdr)'}`, borderRadius: 8, marginBottom: '.6rem', overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', padding: '.65rem 1rem', gap: '.75rem', cursor: 'pointer' }}
              onClick={() => setExpandedOrder(expandedOrder === o.id ? null : o.id)}>
              <span className={`badge ${STATUS_BADGE[o.status] || 'b-open'}`} style={{ fontSize: '.65rem' }}>{o.status}</span>
              <span style={{ fontWeight: 600, flex: 1 }}>{o.customerName}</span>
              <span style={{ fontSize: '.78rem', color: 'var(--muted)' }}>{fmtDate(o.createdAt)}</span>
              <span style={{ fontWeight: 700, color: 'var(--acc)' }}>{fmtMoney(o.total)}</span>
              <span style={{ fontSize: '.75rem', color: 'var(--muted)' }}>{o.fulfillmentType === 'ship' ? '📦 Ship' : '🏪 Pickup'}</span>
            </div>
            {expandedOrder === o.id && (
              <div style={{ borderTop: '1px solid var(--bdr)', padding: '1rem' }}>
                <div style={{ fontSize: '.75rem', color: 'var(--muted)', marginBottom: '.75rem', fontFamily: 'monospace' }}>#{o.id.replace(/-/g,'').slice(0,12).toUpperCase()}</div>
                {o.items.map(item => (
                  <div key={item.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '.35rem 0', borderBottom: '1px solid var(--bdr)', fontSize: '.88rem' }}>
                    <span>×{item.quantity} — {catalog.find(p => p.id === item.productId)?.name || 'Product'}</span>
                    <span style={{ fontWeight: 600 }}>{fmtMoney(item.unitPrice * item.quantity)}</span>
                  </div>
                ))}
                {o.discountAmount > 0 && <div style={{ display: 'flex', justifyContent: 'space-between', padding: '.35rem 0', fontSize: '.88rem', color: 'var(--ok)' }}>
                  <span>Discount</span><span>-{fmtMoney(o.discountAmount)}</span></div>}
                {o.shippingCharge > 0 && <div style={{ display: 'flex', justifyContent: 'space-between', padding: '.35rem 0', fontSize: '.88rem' }}>
                  <span>Shipping</span><span>{fmtMoney(o.shippingCharge)}</span></div>}
                {o.trackingNumber && (
                  <div style={{ marginTop: '.5rem', fontSize: '.8rem', color: 'var(--muted)' }}>
                    📦 {o.carrier && <strong>{o.carrier}: </strong>}
                    <span style={{ fontFamily: 'monospace', color: 'var(--accB)' }}>{o.trackingNumber}</span>
                    {o.fulfilledAt && <span> · fulfilled {fmtDate(o.fulfilledAt)}</span>}
                  </div>
                )}
                <div style={{ display: 'flex', gap: '.5rem', marginTop: '.75rem', flexWrap: 'wrap' }}>
                  {(o.status === 'paid' || o.status === 'pending') && <button className="btn btn-sm btn-ok" style={{ fontSize: '.75rem' }}
                    onClick={() => setFulfillModal(o)}>Mark Fulfilled</button>}
                  {(o.status === 'paid' || o.status === 'fulfilled') && o.items.map(item => (
                    <button key={item.id} className="btn btn-sm btn-s" style={{ fontSize: '.75rem' }}
                      onClick={() => setReturnModal({ order: o, item })}>Return Item</button>
                  ))}
                </div>
              </div>
            )}
          </div>
        ))}
      </>)}

      {/* ── Discounts Tab ───────────────────────────── */}
      {tab === 'discounts' && (<>
        {isAdmin && <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '1rem' }}>
          <button className="btn btn-p btn-sm" onClick={() => setEditDiscount({})}>+ New Discount</button>
        </div>}
        {discounts.length === 0 && <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--muted)' }}>No discounts configured.</div>}
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.85rem' }}>
          <thead><tr style={{ color: 'var(--muted)', fontSize: '.75rem', textAlign: 'left' }}>
            <th style={{ padding: '.4rem .5rem' }}>Code</th>
            <th style={{ padding: '.4rem .5rem' }}>Type</th>
            <th style={{ padding: '.4rem .5rem' }}>Amount</th>
            <th style={{ padding: '.4rem .5rem' }}>Uses</th>
            <th style={{ padding: '.4rem .5rem' }}>Status</th>
            <th style={{ padding: '.4rem .5rem' }}></th>
          </tr></thead>
          <tbody>
            {discounts.map(d => (
              <tr key={d.id} style={{ borderTop: '1px solid var(--bdr)' }}>
                <td style={{ padding: '.5rem', fontFamily: 'monospace', fontWeight: 700 }}>{d.code}</td>
                <td style={{ padding: '.5rem' }}>{d.discountType === 'percent' ? `${d.amount}%` : 'Fixed'}</td>
                <td style={{ padding: '.5rem', color: 'var(--acc)' }}>{d.discountType === 'percent' ? `${d.amount}%` : fmtMoney(d.amount)}</td>
                <td style={{ padding: '.5rem', color: 'var(--muted)' }}>{d.usageCount}{d.usageLimit ? `/${d.usageLimit}` : ''}</td>
                <td style={{ padding: '.5rem' }}><span className={`badge ${d.active ? 'b-ok' : 'b-d'}`} style={{ fontSize: '.65rem' }}>{d.active ? 'Active' : 'Inactive'}</span></td>
                <td style={{ padding: '.5rem' }}>{isAdmin && <button className="btn btn-sm btn-s" style={{ fontSize: '.7rem' }} onClick={() => setEditDiscount(d)}>Edit</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </>)}

      {/* ── Returns Tab ─────────────────────────────── */}
      {tab === 'returns' && (<>
        {returns.length === 0 && <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--muted)' }}>No returns on record.</div>}
        {returns.map(r => (
          <div key={r.id} style={{ background: 'var(--surf)', border: '1px solid var(--bdr)', borderRadius: 8, padding: '.75rem 1rem', marginBottom: '.6rem', fontSize: '.85rem', display: 'flex', gap: '.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <span className={`badge ${r.disposition === 'no_restock' ? 'b-d' : 'b-ok'}`} style={{ fontSize: '.65rem' }}>{DISPOSITION_LABELS[r.disposition]}</span>
            <span style={{ flex: 1 }}>Qty {r.quantity} · {r.reason}</span>
            <span style={{ color: 'var(--muted)', fontSize: '.75rem' }}>{fmtDate(r.createdAt)}</span>
            {r.notes && <span style={{ color: 'var(--muted)', fontStyle: 'italic' }}>{r.notes}</span>}
          </div>
        ))}
      </>)}

      {/* ── Gift Codes Tab ──────────────────────────── */}
      {tab === 'gift-codes' && (<>
        {giftCodes.length === 0 && <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--muted)' }}>No gift codes issued yet.</div>}
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.85rem' }}>
          <thead><tr style={{ color: 'var(--muted)', fontSize: '.75rem', textAlign: 'left' }}>
            <th style={{ padding: '.4rem .5rem' }}>Code</th>
            <th style={{ padding: '.4rem .5rem' }}>Type</th>
            <th style={{ padding: '.4rem .5rem' }}>Value</th>
            <th style={{ padding: '.4rem .5rem' }}>Balance</th>
            <th style={{ padding: '.4rem .5rem' }}>Status</th>
            <th style={{ padding: '.4rem .5rem' }}></th>
          </tr></thead>
          <tbody>
            {giftCodes.map(gc => (
              <tr key={gc.id} style={{ borderTop: '1px solid var(--bdr)' }}>
                <td style={{ padding: '.5rem', fontFamily: 'monospace', fontWeight: 700 }}>{gc.code}</td>
                <td style={{ padding: '.5rem' }}>{gc.type === 'gift_card' ? 'Gift Card' : 'Gift Cert'}</td>
                <td style={{ padding: '.5rem' }}>{fmtMoney(gc.originalValue)}</td>
                <td style={{ padding: '.5rem', color: gc.currentBalance > 0 ? 'var(--ok)' : 'var(--muted)' }}>{fmtMoney(gc.currentBalance)}</td>
                <td style={{ padding: '.5rem' }}><span className={`badge ${gc.status === 'active' ? 'b-ok' : gc.status === 'redeemed' ? 'b-coop' : 'b-d'}`} style={{ fontSize: '.65rem' }}>{gc.status}</span></td>
                <td style={{ padding: '.5rem' }}>
                  {isAdmin && gc.status === 'active' && <button className="btn btn-sm btn-d" style={{ fontSize: '.7rem' }}
                    onClick={async () => { if (!confirm('Void this code?')) return; try { await voidGiftCode(gc.id); setGiftCodes(prev => prev.map(x => x.id === gc.id ? { ...x, status: 'voided' } : x)) } catch (e) { onAlert?.('Error: ' + e.message) } }}>Void</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </>)}

      {/* ── Settings Tab ────────────────────────────── */}
      {tab === 'settings' && (<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '.75rem' }}>
            <div style={{ fontWeight: 700 }}>Categories</div>
            <button className="btn btn-p btn-sm" style={{ fontSize: '.75rem' }} onClick={() => setEditCategory({})}>+ Add</button>
          </div>
          {categories.map(c => (
            <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: '.5rem', padding: '.4rem 0', borderBottom: '1px solid var(--bdr)', fontSize: '.88rem' }}>
              <span style={{ flex: 1 }}>{c.name}</span>
              <span style={{ fontSize: '.72rem', color: 'var(--muted)' }}>sf:{c.storefrontVisible?'✓':'✗'} st:{c.staffVisible?'✓':'✗'}</span>
              <button className="btn btn-sm btn-s" style={{ fontSize: '.7rem' }} onClick={() => setEditCategory(c)}>Edit</button>
            </div>
          ))}
        </div>
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '.75rem' }}>
            <div style={{ fontWeight: 700 }}>Stock Locations</div>
            <button className="btn btn-p btn-sm" style={{ fontSize: '.75rem' }} onClick={() => setEditLocation({})}>+ Add</button>
          </div>
          {locations.map(l => (
            <div key={l.id} style={{ display: 'flex', alignItems: 'center', gap: '.5rem', padding: '.4rem 0', borderBottom: '1px solid var(--bdr)', fontSize: '.88rem' }}>
              <span style={{ flex: 1 }}>{l.name}</span>
              {l.isDefault && <span className="badge b-ok" style={{ fontSize: '.6rem' }}>Default</span>}
              <button className="btn btn-sm btn-s" style={{ fontSize: '.7rem' }} onClick={() => setEditLocation(l)}>Edit</button>
            </div>
          ))}
        </div>
        <div style={{ gridColumn: '1/-1' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '.75rem' }}>
            <div style={{ fontWeight: 700 }}>Vendors / Suppliers</div>
            <button className="btn btn-p btn-sm" style={{ fontSize: '.75rem' }} onClick={() => setEditVendor({})}>+ Add Vendor</button>
          </div>
          {vendors.length === 0 && <div style={{ fontSize: '.85rem', color: 'var(--muted)' }}>No vendors yet.</div>}
          {vendors.map(v => (
            <div key={v.id} style={{ display: 'flex', alignItems: 'center', gap: '.75rem', padding: '.45rem 0', borderBottom: '1px solid var(--bdr)', fontSize: '.88rem', flexWrap: 'wrap' }}>
              <span style={{ fontWeight: 600, minWidth: 120 }}>{v.name}</span>
              {v.email && <a href={`mailto:${v.email}`} style={{ color: 'var(--accB)', textDecoration: 'none', fontSize: '.8rem' }}>{v.email}</a>}
              {v.phone && <span style={{ color: 'var(--muted)', fontSize: '.8rem' }}>{v.phone}</span>}
              {v.website && <a href={v.website} target="_blank" rel="noreferrer" style={{ color: 'var(--muted)', fontSize: '.75rem' }}>🔗 site</a>}
              <button className="btn btn-sm btn-s" style={{ fontSize: '.7rem', marginLeft: 'auto' }} onClick={() => setEditVendor(v)}>Edit</button>
            </div>
          ))}
        </div>
      </div>)}

      {/* ── Modals ──────────────────────────────────── */}
      {editProduct !== null && (
        <ProductEditModal product={editProduct} categories={categories}
          onSave={async (p) => {
            try {
              await upsertMerchProduct(p)
              await loadAll()
              setEditProduct(null)
              onAlert?.('Product saved.')
            } catch (e) { onAlert?.('Error: ' + e.message) }
          }}
          onClose={() => setEditProduct(null)} />
      )}

      {editBundle !== null && (
        <BundleMakerModal bundle={editBundle} catalog={catalog} categories={categories}
          onSave={async (p, components) => {
            const id = await upsertMerchProduct(p)
            await upsertBundleComponents(id, components.map(c => ({ variantId: c.variantId, quantity: c.quantity })))
            await loadAll()
            setEditBundle(null)
            onAlert?.('Bundle saved.')
          }}
          onClose={() => setEditBundle(null)} />
      )}

      {editVariant !== null && (
        <VariantEditModal variant={editVariant} vendors={vendors}
          productSku={catalog.find(p => p.id === editVariant?.productId)?.sku || null}
          onSave={async (v) => {
            try {
              await upsertMerchVariant(v)
              await loadAll()
              setEditVariant(null)
              onAlert?.('Variant saved.')
            } catch (e) { onAlert?.('Error: ' + e.message) }
          }}
          onDelete={editVariant.id ? async () => {
            if (!confirm('Delete this variant? This cannot be undone.')) return
            try { await deleteMerchVariant(editVariant.id); await loadAll(); setEditVariant(null) }
            catch (e) { onAlert?.('Error: ' + e.message) }
          } : undefined}
          onAddVendor={() => setEditVendor({})}
          onClose={() => setEditVariant(null)} />
      )}

      {editCategory !== null && (
        <CategoryEditModal category={editCategory}
          onSave={async (c) => {
            try { await upsertMerchCategory(c); await loadAll(); setEditCategory(null); onAlert?.('Category saved.') }
            catch (e) { onAlert?.('Error: ' + e.message) }
          }}
          onClose={() => setEditCategory(null)} />
      )}

      {editDiscount !== null && (
        <DiscountEditModal discount={editDiscount} categories={categories} catalog={catalog}
          onSave={async (d) => {
            try { await upsertMerchDiscount(d); await loadAll(); setEditDiscount(null); onAlert?.('Discount saved.') }
            catch (e) { onAlert?.('Error: ' + e.message) }
          }}
          onClose={() => setEditDiscount(null)} />
      )}

      {editLocation !== null && (
        <LocationEditModal location={editLocation}
          onSave={async (l) => {
            try { await upsertStockLocation(l); await loadAll(); setEditLocation(null); onAlert?.('Location saved.') }
            catch (e) { onAlert?.('Error: ' + e.message) }
          }}
          onClose={() => setEditLocation(null)} />
      )}

      {editVendor !== null && (
        <VendorEditModal vendor={editVendor}
          onSave={async (v) => {
            try { await upsertMerchVendor(v); await loadAll(); setEditVendor(null); onAlert?.('Vendor saved.') }
            catch (e) { onAlert?.('Error: ' + e.message) }
          }}
          onDelete={editVendor.id ? async () => {
            if (!confirm('Deactivate this vendor?')) return
            try { await deleteMerchVendor(editVendor.id); await loadAll(); setEditVendor(null); onAlert?.('Vendor deactivated.') }
            catch (e) { onAlert?.('Error: ' + e.message) }
          } : undefined}
          onClose={() => setEditVendor(null)} />
      )}

      {adjustModal && (
        <InventoryAdjustModal variant={adjustModal.variant} productName={adjustModal.productName}
          locations={locations} currentUser={currentUser}
          onClose={() => setAdjustModal(null)}
          onComplete={async () => { await loadAll(); setAdjustModal(null); onAlert?.('Inventory updated.') }}
          onAlert={onAlert} />
      )}

      {transferModal && (
        <InventoryTransferModal variant={transferModal.variant} productName={transferModal.productName}
          locations={locations} inventoryByVariant={inventoryByVariant}
          onClose={() => setTransferModal(null)}
          onComplete={async () => { await loadAll(); setTransferModal(null); onAlert?.('Transfer complete.') }}
          onAlert={onAlert} />
      )}

      {fulfillModal && (
        <FulfillOrderModal order={fulfillModal}
          onSave={async ({ trackingNumber, carrier, notes }) => {
            try {
              await fulfillMerchOrder(fulfillModal.id, { trackingNumber, carrier, notes })
              await loadAll(); setFulfillModal(null); onAlert?.('Order fulfilled.')
            } catch (e) { onAlert?.('Error: ' + e.message) }
          }}
          onClose={() => setFulfillModal(null)} />
      )}

      {purchaseOrderModal !== null && (
        <PurchaseOrderModal po={purchaseOrderModal} vendors={vendors} catalog={catalog} locations={locations}
          onSave={async (po) => {
            try { await createPurchaseOrder(po); await loadAll(); setPurchaseOrderModal(null); onAlert?.('Purchase order created.') }
            catch (e) { onAlert?.('Error: ' + e.message) }
          }}
          onClose={() => setPurchaseOrderModal(null)} />
      )}

      {receivePOModal && (
        <ReceivePOLineModal line={receivePOModal.line} locations={locations}
          onSave={async ({ qty, locationId, notes }) => {
            try {
              await receivePOLine(receivePOModal.line.id, qty, locationId, notes)
              await loadAll(); setReceivePOModal(null); onAlert?.(`Received ${qty} units.`)
            } catch (e) { onAlert?.('Error: ' + e.message) }
          }}
          onClose={() => setReceivePOModal(null)} />
      )}

      {returnModal && (
        <ReturnModal order={returnModal.order} item={returnModal.item}
          catalog={catalog} currentUser={currentUser}
          onClose={() => setReturnModal(null)}
          onComplete={async () => { await loadAll(); setReturnModal(null); onAlert?.('Return processed.') }}
          onAlert={onAlert} />
      )}

      {saleOpen && <MerchStaffSales currentUser={currentUser} users={users} setUsers={setUsers}
        setPayments={setPayments} onAlert={onAlert} onClose={() => setSaleOpen(false)} />}
    </div>
  )
}

// ─── ImageUploader ────────────────────────────────────────────
function ImageUploader({ images, onChange, maxImages = 5 }) {
  const [uploading, setUploading] = useState(false)
  const inputRef = useRef()
  const handleFiles = async files => {
    const toUpload = Array.from(files).slice(0, maxImages - images.length)
    if (!toUpload.length) return
    setUploading(true)
    try {
      const urls = await Promise.all(toUpload.map(f => uploadMerchImage(f)))
      onChange([...images, ...urls])
    } catch (e) { alert('Upload error: ' + e.message) }
    setUploading(false)
  }
  return (
    <div>
      <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap', marginBottom: '.4rem' }}>
        {images.map((url, i) => (
          <div key={i} style={{ position: 'relative', flexShrink: 0 }}>
            <img src={url} alt="" style={{ width: 72, height: 72, objectFit: 'cover', borderRadius: 6, border: '1px solid var(--bdr)', display: 'block' }} />
            <button type="button" style={{ position: 'absolute', top: -6, right: -6, background: 'var(--danger,#c33)', border: 'none', color: '#fff', borderRadius: '50%', width: 18, height: 18, cursor: 'pointer', fontSize: '.72rem', lineHeight: '18px', textAlign: 'center', padding: 0 }}
              onClick={() => onChange(images.filter((_, j) => j !== i))}>✕</button>
          </div>
        ))}
        {images.length < maxImages && (
          <button type="button" disabled={uploading}
            style={{ width: 72, height: 72, background: 'var(--bg2)', border: '2px dashed var(--bdr)', borderRadius: 6, cursor: uploading ? 'wait' : 'pointer', color: 'var(--muted)', fontSize: '.75rem', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '.15rem', flexShrink: 0 }}
            onClick={() => inputRef.current?.click()}>
            {uploading ? '…' : <><span style={{ fontSize: '1.1rem' }}>+</span><span>Image</span></>}
          </button>
        )}
      </div>
      <input ref={inputRef} type="file" accept="image/*" multiple style={{ display: 'none' }}
        onChange={e => { handleFiles(e.target.files); e.target.value = '' }} />
      <div style={{ fontSize: '.68rem', color: 'var(--muted)' }}>{images.length} / {maxImages} images · Click thumbnail ✕ to remove</div>
    </div>
  )
}

// ─── ProductEditModal ─────────────────────────────────────────
function ProductEditModal({ product, categories, onSave, onClose }) {
  const [form, setForm] = useState(() => {
    const base = { type: 'physical', name: '', description: '', sku: '', skuFamilyCode: '', basePrice: '',
      categoryId: '', imageUrls: [], storefrontVisible: true, staffVisible: true,
      shippable: true, pickupOnly: false, returnable: true, returnWindowDays: 30,
      restockable: true, returnPolicyNote: '', active: true, archived: false, sortOrder: 0,
      internalNotes: '',
      ...product }
    return {
      ...base,
      basePrice: product.basePrice != null ? String(product.basePrice) : '',
      imageUrls: product.imageUrls?.length ? product.imageUrls : (product.imageUrl ? [product.imageUrl] : []),
    }
  })
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
  const selectedCat = categories.find(c => c.id === form.categoryId)
  const suggestedSku = selectedCat?.skuCode && form.skuFamilyCode
    ? `${selectedCat.skuCode}-${form.skuFamilyCode}` : null
  return (
    <div className="mo"><div className="mc" style={{ maxWidth: 560, maxHeight: '85vh', overflowY: 'auto' }}>
      <div className="mt2">{product.id ? 'Edit Product' : 'New Product'}</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '.75rem', marginBottom: '.75rem' }}>
        <div className="f" style={{ gridColumn: '1/-1' }}><label>Name *</label><input value={form.name} onChange={e => set('name', e.target.value)} placeholder="Product name" /></div>
        <div className="f"><label>Type *</label>
          <select value={form.type} onChange={e => set('type', e.target.value)}>
            {Object.entries(TYPE_LABELS).filter(([k]) => k !== 'bundle').map(([k,v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div className="f"><label>Category</label>
          <select value={form.categoryId || ''} onChange={e => set('categoryId', e.target.value || null)}>
            <option value="">— None —</option>
            {categories.map(c => <option key={c.id} value={c.id}>{c.name}{c.skuCode ? ` [${c.skuCode}]` : ''}</option>)}
          </select>
        </div>
        <div className="f"><label>Base Price ($) *</label><input type="number" min="0" step="0.01" value={form.basePrice} onChange={e => set('basePrice', e.target.value)} placeholder="0.00" /></div>
        <div className="f">
          <label>Product Family Code <span style={{ fontWeight: 400, color: 'var(--muted)', fontSize: '.78rem' }}>2–8 chars (e.g. RAID, ICON, HPA)</span></label>
          <input value={form.skuFamilyCode || ''} maxLength={8} style={{ textTransform: 'uppercase', width: 120 }}
            onChange={e => {
              const v = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '')
              set('skuFamilyCode', v)
              if (selectedCat?.skuCode && v) set('sku', `${selectedCat.skuCode}-${v}`)
            }}
            placeholder="e.g. RAID" />
        </div>
        <div className="f">
          <label>Base SKU {suggestedSku && suggestedSku !== form.sku && (
            <button type="button" style={{ marginLeft: '.5rem', fontSize: '.72rem', padding: '1px 6px', cursor: 'pointer' }}
              onClick={() => set('sku', suggestedSku)}>Use {suggestedSku}</button>
          )}</label>
          <input value={form.sku || ''} style={{ textTransform: 'uppercase' }}
            onChange={e => set('sku', e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, ''))}
            placeholder={suggestedSku || 'e.g. APP-RAID'} />
        </div>
        <div className="f" style={{ gridColumn: '1/-1' }}><label>Description</label><textarea value={form.description || ''} onChange={e => set('description', e.target.value)} rows={2} style={{ resize: 'vertical' }} /></div>
        <div className="f" style={{ gridColumn: '1/-1' }}>
          <label>Images (up to 5)</label>
          <ImageUploader images={form.imageUrls} onChange={v => set('imageUrls', v)} />
        </div>
        <div className="f"><label>Sort Order</label><input type="number" value={form.sortOrder} onChange={e => set('sortOrder', parseInt(e.target.value) || 0)} /></div>
      </div>
      <div style={{ fontSize: '.8rem', color: 'var(--muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: '.5rem' }}>Visibility</div>
      <div style={{ display: 'flex', gap: '1.5rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
        {[['active','Active'],['storefrontVisible','On Storefront'],['staffVisible','Staff Sales'],['archived','Archived']].map(([k,lbl]) => (
          <label key={k} style={{ display: 'flex', alignItems: 'center', gap: '.4rem', fontSize: '.88rem', cursor: 'pointer' }}>
            <input type="checkbox" checked={!!form[k]} onChange={e => set(k, e.target.checked)} />{lbl}
          </label>
        ))}
      </div>
      {form.type === 'physical' && <>
        <div style={{ fontSize: '.8rem', color: 'var(--muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: '.5rem' }}>Shipping & Returns</div>
        <div style={{ display: 'flex', gap: '1.5rem', marginBottom: '.75rem', flexWrap: 'wrap' }}>
          {[['shippable','Shippable'],['pickupOnly','Pickup Only'],['returnable','Returnable'],['restockable','Restockable']].map(([k,lbl]) => (
            <label key={k} style={{ display: 'flex', alignItems: 'center', gap: '.4rem', fontSize: '.88rem', cursor: 'pointer' }}>
              <input type="checkbox" checked={!!form[k]} onChange={e => set(k, e.target.checked)} />{lbl}
            </label>
          ))}
        </div>
        {form.returnable && <div style={{ display: 'flex', gap: '.75rem' }}>
          <div className="f"><label>Return Window (days)</label><input type="number" min={0} value={form.returnWindowDays} onChange={e => set('returnWindowDays', parseInt(e.target.value) || 0)} /></div>
          <div className="f" style={{ flex: 2 }}><label>Return Policy Note</label><input value={form.returnPolicyNote || ''} onChange={e => set('returnPolicyNote', e.target.value)} placeholder="E.g. No returns on worn items." /></div>
        </div>}
      </>}
      {(form.type === 'physical' || form.type === 'bundle') && (
        <div className="f" style={{ marginTop: '.75rem' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '.4rem' }}>
            Internal Notes <span style={{ fontSize: '.75rem', color: 'var(--muted)', fontWeight: 400 }}>(staff only — never shown to customers)</span>
          </label>
          <textarea value={form.internalNotes || ''} onChange={e => set('internalNotes', e.target.value)}
            rows={3} style={{ resize: 'vertical' }} placeholder="Supplier notes, handling instructions, internal reminders…" />
        </div>
      )}
      <div className="ma" style={{ marginTop: '1rem' }}>
        <button className="btn btn-s" onClick={onClose}>Cancel</button>
        <button className="btn btn-p" disabled={!form.name || !form.basePrice}
          onClick={() => onSave({ ...form, basePrice: parseFloat(form.basePrice) || 0 })}>Save Product</button>
      </div>
    </div></div>
  )
}

// ─── VariantEditModal ─────────────────────────────────────────
function VariantEditModal({ variant, vendors = [], productSku = null, onSave, onDelete, onClose, onAddVendor }) {
  const [form, setForm] = useState(() => {
    const base = { label: '', sku: '', skuSuffix: '', priceOverride: '', shippingCharge: '0',
      storefrontVisible: true, staffVisible: true, active: true, sortOrder: 0,
      reorderPoint: '', reorderQty: '', cost: '', leadTimeDays: '', vendorId: '', vendorSku: '',
      ...variant }
    return { ...base,
      priceOverride:  variant.priceOverride  != null ? String(variant.priceOverride)  : '',
      shippingCharge: variant.shippingCharge != null ? String(variant.shippingCharge) : '0',
      reorderPoint:   variant.reorderPoint   != null ? String(variant.reorderPoint)   : '',
      reorderQty:     variant.reorderQty     != null ? String(variant.reorderQty)     : '',
      cost:           variant.cost           != null ? String(variant.cost)           : '',
      leadTimeDays:   variant.leadTimeDays   != null ? String(variant.leadTimeDays)   : '',
      vendorId:       variant.vendorId       ?? '',
      vendorSku:      variant.vendorSku      ?? '',
      skuSuffix:      variant.skuSuffix      ?? '',
    }
  })
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
  const suggestedSku = productSku && form.skuSuffix ? `${productSku}-${form.skuSuffix}` : null
  return (
    <div className="mo" onClick={onClose}><div className="mc" style={{ maxWidth: 480 }} onClick={e => e.stopPropagation()}>
      <div className="mt2">{variant.id ? 'Edit Variant' : 'New Variant'}</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '.75rem', marginBottom: '.75rem' }}>
        <div className="f" style={{ gridColumn: '1/-1' }}><label>Label *</label><input value={form.label} onChange={e => set('label', e.target.value)} placeholder='e.g. "Black / XL"' /></div>
        <div className="f">
          <label>SKU Suffix <span style={{ fontWeight: 400, color: 'var(--muted)', fontSize: '.78rem' }}>variant codes (e.g. BLK-LG, 68, 2000)</span></label>
          <input value={form.skuSuffix || ''} maxLength={20} style={{ textTransform: 'uppercase' }}
            onChange={e => {
              const v = e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, '')
              set('skuSuffix', v)
              if (productSku && v) set('sku', `${productSku}-${v}`)
            }}
            placeholder="e.g. BLK-LG" />
        </div>
        <div className="f">
          <label>Full SKU {suggestedSku && suggestedSku !== form.sku && (
            <button type="button" style={{ marginLeft: '.5rem', fontSize: '.72rem', padding: '1px 6px', cursor: 'pointer' }}
              onClick={() => set('sku', suggestedSku)}>Use {suggestedSku}</button>
          )}</label>
          <input value={form.sku || ''} style={{ textTransform: 'uppercase' }}
            onChange={e => set('sku', e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, ''))}
            placeholder={productSku ? `${productSku}-…` : 'e.g. APP-RAID-BLK-LG'} />
        </div>
        <div className="f"><label>Price Override ($)</label><input type="number" min="0" step="0.01" value={form.priceOverride} onChange={e => set('priceOverride', e.target.value)} placeholder="Leave blank = base price" /></div>
        <div className="f"><label>Shipping Charge ($)</label><input type="number" min="0" step="0.01" value={form.shippingCharge} onChange={e => set('shippingCharge', e.target.value)} /></div>
        <div className="f"><label>Sort Order</label><input type="number" value={form.sortOrder} onChange={e => set('sortOrder', parseInt(e.target.value) || 0)} /></div>
      </div>
      <div style={{ display: 'flex', gap: '1.5rem', marginBottom: '.75rem', flexWrap: 'wrap' }}>
        {[['active','Active'],['storefrontVisible','On Storefront'],['staffVisible','Staff Sales']].map(([k,lbl]) => (
          <label key={k} style={{ display: 'flex', alignItems: 'center', gap: '.4rem', fontSize: '.88rem', cursor: 'pointer' }}>
            <input type="checkbox" checked={!!form[k]} onChange={e => set(k, e.target.checked)} />{lbl}
          </label>
        ))}
      </div>
      {/* ── Inventory & Ordering ── */}
      <div style={{ borderTop: '1px solid var(--bdr)', paddingTop: '.75rem', marginBottom: '.75rem' }}>
        <div style={{ fontSize: '.78rem', fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: '.6rem' }}>Inventory &amp; Ordering</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '.75rem' }}>
          <div className="f"><label>Reorder Point</label><input type="number" min="0" value={form.reorderPoint} onChange={e => set('reorderPoint', e.target.value)} placeholder="Alert when qty ≤ this" /></div>
          <div className="f"><label>Reorder Qty</label><input type="number" min="0" value={form.reorderQty} onChange={e => set('reorderQty', e.target.value)} placeholder="Units to order" /></div>
          <div className="f"><label>Cost / Unit ($)</label><input type="number" min="0" step="0.0001" value={form.cost} onChange={e => set('cost', e.target.value)} placeholder="Your cost" /></div>
          <div className="f"><label>Lead Time (days)</label><input type="number" min="0" value={form.leadTimeDays} onChange={e => set('leadTimeDays', e.target.value)} placeholder="Delivery days" /></div>
          <div className="f" style={{ gridColumn: '1/-1' }}>
            <label>Vendor</label>
            <div style={{ display: 'flex', gap: '.4rem' }}>
              <select value={form.vendorId} onChange={e => set('vendorId', e.target.value)} style={{ flex: 1 }}>
                <option value="">— None —</option>
                {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select>
              {vendors.length === 0 && <span style={{ fontSize: '.72rem', color: 'var(--muted)', alignSelf: 'center' }}>Add vendors in Settings first</span>}
              {onAddVendor && <button type="button" className="btn btn-s btn-sm" style={{ fontSize: '.75rem', whiteSpace: 'nowrap' }} onClick={onAddVendor}>＋ Add</button>}
            </div>
          </div>
          {form.vendorId && (
            <div className="f" style={{ gridColumn: '1/-1' }}>
              <label>Vendor SKU</label>
              <input value={form.vendorSku} onChange={e => set('vendorSku', e.target.value)} placeholder="Supplier's part number" />
            </div>
          )}
        </div>
      </div>
      <div className="ma" style={{ justifyContent: onDelete ? 'space-between' : 'flex-end', marginTop: '.5rem' }}>
        {onDelete && <button className="btn btn-d btn-sm" style={{ fontSize: '.8rem' }} onClick={onDelete}>Delete Variant</button>}
        <div style={{ display: 'flex', gap: '.5rem' }}>
          <button className="btn btn-s" onClick={onClose}>Cancel</button>
          <button className="btn btn-p" disabled={!form.label}
            onClick={() => onSave({
              ...form,
              priceOverride:  form.priceOverride  !== '' ? parseFloat(form.priceOverride)  : null,
              shippingCharge: parseFloat(form.shippingCharge) || 0,
              vendorId:       form.vendorId || null,
              vendorSku:      form.vendorSku || null,
            })}>Save Variant</button>
        </div>
      </div>
    </div></div>
  )
}

// ─── FulfillOrderModal ───────────────────────────────────────
function FulfillOrderModal({ order, onSave, onClose }) {
  const isShip = order.fulfillmentType === 'ship'
  const [trackingNumber, setTrackingNumber] = useState('')
  const [carrier, setCarrier] = useState('')
  const [notes, setNotes] = useState('')
  return (
    <div className="mo" onClick={onClose}><div className="mc" style={{ maxWidth: 400 }} onClick={e => e.stopPropagation()}>
      <div className="mt2">Mark Fulfilled — {order.customerName}</div>
      <div style={{ fontSize: '.85rem', color: 'var(--muted)', marginBottom: '1rem' }}>
        {isShip ? '📦 Shipment' : '🏪 Pickup'} · {order.items?.length || 0} item(s)
      </div>
      {isShip && <>
        <div className="f"><label>Carrier</label>
          <select value={carrier} onChange={e => setCarrier(e.target.value)}>
            <option value="">— Select —</option>
            {['UPS','FedEx','USPS','DHL','Other'].map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div className="f"><label>Tracking Number</label>
          <input value={trackingNumber} onChange={e => setTrackingNumber(e.target.value)} placeholder="1Z999AA10123456784" />
        </div>
      </>}
      <div className="f"><label>Notes</label>
        <input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Optional fulfillment notes" />
      </div>
      <div className="ma">
        <button className="btn btn-s" onClick={onClose}>Cancel</button>
        <button className="btn btn-ok" disabled={isShip && !trackingNumber}
          onClick={() => onSave({ trackingNumber: trackingNumber || null, carrier: carrier || null, notes: notes || null })}>
          Confirm Fulfilled
        </button>
      </div>
    </div></div>
  )
}

// ─── InventoryTransferModal ───────────────────────────────────
function InventoryTransferModal({ variant, productName, locations, inventoryByVariant, onClose, onComplete, onAlert }) {
  const vLocs = (inventoryByVariant[variant.id] || []).filter(l => l.quantity > 0)
  const [fromLocationId, setFromLocationId] = useState(vLocs[0]?.locationId || '')
  const [toLocationId, setToLocationId] = useState('')
  const [qty, setQty] = useState('')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const fromQty = vLocs.find(l => l.locationId === fromLocationId)?.quantity || 0

  const doTransfer = async () => {
    const q = parseInt(qty)
    if (!q || q <= 0 || !fromLocationId || !toLocationId) return
    if (fromLocationId === toLocationId) { onAlert?.('Source and destination must differ.'); return }
    setBusy(true)
    try {
      await transferMerchInventory(variant.id, fromLocationId, toLocationId, q, notes || null)
      await onComplete()
    } catch (e) { onAlert?.('Error: ' + e.message) }
    setBusy(false)
  }

  return (
    <div className="mo" onClick={onClose}><div className="mc" style={{ maxWidth: 380 }} onClick={e => e.stopPropagation()}>
      <div className="mt2">Transfer Stock</div>
      <div style={{ fontSize: '.88rem', color: 'var(--muted)', marginBottom: '1rem' }}>{productName} · {variant.label}</div>
      <div className="f"><label>From Location</label>
        <select value={fromLocationId} onChange={e => setFromLocationId(e.target.value)}>
          {vLocs.map(l => <option key={l.locationId} value={l.locationId}>{l.locationName} ({l.quantity} avail.)</option>)}
        </select>
      </div>
      <div className="f"><label>To Location</label>
        <select value={toLocationId} onChange={e => setToLocationId(e.target.value)}>
          <option value="">— Select —</option>
          {locations.filter(l => l.id !== fromLocationId).map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
      </div>
      <div className="f"><label>Quantity</label>
        <input type="number" min="1" max={fromQty} value={qty} onChange={e => setQty(e.target.value)} placeholder={`Max ${fromQty}`} />
      </div>
      <div className="f"><label>Notes</label>
        <input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Optional" />
      </div>
      <div className="ma">
        <button className="btn btn-s" onClick={onClose}>Cancel</button>
        <button className="btn btn-p" disabled={busy || !qty || !fromLocationId || !toLocationId}
          onClick={doTransfer}>{busy ? 'Transferring…' : 'Transfer'}</button>
      </div>
    </div></div>
  )
}

// ─── PurchaseOrderModal ───────────────────────────────────────
function PurchaseOrderModal({ po, vendors, catalog, locations, onSave, onClose }) {
  const defaultLocId = locations.find(l => l.isDefault)?.id || locations[0]?.id || ''
  const [vendorId, setVendorId] = useState(po.vendorId || '')
  const [expectedBy, setExpectedBy] = useState(po.expectedBy || '')
  const [notes, setNotes] = useState(po.notes || '')
  const [lines, setLines] = useState(po.lines || [{ variantId: '', qtyOrdered: 1, unitCost: '', receiveLocationId: defaultLocId }])

  // Flat list of all variants for picker
  const allVariants = catalog.flatMap(p => p.variants.map(v => ({ id: v.id, label: `${p.name} — ${v.label}`, sku: v.sku })))

  const addLine = () => setLines(l => [...l, { variantId: '', qtyOrdered: 1, unitCost: '', receiveLocationId: defaultLocId }])
  const removeLine = i => setLines(l => l.filter((_, idx) => idx !== i))
  const setLine = (i, k, v) => setLines(l => l.map((line, idx) => idx === i ? { ...line, [k]: v } : line))

  const canSave = vendorId && lines.length > 0 && lines.every(l => l.variantId && l.qtyOrdered > 0)

  return (
    <div className="mo" onClick={onClose}><div className="mc" style={{ maxWidth: 560 }} onClick={e => e.stopPropagation()}>
      <div className="mt2">Create Purchase Order</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '.75rem', marginBottom: '.75rem' }}>
        <div className="f" style={{ gridColumn: '1/-1' }}><label>Vendor *</label>
          <select value={vendorId} onChange={e => setVendorId(e.target.value)}>
            <option value="">— Select Vendor —</option>
            {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
        </div>
        <div className="f"><label>Expected Delivery</label><input type="date" value={expectedBy} onChange={e => setExpectedBy(e.target.value)} /></div>
        <div className="f"><label>Notes</label><input value={notes} onChange={e => setNotes(e.target.value)} /></div>
      </div>
      <div style={{ fontSize: '.78rem', fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: '.5rem' }}>Line Items</div>
      {lines.map((line, i) => (
        <div key={i} style={{ display: 'grid', gridTemplateColumns: '2fr 60px 90px 1fr 28px', gap: '.4rem', marginBottom: '.4rem', alignItems: 'end' }}>
          <div className="f" style={{ marginBottom: 0 }}>
            <select value={line.variantId} onChange={e => setLine(i, 'variantId', e.target.value)} style={{ fontSize: '.82rem' }}>
              <option value="">— Variant —</option>
              {allVariants.map(v => <option key={v.id} value={v.id}>{v.label}{v.sku ? ` (${v.sku})` : ''}</option>)}
            </select>
          </div>
          <div className="f" style={{ marginBottom: 0 }}><input type="number" min="1" value={line.qtyOrdered} onChange={e => setLine(i, 'qtyOrdered', parseInt(e.target.value) || 1)} placeholder="Qty" /></div>
          <div className="f" style={{ marginBottom: 0 }}><input type="number" min="0" step="0.01" value={line.unitCost} onChange={e => setLine(i, 'unitCost', e.target.value)} placeholder="Cost $" /></div>
          <div className="f" style={{ marginBottom: 0 }}>
            <select value={line.receiveLocationId} onChange={e => setLine(i, 'receiveLocationId', e.target.value)} style={{ fontSize: '.82rem' }}>
              {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </div>
          <button type="button" className="btn btn-d btn-sm" style={{ fontSize: '.75rem', padding: '3px 7px' }} onClick={() => removeLine(i)}>✕</button>
        </div>
      ))}
      <button type="button" className="btn btn-s btn-sm" style={{ fontSize: '.78rem', marginBottom: '.75rem' }} onClick={addLine}>+ Add Line</button>
      <div className="ma">
        <button className="btn btn-s" onClick={onClose}>Cancel</button>
        <button className="btn btn-p" disabled={!canSave}
          onClick={() => onSave({
            vendorId,
            expectedBy: expectedBy || null,
            notes: notes || null,
            lines: lines.map(l => ({
              variant_id: l.variantId,
              qty_ordered: parseInt(l.qtyOrdered) || 1,
              unit_cost: l.unitCost !== '' ? l.unitCost : null,
              receive_location_id: l.receiveLocationId || null,
            }))
          })}>Create PO</button>
      </div>
    </div></div>
  )
}

// ─── ReceivePOLineModal ───────────────────────────────────────
function ReceivePOLineModal({ line, locations, onSave, onClose }) {
  const remaining = line.qtyOrdered - line.qtyReceived
  const defaultLocId = line.receiveLocationId || locations.find(l => l.isDefault)?.id || locations[0]?.id || ''
  const [qty, setQty] = useState(String(remaining))
  const [locationId, setLocationId] = useState(defaultLocId)
  const [notes, setNotes] = useState('')
  return (
    <div className="mo" onClick={onClose}><div className="mc" style={{ maxWidth: 360 }} onClick={e => e.stopPropagation()}>
      <div className="mt2">Receive Stock</div>
      <div style={{ fontSize: '.88rem', color: 'var(--muted)', marginBottom: '1rem' }}>
        <strong>{line.productName}</strong> · {line.variantLabel}<br />
        Ordered: {line.qtyOrdered} · Already received: {line.qtyReceived} · Remaining: {remaining}
      </div>
      <div className="f"><label>Qty to Receive *</label>
        <input type="number" min="1" max={remaining} value={qty} onChange={e => setQty(e.target.value)} />
      </div>
      <div className="f"><label>Stock into Location *</label>
        <select value={locationId} onChange={e => setLocationId(e.target.value)}>
          {locations.map(l => <option key={l.id} value={l.id}>{l.name}{l.isDefault ? ' (default)' : ''}</option>)}
        </select>
      </div>
      <div className="f"><label>Notes</label>
        <input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Optional receiving notes" />
      </div>
      <div className="ma">
        <button className="btn btn-s" onClick={onClose}>Cancel</button>
        <button className="btn btn-ok" disabled={!qty || parseInt(qty) <= 0 || !locationId}
          onClick={() => onSave({ qty: parseInt(qty), locationId, notes: notes || null })}>Receive</button>
      </div>
    </div></div>
  )
}

// ─── VendorEditModal ──────────────────────────────────────────
function VendorEditModal({ vendor, onSave, onDelete, onClose }) {
  const [form, setForm] = useState({ name: '', email: '', phone: '', website: '', notes: '', active: true, ...vendor })
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
  return (
    <div className="mo" onClick={onClose}><div className="mc" style={{ maxWidth: 420 }} onClick={e => e.stopPropagation()}>
      <div className="mt2">{vendor.id ? 'Edit Vendor' : 'Add Vendor'}</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '.75rem', marginBottom: '.75rem' }}>
        <div className="f" style={{ gridColumn: '1/-1' }}><label>Name *</label><input value={form.name} onChange={e => set('name', e.target.value)} /></div>
        <div className="f"><label>Email</label><input type="email" value={form.email || ''} onChange={e => set('email', e.target.value)} /></div>
        <div className="f"><label>Phone</label><input value={form.phone || ''} onChange={e => set('phone', e.target.value)} /></div>
        <div className="f" style={{ gridColumn: '1/-1' }}><label>Website</label><input value={form.website || ''} onChange={e => set('website', e.target.value)} placeholder="https://..." /></div>
        <div className="f" style={{ gridColumn: '1/-1' }}><label>Notes</label><textarea rows={2} value={form.notes || ''} onChange={e => set('notes', e.target.value)} style={{ resize: 'vertical' }} /></div>
      </div>
      <div style={{ display: 'flex', gap: '1rem', marginBottom: '.75rem' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: '.4rem', fontSize: '.88rem', cursor: 'pointer' }}>
          <input type="checkbox" checked={!!form.active} onChange={e => set('active', e.target.checked)} />Active
        </label>
      </div>
      <div className="ma" style={{ justifyContent: onDelete ? 'space-between' : 'flex-end' }}>
        {onDelete && <button className="btn btn-d btn-sm" style={{ fontSize: '.8rem' }} onClick={onDelete}>Deactivate</button>}
        <div style={{ display: 'flex', gap: '.5rem' }}>
          <button className="btn btn-s" onClick={onClose}>Cancel</button>
          <button className="btn btn-p" disabled={!form.name} onClick={() => onSave(form)}>Save Vendor</button>
        </div>
      </div>
    </div></div>
  )
}

// ─── CategoryEditModal ────────────────────────────────────────
function CategoryEditModal({ category, onSave, onClose }) {
  const [form, setForm] = useState({ name: '', slug: '', skuCode: '', sortOrder: 0, active: true, storefrontVisible: true, staffVisible: true, ...category })
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
  return (
    <div className="mo" onClick={onClose}><div className="mc" style={{ maxWidth: 380 }} onClick={e => e.stopPropagation()}>
      <div className="mt2">{category.id ? 'Edit Category' : 'New Category'}</div>
      <div style={{ marginBottom: '.75rem' }}>
        <div className="f"><label>Name *</label><input value={form.name} onChange={e => set('name', e.target.value)} /></div>
        <div className="f">
          <label>SKU Code <span style={{ fontWeight: 400, color: 'var(--muted)', fontSize: '.78rem' }}>2–6 chars, uppercase — first segment of every product SKU in this category (e.g. APP, HDR, TNK)</span></label>
          <input value={form.skuCode || ''} maxLength={6} style={{ textTransform: 'uppercase', width: 100 }}
            onChange={e => set('skuCode', e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
            placeholder="e.g. APP" />
        </div>
        <div className="f"><label>Slug</label><input value={form.slug || ''} onChange={e => set('slug', e.target.value)} placeholder="Auto-generated if blank" /></div>
        <div className="f"><label>Sort Order</label><input type="number" value={form.sortOrder} onChange={e => set('sortOrder', parseInt(e.target.value) || 0)} /></div>
      </div>
      <div style={{ display: 'flex', gap: '1.5rem', marginBottom: '1rem' }}>
        {[['active','Active'],['storefrontVisible','Storefront'],['staffVisible','Staff']].map(([k,lbl]) => (
          <label key={k} style={{ display: 'flex', alignItems: 'center', gap: '.4rem', fontSize: '.88rem', cursor: 'pointer' }}>
            <input type="checkbox" checked={!!form[k]} onChange={e => set(k, e.target.checked)} />{lbl}
          </label>
        ))}
      </div>
      <div className="ma">
        <button className="btn btn-s" onClick={onClose}>Cancel</button>
        <button className="btn btn-p" disabled={!form.name} onClick={() => onSave(form)}>Save</button>
      </div>
    </div></div>
  )
}

// ─── DiscountEditModal ────────────────────────────────────────
function DiscountEditModal({ discount, categories, catalog, onSave, onClose }) {
  const [form, setForm] = useState(() => {
    const base = { code: '', description: '', discountType: 'percent', amount: '',
      appliesTo: 'all', categoryId: '', productId: '', active: true,
      usageLimit: '', startsAt: '', endsAt: '', channel: 'both', ...discount }
    return { ...base,
      amount: discount.amount != null ? String(discount.amount) : '',
      usageLimit: discount.usageLimit != null ? String(discount.usageLimit) : '' }
  })
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
  return (
    <div className="mo" onClick={onClose}><div className="mc" style={{ maxWidth: 460 }} onClick={e => e.stopPropagation()}>
      <div className="mt2">{discount.id ? 'Edit Discount' : 'New Discount'}</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '.75rem', marginBottom: '.75rem' }}>
        <div className="f"><label>Code *</label><input value={form.code} onChange={e => set('code', e.target.value.toUpperCase())} placeholder="SAVE10" /></div>
        <div className="f"><label>Channel</label>
          <select value={form.channel} onChange={e => set('channel', e.target.value)}>
            <option value="both">Both</option><option value="online">Online Only</option><option value="staff">Staff Only</option>
          </select>
        </div>
        <div className="f"><label>Type</label>
          <select value={form.discountType} onChange={e => set('discountType', e.target.value)}>
            <option value="percent">Percent Off</option><option value="fixed">Fixed Amount</option>
          </select>
        </div>
        <div className="f"><label>Amount *</label><input type="number" min="0" step="0.01" value={form.amount} onChange={e => set('amount', e.target.value)} placeholder={form.discountType === 'percent' ? '10 = 10%' : '5.00'} /></div>
        <div className="f"><label>Applies To</label>
          <select value={form.appliesTo} onChange={e => set('appliesTo', e.target.value)}>
            <option value="all">All Products</option><option value="category">Category</option><option value="product">Specific Product</option>
          </select>
        </div>
        {form.appliesTo === 'category' && <div className="f"><label>Category</label>
          <select value={form.categoryId || ''} onChange={e => set('categoryId', e.target.value || null)}>
            <option value="">— Select —</option>
            {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>}
        {form.appliesTo === 'product' && <div className="f"><label>Product</label>
          <select value={form.productId || ''} onChange={e => set('productId', e.target.value || null)}>
            <option value="">— Select —</option>
            {catalog.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>}
        <div className="f"><label>Usage Limit</label><input type="number" min="0" value={form.usageLimit} onChange={e => set('usageLimit', e.target.value)} placeholder="Unlimited" /></div>
        <div className="f"><label>Starts At</label><input type="datetime-local" value={form.startsAt || ''} onChange={e => set('startsAt', e.target.value || null)} /></div>
        <div className="f"><label>Ends At</label><input type="datetime-local" value={form.endsAt || ''} onChange={e => set('endsAt', e.target.value || null)} /></div>
        <div className="f" style={{ gridColumn: '1/-1' }}><label>Description</label><input value={form.description || ''} onChange={e => set('description', e.target.value)} /></div>
      </div>
      <label style={{ display: 'flex', alignItems: 'center', gap: '.4rem', fontSize: '.88rem', marginBottom: '1rem', cursor: 'pointer' }}>
        <input type="checkbox" checked={!!form.active} onChange={e => set('active', e.target.checked)} />Active
      </label>
      <div className="ma">
        <button className="btn btn-s" onClick={onClose}>Cancel</button>
        <button className="btn btn-p" disabled={!form.code || !form.amount}
          onClick={() => onSave({ ...form, amount: parseFloat(form.amount) || 0, usageLimit: form.usageLimit ? parseInt(form.usageLimit) : null })}>Save</button>
      </div>
    </div></div>
  )
}

// ─── LocationEditModal ────────────────────────────────────────
function LocationEditModal({ location, onSave, onClose }) {
  const [form, setForm] = useState({ name: '', levelLabels: { l1: 'Location' }, isDefault: false, active: true, ...location })
  const [labelsStr, setLabelsStr] = useState(JSON.stringify(location.levelLabels || { l1: 'Location' }, null, 2))
  return (
    <div className="mo" onClick={onClose}><div className="mc" style={{ maxWidth: 380 }} onClick={e => e.stopPropagation()}>
      <div className="mt2">{location.id ? 'Edit Location' : 'New Location'}</div>
      <div className="f"><label>Name *</label><input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} /></div>
      <div className="f"><label>Level Labels (JSON)</label>
        <textarea rows={4} value={labelsStr} onChange={e => setLabelsStr(e.target.value)}
          style={{ fontFamily: 'monospace', fontSize: '.82rem', resize: 'vertical' }}
          placeholder={'{"l1":"Room","l2":"Shelf","l3":"Bin"}'} />
        <div style={{ fontSize: '.72rem', color: 'var(--muted)' }}>Keys l1–l5 define hierarchy levels.</div>
      </div>
      <div style={{ display: 'flex', gap: '1.5rem', marginBottom: '1rem' }}>
        {[['active','Active'],['isDefault','Default Location']].map(([k,lbl]) => (
          <label key={k} style={{ display: 'flex', alignItems: 'center', gap: '.4rem', fontSize: '.88rem', cursor: 'pointer' }}>
            <input type="checkbox" checked={!!form[k]} onChange={e => setForm(f => ({ ...f, [k]: e.target.checked }))} />{lbl}
          </label>
        ))}
      </div>
      <div className="ma">
        <button className="btn btn-s" onClick={onClose}>Cancel</button>
        <button className="btn btn-p" disabled={!form.name}
          onClick={() => {
            let labels = {}; try { labels = JSON.parse(labelsStr) } catch { onAlert?.('Invalid JSON for level labels'); return }
            onSave({ ...form, levelLabels: labels })
          }}>Save</button>
      </div>
    </div></div>
  )
}

// ─── InventoryAdjustModal ─────────────────────────────────────
function InventoryAdjustModal({ variant, productName, locations, currentUser, onClose, onComplete, onAlert }) {
  const [locationId, setLocationId] = useState(locations.find(l => l.isDefault)?.id || locations[0]?.id || '')
  const [qtyChange, setQtyChange] = useState('')
  const [txType, setTxType] = useState('restock')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const TX_TYPES = ['restock','manual_adjustment','damage','correction','transfer']

  const doAdjust = async () => {
    const qty = parseInt(qtyChange)
    if (!qty || !locationId) return
    setBusy(true)
    try {
      await adjustMerchInventory(variant.id, locationId, qty, txType, notes || null, currentUser?.id || null)
      await onComplete()
    } catch (e) { onAlert?.('Error: ' + e.message) }
    setBusy(false)
  }

  return (
    <div className="mo" onClick={onClose}><div className="mc" style={{ maxWidth: 380 }} onClick={e => e.stopPropagation()}>
      <div className="mt2">Adjust Inventory</div>
      <div style={{ fontSize: '.88rem', color: 'var(--muted)', marginBottom: '1rem' }}>{productName} · {variant.label}</div>
      <div style={{ marginBottom: '.75rem', fontSize: '.9rem' }}>Current: <strong style={{ color: 'var(--acc)' }}>{variant.inventory}</strong> in stock</div>
      <div className="f"><label>Location</label>
        <select value={locationId} onChange={e => setLocationId(e.target.value)}>
          {locations.map(l => <option key={l.id} value={l.id}>{l.name}{l.isDefault ? ' (default)' : ''}</option>)}
        </select>
      </div>
      <div className="f"><label>Quantity Change</label>
        <input type="number" value={qtyChange} onChange={e => setQtyChange(e.target.value)} placeholder="+10 to add, -5 to remove" /></div>
      <div className="f"><label>Type</label>
        <select value={txType} onChange={e => setTxType(e.target.value)}>
          {TX_TYPES.map(t => <option key={t} value={t}>{t.replace(/_/g,' ')}</option>)}
        </select>
      </div>
      <div className="f"><label>Notes</label><input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Optional" /></div>
      <div className="ma">
        <button className="btn btn-s" onClick={onClose}>Cancel</button>
        <button className="btn btn-p" disabled={!qtyChange || !locationId || busy} onClick={doAdjust}>{busy ? 'Saving…' : 'Adjust'}</button>
      </div>
    </div></div>
  )
}

// ─── ReturnModal ──────────────────────────────────────────────
function ReturnModal({ order, item, catalog, currentUser, onClose, onComplete, onAlert }) {
  const product = catalog.find(p => p.id === item.productId)
  const [quantity, setQuantity] = useState(item.quantity)
  const [reason, setReason] = useState('')
  const [disposition, setDisposition] = useState('restock_sellable')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)

  const doReturn = async () => {
    if (!reason) return
    setBusy(true)
    try {
      await processMerchReturn({
        orderId: order.id, orderItemId: item.id, quantity, reason, disposition,
        notes: notes || null, createdBy: currentUser?.id || null,
      })
      await onComplete()
    } catch (e) { onAlert?.('Error: ' + e.message) }
    setBusy(false)
  }

  return (
    <div className="mo" onClick={onClose}><div className="mc" style={{ maxWidth: 420 }} onClick={e => e.stopPropagation()}>
      <div className="mt2">Process Return</div>
      <div style={{ fontSize: '.88rem', color: 'var(--muted)', marginBottom: '1rem' }}>{product?.name || 'Item'} · Ordered: {item.quantity}</div>
      {product && !product.returnable && <div style={{ background: 'rgba(220,50,47,.1)', border: '1px solid var(--danger)', borderRadius: 6, padding: '.65rem 1rem', fontSize: '.85rem', color: 'var(--danger)', marginBottom: '1rem' }}>
        ⚠ This product is marked non-returnable.{product.returnPolicyNote ? ' ' + product.returnPolicyNote : ''}
      </div>}
      <div className="f"><label>Return Quantity</label>
        <input type="number" min={1} max={item.quantity} value={quantity} onChange={e => setQuantity(Math.max(1, Math.min(item.quantity, parseInt(e.target.value) || 1)))} />
      </div>
      <div className="f"><label>Reason *</label><input value={reason} onChange={e => setReason(e.target.value)} placeholder="Customer reason for return" /></div>
      <div className="f"><label>Disposition</label>
        <select value={disposition} onChange={e => setDisposition(e.target.value)}>
          {Object.entries(DISPOSITION_LABELS).map(([k,v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>
      <div className="f"><label>Notes</label><input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Internal notes" /></div>
      <div className="ma">
        <button className="btn btn-s" onClick={onClose}>Cancel</button>
        <button className="btn btn-p" disabled={!reason || busy} onClick={doReturn}>{busy ? 'Processing…' : 'Process Return'}</button>
      </div>
    </div></div>
  )
}

// ================================================================
// MERCH STAFF SALES
// ================================================================
export function MerchStaffSales({ currentUser, users, setUsers, setPayments, onAlert, onClose }) {
  const [catalog, setCatalog] = useState([])
  const [categories, setCategories] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [catFilter, setCatFilter] = useState('')
  const [cart, setCart] = useState([])
  const [variantModal, setVariantModal] = useState(null)
  const [step, setStep] = useState('lookup') // lookup | email-collect | auth-prompt | awaiting | browse | payment | receipt
  const [customerPhone, setCustomerPhone] = useState('')
  const [customerName, setCustomerName] = useState('')
  const [lookupStatus, setLookupStatus] = useState('idle') // idle | searching | found | notfound
  const [foundUserId, setFoundUserId] = useState(null)
  const [foundUser, setFoundUser] = useState(null)
  const [authEmail, setAuthEmail] = useState('')
  const [emailSending, setEmailSending] = useState(false)
  const [discountCode, setDiscountCode] = useState('')
  const [appliedDiscount, setAppliedDiscount] = useState(null)
  const [discountErr, setDiscountErr] = useState('')
  const [cardLast4, setCardLast4] = useState('')
  const [cardExpiry, setCardExpiry] = useState('')
  const [cardHolder, setCardHolder] = useState('')
  const [applyCredits, setApplyCredits] = useState(false)
  const [saving, setSaving] = useState(false)
  const [completedPayment, setCompletedPayment] = useState(null)
  const handleCardExpiry = e => { const d = e.target.value.replace(/\D/g, '').slice(0, 4); setCardExpiry(d.length > 2 ? d.slice(0, 2) + '/' + d.slice(2) : d) }

  useEffect(() => {
    Promise.all([fetchMerchCatalog('staff'), fetchMerchCategories()])
      .then(([p, c]) => { setCatalog(p); setCategories(c) })
      .catch(e => onAlert?.('Error loading catalog: ' + e.message))
      .finally(() => setLoading(false))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const filteredCatalog = useMemo(() =>
    catalog.filter(p =>
      (!catFilter || p.categoryId === catFilter) &&
      (!search || p.name.toLowerCase().includes(search.toLowerCase()) || (p.sku || '').toLowerCase().includes(search.toLowerCase()))
    ), [catalog, search, catFilter]
  )

  const cartTotal = useMemo(() => cart.reduce((s, i) => s + i.price * i.qty, 0), [cart])
  const discountAmount = useMemo(() => {
    if (!appliedDiscount) return 0
    return appliedDiscount.discountType === 'percent'
      ? cartTotal * appliedDiscount.amount / 100
      : Math.min(appliedDiscount.amount, cartTotal)
  }, [appliedDiscount, cartTotal])
  const finalTotal = Math.max(cartTotal - discountAmount, 0)
  const customerCredits = (foundUserId && users ? (users.find(u => u.id === foundUserId)?.credits ?? 0) : 0)
  const staffCreditsApplied = applyCredits ? Math.min(customerCredits, finalTotal) : 0
  const staffAmountDue = finalTotal - staffCreditsApplied

  const addToCart = (item) => {
    setCart(prev => {
      const key = `${item.productId}::${item.variantId || ''}`
      const existing = prev.find(i => `${i.productId}::${i.variantId || ''}` === key)
      if (existing) return prev.map(i => `${i.productId}::${i.variantId || ''}` === key ? { ...i, qty: i.qty + item.qty } : i)
      return [...prev, { ...item, key }]
    })
  }

  const lookupPhone = async () => {
    const ph = cleanPh(customerPhone)
    if (ph.length < 10) return
    setLookupStatus('searching')
    try {
      const found = await fetchUserByPhone(ph)
      if (found) {
        setFoundUser(found); setFoundUserId(found.id)
        setCustomerName(found.name || customerName)
        setLookupStatus('found')
      } else {
        setFoundUser(null); setFoundUserId(null)
        setLookupStatus('notfound')
      }
    } catch { setFoundUser(null); setLookupStatus('notfound') }
  }

  const doLookupContinue = () => {
    if (lookupStatus === 'notfound') { setStep('auth-prompt'); return }
    if (!foundUser) return
    const social = foundUser.authProvider && foundUser.authProvider !== 'email'
    if (social && foundUser.email) { setStep('browse'); return }
    if (social && !foundUser.email) { setAuthEmail(''); setStep('email-collect'); return }
    setAuthEmail(foundUser.email || '')
    setStep('auth-prompt')
  }

  const doSaveEmail = async () => {
    if (!authEmail.trim() || emailSending) return
    setEmailSending(true)
    try {
      await linkOAuthUser(foundUserId, null, authEmail.trim(), foundUser.authProvider)
      if (setUsers) setUsers(prev => prev.map(u => u.id === foundUserId ? { ...u, email: authEmail.trim() } : u))
      setStep('browse')
    } catch (e) { onAlert?.('Error saving email: ' + e.message) }
    setEmailSending(false)
  }

  const doSendAuthInvite = async () => {
    if (!authEmail.trim() || !customerName.trim() || emailSending) return
    setEmailSending(true)
    try {
      let userId = foundUserId
      if (!userId) {
        const ph = cleanPh(customerPhone)
        const guest = await createGuestUser({ name: customerName.trim(), phone: ph.length === 10 ? ph : null, createdByUserId: currentUser?.id || null })
        userId = guest.id; setFoundUserId(userId)
        if (setUsers) setUsers(prev => [...prev, guest])
      }
      await linkOAuthUser(userId, null, authEmail.trim(), 'email')
      if (setUsers) setUsers(prev => prev.map(u => u.id === userId
        ? { ...u, email: authEmail.trim(), authProvider: u.authProvider ?? 'email' } : u))
      await emailSocialAuthInvite(userId, { recipientName: customerName.trim() })
      setStep('awaiting')
    } catch (e) { onAlert?.('Error: ' + e.message) }
    setEmailSending(false)
  }

  const applyDiscount = async () => {
    setDiscountErr('')
    try {
      const d = await validateMerchDiscount(discountCode, 'staff')
      if (!d) { setDiscountErr('Code not found or expired.'); return }
      setAppliedDiscount(d)
    } catch (e) { setDiscountErr('Error: ' + e.message) }
  }

  const doCheckout = async () => {
    if (!customerName.trim()) return
    setSaving(true)
    try {
      let userId = foundUserId
      if (!userId) {
        const ph = cleanPh(customerPhone)
        const guest = await createGuestUser({ name: customerName.trim(), phone: ph.length === 10 ? ph : null, createdByUserId: currentUser?.id || null })
        userId = guest.id
        if (setUsers) setUsers(prev => [...prev, guest])
      }

      const items = cart.map(i => ({
        product_id: i.productId, variant_id: i.variantId || '',
        quantity: i.qty, unit_price: i.price,
        discount_amount: 0, product_type: i.type,
      }))

      const order = await createMerchOrder({
        userId, customerName: customerName.trim(), fulfillmentType: 'pickup',
        shippingAddress: null, items,
        discountId: appliedDiscount?.id || null,
        discountAmount, shippingCharge: 0, notes: null,
      })

      const txn = await processPayment({ amount: staffAmountDue, mode: 'card_present', card: { last4: cardLast4, expiry: cardExpiry, holder: cardHolder } })
      if (!txn.ok) throw new Error('Terminal declined')
      const snapshot = {
        type: 'merch', customerName: customerName.trim(),
        items: cart.map(i => ({ name: i.productName, variant: i.variantLabel, qty: i.qty, unitPrice: i.price })),
        discount: discountAmount || undefined, shipping: 0, fulfillmentType: 'pickup',
        refNum: order.id.replace(/-/g, '').slice(0, 12).toUpperCase(),
        transactionAt: new Date().toISOString(),
        cardLast4: txn.last4,
        cardExpiry: txn.expiry,
        cardHolder: txn.holder || customerName.trim(),
        giftCodes: (order.giftCodes || []).map(g => ({ code: g.code, type: g.type })),
      }

      const payment = await createPayment({
        userId, reservationId: null, merchOrderId: order.id,
        customerName: customerName.trim(), amount: order.total, status: 'paid', snapshot,
      })

      if (setPayments) setPayments(prev => [payment, ...prev])
      if (staffCreditsApplied > 0) {
        try {
          const newBal = await deductUserCredits(userId, staffCreditsApplied)
          if (setUsers) setUsers(prev => prev.map(u => u.id === userId ? { ...u, credits: newBal } : u))
        } catch (credErr) { console.warn('Credits deduction error:', credErr.message) }
      }
      setCompletedPayment(payment)
      setStep('receipt')
      emailMerchPurchase(userId, {
        orderRef: snapshot.refNum,
        items: cart.map(i => ({ name: i.productName + (i.variantLabel ? ' — ' + i.variantLabel : ''), qty: i.qty, price: i.price })),
        total: order.total,
        creditsApplied: staffCreditsApplied,
        fulfillmentType: 'pickup',
        shippingAddress: null,
        cardLast4: snapshot.cardLast4,
      })

      // Refresh catalog inventory
      fetchMerchCatalog('staff').then(setCatalog).catch(() => {})
    } catch (e) { onAlert?.('Checkout error: ' + e.message) }
    setSaving(false)
  }

  const reset = () => {
    setCart([]); setSearch(''); setCatFilter(''); setDiscountCode(''); setAppliedDiscount(null); setDiscountErr('')
    setCustomerPhone(''); setCustomerName(''); setFoundUserId(null); setFoundUser(null)
    setLookupStatus('idle'); setAuthEmail(''); setEmailSending(false)
    setCardLast4(''); setCardExpiry(''); setCardHolder(''); setApplyCredits(false)
    setCompletedPayment(null); setStep('lookup')
  }

  if (completedPayment && step === 'receipt') return (
    <div>
      <MerchReceiptModal payment={completedPayment} onClose={() => { reset(); onClose?.() }} />
    </div>
  )

  const hasSidebar = step === 'browse' || step === 'payment'

  return (
    <div style={hasSidebar ? { display: 'grid', gridTemplateColumns: '1fr 320px', gap: '1.25rem', minHeight: 400 } : { minHeight: 400 }}>
      {/* ── Left / Full: Steps ─── */}
      <div>
        {/* ── LOOKUP ── */}
        {step === 'lookup' && (
          <div style={{ maxWidth: 420 }}>
            <div style={{ fontWeight: 700, fontSize: '1rem', marginBottom: '.5rem' }}>Find Customer</div>
            <div style={{ fontSize: '.83rem', color: 'var(--muted)', marginBottom: '1rem' }}>
              Look up the customer by phone number before selecting products.
            </div>
            <div style={{ display: 'flex', gap: '.5rem', marginBottom: '.65rem' }}>
              <div className="f" style={{ flex: 1, marginBottom: 0 }}>
                <label>Phone Number</label>
                <input type="tel" value={customerPhone}
                  onChange={e => { setCustomerPhone(e.target.value); setLookupStatus('idle'); setFoundUser(null) }}
                  placeholder="(317) 555-0100" onBlur={lookupPhone} />
              </div>
              <button className="btn btn-s btn-sm" style={{ alignSelf: 'flex-end' }}
                onClick={lookupPhone}>{lookupStatus === 'searching' ? '…' : 'Search →'}</button>
            </div>
            {lookupStatus === 'found' && (
              <div style={{ background: 'rgba(100,200,100,.07)', border: '1px solid var(--ok)', borderRadius: 6, padding: '.6rem .85rem', marginBottom: '.75rem' }}>
                <div style={{ fontWeight: 700, fontSize: '.88rem', color: 'var(--ok)' }}>✓ {foundUser.name}</div>
                <div style={{ fontSize: '.78rem', color: 'var(--muted)', marginTop: '.2rem' }}>
                  {foundUser.authProvider && foundUser.authProvider !== 'email'
                    ? `Signed in via ${foundUser.authProvider}` : '⚠ No social account yet'}
                  {foundUser.email ? ` · ${foundUser.email}` : ''}
                </div>
              </div>
            )}
            {lookupStatus === 'notfound' && (
              <div style={{ fontSize: '.82rem', color: 'var(--acc)', marginBottom: '.75rem' }}>
                No account found — will create a new one.
              </div>
            )}
            <div className="ma" style={{ marginTop: '.75rem' }}>
              <button className="btn btn-p"
                disabled={lookupStatus !== 'found' && lookupStatus !== 'notfound'}
                onClick={doLookupContinue}>Continue →</button>
            </div>
          </div>
        )}

        {/* ── EMAIL COLLECT (social-auth user missing email) ── */}
        {step === 'email-collect' && (
          <div style={{ maxWidth: 420 }}>
            <div style={{ fontWeight: 700, fontSize: '1rem', marginBottom: '.5rem' }}>Email on File</div>
            <div style={{ fontSize: '.83rem', color: 'var(--muted)', marginBottom: '1rem' }}>
              {customerName} is signed in but has no email on record. Enter their email to complete the account.
            </div>
            <div className="f">
              <label>Email Address *</label>
              <input type="email" value={authEmail} onChange={e => setAuthEmail(e.target.value)} placeholder="name@example.com" />
            </div>
            <div className="ma" style={{ marginTop: '.75rem' }}>
              <button className="btn btn-s" onClick={() => setStep('lookup')}>← Back</button>
              <button className="btn btn-p" disabled={!authEmail.trim() || emailSending} onClick={doSaveEmail}>
                {emailSending ? 'Saving…' : 'Save & Continue →'}
              </button>
            </div>
          </div>
        )}

        {/* ── AUTH PROMPT (phone-only or new customer) ── */}
        {step === 'auth-prompt' && (
          <div style={{ maxWidth: 420 }}>
            <div style={{ fontWeight: 700, fontSize: '1rem', marginBottom: '.5rem' }}>
              {foundUserId ? 'Social Account Required' : 'New Customer'}
            </div>
            <div style={{ fontSize: '.83rem', color: 'var(--muted)', marginBottom: '1rem', lineHeight: 1.55 }}>
              {foundUserId
                ? `${customerName}'s account doesn't have a social login yet. Enter their email to send a sign-in link.`
                : "No account found. Enter the customer's name and email to create an account and send them a sign-in link."}
            </div>
            {!foundUserId && (
              <div className="f">
                <label>Full Name *</label>
                <input value={customerName} onChange={e => setCustomerName(e.target.value)} placeholder="Full name" />
              </div>
            )}
            <div className="f">
              <label>Email Address *</label>
              <input type="email" value={authEmail} onChange={e => setAuthEmail(e.target.value)} placeholder="name@example.com" />
            </div>
            <div className="ma" style={{ marginTop: '.75rem' }}>
              <button className="btn btn-s" onClick={() => setStep('lookup')}>← Back</button>
              <button className="btn btn-p" disabled={!authEmail.trim() || !customerName.trim() || emailSending} onClick={doSendAuthInvite}>
                {emailSending ? 'Sending…' : 'Send Sign-In Link'}
              </button>
            </div>
          </div>
        )}

        {/* ── AWAITING (manual confirm after email sent) ── */}
        {step === 'awaiting' && (
          <div style={{ maxWidth: 420 }}>
            <div style={{ fontWeight: 700, fontSize: '1rem', marginBottom: '.5rem' }}>📨 Sign-In Link Sent</div>
            <div style={{ fontSize: '.83rem', color: 'var(--muted)', marginBottom: '1rem', lineHeight: 1.6 }}>
              An email was sent to <strong style={{ color: 'var(--txt)' }}>{authEmail}</strong>. Once {customerName} has created their account, press Continue.
            </div>
            <div style={{ background: 'rgba(200,224,58,.07)', border: '1px solid rgba(200,224,58,.3)', borderRadius: 6, padding: '.65rem .85rem', marginBottom: '1.25rem', fontSize: '.8rem', color: 'var(--acc)', lineHeight: 1.5 }}>
              Direct them to <strong>sector317.com/?login</strong> if they don't see the email.
            </div>
            <div className="ma">
              <button className="btn btn-p" onClick={() => setStep('browse')}>They've signed up — Continue →</button>
            </div>
          </div>
        )}

        {/* ── BROWSE (catalog) ── */}
        {step === 'browse' && <>
          {customerName && (
            <div style={{ fontSize: '.8rem', color: 'var(--ok)', marginBottom: '.65rem' }}>
              ✓ Customer: <strong>{customerName}</strong>
            </div>
          )}
          <div style={{ display: 'flex', gap: '.5rem', marginBottom: '.75rem', flexWrap: 'wrap' }}>
            <input placeholder="Search products…" value={search} onChange={e => setSearch(e.target.value)}
              style={{ flex: 1, minWidth: 160, background: 'var(--bg2)', border: '1px solid var(--bdr)', borderRadius: 6, padding: '.4rem .75rem', color: 'var(--txt)', fontSize: '.88rem' }} />
            <select value={catFilter} onChange={e => setCatFilter(e.target.value)}
              style={{ background: 'var(--bg2)', border: '1px solid var(--bdr)', borderRadius: 6, padding: '.4rem .5rem', color: 'var(--txt)', fontSize: '.88rem' }}>
              <option value="">All Categories</option>
              {categories.filter(c => c.staffVisible).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          {loading ? <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--muted)' }}>Loading…</div> : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '.75rem' }}>
              {filteredCatalog.map(p => (
                <ProductCard key={p.id} product={p} channel="staff" onSelect={() => setVariantModal(p)} />
              ))}
              {filteredCatalog.length === 0 && <div style={{ gridColumn: '1/-1', textAlign: 'center', padding: '2rem', color: 'var(--muted)' }}>No products found.</div>}
            </div>
          )}
        </>}

        {/* ── PAYMENT ── */}
        {step === 'payment' && (
          <div style={{ maxWidth: 440 }}>
            <div style={{ fontWeight: 700, marginBottom: '1rem' }}>Payment</div>
            {customerCredits > 0 && (
              <div style={{ background: 'rgba(100,180,100,.08)', border: '1px solid rgba(100,180,100,.3)', borderRadius: 6, padding: '.6rem .85rem', marginBottom: '.75rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', cursor: 'pointer' }} onClick={() => setApplyCredits(a => !a)}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '.5rem', cursor: 'pointer', fontSize: '.85rem' }}>
                  <input type="checkbox" checked={applyCredits} readOnly style={{ accentColor: 'var(--ok)' }} />
                  Apply store credits ({fmtMoney(customerCredits)} available)
                </label>
                {staffCreditsApplied > 0 && <span style={{ color: 'var(--ok)', fontWeight: 700 }}>-{fmtMoney(staffCreditsApplied)}</span>}
              </div>
            )}
            <div style={{ background: 'rgba(184,150,12,.08)', border: '1px solid var(--warn)', borderRadius: 6, padding: '.75rem 1rem', fontSize: '.9rem', color: 'var(--warnL)', marginBottom: '1rem', textAlign: 'center' }}>
              💳 Present terminal to customer for <strong>{fmtMoney(staffAmountDue)}</strong>
              {staffCreditsApplied > 0 && <span style={{ fontSize: '.78rem', display: 'block', color: 'var(--muted)', marginTop: '.2rem' }}>({fmtMoney(staffCreditsApplied)} covered by credits)</span>}
            </div>
            <div style={{ background: 'var(--surf)', border: '1px solid var(--bdr)', borderRadius: 6, padding: '.65rem .85rem', marginBottom: '1rem' }}>
              <div style={{ fontSize: '.68rem', color: 'var(--muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: '.5rem' }}>Card Details (after terminal approval)</div>
              <div style={{ display: 'flex', gap: '.5rem', marginBottom: '.4rem' }}>
                <div style={{ flex: 1 }}><label style={{ fontSize: '.72rem', color: 'var(--muted)', display: 'block', marginBottom: '.2rem' }}>Last 4 Digits</label>
                  <input type="text" inputMode="numeric" maxLength={4} value={cardLast4}
                    onChange={e => setCardLast4(e.target.value.replace(/\D/g, ''))}
                    style={{ width: '100%', background: 'var(--bg2)', border: '1px solid var(--bdr)', borderRadius: 4, padding: '.35rem .5rem', color: 'var(--txt)', fontSize: '.88rem' }} />
                </div>
                <div style={{ flex: 1 }}><label style={{ fontSize: '.72rem', color: 'var(--muted)', display: 'block', marginBottom: '.2rem' }}>Expiry (MM/YY)</label>
                  <input type="text" maxLength={5} placeholder="MM/YY" value={cardExpiry}
                    onChange={handleCardExpiry}
                    style={{ width: '100%', background: 'var(--bg2)', border: '1px solid var(--bdr)', borderRadius: 4, padding: '.35rem .5rem', color: 'var(--txt)', fontSize: '.88rem' }} />
                </div>
              </div>
              <div><label style={{ fontSize: '.72rem', color: 'var(--muted)', display: 'block', marginBottom: '.2rem' }}>Name on Card</label>
                <input type="text" placeholder={customerName || 'Cardholder name'} value={cardHolder}
                  onChange={e => setCardHolder(e.target.value)}
                  style={{ width: '100%', background: 'var(--bg2)', border: '1px solid var(--bdr)', borderRadius: 4, padding: '.35rem .5rem', color: 'var(--txt)', fontSize: '.88rem' }} />
              </div>
            </div>
            <div className="ma">
              <button className="btn btn-s" onClick={() => setStep('browse')}>← Back</button>
              <button className="btn btn-p" disabled={saving} onClick={doCheckout}>{saving ? 'Processing…' : 'Payment Collected — Complete Sale'}</button>
            </div>
          </div>
        )}
      </div>

      {/* ── Right: Cart (browse + payment only) ─── */}
      {hasSidebar && (
        <div style={{ background: 'var(--surf)', border: '1px solid var(--bdr)', borderRadius: 10, padding: '1rem', display: 'flex', flexDirection: 'column' }}>
          <div style={{ fontWeight: 700, marginBottom: '.75rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>Cart</span>
            {cart.length > 0 && <button className="btn btn-sm btn-s" style={{ fontSize: '.72rem' }} onClick={() => setCart([])}>Clear</button>}
          </div>
          {cart.length === 0 && <div style={{ color: 'var(--muted)', fontSize: '.88rem', textAlign: 'center', padding: '2rem 0' }}>No items yet</div>}
          {cart.map(item => (
            <div key={item.key} style={{ display: 'flex', alignItems: 'flex-start', gap: '.5rem', padding: '.4rem 0', borderBottom: '1px solid var(--bdr)', fontSize: '.85rem' }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600 }}>{item.productName}</div>
                {item.variantLabel && <div style={{ color: 'var(--muted)', fontSize: '.75rem' }}>{item.variantLabel}</div>}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '.35rem' }}>
                <button style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: '1rem', padding: '0 .2rem' }}
                  onClick={() => setCart(prev => prev.map(i => i.key === item.key ? { ...i, qty: Math.max(1, i.qty - 1) } : i))}>−</button>
                <span style={{ minWidth: 20, textAlign: 'center' }}>{item.qty}</span>
                <button style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: '1rem', padding: '0 .2rem' }}
                  onClick={() => setCart(prev => prev.map(i => i.key === item.key ? { ...i, qty: i.qty + 1 } : i))}>+</button>
              </div>
              <div style={{ fontWeight: 700, color: 'var(--acc)', minWidth: 52, textAlign: 'right' }}>{fmtMoney(item.price * item.qty)}</div>
              <button style={{ background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer', fontSize: '.9rem' }}
                onClick={() => setCart(prev => prev.filter(i => i.key !== item.key))}>✕</button>
            </div>
          ))}
          {cart.length > 0 && step === 'browse' && <>
            <div style={{ marginTop: '.75rem' }}>
              <div style={{ display: 'flex', gap: '.35rem', marginBottom: '.4rem' }}>
                <input placeholder="Discount code" value={discountCode} onChange={e => { setDiscountCode(e.target.value.toUpperCase()); setDiscountErr('') }}
                  style={{ flex: 1, background: 'var(--bg2)', border: '1px solid var(--bdr)', borderRadius: 4, padding: '.35rem .5rem', color: 'var(--txt)', fontSize: '.82rem' }} />
                <button className="btn btn-sm btn-s" style={{ fontSize: '.75rem' }} onClick={applyDiscount}>Apply</button>
              </div>
              {discountErr && <div style={{ fontSize: '.78rem', color: 'var(--danger)', marginBottom: '.3rem' }}>{discountErr}</div>}
              {appliedDiscount && <div style={{ fontSize: '.78rem', color: 'var(--ok)', marginBottom: '.3rem' }}>✓ {appliedDiscount.code} applied</div>}
            </div>
            <div style={{ marginTop: 'auto', paddingTop: '.75rem' }}>
              {discountAmount > 0 && <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '.82rem', color: 'var(--ok)', marginBottom: '.3rem' }}>
                <span>Discount</span><span>-{fmtMoney(discountAmount)}</span></div>}
              <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 800, fontSize: '1.1rem', borderTop: '2px solid var(--bdr)', paddingTop: '.5rem' }}>
                <span>Total</span><span style={{ color: 'var(--acc)' }}>{fmtMoney(finalTotal)}</span>
              </div>
              <button className="btn btn-p" style={{ width: '100%', marginTop: '.75rem' }} onClick={() => setStep('payment')}>
                Checkout →
              </button>
            </div>
          </>}
          {step === 'payment' && cart.length > 0 && (
            <div style={{ marginTop: 'auto', paddingTop: '.75rem', borderTop: '1px solid var(--bdr)' }}>
              {discountAmount > 0 && <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '.82rem', color: 'var(--ok)', marginBottom: '.3rem' }}>
                <span>Discount</span><span>-{fmtMoney(discountAmount)}</span></div>}
              <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 800, fontSize: '1.1rem' }}>
                <span>Total</span><span style={{ color: 'var(--acc)' }}>{fmtMoney(finalTotal)}</span>
              </div>
            </div>
          )}
        </div>
      )}

      {variantModal && (
        <VariantModal product={variantModal} channel="staff" onAdd={addToCart} onClose={() => setVariantModal(null)} />
      )}
    </div>
  )
}

// ─── BundleMakerModal ─────────────────────────────────────────
function BundleMakerModal({ bundle, catalog, categories, onSave, onClose }) {
  const [form, setForm] = useState({
    name: bundle.name || '',
    description: bundle.description || '',
    categoryId: bundle.categoryId || '',
    basePrice: bundle.basePrice != null ? String(bundle.basePrice) : '',
    storefrontVisible: bundle.storefrontVisible ?? true,
    staffVisible: bundle.staffVisible ?? true,
    active: bundle.active ?? true,
    archived: bundle.archived ?? false,
    sortOrder: bundle.sortOrder ?? 0,
    imageUrls: bundle.imageUrls?.length ? bundle.imageUrls : (bundle.imageUrl ? [bundle.imageUrl] : []),
  })
  const [components, setComponents] = useState([]) // {productId,variantId,quantity,productName,variantLabel,price}
  const [loadingComps, setLoadingComps] = useState(!!bundle.id)
  const [saving, setSaving] = useState(false)
  const [selProductId, setSelProductId] = useState('')
  const [selVariantId, setSelVariantId] = useState('')
  const [selQty, setSelQty] = useState(1)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  useEffect(() => {
    if (!bundle.id) { setLoadingComps(false); return }
    fetchBundleComponents(bundle.id).then(comps => {
      const enriched = comps.map(c => {
        for (const p of catalog) {
          const v = p.variants.find(vv => vv.id === c.variantId)
          if (v) return { productId: p.id, variantId: c.variantId, quantity: c.quantity, productName: p.name, variantLabel: v.label, price: variantPrice(p, v) }
        }
        return null
      }).filter(Boolean)
      setComponents(enriched)
    }).catch(() => {}).finally(() => setLoadingComps(false))
  }, []) // eslint-disable-line

  const sellableProducts = catalog.filter(p => p.type !== 'bundle' && p.active && !p.archived)
  const selProduct = sellableProducts.find(p => p.id === selProductId)
  const selVariants = (selProduct?.variants || []).filter(v => v.active)
  const selVariant = selVariants.find(v => v.id === selVariantId)
  const selPrice = selVariant ? variantPrice(selProduct, selVariant) : (selProduct?.basePrice || 0)

  const componentTotal = components.reduce((s, c) => s + c.price * c.quantity, 0)
  const bundlePrice = parseFloat(form.basePrice) || 0
  const savingsPct = componentTotal > 0 && bundlePrice > 0 && bundlePrice < componentTotal
    ? Math.round((1 - bundlePrice / componentTotal) * 100) : null

  const addComponent = () => {
    if (!selProductId) return
    const matchKey = c => selVariantId ? c.variantId === selVariantId : (!c.variantId && c.productId === selProductId)
    if (components.find(matchKey)) {
      setComponents(prev => prev.map(c => matchKey(c) ? { ...c, quantity: c.quantity + selQty } : c))
    } else {
      setComponents(prev => [...prev, { productId: selProductId, variantId: selVariantId || null, quantity: selQty, productName: selProduct.name, variantLabel: selVariant?.label || null, price: selPrice }])
    }
    setSelProductId(''); setSelVariantId(''); setSelQty(1)
  }

  const doSave = async () => {
    if (!form.name || !bundlePrice || components.length === 0) return
    setSaving(true)
    try {
      await onSave({ ...form, type: 'bundle', basePrice: bundlePrice, bundleSavingsPct: savingsPct }, components)
    } catch (e) { alert('Save error: ' + e.message) }
    setSaving(false)
  }

  const sectionLabel = txt => (
    <div style={{ fontSize: '.78rem', color: 'var(--muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: '.6rem' }}>{txt}</div>
  )

  return (
    <div className="mo" onClick={onClose}>
      <div className="mc" style={{ maxWidth: 700, maxHeight: '92vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
        <div className="mt2">{bundle.id ? 'Edit Bundle' : 'New Bundle'}</div>

        {/* Basic info */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '.75rem', marginBottom: '1rem' }}>
          <div className="f" style={{ gridColumn: '1/-1' }}><label>Bundle Name *</label><input value={form.name} onChange={e => set('name', e.target.value)} placeholder="e.g. Tactical Starter Pack" /></div>
          <div className="f">
            <label>Category</label>
            <select value={form.categoryId || ''} onChange={e => set('categoryId', e.target.value || null)}>
              <option value="">— None —</option>
              {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div className="f"><label>Sort Order</label><input type="number" value={form.sortOrder} onChange={e => set('sortOrder', parseInt(e.target.value) || 0)} /></div>
          <div className="f" style={{ gridColumn: '1/-1' }}><label>Description</label><textarea value={form.description || ''} onChange={e => set('description', e.target.value)} rows={2} style={{ resize: 'vertical' }} /></div>
        </div>

        {/* Images */}
        <div style={{ marginBottom: '1rem' }}>
          {sectionLabel('Images (up to 5)')}
          <ImageUploader images={form.imageUrls} onChange={v => set('imageUrls', v)} />
        </div>

        {/* Visibility */}
        {sectionLabel('Visibility')}
        <div style={{ display: 'flex', gap: '1.5rem', marginBottom: '1.25rem', flexWrap: 'wrap' }}>
          {[['active','Active'],['storefrontVisible','On Storefront'],['staffVisible','Staff Sales'],['archived','Archived']].map(([k,lbl]) => (
            <label key={k} style={{ display: 'flex', alignItems: 'center', gap: '.4rem', fontSize: '.88rem', cursor: 'pointer' }}>
              <input type="checkbox" checked={!!form[k]} onChange={e => set(k, e.target.checked)} />{lbl}
            </label>
          ))}
        </div>

        {/* Component picker */}
        <div style={{ borderTop: '1px solid var(--bdr)', paddingTop: '1rem' }}>
          {sectionLabel('Bundle Contents')}
          {loadingComps
            ? <div style={{ color: 'var(--muted)', fontSize: '.85rem', marginBottom: '.75rem' }}>Loading components…</div>
            : <>
              {/* Add component row */}
              <div style={{ display: 'flex', gap: '.5rem', marginBottom: '.75rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
                <div style={{ flex: 2, minWidth: 160 }}>
                  <div style={{ fontSize: '.72rem', color: 'var(--muted)', marginBottom: '.2rem' }}>Product</div>
                  <select value={selProductId} onChange={e => { setSelProductId(e.target.value); setSelVariantId('') }}
                    style={{ width: '100%', background: 'var(--bg2)', border: '1px solid var(--bdr)', borderRadius: 5, padding: '.35rem .5rem', color: 'var(--txt)', fontSize: '.85rem' }}>
                    <option value="">— Select product —</option>
                    {sellableProducts.map(p => <option key={p.id} value={p.id}>{p.name} ({fmtMoney(p.basePrice)})</option>)}
                  </select>
                </div>
                {selVariants.length > 0 && (
                  <div style={{ flex: 2, minWidth: 130 }}>
                    <div style={{ fontSize: '.72rem', color: 'var(--muted)', marginBottom: '.2rem' }}>Variant</div>
                    <select value={selVariantId} onChange={e => setSelVariantId(e.target.value)}
                      style={{ width: '100%', background: 'var(--bg2)', border: '1px solid var(--bdr)', borderRadius: 5, padding: '.35rem .5rem', color: 'var(--txt)', fontSize: '.85rem' }}>
                      <option value="">— Any variant —</option>
                      {selVariants.map(v => <option key={v.id} value={v.id}>{v.label}{v.priceOverride != null ? ` (${fmtMoney(v.priceOverride)})` : ''}</option>)}
                    </select>
                  </div>
                )}
                <div>
                  <div style={{ fontSize: '.72rem', color: 'var(--muted)', marginBottom: '.2rem' }}>Qty</div>
                  <input type="number" min={1} value={selQty} onChange={e => setSelQty(Math.max(1, parseInt(e.target.value) || 1))}
                    style={{ width: 56, background: 'var(--bg2)', border: '1px solid var(--bdr)', borderRadius: 5, padding: '.35rem .5rem', color: 'var(--txt)', fontSize: '.85rem', textAlign: 'center' }} />
                </div>
                {selProductId && (
                  <div style={{ fontSize: '.8rem', color: 'var(--acc)', fontWeight: 700, paddingBottom: '.4rem' }}>{fmtMoney(selPrice * selQty)}</div>
                )}
                <button className="btn btn-s btn-sm" style={{ alignSelf: 'flex-end' }} disabled={!selProductId} onClick={addComponent}>+ Add</button>
              </div>

              {/* Component list */}
              {components.length === 0 && <div style={{ fontSize: '.82rem', color: 'var(--muted)', padding: '.4rem 0', marginBottom: '.5rem' }}>No items added yet.</div>}
              {components.map((c, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '.6rem', padding: '.45rem 0', borderBottom: '1px solid var(--bdr)', fontSize: '.85rem' }}>
                  <span style={{ flex: 1 }}>
                    <span style={{ fontWeight: 600 }}>{c.productName}</span>
                    {c.variantLabel && <span style={{ color: 'var(--muted)', marginLeft: '.35rem' }}>— {c.variantLabel}</span>}
                  </span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '.25rem' }}>
                    <button style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: '1.1rem', lineHeight: 1, padding: '0 5px' }}
                      onClick={() => setComponents(prev => prev.map((x, j) => j === i ? { ...x, quantity: Math.max(1, x.quantity - 1) } : x))}>−</button>
                    <span style={{ minWidth: 22, textAlign: 'center', fontWeight: 600 }}>×{c.quantity}</span>
                    <button style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: '1.1rem', lineHeight: 1, padding: '0 5px' }}
                      onClick={() => setComponents(prev => prev.map((x, j) => j === i ? { ...x, quantity: x.quantity + 1 } : x))}>+</button>
                  </div>
                  <span style={{ fontWeight: 700, color: 'var(--acc)', minWidth: 60, textAlign: 'right' }}>{fmtMoney(c.price * c.quantity)}</span>
                  <button style={{ background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer', padding: '0 4px' }}
                    onClick={() => setComponents(prev => prev.filter((_, j) => j !== i))}>✕</button>
                </div>
              ))}

              {/* Price summary + bundle price input */}
              <div style={{ marginTop: '.9rem', background: 'var(--bg2)', borderRadius: 8, padding: '.85rem 1rem' }}>
                {components.length > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '.85rem', marginBottom: '.65rem', paddingBottom: '.65rem', borderBottom: '1px solid var(--bdr)' }}>
                    <span style={{ color: 'var(--muted)' }}>Component retail total</span>
                    <span style={{ fontWeight: 700 }}>{fmtMoney(componentTotal)}</span>
                  </div>
                )}
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem' }}>
                    <label style={{ fontSize: '.82rem', color: 'var(--muted)', whiteSpace: 'nowrap' }}>Bundle Price ($) *</label>
                    <input type="number" min="0" step="0.01" value={form.basePrice} onChange={e => set('basePrice', e.target.value)} placeholder="0.00"
                      style={{ width: 90, background: 'var(--bg)', border: '1px solid var(--bdr)', borderRadius: 5, padding: '.35rem .6rem', color: 'var(--txt)', fontSize: '.95rem', fontWeight: 700 }} />
                  </div>
                  {savingsPct !== null && savingsPct > 0 && (
                    <div style={{ background: 'var(--dangerL,#c44)', color: '#fff', fontWeight: 800, fontSize: '.9rem', padding: '.3rem .9rem', borderRadius: 99 }}>
                      {savingsPct}% OFF!
                    </div>
                  )}
                  {bundlePrice > 0 && componentTotal > 0 && bundlePrice >= componentTotal && (
                    <div style={{ color: 'var(--warn)', fontSize: '.8rem' }}>Bundle price ≥ component total — no savings.</div>
                  )}
                </div>
              </div>
            </>
          }
        </div>

        <div className="ma" style={{ marginTop: '1.25rem' }}>
          <button className="btn btn-s" onClick={onClose}>Cancel</button>
          <button className="btn btn-p" disabled={saving || !form.name || !bundlePrice || components.length === 0} onClick={doSave}>
            {saving ? 'Saving…' : 'Save Bundle'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ================================================================
// MERCH STOREFRONT (customer portal)
// ================================================================
function MerchStorefront({ currentUser, setPayments, onAlert, onSignIn }) {
  const [catalog, setCatalog] = useState([])
  const [categories, setCategories] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [catFilter, setCatFilter] = useState('')
  const [cart, setCart] = useState([])
  const [variantModal, setVariantModal] = useState(null)
  const [step, setStep] = useState('browse') // browse | cart | checkout | receipt
  const [fulfillmentType, setFulfillmentType] = useState('pickup')
  const [shippingAddress, setShippingAddress] = useState({ name: '', line1: '', line2: '', city: '', state: '', zip: '' })
  const [discountCode, setDiscountCode] = useState('')
  const [appliedDiscount, setAppliedDiscount] = useState(null)
  const [discountErr, setDiscountErr] = useState('')
  const [cardLast4, setCardLast4] = useState('')
  const [cardExpiry, setCardExpiry] = useState('')
  const [cardHolder, setCardHolder] = useState('')
  const [applyCredits, setApplyCredits] = useState(false)
  const [saving, setSaving] = useState(false)
  const [completedPayment, setCompletedPayment] = useState(null)
  const handleCardExpiry = e => { const d = e.target.value.replace(/\D/g, '').slice(0, 4); setCardExpiry(d.length > 2 ? d.slice(0, 2) + '/' + d.slice(2) : d) }

  useEffect(() => {
    Promise.all([fetchMerchCatalog('storefront'), fetchMerchCategories()])
      .then(([p, c]) => { setCatalog(p); setCategories(c) })
      .catch(e => onAlert?.('Error loading shop: ' + e.message))
      .finally(() => setLoading(false))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const filteredCatalog = useMemo(() =>
    catalog.filter(p =>
      (!catFilter || p.categoryId === catFilter) &&
      (!search || p.name.toLowerCase().includes(search.toLowerCase()))
    ), [catalog, search, catFilter]
  )

  const cartTotal = useMemo(() => cart.reduce((s, i) => s + i.price * i.qty, 0), [cart])
  const shippingCharge = useMemo(() => {
    if (fulfillmentType !== 'ship') return 0
    return cart.reduce((s, i) => s + (i.shippingCharge || 0) * i.qty, 0)
  }, [cart, fulfillmentType])
  const discountAmount = useMemo(() => {
    if (!appliedDiscount) return 0
    return appliedDiscount.discountType === 'percent'
      ? cartTotal * appliedDiscount.amount / 100
      : Math.min(appliedDiscount.amount, cartTotal)
  }, [appliedDiscount, cartTotal])
  const finalTotal = Math.max(cartTotal + shippingCharge - discountAmount, 0)
  const storefrontCreditBalance = currentUser?.credits ?? 0
  const storefrontCreditsApplied = applyCredits ? Math.min(storefrontCreditBalance, finalTotal) : 0
  const storefrontAmountDue = finalTotal - storefrontCreditsApplied

  const addToCart = (item) => {
    const product = catalog.find(p => p.id === item.productId)
    const variant = product?.variants.find(v => v.id === item.variantId)
    setCart(prev => {
      const key = `${item.productId}::${item.variantId || ''}`
      const existing = prev.find(i => i.key === key)
      if (existing) return prev.map(i => i.key === key ? { ...i, qty: i.qty + item.qty } : i)
      return [...prev, { ...item, key, shippingCharge: variant?.shippingCharge || 0 }]
    })
  }

  const applyDiscount = async () => {
    setDiscountErr('')
    try {
      const d = await validateMerchDiscount(discountCode, 'online')
      if (!d) { setDiscountErr('Code not found or expired.'); return }
      setAppliedDiscount(d)
    } catch (e) { setDiscountErr('Error: ' + e.message) }
  }

  const doCheckout = async () => {
    if (!currentUser) { onSignIn?.(); return }
    setSaving(true)
    try {
      const items = cart.map(i => ({
        product_id: i.productId, variant_id: i.variantId || '',
        quantity: i.qty, unit_price: i.price,
        discount_amount: 0, product_type: i.type,
      }))

      const order = await createMerchOrder({
        userId: currentUser.id, customerName: currentUser.name,
        fulfillmentType,
        shippingAddress: fulfillmentType === 'ship' ? shippingAddress : null,
        items, discountId: appliedDiscount?.id || null,
        discountAmount, shippingCharge, notes: null,
      })

      const txn = await processPayment({ amount: storefrontAmountDue, mode: 'card_not_present', card: { last4: cardLast4, expiry: cardExpiry, holder: cardHolder } })
      if (!txn.ok) throw new Error('Payment declined')
      const snapshot = {
        type: 'merch', customerName: currentUser.name,
        items: cart.map(i => ({ name: i.productName, variant: i.variantLabel, qty: i.qty, unitPrice: i.price })),
        discount: discountAmount || undefined, shipping: shippingCharge || undefined,
        fulfillmentType,
        refNum: order.id.replace(/-/g, '').slice(0, 12).toUpperCase(),
        transactionAt: new Date().toISOString(),
        cardLast4: txn.last4,
        cardExpiry: txn.expiry,
        cardHolder: txn.holder || currentUser.name,
        giftCodes: (order.giftCodes || []).map(g => ({ code: g.code, type: g.type })),
      }

      const payment = await createPayment({
        userId: currentUser.id, reservationId: null, merchOrderId: order.id,
        customerName: currentUser.name, amount: order.total, status: 'paid', snapshot,
      })

      if (setPayments) setPayments(prev => [payment, ...prev])
      if (storefrontCreditsApplied > 0) {
        try { await deductUserCredits(currentUser.id, storefrontCreditsApplied) }
        catch (credErr) { console.warn('Credits deduction error:', credErr.message) }
      }
      setCompletedPayment(payment)
      setStep('receipt')
      emailMerchPurchase(currentUser.id, {
        orderRef: snapshot.refNum,
        items: cart.map(i => ({ name: i.productName + (i.variantLabel ? ' — ' + i.variantLabel : ''), qty: i.qty, price: i.price })),
        total: order.total,
        creditsApplied: storefrontCreditsApplied,
        fulfillmentType,
        shippingAddress: fulfillmentType === 'ship' ? shippingAddress : null,
        cardLast4: snapshot.cardLast4,
      })
    } catch (e) { onAlert?.('Checkout error: ' + e.message) }
    setSaving(false)
  }

  if (step === 'receipt' && completedPayment) return (
    <MerchReceiptModal payment={completedPayment} onClose={() => { setCart([]); setCompletedPayment(null); setStep('browse') }} />
  )

  return (
    <div>
      {/* Top nav */}
      <div style={{ display: 'flex', gap: '.75rem', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap' }}>
        {step !== 'browse' && <button className="btn btn-s btn-sm" style={{ fontSize: '.8rem' }} onClick={() => setStep(step === 'checkout' ? 'cart' : 'browse')}>← Back</button>}
        <div style={{ fontWeight: 700, fontSize: '1.05rem' }}>
          {step === 'browse' ? 'Shop' : step === 'cart' ? 'Cart' : 'Checkout'}
        </div>
        {step === 'browse' && cart.length > 0 && (
          <button className="btn btn-p btn-sm" style={{ marginLeft: 'auto', fontSize: '.85rem' }} onClick={() => setStep('cart')}>
            Cart ({cart.reduce((s, i) => s + i.qty, 0)}) · {fmtMoney(cartTotal)}
          </button>
        )}
      </div>

      {/* Browse */}
      {step === 'browse' && (<>
        <div style={{ display: 'flex', gap: '.5rem', marginBottom: '.75rem', flexWrap: 'wrap' }}>
          <input placeholder="Search…" value={search} onChange={e => setSearch(e.target.value)}
            style={{ flex: 1, minWidth: 140, background: 'var(--bg2)', border: '1px solid var(--bdr)', borderRadius: 6, padding: '.4rem .75rem', color: 'var(--txt)', fontSize: '.88rem' }} />
          <select value={catFilter} onChange={e => setCatFilter(e.target.value)}
            style={{ background: 'var(--bg2)', border: '1px solid var(--bdr)', borderRadius: 6, padding: '.4rem .5rem', color: 'var(--txt)', fontSize: '.88rem' }}>
            <option value="">All</option>
            {categories.filter(c => c.storefrontVisible).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        {!loading && search===''&&catFilter===''&&filteredCatalog.length>0&&<>
          <div style={{fontSize:'.72rem',fontFamily:'var(--fd)',letterSpacing:'.1em',textTransform:'uppercase',color:'var(--muted)',marginBottom:'.65rem',fontWeight:700}}>Featured</div>
          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(160px,1fr))',gap:'.75rem',marginBottom:'1.5rem'}}>
            {filteredCatalog.slice(0,4).map(p=>(
              <ProductCard key={'feat-'+p.id} product={p} channel="storefront"
                onSelect={currentUser?()=>setVariantModal(p):()=>onSignIn?.()}/>
            ))}
          </div>
          <div style={{fontSize:'.72rem',fontFamily:'var(--fd)',letterSpacing:'.1em',textTransform:'uppercase',color:'var(--muted)',marginBottom:'.65rem',fontWeight:700}}>All Items</div>
        </>}
        {loading ? <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--muted)' }}>Loading…</div> : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '.75rem' }}>
            {filteredCatalog.map(p => (
              <ProductCard key={p.id} product={p} channel="storefront"
                onSelect={currentUser ? () => setVariantModal(p) : () => onSignIn?.()} />
            ))}
            {filteredCatalog.length === 0 && <div style={{ gridColumn: '1/-1', textAlign: 'center', padding: '2rem', color: 'var(--muted)' }}>No products found.</div>}
          </div>
        )}
        {!currentUser && catalog.length > 0 && (
          <div style={{ textAlign: 'center', marginTop: '1.5rem' }}>
            <button className="btn btn-p" onClick={() => onSignIn?.()}>Sign In to Purchase</button>
          </div>
        )}
      </>)}

      {/* Cart */}
      {step === 'cart' && (
        <div style={{ maxWidth: 520 }}>
          {cart.map(item => (
            <div key={item.key} style={{ display: 'flex', alignItems: 'center', gap: '.75rem', padding: '.6rem 0', borderBottom: '1px solid var(--bdr)' }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: '.9rem' }}>{item.productName}</div>
                {item.variantLabel && <div style={{ fontSize: '.75rem', color: 'var(--muted)' }}>{item.variantLabel}</div>}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '.4rem' }}>
                <button style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: '1.1rem' }}
                  onClick={() => setCart(p => p.map(i => i.key === item.key ? { ...i, qty: Math.max(1, i.qty - 1) } : i))}>−</button>
                <span style={{ minWidth: 24, textAlign: 'center' }}>{item.qty}</span>
                <button style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: '1.1rem' }}
                  onClick={() => setCart(p => p.map(i => i.key === item.key ? { ...i, qty: i.qty + 1 } : i))}>+</button>
              </div>
              <span style={{ fontWeight: 700, color: 'var(--acc)', minWidth: 60, textAlign: 'right' }}>{fmtMoney(item.price * item.qty)}</span>
              <button style={{ background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer' }}
                onClick={() => setCart(p => p.filter(i => i.key !== item.key))}>✕</button>
            </div>
          ))}
          <div style={{ marginTop: '1rem' }}>
            <div style={{ display: 'flex', gap: '.4rem', marginBottom: '.5rem' }}>
              <input placeholder="Discount code" value={discountCode} onChange={e => { setDiscountCode(e.target.value.toUpperCase()); setDiscountErr('') }}
                style={{ flex: 1, background: 'var(--bg2)', border: '1px solid var(--bdr)', borderRadius: 4, padding: '.4rem .6rem', color: 'var(--txt)', fontSize: '.85rem' }} />
              <button className="btn btn-sm btn-s" style={{ fontSize: '.8rem' }} onClick={applyDiscount}>Apply</button>
            </div>
            {discountErr && <div style={{ fontSize: '.78rem', color: 'var(--danger)', marginBottom: '.3rem' }}>{discountErr}</div>}
            {appliedDiscount && <div style={{ fontSize: '.78rem', color: 'var(--ok)', marginBottom: '.5rem' }}>✓ {appliedDiscount.code}</div>}
            <div style={{ fontWeight: 700, marginBottom: '.75rem' }}>Fulfillment</div>
            <div style={{ display: 'flex', gap: '.5rem', marginBottom: '1rem' }}>
              {[['pickup','In-Store Pickup (Free)'],['ship','Ship to Address']].map(([v,lbl]) => (
                <button key={v} className={`btn btn-sm ${fulfillmentType === v ? 'btn-p' : 'btn-s'}`} style={{ fontSize: '.82rem' }}
                  onClick={() => setFulfillmentType(v)}>{lbl}</button>
              ))}
            </div>
            {discountAmount > 0 && <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '.85rem', color: 'var(--ok)', marginBottom: '.3rem' }}><span>Discount</span><span>-{fmtMoney(discountAmount)}</span></div>}
            {shippingCharge > 0 && <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '.85rem', marginBottom: '.3rem' }}><span>Shipping</span><span>{fmtMoney(shippingCharge)}</span></div>}
            {storefrontCreditBalance > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '.85rem', marginBottom: '.3rem', cursor: 'pointer', color: applyCredits ? 'var(--ok)' : 'var(--muted)' }} onClick={() => setApplyCredits(a => !a)}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '.4rem', cursor: 'pointer' }}>
                  <input type="checkbox" checked={applyCredits} readOnly style={{ accentColor: 'var(--ok)' }} />
                  Credits ({fmtMoney(storefrontCreditBalance)})
                </label>
                <span>{applyCredits ? `-${fmtMoney(storefrontCreditsApplied)}` : ''}</span>
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 800, fontSize: '1.1rem', borderTop: '2px solid var(--bdr)', paddingTop: '.5rem', marginBottom: '1rem' }}>
              <span>Total</span><span style={{ color: 'var(--acc)' }}>{fmtMoney(storefrontAmountDue)}</span>
            </div>
            <button className="btn btn-p" style={{ width: '100%' }} onClick={() => setStep('checkout')}>Continue to Checkout →</button>
          </div>
        </div>
      )}

      {/* Checkout */}
      {step === 'checkout' && (
        <div style={{ maxWidth: 480 }}>
          {fulfillmentType === 'ship' && (
            <div style={{ marginBottom: '1rem' }}>
              <div style={{ fontWeight: 600, marginBottom: '.5rem' }}>Shipping Address</div>
              {['name','line1','line2','city','state','zip'].map(k => (
                <div className="f" key={k}><label style={{ textTransform: 'capitalize' }}>{k === 'line1' ? 'Address Line 1' : k === 'line2' ? 'Address Line 2 (Optional)' : k}</label>
                  <input value={shippingAddress[k]} onChange={e => setShippingAddress(s => ({ ...s, [k]: e.target.value }))} /></div>
              ))}
            </div>
          )}
          {storefrontCreditsApplied > 0 && (
            <div style={{ background: 'rgba(100,180,100,.08)', border: '1px solid rgba(100,180,100,.3)', borderRadius: 6, padding: '.6rem .85rem', marginBottom: '.75rem', fontSize: '.85rem', color: 'var(--ok)' }}>
              ✓ {fmtMoney(storefrontCreditsApplied)} store credits applied
            </div>
          )}
          {storefrontAmountDue > 0 && (
            <div style={{ background: 'rgba(184,150,12,.08)', border: '1px solid var(--warn)', borderRadius: 6, padding: '.75rem 1rem', fontSize: '.9rem', color: 'var(--warnL)', marginBottom: '1rem', textAlign: 'center' }}>
              💳 Present terminal to customer for <strong>{fmtMoney(storefrontAmountDue)}</strong>
            </div>
          )}
          {storefrontAmountDue > 0 && (
            <div style={{ background: 'var(--surf)', border: '1px solid var(--bdr)', borderRadius: 6, padding: '.65rem .85rem', marginBottom: '1rem' }}>
              <div style={{ fontSize: '.68rem', color: 'var(--muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: '.5rem' }}>Card Details (after terminal approval)</div>
              <div style={{ display: 'flex', gap: '.5rem', marginBottom: '.4rem' }}>
                <div style={{ flex: 1 }}><label style={{ fontSize: '.72rem', color: 'var(--muted)', display: 'block', marginBottom: '.2rem' }}>Last 4 Digits</label>
                  <input type="text" inputMode="numeric" maxLength={4} value={cardLast4}
                    onChange={e => setCardLast4(e.target.value.replace(/\D/g, ''))}
                    style={{ width: '100%', background: 'var(--bg2)', border: '1px solid var(--bdr)', borderRadius: 4, padding: '.35rem .5rem', color: 'var(--txt)', fontSize: '.88rem' }} />
                </div>
                <div style={{ flex: 1 }}><label style={{ fontSize: '.72rem', color: 'var(--muted)', display: 'block', marginBottom: '.2rem' }}>Expiry (MM/YY)</label>
                  <input type="text" maxLength={5} placeholder="MM/YY" value={cardExpiry}
                    onChange={handleCardExpiry}
                    style={{ width: '100%', background: 'var(--bg2)', border: '1px solid var(--bdr)', borderRadius: 4, padding: '.35rem .5rem', color: 'var(--txt)', fontSize: '.88rem' }} />
                </div>
              </div>
              <div><label style={{ fontSize: '.72rem', color: 'var(--muted)', display: 'block', marginBottom: '.2rem' }}>Name on Card</label>
                <input type="text" value={cardHolder} placeholder={currentUser?.name || 'Cardholder name'}
                  onChange={e => setCardHolder(e.target.value)}
                  style={{ width: '100%', background: 'var(--bg2)', border: '1px solid var(--bdr)', borderRadius: 4, padding: '.35rem .5rem', color: 'var(--txt)', fontSize: '.88rem' }} />
              </div>
            </div>
          )}
          {storefrontAmountDue === 0 && storefrontCreditsApplied > 0 && (
            <div style={{ background: 'rgba(100,180,100,.1)', border: '1px solid rgba(100,180,100,.3)', borderRadius: 5, padding: '.6rem .85rem', fontSize: '.82rem', color: 'var(--ok)', marginBottom: '1rem' }}>
              ✓ Covered in full by store credits — no card required.
            </div>
          )}
          <button className="btn btn-p" style={{ width: '100%' }} disabled={saving} onClick={doCheckout}>
            {saving ? 'Processing…' : `Complete Purchase · ${fmtMoney(storefrontAmountDue)}`}
          </button>
        </div>
      )}

      {variantModal && (
        <VariantModal product={variantModal} channel="storefront" onAdd={addToCart} onClose={() => setVariantModal(null)} />
      )}
    </div>
  )
}

// ================================================================
// MAIN EXPORT
// ================================================================
export default function MerchPortal({ surface, currentUser, users, setUsers, setPayments, onAlert, onClose, onSignIn, isAdmin: isAdminProp }) {
  const s = surface || (
    currentUser?.access === 'admin' || currentUser?.access === 'manager' ? 'admin' :
    currentUser?.access === 'staff' ? 'staff' : 'storefront'
  )
  const isAdmin = isAdminProp ?? currentUser?.access === 'admin'
  if (s === 'admin') return <MerchAdmin currentUser={currentUser} isAdmin={isAdmin} users={users} setUsers={setUsers} setPayments={setPayments} onAlert={onAlert} />
  if (s === 'staff') return (
    <MerchStaffSales currentUser={currentUser} users={users} setUsers={setUsers}
      setPayments={setPayments} onAlert={onAlert} onClose={onClose} />
  )
  return (
    <MerchStorefront currentUser={currentUser} setPayments={setPayments}
      onAlert={onAlert} onSignIn={onSignIn} />
  )
}
