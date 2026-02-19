import { createClient } from '@supabase/supabase-js'

// ── Set these in Vercel Environment Variables and in .env.local for local dev
// Supabase Dashboard → Project → Settings → API
const SUPABASE_URL  = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_ANON = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON)


// ============================================================
// HELPERS — convert snake_case DB rows to camelCase app objects
// ============================================================

const toUser = r => r ? ({
  id:                 r.id,
  name:               r.name,
  phone:              r.phone,
  email:              r.email,
  authId:             r.auth_id,
  access:             r.access,
  role:               r.role,
  active:             r.active,
  authProvider:       r.auth_provider,
  needsRewaiverDocId: r.needs_rewaiver_doc_id,
  waivers:            r.waivers ?? [],
}) : null

const toWaiverDoc = r => r ? ({
  id:        r.id,
  name:      r.name,
  version:   r.version,
  body:      r.body,
  active:    r.active,
  createdAt: r.created_at,
}) : null

const toResType = r => r ? ({
  id:                  r.id,
  name:                r.name,
  mode:                r.mode,
  style:               r.style,
  pricingMode:         r.pricing_mode,
  price:               Number(r.price),
  maxPlayers:          r.max_players,
  description:         r.description,
  active:              r.active,
  availableForBooking: r.available_for_booking,
}) : null

const toSessionTemplate = r => r ? ({
  id:          r.id,
  dayOfWeek:   r.day_of_week,
  startTime:   r.start_time,
  maxSessions: r.max_sessions,
  active:      r.active,
}) : null

const toReservation = r => r ? ({
  id:           r.id,
  typeId:       r.type_id,
  userId:       r.user_id,
  customerName: r.customer_name,
  date:         r.date,
  startTime:    r.start_time,
  playerCount:  r.player_count,
  amount:       Number(r.amount),
  status:       r.status,
  players:      r.players ?? [],
}) : null

const toShift = r => r ? ({
  id:           r.id,
  staffId:      r.staff_id,
  date:         r.date,
  start:        r.start_time ?? r.start,
  end:          r.end_time   ?? r.end,
  open:         r.open ?? false,
  conflicted:   r.conflicted ?? false,
  conflictNote: r.conflict_note,
}) : null


// ============================================================
// USERS
// ============================================================

export async function fetchAllUsers() {
  const { data, error } = await supabase.from('users').select('*').order('name')
  if (error) throw error
  return data.map(toUser)
}

export async function fetchUserByPhone(phone) {
  const { data, error } = await supabase
    .from('users').select('*').eq('phone', phone).maybeSingle()
  if (error) throw error
  return toUser(data)
}

export async function createUser(user) {
  const { data, error } = await supabase.from('users').insert({
    name:                 user.name,
    phone:                user.phone ?? null,
    email:                user.email ?? null,
    auth_id:              user.authId ?? null,
    access:               user.access ?? 'customer',
    role:                 user.role ?? null,
    active:               user.active ?? true,
    auth_provider:        user.authProvider ?? null,
    needs_rewaiver_doc_id:user.needsRewaiverDocId ?? null,
    waivers:              user.waivers ?? [],
  }).select().single()
  if (error) throw error
  return toUser(data)
}

export async function updateUser(id, changes) {
  const row = {}
  if (changes.name               !== undefined) row.name                  = changes.name
  if (changes.phone              !== undefined) row.phone                 = changes.phone
  if (changes.access             !== undefined) row.access                = changes.access
  if (changes.role               !== undefined) row.role                  = changes.role
  if (changes.active             !== undefined) row.active                = changes.active
  if (changes.email              !== undefined) row.email                 = changes.email
  if (changes.authId             !== undefined) row.auth_id               = changes.authId
  if (changes.authProvider       !== undefined) row.auth_provider         = changes.authProvider
  if (changes.needsRewaiverDocId !== undefined) row.needs_rewaiver_doc_id = changes.needsRewaiverDocId
  if (changes.waivers            !== undefined) row.waivers               = changes.waivers
  const { data, error } = await supabase.from('users').update(row).eq('id', id).select().single()
  if (error) throw error
  return toUser(data)
}

export async function deleteUser(id) {
  const { error } = await supabase.from('users').delete().eq('id', id)
  if (error) throw error
}

// Sign a waiver — appends to user's waivers array and clears re-sign flag
export async function signWaiver(userId, signedName, waiverDocId) {
  // First get current waivers
  const { data: current, error: fetchErr } = await supabase
    .from('users').select('waivers').eq('id', userId).single()
  if (fetchErr) throw fetchErr
  const updated = [...(current.waivers ?? []), {
    signedAt:    new Date().toISOString(),
    signedName,
    waiverDocId,
  }]
  return updateUser(userId, { waivers: updated, needsRewaiverDocId: null })
}


// ============================================================
// WAIVER DOCS
// ============================================================

export async function fetchWaiverDocs() {
  const { data, error } = await supabase.from('waiver_docs').select('*').order('created_at', { ascending: false })
  if (error) throw error
  return data.map(toWaiverDoc)
}

