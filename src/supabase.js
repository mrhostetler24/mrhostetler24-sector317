import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL  = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_ANON = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON)

// ============================================================
// SCORE CALCULATION
// Formula: GREATEST(0, ROUND((100 - X) × multiplier - T))
//   X          = 80 if objective failed, else 0
//   multiplier = 1.0 + visual_add + audio_add
//     V → +0.0, C → +0.2, R → +0.2, S → +0.4, CS → +0.4, B → +0.8
//     audio: cranked (C) → +0.2, Off (O) / Tunes (T) → +0.0
//   T = 15 if targets NOT eliminated, else 0
// ============================================================
export function calculateRunScore({ visual, cranked, audio, targetsEliminated, objectiveComplete }) {
  const visualAdd = { V: 0.0, C: 0.2, R: 0.2, S: 0.4, CS: 0.4, B: 0.8 }[visual] ?? 0.0
  const audioCranked = audio ? audio === 'C' : !!cranked // new audio code or legacy boolean
  const multiplier = 1.0 + visualAdd + (audioCranked ? 0.2 : 0.0)
  const X = objectiveComplete ? 0 : 80
  const T = targetsEliminated ? 0 : 15
  return Math.max(0, Math.round((100 - X) * multiplier - T))
}


// ============================================================
// HELPERS — map DB rows to app objects
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
  leaderboardName:        r.leaderboard_name ?? null,
  hideFromLeaderboard:    r.hide_from_leaderboard ?? false,
  isReal:                 r.is_real ?? true,
  createdByUserId:    r.created_by_user_id ?? null,
  createdAt:          r.created_at ?? null,
  avatarUrl:          r.avatar_url ?? null,
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
  paid:         r.paid ?? false,
  rescheduled:  r.rescheduled ?? false,
  players:      r.players ?? [],
  createdAt:    r.created_at ?? null,
}) : null

const toShift = r => r ? ({
  id:             r.id,
  staffId:        r.staff_id,
  date:           r.date,
  start:          r.start_time,
  end:            r.end_time,
  open:           r.open ?? false,
  conflicted:     r.conflicted ?? false,
  conflictNote:   r.conflict_note,
  templateSlotId: r.template_slot_id ?? null,
  role:           r.role ?? null,
}) : null

const toReservationPlayer = r => r ? ({
  id:                  r.id,
  reservationId:       r.reservation_id,
  userId:              r.user_id ?? null,
  name:                r.name,
  team:                r.team ?? null,
  scoredReservationId: r.scored_reservation_id ?? null,
}) : null

const toRun = r => r ? ({
  id:                 r.id,
  reservationId:      r.reservation_id,
  runNumber:          r.run_number,
  structure:          r.structure,
  visual:             r.visual,
  cranked:            r.cranked,
  audio:              r.audio ?? null,
  targetsEliminated:  r.targets_eliminated,
  objectiveComplete:  r.objective_complete,
  elapsedSeconds:     r.elapsed_seconds,
  score:              r.score,
  scoredBy:           r.scored_by,
  objectiveId:        r.objective_id,
  team:               r.team,
  liveOpDifficulty:   r.live_op_difficulty,
  winningTeam:        r.winning_team,
  createdAt:          r.created_at,
  updatedAt:          r.updated_at,
}) : null

const toSetting = r => r ? ({
  key:         r.key,
  value:       r.value,
  label:       r.label,
  description: r.description,
}) : null

