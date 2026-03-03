// Module-level rate limiting — same pattern as kiosk-auth.js
const _attempts = new Map() // ip -> { count, lockedUntil }
const MAX_ATTEMPTS  = 5
const LOCKOUT_MS    = 15 * 60 * 1000  // 15 minutes
const FAIL_DELAY_MS = 2000

function getIp(req) {
  const fwd = req.headers['x-forwarded-for']
  return (fwd ? fwd.split(',')[0] : req.socket?.remoteAddress) ?? 'unknown'
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  const exitPin = process.env.KIOSK_EXIT_PIN
  if (!exitPin) return res.status(500).json({ error: 'Exit PIN not configured.' })

  const ip  = getIp(req)
  const rec = _attempts.get(ip) ?? { count: 0, lockedUntil: 0 }

  if (Date.now() < rec.lockedUntil) {
    const mins = Math.ceil((rec.lockedUntil - Date.now()) / 60000)
    return res.status(429).json({ error: `Locked for ${mins} more minute${mins !== 1 ? 's' : ''}.` })
  }

  const body = req.body ?? {}
  if (body.pin !== exitPin) {
    await new Promise(r => setTimeout(r, FAIL_DELAY_MS))
    rec.count += 1
    rec.lockedUntil = rec.count >= MAX_ATTEMPTS ? Date.now() + LOCKOUT_MS : 0
    _attempts.set(ip, rec)
    return res.status(401).json({ error: 'Incorrect PIN.' })
  }

  _attempts.delete(ip)
  res.status(200).json({ ok: true })
}
