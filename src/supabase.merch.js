import { supabase } from "./supabase.client.js"

// ============================================================
// MERCHANDISE
// ============================================================

const toMerchCategory = r => r ? ({
  id: r.id, name: r.name, slug: r.slug, skuCode: r.sku_code ?? null,
  sortOrder: r.sort_order,
  active: r.active, storefrontVisible: r.storefront_visible, staffVisible: r.staff_visible,
  createdAt: r.created_at,
}) : null

const parseImageUrls = v => {
  if (!v) return []
  if (v.startsWith('[')) { try { return JSON.parse(v) } catch { return [v] } }
  return [v]
}
const toMerchProduct = r => r ? ({
  id: r.id, categoryId: r.category_id, categoryName: r.category_name,
  type: r.type, name: r.name, description: r.description, sku: r.sku,
  skuFamilyCode: r.sku_family_code ?? null,
  basePrice: Number(r.base_price),
  imageUrl: r.image_url?.startsWith('[') ? ((() => { try { return JSON.parse(r.image_url)[0] } catch { return null } })()) : (r.image_url || null),
  imageUrls: parseImageUrls(r.image_url),
  bundleSavingsPct: r.type === 'bundle' && r.return_policy_note ? (parseInt(r.return_policy_note) || null) : null,
  storefrontVisible: r.storefront_visible, staffVisible: r.staff_visible,
  shippable: r.shippable, pickupOnly: r.pickup_only, returnable: r.returnable,
  returnWindowDays: r.return_window_days, restockable: r.restockable,
  returnPolicyNote: r.type !== 'bundle' ? (r.return_policy_note || null) : null,
  internalNotes: r.internal_notes ?? null,
  active: r.active, archived: r.archived,
  sortOrder: r.sort_order, createdAt: r.created_at,
  variants: (r.variants || []).map(v => {
    const mappedVendors = (v.vendors || []).map(vv => ({
      id:           vv.id,
      vendorId:     vv.vendor_id,
      vendorName:   vv.vendor_name  ?? null,
      vendorEmail:  vv.vendor_email ?? null,
      vendorPhone:  vv.vendor_phone ?? null,
      vendorSku:    vv.vendor_sku   ?? null,
      cost:         vv.cost          != null ? Number(vv.cost)          : null,
      leadTimeDays: vv.lead_time_days != null ? Number(vv.lead_time_days) : null,
      isPrimary:    vv.is_primary ?? false,
    }))
    const primary = mappedVendors.find(vv => vv.isPrimary) ?? mappedVendors[0] ?? null
    return {
      id: v.id, label: v.label, sku: v.sku, skuSuffix: v.sku_suffix ?? null,
      priceOverride: v.price_override != null ? Number(v.price_override) : null,
      shippingCharge: Number(v.shipping_charge || 0),
      active: v.active, storefrontVisible: v.storefront_visible, staffVisible: v.staff_visible,
      discontinued: v.discontinued ?? false, discontinuedAt: v.discontinued_at ?? null,
      sortOrder: v.sort_order, inventory: Number(v.inventory || 0),
      reorderPoint: v.reorder_point != null ? Number(v.reorder_point) : null,
      reorderQty:   v.reorder_qty   != null ? Number(v.reorder_qty)   : null,
      vendors: mappedVendors,
      // Convenience fields from primary vendor (backwards-compat)
      vendorId:    primary?.vendorId    ?? null,
      vendorSku:   primary?.vendorSku   ?? null,
      vendorName:  primary?.vendorName  ?? null,
      vendorEmail: primary?.vendorEmail ?? null,
      vendorPhone: primary?.vendorPhone ?? null,
      cost:        primary?.cost        ?? null,
      leadTimeDays: primary?.leadTimeDays ?? null,
    }
  }),
}) : null