const toLeaderboardEntry = r => r ? ({
  playerId:            r.player_id,
  playerName:          r.player_name,
  leaderboardScore:    Number(r.leaderboard_score),
  bestSession:         r.best_session,
  totalScoreAll:       r.total_score_all,
  sessionsInAvg:       r.sessions_in_avg,
  totalSessionsPlayed: r.total_sessions_played,
  rank:                r.rank_all_time ?? r.rank_weekly ?? r.rank_monthly ?? r.rank_yearly,
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
  // Try SECURITY DEFINER RPC first (bypasses RLS, works for all user types)
  const { data, error } = await supabase
    .rpc('lookup_user_by_phone', { p_phone: phone })
  if (!error && data) {
    // RPC returns SETOF — take the first row (ordered: auth'd accounts first)
    const row = Array.isArray(data) ? (data[0] ?? null) : (data ?? null)
    return row ? toUser(row) : null
  }
  // RPC failed or not deployed — fall back to direct query (works for staff/admin only)
  const { data: d2, error: e2 } = await supabase
    .from('users').select('*').eq('phone', phone).limit(1).maybeSingle()
  if (e2) return null  // RLS blocked it — return null rather than crash
  return toUser(d2)
}

export async function linkAuthToGuest(userId, authId, email, provider) {
  // SECURITY DEFINER RPC — links OAuth credentials to an existing guest account,
  // bypassing RLS (a guest row has auth_id=null so normal UPDATE policies block it)
  const { data, error } = await supabase.rpc('link_auth_to_guest', {
    p_user_id:  userId,
    p_auth_id:  authId,
    p_email:    email  ?? '',
    p_provider: provider ?? '',
  })
  if (error) throw error
  // RPC returns a single users row
  const row = Array.isArray(data) ? (data[0] ?? null) : (data ?? null)
  return row ? toUser(row) : null
}

export async function fetchUserByEmail(email) {
  const { data, error } = await supabase
    .from('users').select('*').eq('email', email).maybeSingle()
  if (error) throw error
  return toUser(data)
}

export async function createUser(user) {
  const { data, error } = await supabase.from('users').insert({
    name:                  user.name,
    phone:                 user.phone ?? null,
    email:                 user.email ?? null,
    auth_id:               user.authId ?? null,
    access:                user.access ?? 'customer',
    role:                  user.role ?? null,
    active:                user.active ?? true,
    auth_provider:         user.authProvider ?? null,
    needs_rewaiver_doc_id: user.needsRewaiverDocId ?? null,
    waivers:               user.waivers ?? [],
    leaderboard_name:      user.leaderboardName ?? null,
    is_real:               true,
    created_by_user_id:    user.createdByUserId ?? null,
  }).select().single()
  if (error) throw error
  return toUser(data)
}

/**
 * Create a minimal guest/placeholder user record when someone is added to a
 * reservation by phone number but has no existing account.
 * - access: 'customer', no authProvider (they haven't signed in yet)
 * - createdByUserId: the staff/customer who added them via the reservation screen
 * - is_real: true — this is a real person who needs to complete signup on arrival
 */
// Compute default leaderboard name: initials + last 4 of phone (e.g. "AB-1234")
const _NAME_SUFFIXES = new Set(['jr','jr.','sr','sr.','ii','iii','iv','v','vi','esq','esq.'])
function _guestLbName(name, phone) {
  const clean = (phone || '').replace(/\D/g, '')
  const last4 = clean.length >= 4 ? clean.slice(-4) : '0000'
  const parts = (name || '').trim().split(/\s+/)
  while (parts.length > 1 && _NAME_SUFFIXES.has(parts[parts.length - 1].toLowerCase())) parts.pop()
  const initials = parts.length >= 2
    ? parts[0][0].toUpperCase() + parts[parts.length - 1][0].toUpperCase()
    : (name || '').slice(0, 2).toUpperCase()
  return `${initials}-${last4}`
}

export async function createGuestUser({ name, phone, createdByUserId }) {
  const leaderboardName = _guestLbName(name, phone)

  // Try updated RPC (with p_leaderboard_name) — SECURITY DEFINER bypasses RLS
  const { data: rpcData, error: rpcErr } = await supabase
    .rpc('create_guest_user', {
      p_name:               name,
      p_phone:              phone ?? null,
      p_created_by_user_id: createdByUserId ?? null,
      p_leaderboard_name:   leaderboardName,
    })
  if (!rpcErr && rpcData) {
    const row = Array.isArray(rpcData) ? rpcData[0] : rpcData
    return toUser(row)
  }

  // Fallback: old RPC signature (before migration adds p_leaderboard_name)
  const { data: rpcOld, error: rpcOldErr } = await supabase
    .rpc('create_guest_user', {
      p_name:               name,
      p_phone:              phone ?? null,
      p_created_by_user_id: createdByUserId ?? null,
    })
  if (!rpcOldErr && rpcOld) {
    const row = Array.isArray(rpcOld) ? rpcOld[0] : rpcOld
    const created = toUser(row)
    // Best-effort patch of leaderboard name on the created row
    await supabase.from('users').update({ leaderboard_name: leaderboardName }).eq('id', created.id)
    return { ...created, leaderboardName }
  }

  // Last resort: direct insert (requires permissive RLS INSERT policy)
  const { data, error } = await supabase.from('users').insert({
    name,
    phone:                 phone ?? null,
    access:                'customer',
    active:                true,
    waivers:               [],
    is_real:               true,
    auth_provider:         null,
    created_by_user_id:    createdByUserId ?? null,
    leaderboard_name:      leaderboardName,
  }).select().single()
  if (error) throw new Error(
    `Could not create guest user — RPC: ${rpcOldErr?.message ?? rpcErr?.message ?? 'n/a'}, Direct: ${error.message}`
  )
  return toUser(data)
}

// Admin-only update via SECURITY DEFINER RPC (bypasses RLS for manager/admin editing other users)
export async function updateUserAdmin(id, { name, phone, access, role, active, leaderboardName, hideFromLeaderboard }) {
  const params = {
    p_user_id: id,
    p_name:    name    ?? null,
    p_phone:   phone   ?? null,
    p_access:  access  ?? null,
    p_role:    role    ?? null,
    p_active:  active  ?? null,
  }
  if (leaderboardName      !== undefined) params.p_leaderboard_name      = leaderboardName
  if (hideFromLeaderboard  !== undefined) params.p_hide_from_leaderboard = hideFromLeaderboard
  const { data, error } = await supabase.rpc('admin_update_user', params)
  if (error) throw error
  const row = Array.isArray(data) ? data[0] : data
  return toUser(row)
}

export async function updateUser(id, changes) {
  const row = {}
  if (changes.name               !== undefined) row.name                  = changes.name
  if (changes.phone              !== undefined) row.phone                 = changes.phone
  if (changes.email              !== undefined) row.email                 = changes.email
  if (changes.authId             !== undefined) row.auth_id               = changes.authId
  if (changes.access             !== undefined) row.access                = changes.access
  if (changes.role               !== undefined) row.role                  = changes.role
  if (changes.active             !== undefined) row.active                = changes.active
  if (changes.authProvider       !== undefined) row.auth_provider         = changes.authProvider
  if (changes.needsRewaiverDocId !== undefined) row.needs_rewaiver_doc_id = changes.needsRewaiverDocId
  if (changes.waivers            !== undefined) row.waivers               = changes.waivers
  if (changes.leaderboardName        !== undefined) row.leaderboard_name       = changes.leaderboardName
  if (changes.hideFromLeaderboard    !== undefined) row.hide_from_leaderboard  = changes.hideFromLeaderboard
  const { data, error } = await supabase.from('users').update(row).eq('id', id).select().single()
  if (error) throw error
  return toUser(data)
}

// Customer self-update via SECURITY DEFINER RPC (bypasses RLS auth_id mismatch).
export async function updateOwnProfile(id, { name, phone, leaderboardName, hideFromLeaderboard }) {
  const { data, error } = await supabase.rpc('update_own_profile', {
    p_user_id:               id,
    p_name:                  name,
    p_phone:                 phone,
    p_leaderboard_name:      leaderboardName,
    p_hide_from_leaderboard: hideFromLeaderboard,
  })
  if (error) throw error
  const row = Array.isArray(data) ? data[0] : data
  return toUser(row)
}

// Links an OAuth identity to an existing user row via SECURITY DEFINER RPC,
// bypassing RLS for the case where auth_id is not yet set on the row.
export async function linkOAuthUser(id, authId, email, authProvider) {
  const { data, error } = await supabase.rpc('link_oauth_user', {
    p_user_id:       id,
    p_auth_id:       authId ?? null,
    p_email:         email ?? null,
    p_auth_provider: authProvider ?? null,
  })
  if (error) throw error
  return toUser(data)
}

export async function deleteUser(id) {
  const { error } = await supabase.from('users').delete().eq('id', id)
  if (error) throw error
}

export async function signWaiver(userId, signedName, waiverDocId) {
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
  const { data, error } = await supabase
    .from('waiver_docs').select('*').order('created_at', { ascending: false })
  if (error) throw error
  return data.map(toWaiverDoc)
}

export async function upsertWaiverDoc(doc) {
  const row = {
    name:    doc.name,
    version: doc.version,
    body:    doc.body,
    active:  doc.active ?? false,
  }
  if (doc.id) row.id = doc.id
  const { data, error } = await supabase
    .from('waiver_docs').upsert(row).select().single()
  if (error) throw error
  return toWaiverDoc(data)
}

export async function setActiveWaiverDoc(id) {
  const { error: e1 } = await supabase
    .from('waiver_docs').update({ active: false }).neq('id', id)
  if (e1) throw e1
  const { error: e2 } = await supabase
    .from('waiver_docs').update({ active: true }).eq('id', id)
  if (e2) throw e2
  const { error: e3 } = await supabase
    .from('users').update({ needs_rewaiver_doc_id: id }).eq('access', 'customer')
  if (e3) throw e3
}

export async function deleteWaiverDoc(id) {
  const { error } = await supabase.from('waiver_docs').delete().eq('id', id)
  if (error) throw error
}


// ============================================================
// STAFF ROLES (canonical role list)
// ============================================================

export async function fetchStaffRoles() {
  const { data, error } = await supabase
    .from('staff_roles').select('name').order('sort_order')
  if (error) throw error
  return (data ?? []).map(r => r.name)
}

export async function upsertStaffRole(name, sortOrder) {
  const { error } = await supabase
    .from('staff_roles')
    .upsert({ name, sort_order: sortOrder }, { onConflict: 'name' })
  if (error) throw error
}

export async function deleteStaffRole(name) {
  const { error } = await supabase.from('staff_roles').delete().eq('name', name)
  if (error) throw error
}

// ============================================================
// RESERVATION TYPES
// ============================================================

export async function fetchResTypes() {
  const { data, error } = await supabase
    .from('reservation_types').select('*').order('name')
  if (error) throw error
  return data.map(toResType)
}

export async function upsertResType(rt) {
  const row = {
    name:                  rt.name,
    mode:                  rt.mode,
    style:                 rt.style,
    pricing_mode:          rt.pricingMode,
    price:                 rt.price,
    max_players:           rt.maxPlayers ?? null,
    description:           rt.description ?? '',
    active:                rt.active ?? true,
    available_for_booking: rt.availableForBooking ?? true,
  }
  if (rt.id) row.id = rt.id
  const { data, error } = await supabase
    .from('reservation_types').upsert(row).select().single()
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
  const { data, error } = await supabase
    .from('session_templates').select('*')
    .order('day_of_week').order('start_time')
  if (error) throw error
  return data.map(toSessionTemplate)
}

export async function upsertSessionTemplate(st) {
  const row = {
    day_of_week:  st.dayOfWeek,
    start_time:   st.startTime,
    max_sessions: st.maxSessions ?? 1,
    active:       st.active ?? true,
  }
  if (st.id) row.id = st.id
  const { data, error } = await supabase
    .from('session_templates').upsert(row).select().single()
  if (error) throw error
  return toSessionTemplate(data)
}

export async function deleteSessionTemplate(id) {
  const { error } = await supabase.from('session_templates').delete().eq('id', id)
  if (error) throw error
}


// ============================================================
// PAYMENTS
// ============================================================

const toPayment = p => p ? ({
  id:            p.id,
  userId:        p.user_id,
  reservationId: p.reservation_id,
  customerName:  p.customer_name,
  amount:        Number(p.amount),
  status:        p.status,
  snapshot:      p.snapshot ?? {},
  createdAt:     p.created_at,
}) : null

export async function createPayment(payment) {
  const { data, error } = await supabase.from('payments').insert({
    user_id:        payment.userId,
    reservation_id: payment.reservationId,
    customer_name:  payment.customerName,
    amount:         payment.amount,
    status:         payment.status ?? 'paid',
    snapshot:       payment.snapshot ?? {},
  }).select().single()
  if (error) throw error
  return toPayment(data)
}

export async function fetchPayments() {
  const { data, error } = await supabase
    .from('payments').select('*').order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []).map(toPayment)
}