export async function upsertWaiverDoc(doc) {
  const { data, error } = await supabase.from('waiver_docs').upsert({
    id:         doc.id,
    name:       doc.name,
    version:    doc.version,
    body:       doc.body,
    active:     doc.active ?? false,
    created_at: doc.createdAt ?? new Date().toISOString(),
  }).select().single()
  if (error) throw error
  return toWaiverDoc(data)
}

export async function setActiveWaiverDoc(id) {
  // Deactivate all, then activate the chosen one
  const { error: e1 } = await supabase.from('waiver_docs').update({ active: false }).neq('id', id)
  if (e1) throw e1
  const { error: e2 } = await supabase.from('waiver_docs').update({ active: true }).eq('id', id)
  if (e2) throw e2
  // Flag all users as needing re-sign
  const { error: e3 } = await supabase.from('users').update({ needs_rewaiver_doc_id: id }).eq('access', 'customer')
  if (e3) throw e3
}

export async function deleteWaiverDoc(id) {
  const { error } = await supabase.from('waiver_docs').delete().eq('id', id)
  if (error) throw error
}


// ============================================================
// RESERVATION TYPES
// ============================================================

export async function fetchResTypes() {
  const { data, error } = await supabase.from('reservation_types').select('*').order('name')
  if (error) throw error
  return data.map(toResType)
}

export async function upsertResType(rt) {
  const { data, error } = await supabase.from('reservation_types').upsert({
    id:                   rt.id,
    name:                 rt.name,
    mode:                 rt.mode,
    style:                rt.style,
    pricing_mode:         rt.pricingMode,
    price:                rt.price,
    max_players:          rt.maxPlayers ?? null,
    description:          rt.description ?? '',
    active:               rt.active ?? true,
    available_for_booking:rt.availableForBooking ?? true,
  }).select().single()
  if (error) throw error
  return toResType(data)
}

export async function deleteResType(id) {
  const { error } = await supabase.from('reservation_types').delete().eq('id', id)
  if (error) throw error
}


// ============================================================
// SESSION TEMPLATES
// ============================================================

export async function fetchSessionTemplates() {
  const { data, error } = await supabase.from('session_templates').select('*').order('day_of_week').order('start_time')
  if (error) throw error
  return data.map(toSessionTemplate)
}

export async function upsertSessionTemplate(st) {
  const { data, error } = await supabase.from('session_templates').upsert({
    id:          st.id,
    day_of_week: st.dayOfWeek,
    start_time:  st.startTime,
    max_sessions:st.maxSessions ?? 1,
    active:      st.active ?? true,
  }).select().single()
  if (error) throw error
  return toSessionTemplate(data)
}

export async function deleteSessionTemplate(id) {
  const { error } = await supabase.from('session_templates').delete().eq('id', id)
  if (error) throw error
}


// ============================================================
// RESERVATIONS
// ============================================================

export async function fetchReservations() {
  const { data, error } = await supabase
    .from('reservations').select('*').order('date', { ascending: false }).order('start_time')
  if (error) throw error
  return data.map(toReservation)
}

export async function createReservation(res) {
  const { data, error } = await supabase.from('reservations').insert({
    type_id:       res.typeId,
    user_id:       res.userId,
    customer_name: res.customerName,
    date:          res.date,
    start_time:    res.startTime,
    player_count:  res.playerCount,
    amount:        res.amount,
    status:        res.status ?? 'confirmed',
    players:       res.players ?? [],
  }).select().single()
  if (error) throw error
  return toReservation(data)
}

export async function updateReservation(id, changes) {
  const row = {}
  if (changes.status      !== undefined) row.status       = changes.status
  if (changes.playerCount !== undefined) row.player_count = changes.playerCount
  if (changes.players     !== undefined) row.players      = changes.players
  if (changes.amount      !== undefined) row.amount       = changes.amount
  const { data, error } = await supabase.from('reservations').update(row).eq('id', id).select().single()
  if (error) throw error
  return toReservation(data)
}

export async function addPlayerToReservation(resId, player, currentPlayers) {
  return updateReservation(resId, { players: [...currentPlayers, player] })
}


// ============================================================
// SHIFTS
// ============================================================

export async function fetchShifts() {
  const { data, error } = await supabase.from('shifts').select('*').order('date').order('start')
  if (error) throw error
  return data.map(toShift)
}

export async function createShift(shift) {
  const { data, error } = await supabase.from('shifts').insert({
    staff_id:      shift.staffId ?? null,
    date:          shift.date,
    start_time:    shift.start,
    end_time:      shift.end,
    open:          shift.open ?? false,
    conflicted:    shift.conflicted ?? false,
    conflict_note: shift.conflictNote ?? null,
  }).select().single()
  if (error) throw error
  return toShift(data)
}

export async function updateShift(id, changes) {
  const row = {}
  if (changes.staffId      !== undefined) row.staff_id      = changes.staffId
  if (changes.open         !== undefined) row.open          = changes.open
  if (changes.conflicted   !== undefined) row.conflicted    = changes.conflicted
  if (changes.conflictNote !== undefined) row.conflict_note = changes.conflictNote
  const { data, error } = await supabase.from('shifts').update(row).eq('id', id).select().single()
  if (error) throw error
  return toShift(data)
}

export async function deleteShift(id) {
  const { error } = await supabase.from('shifts').delete().eq('id', id)
  if (error) throw error
}