const toMerchOrder = r => r ? ({
  id: r.id, userId: r.user_id, customerName: r.customer_name,
  status: r.status, total: Number(r.total), fulfillmentType: r.fulfillment_type,
  shippingAddress: r.shipping_address, shippingCharge: Number(r.shipping_charge || 0),
  discountId: r.discount_id, discountAmount: Number(r.discount_amount || 0),
  notes: r.notes, createdAt: r.created_at,
  trackingNumber: r.tracking_number ?? null,
  carrier: r.carrier ?? null,
  fulfilledAt: r.fulfilled_at ?? null,
  fulfillmentNotes: r.fulfillment_notes ?? null,
  items: (r.items || []).map(toMerchOrderItem),
}) : null

const toMerchPO = r => r ? ({
  id: r.id,
  vendorId: r.vendor_id,
  vendorName: r.vendor?.name ?? null,
  status: r.status,
  expectedBy: r.expected_by ?? null,
  notes: r.notes ?? null,
  createdBy: r.created_by ?? null,
  createdAt: r.created_at,
  lines: (r.lines || []).map(l => ({
    id: l.id, poId: l.po_id, variantId: l.variant_id,
    variantLabel: l.variant?.label ?? null,
    variantSku:   l.variant?.sku ?? null,
    productName:  l.variant?.product?.name ?? null,
    qtyOrdered:   l.qty_ordered,
    unitCost:     l.unit_cost != null ? Number(l.unit_cost) : null,
    qtyReceived:  l.qty_received,
    receiveLocationId: l.receive_location_id ?? null,
    notes: l.notes ?? null,
  })),
}) : null

const toMerchOrderItem = r => r ? ({
  id: r.id, orderId: r.order_id, productId: r.product_id, variantId: r.variant_id,
  quantity: r.quantity, unitPrice: Number(r.unit_price), discountAmount: Number(r.discount_amount || 0),
  createdAt: r.created_at,
}) : null

const toMerchDiscount = r => r ? ({
  id: r.id, code: r.code, description: r.description, discountType: r.discount_type,
  amount: Number(r.amount), appliesTo: r.applies_to, categoryId: r.category_id,
  productId: r.product_id, active: r.active, usageLimit: r.usage_limit,
  usageCount: r.usage_count, startsAt: r.starts_at, endsAt: r.ends_at,
  channel: r.channel, createdAt: r.created_at,
}) : null

const toMerchGiftCode = r => r ? ({
  id: r.id, orderItemId: r.order_item_id, productId: r.product_id, code: r.code,
  type: r.type, originalValue: Number(r.original_value), currentBalance: Number(r.current_balance),
  status: r.status, redeemedAt: r.redeemed_at, redeemedBy: r.redeemed_by,
  expiresAt: r.expires_at, notes: r.notes, createdAt: r.created_at,
}) : null

const toMerchReturn = r => r ? ({
  id: r.id, orderId: r.order_id, orderItemId: r.order_item_id, quantity: r.quantity,
  reason: r.reason, disposition: r.disposition, notes: r.notes,
  createdBy: r.created_by, createdAt: r.created_at,
}) : null

const toStockLocation = r => r ? ({
  id: r.id, name: r.name, levelLabels: r.level_labels || {}, isDefault: r.is_default,
  active: r.active, createdAt: r.created_at,
}) : null

const toMerchInventory = r => r ? ({
  id: r.id, variantId: r.variant_id, locationId: r.location_id, quantity: r.quantity,
}) : null

const toMerchInvTx = r => r ? ({
  id: r.id, variantId: r.variant_id, locationId: r.location_id,
  transactionType: r.transaction_type, quantityChange: r.quantity_change,
  orderId: r.order_id, notes: r.notes, createdBy: r.created_by, createdAt: r.created_at,
}) : null

// ─── Catalog reads ────────────────────────────────────────────
export async function fetchMerchCatalog(channel = 'all') {
  const { data, error } = await supabase.rpc('get_merch_catalog', { p_channel: channel })
  if (error) throw error
  return (data || []).map(toMerchProduct)
}