export async function mergeUsers(winnerId, loserId) {
  const { error } = await supabase.rpc('merge_user_accounts', {
    p_winner_id: winnerId,
    p_loser_id:  loserId,
  })
  if (error) throw error
}


// ============================================================
// RESERVATIONS
// ============================================================

const mergePlayersIntoReservations = (resRows, playerRows) => {
  const all = playerRows ?? []
  return (resRows ?? []).map(r => ({
    ...toReservation(r),
    players: all
      .filter(p => p.reservation_id === r.id)
      .map(p => ({ id: p.id, userId: p.user_id ?? null, name: p.name })),
  }))
}

const rpcRowsToReservations = rows =>
  rows.map(row => ({
    ...toReservation(row),
    players: (row.players ?? []).map(p => ({ id: p.id, userId: p.user_id ?? null, name: p.name })),
  }))

export async function fetchAvailabilityReservations() {
  const { data, error } = await supabase.rpc('get_availability_reservations')
  if (error) throw error
  return (data ?? []).map(r => ({
    id: r.id, date: r.date, startTime: r.start_time,
    typeId: r.type_id, playerCount: r.player_count, status: r.status, players: [],
  }))
}

export async function fetchReservations() {
  // Try SECURITY DEFINER RPC — bypasses RLS on reservation_players
  const { data: rpcData, error: rpcErr } = await supabase
    .rpc('get_reservations_with_players')
  if (rpcErr) console.error('[fetchReservations] RPC error:', rpcErr.message, rpcErr.code)
  if (!rpcErr && rpcData) return rpcRowsToReservations(rpcData)

  // Fallback: direct query (subject to RLS)
  const { data: resData, error: resErr } = await supabase
    .from('reservations')
    .select('*')
    .order('date', { ascending: true })
    .order('start_time', { ascending: true })
  if (resErr) throw resErr

  const ids = (resData ?? []).map(r => r.id)
  const { data: playerData, error: playerErr } = ids.length
    ? await supabase.from('reservation_players').select('*').in('reservation_id', ids)
    : { data: [] }
  if (playerErr) {
    console.error('[fetchReservations] reservation_players RLS blocked:', playerErr.message, playerErr.code)
    return mergePlayersIntoReservations(resData, [])
  }

  return mergePlayersIntoReservations(resData, playerData)
}

