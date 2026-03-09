// api/send-reminders.js
// Vercel cron — runs daily at 10:00 AM UTC (5 AM ET / 6 AM ET DST).
// Finds all confirmed reservations for tomorrow and sends reminder emails
// to the booking holder, respecting their opt-out preferences.
//
// Cron schedule: "0 10 * * *" (see vercel.json)
// Auth: Vercel sends Authorization: Bearer <CRON_SECRET> automatically.

import { createClient } from '@supabase/supabase-js'
import crypto from 'crypto'
import { tmplBookingReminder, unsubUrl } from './email-templates.js'

const FROM_ADDRESS = 'Sector 317 <noreply@sector317.com>'
const RESEND_API   = 'https://api.resend.com/emails'

function makeUnsubToken(userId, category) {
  const secret = process.env.EMAIL_UNSUBSCRIBE_SECRET ?? 'change-me'
  return crypto.createHmac('sha256', secret).update(`${userId}:${category}`).digest('base64url')
}

function addDays(isoDate, n) {
  const d = new Date(isoDate + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

function todayUTC() {
  return new Date().toISOString().slice(0, 10)
}

export default async function handler(req, res) {
  // Verify Vercel cron authorization
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  if (!process.env.RESEND_API_KEY) {
    return res.status(500).json({ error: 'RESEND_API_KEY not set' })
  }

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )

  const tomorrow = addDays(todayUTC(), 1)

  // Fetch all confirmed reservations for tomorrow with the booking user's profile
  const { data: reservations, error: resErr } = await supabase
    .from('reservations')
    .select(`
      id, date, start_time, player_count, status,
      user_id,
      reservation_types ( name )
    `)
    .eq('date', tomorrow)
    .eq('status', 'confirmed')

  if (resErr) return res.status(500).json({ error: resErr.message })
  if (!reservations?.length) return res.status(200).json({ sent: 0, message: 'No reservations tomorrow.' })

  // Collect unique user IDs who have a booking tomorrow
  const userIds = [...new Set(reservations.map(r => r.user_id).filter(Boolean))]

  // Fetch user profiles
  const { data: users, error: uErr } = await supabase
    .from('users').select('id, name, email, leaderboard_name').in('id', userIds)
  if (uErr) return res.status(500).json({ error: uErr.message })
  const userMap = {}
  ;(users ?? []).forEach(u => { userMap[u.id] = u })

  // Fetch opt-out preferences
  const { data: prefs } = await supabase
    .from('email_preferences').select('user_id, bookings').in('user_id', userIds)
  const prefMap = {}
  ;(prefs ?? []).forEach(p => { prefMap[p.user_id] = p })

  let sent = 0, skipped = 0
  const errors = []

  // Deduplicate: send only one reminder per user even if they have multiple reservations tomorrow
  const notified = new Set()

  for (const res of reservations) {
    const uid = res.user_id
    if (!uid || notified.has(uid)) { skipped++; continue }
    const user = userMap[uid]
    if (!user?.email) { skipped++; continue }

    // Check opt-out
    const pref = prefMap[uid]
    const optedIn = pref ? (pref.bookings ?? true) : true
    if (!optedIn) { skipped++; continue }

    const link = unsubUrl(uid, 'bookings', makeUnsubToken(uid, 'bookings'))
    const { subject, html } = tmplBookingReminder({
      recipientName: user.leaderboard_name || user.name || 'Operative',
      sessionType:   res.reservation_types?.name ?? '—',
      date:          res.date,
      startTime:     res.start_time,
      playerCount:   res.player_count,
    }, link)

    try {
      const resp = await fetch(RESEND_API, {
        method:  'POST',
        headers: {
          'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
          'Content-Type':  'application/json',
        },
        body: JSON.stringify({ from: FROM_ADDRESS, to: user.email, subject, html }),
      })
      if (!resp.ok) {
        const e = await resp.json().catch(() => ({}))
        throw new Error(`Resend ${resp.status}: ${e.message ?? resp.statusText}`)
      }
      sent++
      notified.add(uid)
    } catch (e) {
      errors.push({ userId: uid, error: e.message })
    }
  }

  return res.status(200).json({ sent, skipped, errors: errors.length ? errors : undefined })
}