export async function fetchMerchCategories() {
  const { data, error } = await supabase.from('merch_categories').select('*').order('sort_order').limit(500)
  if (error) throw error
  return (data || []).map(toMerchCategory)
}

export async function fetchStockLocations() {
  const { data, error } = await supabase.from('merch_stock_locations').select('*').order('name')
  if (error) throw error
  return (data || []).map(toStockLocation)
}

export async function fetchMerchInventory(opts = {}) {
  let q = supabase.from('merch_inventory').select('*').limit(5000)
  if (opts.variantId) q = q.eq('variant_id', opts.variantId)
  if (opts.locationId) q = q.eq('location_id', opts.locationId)
  const { data, error } = await q
  if (error) throw error
  return (data || []).map(toMerchInventory)
}

export async function fetchMerchInventoryTransactions(opts = {}) {
  let q = supabase.from('merch_inventory_transactions').select('*').order('created_at', { ascending: false })
  if (opts.variantId) q = q.eq('variant_id', opts.variantId)
  if (opts.limit) q = q.limit(opts.limit)
  const { data, error } = await q
  if (error) throw error
  return (data || []).map(toMerchInvTx)
}

export async function fetchMerchOrders(opts = {}) {
  let q = supabase.from('merch_orders')
    .select('*, items:merch_order_items(*)')
    .order('created_at', { ascending: false })
  if (opts.userId) q = q.eq('user_id', opts.userId)
  if (opts.status) q = q.eq('status', opts.status)
  const { data, error } = await q
  if (error) throw error
  return (data || []).map(toMerchOrder)
}

export async function fetchMerchDiscounts() {
  const { data, error } = await supabase.from('merch_discounts').select('*').order('created_at', { ascending: false })
  if (error) throw error
  return (data || []).map(toMerchDiscount)
}

export async function fetchMerchGiftCodes(opts = {}) {
  let q = supabase.from('merch_gift_codes').select('*').order('created_at', { ascending: false })
  if (opts.status) q = q.eq('status', opts.status)
  const { data, error } = await q
  if (error) throw error
  return (data || []).map(toMerchGiftCode)
}

export async function fetchMerchReturns() {
  const { data, error } = await supabase.from('merch_returns').select('*').order('created_at', { ascending: false })
  if (error) throw error
  return (data || []).map(toMerchReturn)
}

export async function fetchPurchaseOrders() {
  const { data, error } = await supabase
    .from('merch_purchase_orders')
    .select('*, vendor:merch_vendors(name), lines:merch_po_lines(*, variant:merch_variants(id, label, sku, product:merch_products(name)))')
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data || []).map(toMerchPO)
}

export async function fetchVariantLocations(variantId) {
  const { data, error } = await supabase
    .from('merch_inventory')
    .select('quantity, location:merch_stock_locations(id, name)')
    .eq('variant_id', variantId)
  if (error) throw error
  return (data || []).map(r => ({ quantity: r.quantity, locationId: r.location.id, locationName: r.location.name }))
}

export async function fetchMerchVendors() {
  const { data, error } = await supabase.from('merch_vendors').select('*').eq('active', true).order('name').limit(500)
  if (error) throw error
  return (data || []).map(v => ({
    id: v.id, name: v.name, email: v.email, phone: v.phone,
    website: v.website, notes: v.notes, active: v.active,
  }))
}

export async function upsertMerchVendor(vendor) {
  const { data, error } = await supabase.rpc('upsert_merch_vendor', {
    p_id:      vendor.id      || null,
    p_name:    vendor.name,
    p_email:   vendor.email   || null,
    p_phone:   vendor.phone   || null,
    p_website: vendor.website || null,
    p_notes:   vendor.notes   || null,
    p_active:  vendor.active  ?? true,
  })
  if (error) throw error
  return data
}

export async function deleteMerchVendor(id) {
  const { error } = await supabase.rpc('delete_merch_vendor', { p_id: id })
  if (error) throw error
}