export async function fetchTodaysReservations() {
  const today = new Date().toISOString().split('T')[0]

  // Try SECURITY DEFINER RPC — bypasses RLS on reservation_players
  const { data: rpcData, error: rpcErr } = await supabase
    .rpc('get_reservations_with_players', { p_date: today })
  if (rpcErr) console.error('[fetchTodaysReservations] RPC error:', rpcErr.message, rpcErr.code)
  if (!rpcErr && rpcData) return rpcRowsToReservations(rpcData)

  // Fallback: direct query (subject to RLS)
  const { data: resData, error: resErr } = await supabase
    .from('reservations')
    .select('*')
    .eq('date', today)
    .neq('status', 'cancelled')
    .order('start_time')
  if (resErr) throw resErr

  const ids = (resData ?? []).map(r => r.id)
  const { data: playerData, error: playerErr } = ids.length
    ? await supabase.from('reservation_players').select('*').in('reservation_id', ids)
    : { data: [] }
  if (playerErr) {
    console.error('[fetchTodaysReservations] reservation_players RLS blocked:', playerErr.message, playerErr.code)
    return mergePlayersIntoReservations(resData, [])
  }

  return mergePlayersIntoReservations(resData, playerData)
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
    paid:          res.paid ?? false,
    players:       res.players ?? [],
  }).select().single()
  if (error) throw error
  return toReservation(data)
}

export async function updateReservation(id, changes) {
  const row = {}
  if (changes.status      !== undefined) row.status       = changes.status
  if (changes.playerCount !== undefined) row.player_count = changes.playerCount
  if (changes.amount      !== undefined) row.amount       = changes.amount
  if (changes.paid        !== undefined) row.paid         = changes.paid
  if (changes.date        !== undefined) row.date         = changes.date
  if (changes.startTime   !== undefined) row.start_time   = changes.startTime
  if (changes.typeId      !== undefined) row.type_id      = changes.typeId
  if (changes.rescheduled !== undefined) row.rescheduled  = changes.rescheduled
  const { data, error } = await supabase
    .from('reservations').update(row).eq('id', id).select().single()
  if (error) throw error
  return toReservation(data)
}

export async function addPlayerToReservation(resId, player) {
  // Try SECURITY DEFINER RPC first — bypasses RLS for customer-initiated bookings
  const { data: rpcData, error: rpcErr } = await supabase
    .rpc('add_reservation_player', {
      p_reservation_id: resId,
      p_user_id:        player.userId ?? null,
      p_name:           player.name,
    })
  // rpcData is a single row object — check explicitly for id presence
  // Fall back to player.userId if the RPC doesn't echo user_id back
  if (!rpcErr && rpcData && rpcData.id) {
    return { id: rpcData.id, userId: rpcData.user_id ?? player.userId ?? null, name: rpcData.name }
  }

  // Fallback: direct insert (works for staff/admin whose RLS allows it)
  const { data, error } = await supabase.from('reservation_players').insert({
    reservation_id: resId,
    user_id:        player.userId ?? null,
    name:           player.name,
  }).select().single()
  if (error) throw new Error(
    `Could not add player — RPC: ${rpcErr?.message ?? 'n/a'}, Direct: ${error.message}`
  )
  return { id: data.id, userId: data.user_id ?? player.userId ?? null, name: data.name }
}

/** Fetch all players for a reservation from the normalized table */
export async function fetchPlayersForReservation(resId) {
  const { data, error } = await supabase
    .from('reservation_players')
    .select('*')
    .eq('reservation_id', resId)
    .order('id')
  if (error) throw error
  return data.map(toReservationPlayer)
}

/** Remove a player from a reservation */
export async function removePlayerFromReservation(playerId) {
  const { error } = await supabase
    .from('reservation_players').delete().eq('id', playerId)
  if (error) throw error
}

/** Replace ALL players on a reservation — delete existing, insert new list.
 *  Used by saveGroup in CustomerPortal. App.jsx should call this instead of
 *  updateReservation(id, { players }) which writes to the stale JSONB column. */
export async function syncReservationPlayers(resId, players) {
  // Try SECURITY DEFINER RPC first — bypasses RLS
  const { data: rpcData, error: rpcErr } = await supabase
    .rpc('sync_reservation_players', {
      p_reservation_id: resId,
      p_players: players.map(p => ({
        user_id: p.userId ?? null,
        name:    p.name,
      })),
    })
  // rpcData can be [] (empty array) on success — Array.isArray check avoids falsy [] bug
  if (!rpcErr && Array.isArray(rpcData)) {
    return rpcData.map(p => ({ id: p.id, userId: p.user_id ?? null, name: p.name }))
  }

  // Fallback: direct delete + insert via proven add_reservation_player RPC per player.
  // Direct bulk INSERT is blocked by RLS for customers, so we route each insert
  // through addPlayerToReservation which uses the SECURITY DEFINER add_reservation_player RPC.
  const { error: delErr } = await supabase
    .from('reservation_players').delete().eq('reservation_id', resId)
  if (delErr) throw new Error(`sync delete failed — RPC: ${rpcErr?.message ?? 'n/a'}, Direct: ${delErr.message}`)

  if (!players.length) return []

  const saved = await Promise.all(players.map(p => addPlayerToReservation(resId, p, [])))
  return saved
}

/** Update a player record (e.g. link a userId after they sign in) */
export async function updateReservationPlayer(id, changes) {
  const row = {}
  if (changes.userId              !== undefined) row.user_id               = changes.userId
  if (changes.name                !== undefined) row.name                  = changes.name
  if (changes.team                !== undefined) row.team                  = changes.team
  if (changes.scoredReservationId !== undefined) row.scored_reservation_id = changes.scoredReservationId
  const { data, error } = await supabase
    .from('reservation_players').update(row).eq('id', id).select().single()
  if (error) throw error
  return toReservationPlayer(data)
}

export async function markReservationPaid(id, paid = true) {
  return updateReservation(id, { paid })
}


// ============================================================
// SESSION RUNS
// ============================================================

/** Fetch all runs for a single reservation */
export async function fetchRunsForReservation(reservationId) {
  const { data, error } = await supabase
    .from('session_runs')
    .select('*')
    .eq('reservation_id', reservationId)
    .order('run_number')
  if (error) throw error
  return data.map(toRun)
}

/** Fetch all runs for a list of reservation IDs (bulk load for mission board) */
export async function fetchRunsForReservations(reservationIds) {
  if (!reservationIds.length) return []
  const { data, error } = await supabase
    .from('session_runs')
    .select('*')
    .in('reservation_id', reservationIds)
    .order('reservation_id')
    .order('run_number')
  if (error) throw error
  return data.map(toRun)
}

