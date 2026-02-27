import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL  = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_ANON = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON)

// ============================================================
// SCORE CALCULATION
// Formula: GREATEST(0, ROUND((100 - X) × multiplier - T))
//   X          = 80 if objective failed, else 0
//   multiplier = 1.0 + visual_add + cranked_add
//     C  → +0.2,  S  → +0.4,  CS → +0.4,  B → +0.8
//     cranked → +0.2
//   T = 15 if targets NOT eliminated, else 0
// ============================================================
export function calculateRunScore({ visual, cranked, targetsEliminated, objectiveComplete }) {
  const visualAdd = { V: 0.0, C: 0.2, S: 0.4, CS: 0.4, B: 0.8 }[visual] ?? 0.0
  const multiplier = 1.0 + visualAdd + (cranked ? 0.2 : 0.0)
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
  leaderboardName:    r.leaderboard_name ?? null,
  isReal:             r.is_real ?? true,
  createdByUserId:    r.created_by_user_id ?? null,
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
  players:      r.players ?? [],
}) : null

const toShift = r => r ? ({
  id:           r.id,
  staffId:      r.staff_id,
  date:         r.date,
  start:        r.start_time,
  end:          r.end_time,
  open:         r.open ?? false,
  conflicted:   r.conflicted ?? false,
  conflictNote: r.conflict_note,
}) : null

const toReservationPlayer = r => r ? ({
  id:            r.id,
  reservationId: r.reservation_id,
  userId:        r.user_id ?? null,
  name:          r.name,
  phone:         r.phone ?? null,
}) : null