// ─── Direct mutations (manager/admin via RLS) ─────────────────
export async function upsertMerchCategory(cat) {
  const row = {
    name: cat.name, slug: cat.slug || cat.name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, ''),
    sku_code: cat.skuCode ? cat.skuCode.toUpperCase() : null,
    sort_order: cat.sortOrder ?? 0, active: cat.active ?? true,
    storefront_visible: cat.storefrontVisible ?? true, staff_visible: cat.staffVisible ?? true,
  }
  if (cat.id) row.id = cat.id
  const { data, error } = await supabase.from('merch_categories').upsert(row).select().single()
  if (error) throw error
  return toMerchCategory(data)
}

export async function upsertMerchProduct(product) {
  const imgs = product.imageUrls
  const imageUrlVal = imgs?.length > 1 ? JSON.stringify(imgs) : (imgs?.[0] || product.imageUrl || null)
  const row = {
    category_id: product.categoryId || null, type: product.type,
    name: product.name, description: product.description || null,
    sku: product.sku ? product.sku.toUpperCase() : null,
    sku_family_code: product.skuFamilyCode ? product.skuFamilyCode.toUpperCase() : null,
    base_price: product.basePrice ?? 0,
    image_url: imageUrlVal,
    storefront_visible: product.storefrontVisible ?? true, staff_visible: product.staffVisible ?? true,
    shippable: product.shippable ?? true, pickup_only: product.pickupOnly ?? false,
    returnable: product.returnable ?? true, return_window_days: product.returnWindowDays ?? 30,
    restockable: product.restockable ?? true,
    return_policy_note: product.type === 'bundle'
      ? (product.bundleSavingsPct != null ? String(product.bundleSavingsPct) : null)
      : (product.returnPolicyNote || null),
    active: product.active ?? true, archived: product.archived ?? false, sort_order: product.sortOrder ?? 0,
    internal_notes: product.internalNotes || null,
  }
  if (product.id) row.id = product.id
  const { data, error } = await supabase.from('merch_products').upsert(row).select().single()
  if (error) throw error
  return toMerchProduct(data)
}

export async function upsertMerchVariant(variant) {
  const row = {
    product_id: variant.productId, label: variant.label,
    sku: variant.sku ? variant.sku.toUpperCase() : null,
    sku_suffix: variant.skuSuffix ? variant.skuSuffix.toUpperCase() : null,
    price_override: variant.priceOverride ?? null,
    shipping_charge: variant.shippingCharge ?? 0,
    active: variant.active ?? true, storefront_visible: variant.storefrontVisible ?? true,
    staff_visible: variant.staffVisible ?? true, sort_order: variant.sortOrder ?? 0,
    reorder_point: variant.reorderPoint != null && variant.reorderPoint !== '' ? parseInt(variant.reorderPoint) : null,
    reorder_qty:   variant.reorderQty   != null && variant.reorderQty   !== '' ? parseInt(variant.reorderQty)   : null,
    discontinued: variant.discontinued ?? false,
    discontinued_at: variant.discontinued
      ? (variant.discontinuedAt || new Date().toISOString())
      : null,
  }
  if (variant.id) row.id = variant.id
  const { data, error } = await supabase.from('merch_variants').upsert(row).select().single()
  if (error) throw error
  const variantId = data.id

  // Sync vendor associations via junction table
  const vendors = variant.vendors || []
  await supabase.from('merch_variant_vendors').delete().eq('variant_id', variantId)
  if (vendors.length > 0) {
    // Ensure exactly one is marked primary; default to first if none set
    const hasPrimary = vendors.some(vv => vv.isPrimary)
    const rows = vendors.map((vv, i) => ({
      variant_id:     variantId,
      vendor_id:      vv.vendorId,
      vendor_sku:     vv.vendorSku  || null,
      cost:           vv.cost       != null && vv.cost       !== '' ? parseFloat(vv.cost)       : null,
      lead_time_days: vv.leadTimeDays != null && vv.leadTimeDays !== '' ? parseInt(vv.leadTimeDays) : null,
      is_primary:     hasPrimary ? (vv.isPrimary ?? false) : i === 0,
    }))
    const { error: vErr } = await supabase.from('merch_variant_vendors').insert(rows)
    if (vErr) throw vErr
  }

  return variantId
}