/** Upsert a run record — inserts or updates on (reservation_id, run_number, team) */
export async function createRun(run) {
  const { data, error } = await supabase.from('session_runs').upsert({
    reservation_id:     run.reservationId,
    run_number:         run.runNumber,
    structure:          run.structure ?? 'Alpha',
    visual:             run.visual ?? 'V',
    cranked:            run.cranked ?? false,
    audio:              run.audio ?? null,
    targets_eliminated: run.targetsEliminated ?? false,
    objective_complete: run.objectiveComplete ?? false,
    elapsed_seconds:    run.elapsedSeconds ?? null,
    score:              run.score ?? null,
    scored_by:          run.scoredBy ?? null,
    objective_id:       run.objectiveId ?? null,
    team:               run.team ?? null,
    live_op_difficulty: run.liveOpDifficulty ?? null,
    winning_team:       run.winningTeam ?? null,
  }, { onConflict: 'reservation_id,run_number,team', ignoreDuplicates: false })
  .select().single()
  if (error) throw error
  return toRun(data)
}

/** Update run — used for: locking elapsed time, saving score inputs, final score */
export async function updateRun(id, changes) {
  const row = {}
  if (changes.structure          !== undefined) row.structure           = changes.structure
  if (changes.visual             !== undefined) row.visual              = changes.visual
  if (changes.cranked            !== undefined) row.cranked             = changes.cranked
  if (changes.audio              !== undefined) row.audio               = changes.audio
  if (changes.targetsEliminated  !== undefined) row.targets_eliminated  = changes.targetsEliminated
  if (changes.objectiveComplete  !== undefined) row.objective_complete  = changes.objectiveComplete
  if (changes.elapsedSeconds     !== undefined) row.elapsed_seconds     = changes.elapsedSeconds
  if (changes.score              !== undefined) row.score               = changes.score
  if (changes.scoredBy           !== undefined) row.scored_by           = changes.scoredBy
  if (changes.objectiveId        !== undefined) row.objective_id        = changes.objectiveId
  if (changes.team               !== undefined) row.team               = changes.team
  if (changes.liveOpDifficulty   !== undefined) row.live_op_difficulty  = changes.liveOpDifficulty
  if (changes.winningTeam        !== undefined) row.winning_team        = changes.winningTeam
  const { data, error } = await supabase
    .from('session_runs').update(row).eq('id', id).select().single()
  if (error) throw error
  return toRun(data)
}

/** Save final scored run — calculates score automatically from inputs */
export async function scoreRun(id, inputs, scoredByUserId) {
  const score = calculateRunScore(inputs)
  return updateRun(id, { ...inputs, score, scoredBy: scoredByUserId })
}

/** Delete a run (if instructor needs to redo entry) */
export async function deleteRun(id) {
  const { error } = await supabase.from('session_runs').delete().eq('id', id)
  if (error) throw error
}

/** Upsert a run — creates if no run exists for (reservationId, runNumber), updates if it does */
export async function upsertRun(run) {
  const score = (run.score !== undefined)
    ? run.score
    : (run.elapsedSeconds !== null && run.elapsedSeconds !== undefined)
      ? calculateRunScore(run)
      : null
  const row = {
    reservation_id:     run.reservationId,
    run_number:         run.runNumber,
    structure:          run.structure ?? 'Alpha',
    visual:             run.visual ?? 'V',
    cranked:            run.cranked ?? false,
    audio:              run.audio ?? null,
    targets_eliminated: run.targetsEliminated ?? false,
    objective_complete: run.objectiveComplete ?? false,
    elapsed_seconds:    run.elapsedSeconds ?? null,
    score,
    scored_by:          run.scoredBy ?? null,
  }
  if (run.id) row.id = run.id
  const { data, error } = await supabase
    .from('session_runs').upsert(row, { onConflict: 'reservation_id,run_number' })
    .select().single()
  if (error) throw error
  return toRun(data)
}

/** Fetch auth account creation dates for all users with a linked auth account.
 *  Requires SQL: CREATE OR REPLACE FUNCTION public.get_user_auth_dates()
 *  RETURNS TABLE(user_id uuid, auth_created_at timestamptz) LANGUAGE sql SECURITY DEFINER AS $$
 *    SELECT u.id, au.created_at FROM public.users u
 *    JOIN auth.users au ON au.id::text = u.auth_id WHERE u.auth_id IS NOT NULL;
 *  $$; GRANT EXECUTE ON FUNCTION public.get_user_auth_dates() TO authenticated;
 */
export async function fetchUserAuthDates() {
  const { data, error } = await supabase.rpc('get_user_auth_dates')
  if (error) throw error
  return (data ?? []).map(r => ({ userId: r.user_id, authCreatedAt: r.auth_created_at }))
}


// ============================================================
// OBJECTIVES
// ============================================================

export async function fetchObjectives() {
  const { data, error } = await supabase.from('objectives').select('*').eq('active', true).order('name')
  if (error) throw error
  return data ?? []
}

// ============================================================
// PLAYER SCORING STATS (for scoring modal player cards)
// ============================================================

export async function fetchPlayerScoringStats(userIds) {
  if (!userIds.length) return {}
  const { data, error } = await supabase.rpc('get_player_scoring_stats', { p_user_ids: userIds })
  if (error) throw error
  return Object.fromEntries((data ?? []).map(r => [r.user_id, r]))
}

// ============================================================
// LEADERBOARD  (reads from DB views — safe for public use)
// ============================================================

/** All-time leaderboard — up to `limit` entries */
export async function fetchLeaderboard(limit = 50) {
  const { data, error } = await supabase
    .from('v_leaderboard')
    .select('*')
    .limit(limit)
  if (error) throw error
  return data.map(toLeaderboardEntry)
}

export async function fetchLeaderboardWeekly(limit = 50) {
  const { data, error } = await supabase
    .from('v_leaderboard_weekly')
    .select('*')
    .limit(limit)
  if (error) throw error
  return data.map(r => ({ ...toLeaderboardEntry(r), rank: r.rank_weekly }))
}

export async function fetchLeaderboardMonthly(limit = 50) {
  const { data, error } = await supabase
    .from('v_leaderboard_monthly')
    .select('*')
    .limit(limit)
  if (error) throw error
  return data.map(r => ({ ...toLeaderboardEntry(r), rank: r.rank_monthly }))
}

export async function fetchLeaderboardYearly(limit = 50) {
  const { data, error } = await supabase
    .from('v_leaderboard_yearly')
    .select('*')
    .limit(limit)
  if (error) throw error
  return data.map(r => ({ ...toLeaderboardEntry(r), rank: r.rank_yearly }))
}