const toRun = r => r ? ({
  id:                 r.id,
  reservationId:      r.reservation_id,
  runNumber:          r.run_number,
  structure:          r.structure,
  visual:             r.visual,
  cranked:            r.cranked,
  targetsEliminated:  r.targets_eliminated,
  objectiveComplete:  r.objective_complete,
  elapsedSeconds:     r.elapsed_seconds,
  score:              r.score,
  scoredBy:           r.scored_by,
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
    const row = data?.[0] ?? null
    return row ? {
      id:              row.id,
      name:            row.name,
      phone:           row.phone,
      access:          row.access,
      leaderboardName: row.leaderboard_name,
      email: null, authId: null, authProvider: null,
      waivers: [], needsRewaiverDocId: null,
      active: true, role: null, isReal: true,
    } : null
  }
  // RPC not deployed yet — fall back to direct query (works for staff/admin only)
  const { data: d2, error: e2 } = await supabase
    .from('users').select('*').eq('phone', phone).maybeSingle()
  if (e2) return null  // RLS blocked it — return null rather than crash
  return toUser(d2)
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
export async function createGuestUser({ name, phone, createdByUserId }) {
  // Try SECURITY DEFINER RPC first — bypasses RLS so customers can create guest rows
  const { data: rpcData, error: rpcErr } = await supabase
    .rpc('create_guest_user', {
      p_name:               name,
      p_phone:              phone ?? null,
      p_created_by_user_id: createdByUserId ?? null,
    })
  if (!rpcErr && rpcData) return toUser(rpcData)

  // Fallback: direct insert (works for staff/admin whose RLS allows it)
  const { data, error } = await supabase.from('users').insert({
    name,
    phone:                 phone ?? null,
    access:                'customer',
    active:                true,
    waivers:               [],
    is_real:               true,
    auth_provider:         null,
    created_by_user_id:    createdByUserId ?? null,
  }).select().single()
  if (error) throw new Error(
    `Could not create guest user — RPC: ${rpcErr?.message ?? 'n/a'}, Direct: ${error.message}`
  )
  return toUser(data)
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
  if (changes.leaderboardName    !== undefined) row.leaderboard_name      = changes.leaderboardName
  const { data, error } = await supabase.from('users').update(row).eq('id', id).select().single()
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
// RESERVATIONS
// ============================================================

const mapReservationRows = rows =>
  (rows ?? []).map(r => ({
    ...toReservation(r),
    players: (r.players ?? []).map(p => ({
      id:     p.id,
      userId: p.user_id ?? null,
      name:   p.name,
      phone:  p.phone ?? null,
    })),
  }))

export async function fetchReservations() {
  const { data, error } = await supabase
    .rpc('get_reservations_with_players', { p_today_only: false })
  if (error) throw error
  return mapReservationRows(data)
}

export async function fetchTodaysReservations() {
  const { data, error } = await supabase
    .rpc('get_reservations_with_players', { p_today_only: true })
  if (error) throw error
  return mapReservationRows(data)
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
  const { data, error } = await supabase
    .from('reservations').update(row).eq('id', id).select().single()
  if (error) throw error
  return toReservation(data)
}

export async function addPlayerToReservation(resId, player, currentPlayers) {
  // Try SECURITY DEFINER RPC first — bypasses RLS for customer-initiated bookings
  const { data: rpcData, error: rpcErr } = await supabase
    .rpc('add_reservation_player', {
      p_reservation_id: resId,
      p_user_id:        player.userId ?? null,
      p_name:           player.name,
      p_phone:          player.phone ?? null,
    })
  // rpcData is a single row object — check explicitly for id presence
  if (!rpcErr && rpcData && rpcData.id) {
    return { id: rpcData.id, userId: rpcData.user_id ?? null, name: rpcData.name, phone: rpcData.phone ?? null }
  }

  // Fallback: direct insert (works for staff/admin whose RLS allows it)
  const { data, error } = await supabase.from('reservation_players').insert({
    reservation_id: resId,
    user_id:        player.userId ?? null,
    name:           player.name,
    phone:          player.phone ?? null,
  }).select().single()
  if (error) throw new Error(
    `Could not add player — RPC: ${rpcErr?.message ?? 'n/a'}, Direct: ${error.message}`
  )
  return { id: data.id, userId: data.user_id ?? null, name: data.name, phone: data.phone ?? null }
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
        phone:   p.phone ?? null,
      })),
    })
  // rpcData can be [] (empty array) on success — Array.isArray check avoids falsy [] bug
  if (!rpcErr && Array.isArray(rpcData)) {
    return rpcData.map(p => ({ id: p.id, userId: p.user_id ?? null, name: p.name, phone: p.phone ?? null }))
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
  if (changes.userId !== undefined) row.user_id = changes.userId
  if (changes.name   !== undefined) row.name    = changes.name
  if (changes.phone  !== undefined) row.phone   = changes.phone
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

/** Create a new run record (timer started, no score yet) */
export async function createRun(run) {
  const { data, error } = await supabase.from('session_runs').insert({
    reservation_id:    run.reservationId,
    run_number:        run.runNumber,
    structure:         run.structure ?? 'Alpha',
    visual:            run.visual ?? 'V',
    cranked:           run.cranked ?? false,
    targets_eliminated: run.targetsEliminated ?? false,
    objective_complete: run.objectiveComplete ?? false,
    elapsed_seconds:   run.elapsedSeconds ?? null,
    score:             run.score ?? null,
    scored_by:         run.scoredBy ?? null,
  }).select().single()
  if (error) throw error
  return toRun(data)
}

/** Update run — used for: locking elapsed time, saving score inputs, final score */
export async function updateRun(id, changes) {
  const row = {}
  if (changes.structure          !== undefined) row.structure           = changes.structure
  if (changes.visual             !== undefined) row.visual              = changes.visual
  if (changes.cranked            !== undefined) row.cranked             = changes.cranked
  if (changes.targetsEliminated  !== undefined) row.targets_eliminated  = changes.targetsEliminated
  if (changes.objectiveComplete  !== undefined) row.objective_complete  = changes.objectiveComplete
  if (changes.elapsedSeconds     !== undefined) row.elapsed_seconds     = changes.elapsedSeconds
  if (changes.score              !== undefined) row.score               = changes.score
  if (changes.scoredBy           !== undefined) row.scored_by           = changes.scoredBy
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
  if (changes.start        !== undefined) row.start_time    = changes.start
  if (changes.end          !== undefined) row.end_time      = changes.end
  if (changes.open         !== undefined) row.open          = changes.open
  if (changes.conflicted   !== undefined) row.conflicted    = changes.conflicted
  if (changes.conflictNote !== undefined) row.conflict_note = changes.conflictNote
  const { data, error } = await supabase
    .from('shifts').update(row).eq('id', id).select().single()
  if (error) throw error
  return toShift(data)
}

export async function deleteShift(id) {
  const { error } = await supabase.from('shifts').delete().eq('id', id)
  if (error) throw error
}