export async function deleteMerchVariant(id) {
  const { error } = await supabase.from('merch_variants').delete().eq('id', id)
  if (error) throw error
}

export async function getMerchProductDeletionBlockers(product) {
  const blockers = []

  // Sales history
  const { count: salesCount } = await supabase
    .from('merch_order_items').select('id', { count: 'exact', head: true })
    .eq('product_id', product.id)
  if (salesCount > 0) blockers.push(`${salesCount} sale${salesCount !== 1 ? 's' : ''} on record`)

  // Inventory on hand (already loaded on variants)
  if (product.variants.some(v => v.inventory > 0))
    blockers.push('inventory on hand')

  // Pending purchase order lines
  const variantIds = product.variants.map(v => v.id)
  if (variantIds.length > 0) {
    const { data: lines } = await supabase
      .from('merch_po_lines')
      .select('qty_ordered, qty_received, merch_purchase_orders!inner(status)')
      .in('variant_id', variantIds)
    const pending = (lines || []).filter(l =>
      !['received', 'cancelled'].includes(l.merch_purchase_orders?.status) &&
      (l.qty_received ?? 0) < (l.qty_ordered ?? 0)
    )
    if (pending.length > 0) blockers.push('pending purchase orders')
  }

  return blockers
}

export async function deleteMerchProduct(id) {
  const { error } = await supabase.from('merch_products').delete().eq('id', id)
  if (error) throw error
}

export async function upsertMerchDiscount(discount) {
  const row = {
    code: discount.code.toUpperCase(), description: discount.description || null,
    discount_type: discount.discountType, amount: discount.amount,
    applies_to: discount.appliesTo || 'all',
    category_id: discount.categoryId || null, product_id: discount.productId || null,
    active: discount.active ?? true, usage_limit: discount.usageLimit || null,
    starts_at: discount.startsAt || null, ends_at: discount.endsAt || null,
    channel: discount.channel || 'both',
  }
  if (discount.id) row.id = discount.id
  const { data, error } = await supabase.from('merch_discounts').upsert(row).select().single()
  if (error) throw error
  return toMerchDiscount(data)
}

export async function upsertStockLocation(loc) {
  const row = {
    name: loc.name, level_labels: loc.levelLabels || {},
    is_default: loc.isDefault ?? false, active: loc.active ?? true,
  }
  if (loc.id) row.id = loc.id
  const { data, error } = await supabase.from('merch_stock_locations').upsert(row).select().single()
  if (error) throw error
  return toStockLocation(data)
}

export async function upsertBundleComponents(bundleProductId, components) {
  await supabase.from('merch_bundle_components').delete().eq('bundle_product_id', bundleProductId)
  if (!components.length) return
  const { error } = await supabase.from('merch_bundle_components').insert(
    components.map(c => ({ bundle_product_id: bundleProductId, component_variant_id: c.variantId, quantity: c.quantity }))
  )
  if (error) throw error
}

export async function fetchBundleComponents(bundleProductId) {
  const { data, error } = await supabase
    .from('merch_bundle_components')
    .select('component_variant_id, quantity')
    .eq('bundle_product_id', bundleProductId)
  if (error) throw error
  return (data || []).map(r => ({ variantId: r.component_variant_id, quantity: r.quantity }))
}