/** Fetch a single player's rank and stats across all time windows */
export async function fetchPlayerStats(playerId) {
  const [allTime, weekly, monthly, yearly] = await Promise.all([
    supabase.from('v_leaderboard').select('*').eq('player_id', playerId).maybeSingle(),
    supabase.from('v_leaderboard_weekly').select('*').eq('player_id', playerId).maybeSingle(),
    supabase.from('v_leaderboard_monthly').select('*').eq('player_id', playerId).maybeSingle(),
    supabase.from('v_leaderboard_yearly').select('*').eq('player_id', playerId).maybeSingle(),
  ])
  return {
    allTime:  toLeaderboardEntry(allTime.data),
    weekly:   weekly.data  ? { ...toLeaderboardEntry(weekly.data),  rank: weekly.data.rank_weekly   } : null,
    monthly:  monthly.data ? { ...toLeaderboardEntry(monthly.data), rank: monthly.data.rank_monthly } : null,
    yearly:   yearly.data  ? { ...toLeaderboardEntry(yearly.data),  rank: yearly.data.rank_yearly   } : null,
  }
}

/** Fetch all session scores for a player (for their history view) */
export async function fetchPlayerSessionHistory(playerId) {
  // Sessions where they were the booker (uses v_session_scores view)
  const { data: asBooker, error: e1 } = await supabase
    .from('v_session_scores')
    .select('*')
    .eq('booker_id', playerId)
  if (e1) throw e1

  // Sessions where they appear as a participant in reservation_players
  const { data: asPlayer, error: e2 } = await supabase
    .from('reservation_players')
    .select('reservation_id, reservations(id, date, type_id, customer_name, status)')
    .eq('user_id', playerId)
  if (e2) throw e2

  return {
    asBooker:  asBooker ?? [],
    asPlayer:  (asPlayer ?? []).map(p => p.reservations).filter(Boolean),
  }
}


// ============================================================
// APP SETTINGS
// ============================================================

export async function fetchAppSettings() {
  const { data, error } = await supabase
    .from('app_settings').select('*').order('key')
  if (error) throw error
  return data.map(toSetting)
}

export async function updateAppSetting(key, value) {
  const { data, error } = await supabase
    .from('app_settings')
    .update({ value: String(value), updated_at: new Date().toISOString() })
    .eq('key', key)
    .select().single()
  if (error) throw error
  return toSetting(data)
}

/** Convenience: get a single setting value as a number */
export async function getSettingNumber(key, fallback = 10) {
  const { data } = await supabase
    .from('app_settings').select('value').eq('key', key).maybeSingle()
  return data ? Number(data.value) : fallback
}


// ============================================================
// SHIFTS
// ============================================================

export async function fetchShifts() {
  const { data, error } = await supabase
    .from('shifts').select('*').order('date').order('start_time')
  if (error) throw error
  return data.map(toShift)
}

export async function createShift(shift) {
  const { data, error } = await supabase.from('shifts').insert({
    staff_id:         shift.staffId ?? null,
    date:             shift.date,
    start_time:       shift.start,
    end_time:         shift.end,
    open:             shift.open ?? false,
    conflicted:       shift.conflicted ?? false,
    conflict_note:    shift.conflictNote ?? null,
    template_slot_id: shift.templateSlotId ?? null,
    role:             shift.role ?? null,
  }).select().single()
  if (error) throw error
  return toShift(data)
}

export async function createShiftBatch(shiftsArray) {
  if (!shiftsArray.length) return []
  const rows = shiftsArray.map(shift => ({
    staff_id:         shift.staffId ?? null,
    date:             shift.date,
    start_time:       shift.start,
    end_time:         shift.end,
    open:             shift.open ?? true,
    conflicted:       shift.conflicted ?? false,
    conflict_note:    shift.conflictNote ?? null,
    template_slot_id: shift.templateSlotId ?? null,
    role:             shift.role ?? null,
  }))
  const { data, error } = await supabase.from('shifts').insert(rows).select()
  if (error) throw error
  return data.map(toShift)
}

export async function upsertShiftBatch(shiftsArray) {
  if (!shiftsArray.length) return []
  const rows = shiftsArray.map(shift => ({
    ...(shift.id ? { id: shift.id } : {}),
    staff_id:         shift.staffId ?? null,
    date:             shift.date,
    start_time:       shift.start,
    end_time:         shift.end,
    open:             shift.open ?? true,
    conflicted:       shift.conflicted ?? false,
    conflict_note:    shift.conflictNote ?? null,
    template_slot_id: shift.templateSlotId ?? null,
    role:             shift.role ?? null,
  }))
  const { data, error } = await supabase.from('shifts').upsert(rows).select()
  if (error) throw error
  return data.map(toShift)
}

export async function updateShift(id, changes) {
  const row = {}
  if (changes.staffId        !== undefined) row.staff_id         = changes.staffId
  if (changes.start          !== undefined) row.start_time       = changes.start
  if (changes.end            !== undefined) row.end_time         = changes.end
  if (changes.open           !== undefined) row.open             = changes.open
  if (changes.conflicted     !== undefined) row.conflicted       = changes.conflicted
  if (changes.conflictNote   !== undefined) row.conflict_note    = changes.conflictNote
  if (changes.templateSlotId !== undefined) row.template_slot_id = changes.templateSlotId
  if (changes.role           !== undefined) row.role             = changes.role
  const { data, error } = await supabase
    .from('shifts').update(row).eq('id', id).select().maybeSingle()
  if (error) throw error
  if (!data) throw new Error('Permission denied — shift could not be updated. Ask an admin to check the shifts RLS policy.')
  return toShift(data)
}

export async function claimShift(shiftId) {
  const { data, error } = await supabase.rpc('claim_shift', { p_shift_id: shiftId })
  if (error) throw error
  return data ? toShift(data) : null
}

// ── Shift alerts ─────────────────────────────────────────────────────────────

export async function createShiftAlerts(shiftId, staffIds) {
  if (!staffIds.length) return
  const rows = staffIds.map(staffId => ({ shift_id: shiftId, staff_id: staffId }))
  const { error } = await supabase.from('shift_alerts')
    .upsert(rows, { onConflict: 'shift_id,staff_id', ignoreDuplicates: true })
  if (error) throw error
}

export async function fetchMyShiftAlerts(staffId) {
  const { data, error } = await supabase
    .from('shift_alerts')
    .select('id, shift_id, created_at, shifts(id, date, start_time, end_time, role, open, conflicted, staff_id)')
    .eq('staff_id', staffId)
    .is('dismissed_at', null)
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []).map(r => ({
    id: r.id,
    shiftId: r.shift_id,
    createdAt: r.created_at,
    shift: r.shifts ? {
      id: r.shifts.id, date: r.shifts.date,
      start: r.shifts.start_time, end: r.shifts.end_time,
      role: r.shifts.role, open: r.shifts.open,
      conflicted: r.shifts.conflicted, staffId: r.shifts.staff_id,
    } : null,
  }))
}

export async function dismissShiftAlert(alertId) {
  const { error } = await supabase.from('shift_alerts')
    .update({ dismissed_at: new Date().toISOString() }).eq('id', alertId)
  if (error) throw error
}

export async function deleteShift(id) {
  const { error } = await supabase.from('shifts').delete().eq('id', id)
  if (error) throw error
}

// ============================================================
// KIOSK
// ============================================================

export async function fetchKioskReservations(phone) {
  const { data, error } = await supabase.rpc('kiosk_lookup_reservations', { p_phone: phone })
  if (error) throw error
  return (data ?? []).map(r => ({
    id: r.id, typeId: r.type_id, userId: r.user_id,
    customerName: r.customer_name, date: r.date, startTime: r.start_time,
    playerCount: r.player_count, amount: Number(r.amount),
    status: r.status, paid: r.paid, createdAt: r.created_at,
    players: (r.players ?? []).map(p => ({ id: p.id, userId: p.user_id ?? null, name: p.name })),
  }))
}

export async function kioskSignWaiver(userId, signedName, waiverDocId) {
  const { error } = await supabase.rpc('kiosk_sign_waiver', {
    p_user_id: userId, p_signed_name: signedName, p_waiver_doc_id: waiverDocId,
  })
  if (error) throw error
}

export async function fetchPlayerWaiverStatus(userIds) {
  if (!userIds.length) return {}
  const { data, error } = await supabase.rpc('kiosk_get_player_waivers', { p_user_ids: userIds })
  if (error) throw error
  return Object.fromEntries((data ?? []).map(r => [r.id, {
    waivers: r.waivers ?? [], needsRewaiverDocId: r.needs_rewaiver_doc_id,
  }]))
}


// ============================================================
// SHIFT TEMPLATES
// ============================================================

const toShiftTemplate = r => r ? ({
  id:             r.id,
  name:           r.name,
  active:         r.active ?? false,
  cycleStartDate: r.cycle_start_date ?? null,
  createdAt:      r.created_at,
}) : null

const toTemplateSlot = r => r ? ({
  id:         r.id,
  templateId: r.template_id,
  dayOfWeek:  r.day_of_week,
  startTime:  r.start_time,
  endTime:    r.end_time,
  role:       r.role ?? null,
  label:      r.label ?? null,
}) : null

const toScheduleBlock = r => r ? ({
  id:         r.id,
  label:      r.label ?? null,
  date:       r.date,
  isFullDay:  r.is_full_day ?? true,
  startTime:  r.start_time ?? null,
  endTime:    r.end_time ?? null,
  isHoliday:  r.is_holiday ?? false,
  createdBy:  r.created_by ?? null,
  createdAt:  r.created_at,
}) : null

const toUserRole = r => r ? ({
  id:     r.id,
  userId: r.user_id,
  role:   r.role,
}) : null

export async function fetchShiftTemplates() {
  const { data, error } = await supabase
    .from('shift_templates').select('*').order('created_at')
  if (error) throw error
  return data.map(toShiftTemplate)
}

export async function upsertShiftTemplate(tmpl) {
  const row = {
    name:             tmpl.name,
    active:           tmpl.active ?? false,
    cycle_start_date: tmpl.cycleStartDate ?? null,
  }
  if (tmpl.id) row.id = tmpl.id
  const { data, error } = await supabase
    .from('shift_templates').upsert(row).select().single()
  if (error) throw error
  return toShiftTemplate(data)
}

export async function deleteShiftTemplate(id) {
  const { error } = await supabase.from('shift_templates').delete().eq('id', id)
  if (error) throw error
}

/** Deactivate all templates then activate the chosen one. Pass null to deactivate all. */
export async function setActiveShiftTemplate(id) {
  await supabase.from('shift_templates').update({ active: false }).neq('id', id ?? '00000000-0000-0000-0000-000000000000')
  if (!id) return null
  const { data, error } = await supabase
    .from('shift_templates').update({ active: true }).eq('id', id).select().single()
  if (error) throw error
  return toShiftTemplate(data)
}

export async function fetchTemplateSlots(templateId) {
  const { data, error } = await supabase
    .from('shift_template_slots')
    .select('*')
    .eq('template_id', templateId)
    .order('day_of_week').order('start_time')
  if (error) throw error
  return data.map(toTemplateSlot)
}

export async function upsertTemplateSlot(slot) {
  const row = {
    template_id: slot.templateId,
    day_of_week: slot.dayOfWeek,
    start_time:  slot.startTime,
    end_time:    slot.endTime,
    role:        slot.role ?? null,
    label:       slot.label ?? null,
  }
  if (slot.id) row.id = slot.id
  const { data, error } = await supabase
    .from('shift_template_slots').upsert(row).select().single()
  if (error) throw error
  return toTemplateSlot(data)
}

export async function deleteTemplateSlot(id) {
  const { error } = await supabase.from('shift_template_slots').delete().eq('id', id)
  if (error) throw error
}

export async function fetchScheduleBlocks(fromDate, toDate) {
  let q = supabase.from('schedule_blocks').select('*').order('date').order('start_time')
  if (fromDate) q = q.gte('date', fromDate)
  if (toDate)   q = q.lte('date', toDate)
  const { data, error } = await q
  if (error) throw error
  return data.map(toScheduleBlock)
}

export async function createScheduleBlock(block) {
  const { data, error } = await supabase.from('schedule_blocks').insert({
    label:       block.label     ?? null,
    date:        block.date,
    is_full_day: block.isFullDay ?? true,
    start_time:  block.startTime ?? null,
    end_time:    block.endTime   ?? null,
    is_holiday:  block.isHoliday ?? false,
    created_by:  block.createdBy ?? null,
  }).select().single()
  if (error) throw error
  return toScheduleBlock(data)
}