export async function uploadMerchImage(file) {
  const ext = file.name.split('.').pop().toLowerCase()
  const path = `products/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
  const { error } = await supabase.storage.from('merch-images').upload(path, file, { cacheControl: '3600', upsert: false })
  if (error) throw error
  const { data } = supabase.storage.from('merch-images').getPublicUrl(path)
  return data.publicUrl
}

export async function voidGiftCode(id) {
  const { error } = await supabase.from('merch_gift_codes').update({ status: 'voided' }).eq('id', id)
  if (error) throw error
}

export async function updateMerchOrderStatus(id, status) {
  const { error } = await supabase.from('merch_orders').update({ status }).eq('id', id)
  if (error) throw error
}

// ─── RPC wrappers ─────────────────────────────────────────────
export async function validateMerchDiscount(code, channel = 'online') {
  const { data, error } = await supabase.rpc('validate_merch_discount', { p_code: code, p_channel: channel })
  if (error) throw error
  return data ? toMerchDiscount(data) : null
}

export async function adjustMerchInventory(variantId, locationId, quantityChange, transactionType, notes, createdBy) {
  const { error } = await supabase.rpc('adjust_merch_inventory', {
    p_variant_id: variantId, p_location_id: locationId ?? null,
    p_quantity_change: quantityChange, p_transaction_type: transactionType,
    p_notes: notes ?? null, p_created_by: createdBy ?? null,
  })
  if (error) throw error
}

export async function createMerchOrder(params) {
  const { data, error } = await supabase.rpc('create_merch_order', {
    p_user_id: params.userId ?? null,
    p_customer_name: params.customerName,
    p_fulfillment_type: params.fulfillmentType || 'pickup',
    p_shipping_address: params.shippingAddress ?? null,
    p_items: params.items,
    p_discount_id: params.discountId ?? null,
    p_discount_amount: params.discountAmount ?? 0,
    p_shipping_charge: params.shippingCharge ?? 0,
    p_notes: params.notes ?? null,
  })
  if (error) throw error
  return toMerchOrder(data)
}

export async function processMerchReturn(params) {
  const { error } = await supabase.rpc('process_merch_return', {
    p_order_id: params.orderId, p_order_item_id: params.orderItemId,
    p_quantity: params.quantity, p_reason: params.reason,
    p_disposition: params.disposition, p_notes: params.notes ?? null,
    p_created_by: params.createdBy ?? null,
  })
  if (error) throw error
}

export async function createPurchaseOrder(po) {
  const { data, error } = await supabase.rpc('create_purchase_order', {
    p_vendor_id:   po.vendorId,
    p_expected_by: po.expectedBy || null,
    p_notes:       po.notes     || null,
    p_lines:       po.lines     || [],
  })
  if (error) throw error
  return data
}

export async function receivePOLine(poLineId, qty, locationId, notes) {
  const { error } = await supabase.rpc('receive_po_line', {
    p_po_line_id:  poLineId,
    p_qty:         qty,
    p_location_id: locationId || null,
    p_notes:       notes      || null,
  })
  if (error) throw error
}

export async function updatePOStatus(poId, status) {
  const { error } = await supabase.rpc('update_po_status', { p_po_id: poId, p_status: status })
  if (error) throw error
}

export async function fulfillMerchOrder(orderId, { trackingNumber, carrier, notes } = {}) {
  const { error } = await supabase.rpc('fulfill_merch_order', {
    p_order_id:        orderId,
    p_tracking_number: trackingNumber || null,
    p_carrier:         carrier        || null,
    p_notes:           notes          || null,
  })
  if (error) throw error
}

export async function transferMerchInventory(variantId, fromLocationId, toLocationId, qty, notes) {
  const { data, error } = await supabase.rpc('transfer_merch_inventory', {
    p_variant_id:       variantId,
    p_from_location_id: fromLocationId,
    p_to_location_id:   toLocationId,
    p_qty:              qty,
    p_notes:            notes || null,
  })
  if (error) throw error
  return data
}

export async function redeemGiftCode(code, redeemedBy, amountToRedeem) {
  const { data, error } = await supabase.rpc('redeem_gift_code', {
    p_code: code, p_redeemed_by: redeemedBy ?? null, p_amount_to_redeem: amountToRedeem ?? null,
  })
  if (error) throw error
  return data
}