export async function updateScheduleBlock(id, block) {
  const { data, error } = await supabase.from('schedule_blocks').update({
    label:       block.label     ?? null,
    date:        block.date,
    is_full_day: block.isFullDay ?? true,
    start_time:  block.startTime ?? null,
    end_time:    block.endTime   ?? null,
    is_holiday:  block.isHoliday ?? false,
  }).eq('id', id).select().single()
  if (error) throw error
  return toScheduleBlock(data)
}

export async function deleteScheduleBlock(id) {
  const { error } = await supabase.from('schedule_blocks').delete().eq('id', id)
  if (error) throw error
}

export async function fetchUserRoles() {
  const { data, error } = await supabase.from('user_roles').select('*')
  if (error) throw error
  return data.map(toUserRole)
}

export async function addUserRole(userId, role) {
  const { data, error } = await supabase
    .from('user_roles').insert({ user_id: userId, role }).select().single()
  if (error) throw error
  return toUserRole(data)
}

export async function removeUserRole(id) {
  const { error } = await supabase.from('user_roles').delete().eq('id', id)
  if (error) throw error
}

// ── Slot assignments (2-week rotation) ─────────────────────────────────────

const toSlotAssignment = r => r ? ({
  id:         r.id,
  slotId:     r.template_slot_id,
  weekNumber: r.week_number,
  staffId:    r.staff_id,
}) : null

export async function fetchSlotAssignments(templateId) {
  const { data, error } = await supabase
    .from('shift_slot_assignments')
    .select('*, shift_template_slots!inner(template_id)')
    .eq('shift_template_slots.template_id', templateId)
  if (error) throw error
  return (data ?? []).map(toSlotAssignment)
}

// staffId=null → deletes the assignment; staffId set → upserts
export async function upsertSlotAssignment(slotId, weekNum, staffId) {
  if (!staffId) {
    const { error } = await supabase
      .from('shift_slot_assignments')
      .delete()
      .eq('template_slot_id', slotId)
      .eq('week_number', weekNum)
    if (error) throw error
    return null
  }
  const { data, error } = await supabase
    .from('shift_slot_assignments')
    .upsert(
      { template_slot_id: slotId, week_number: weekNum, staff_id: staffId },
      { onConflict: 'template_slot_id,week_number' }
    )
    .select().single()
  if (error) throw error
  return toSlotAssignment(data)
}

// ── Staff Availability Blocks ────────────────────────────────────────────────

const toStaffBlock = r => r ? ({
  id:        r.id,
  staffId:   r.staff_id,
  startDate: r.start_date,
  endDate:   r.end_date,
  startTime: r.start_time ?? null,
  endTime:   r.end_time ?? null,
  label:     r.label ?? null,
  status:    r.status,
  createdAt: r.created_at,
}) : null

export async function fetchStaffBlocks(staffId) {
  const { data, error } = await supabase
    .from('staff_availability_blocks').select('*')
    .eq('staff_id', staffId).order('start_date')
  if (error) throw error
  return (data ?? []).map(toStaffBlock)
}

export async function fetchAllStaffBlocks() {
  const { data, error } = await supabase
    .from('staff_availability_blocks').select('*')
  if (error) throw error
  return (data ?? []).map(toStaffBlock)
}

export async function createStaffBlock(block) {
  const { data, error } = await supabase
    .from('staff_availability_blocks').insert({
      staff_id:   block.staffId,
      start_date: block.startDate,
      end_date:   block.endDate,
      start_time: block.startTime ?? null,
      end_time:   block.endTime ?? null,
      label:      block.label ?? null,
      status:     block.status ?? 'confirmed',
    }).select().single()
  if (error) throw error
  return toStaffBlock(data)
}

export async function updateStaffBlock(id, changes) {
  const row = {}
  if (changes.status    !== undefined) row.status     = changes.status
  if (changes.label     !== undefined) row.label      = changes.label
  if (changes.startDate !== undefined) row.start_date = changes.startDate
  if (changes.endDate   !== undefined) row.end_date   = changes.endDate
  if (changes.startTime !== undefined) row.start_time = changes.startTime
  if (changes.endTime   !== undefined) row.end_time   = changes.endTime
  const { data, error } = await supabase
    .from('staff_availability_blocks').update(row).eq('id', id).select().single()
  if (error) throw error
  return toStaffBlock(data)
}

export async function deleteStaffBlock(id) {
  const { error } = await supabase
    .from('staff_availability_blocks').delete().eq('id', id)
  if (error) throw error
}

// ============================================================
// AVATAR / PROFILE PICTURE
// ============================================================

/** Resize an image file to at most maxPx on the longest side, returned as JPEG blob. */
function resizeImage(file, maxPx = 512, quality = 0.85) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      URL.revokeObjectURL(url)
      const scale = Math.min(1, maxPx / Math.max(img.width, img.height))
      const w = Math.round(img.width * scale)
      const h = Math.round(img.height * scale)
      const canvas = document.createElement('canvas')
      canvas.width = w; canvas.height = h
      canvas.getContext('2d').drawImage(img, 0, 0, w, h)
      canvas.toBlob(blob => {
        if (!blob) { reject(new Error('Image resize failed')); return }
        resolve(new File([blob], 'avatar.jpg', { type: 'image/jpeg' }))
      }, 'image/jpeg', quality)
    }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Failed to load image')) }
    img.src = url
  })
}

/** Upload a profile picture to Supabase Storage (bucket: avatars) and return the public URL. */
export async function uploadAvatar(userId, file) {
  const MAX_BYTES = 8 * 1024 * 1024 // 8 MB pre-resize guard
  if (file.size > MAX_BYTES) throw new Error('File too large — please choose an image under 8 MB.')
  const resized = await resizeImage(file, 512, 0.85)
  const path = `${userId}/avatar.jpg`
  const { error } = await supabase.storage
    .from('avatars')
    .upload(path, resized, { upsert: true, contentType: 'image/jpeg' })
  if (error) throw error
  const { data } = supabase.storage.from('avatars').getPublicUrl(path)
  return data.publicUrl
}

/** Persist the avatar URL to the users table via SECURITY DEFINER RPC. */
export async function updateOwnAvatar(userId, avatarUrl) {
  const { error } = await supabase.rpc('update_own_avatar', {
    p_user_id:   userId,
    p_avatar_url: avatarUrl,
  })
  if (error) throw error
}
