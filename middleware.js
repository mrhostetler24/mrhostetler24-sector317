// Vercel Edge Middleware — restricts /kiosk to the configured IP.
// Set KIOSK_ALLOWED_IP in Vercel env vars (and .env.local for local dev).
// If the variable is not set, all IPs are allowed (safe default for development).

export default function middleware(req) {
  const allowed = process.env.KIOSK_ALLOWED_IP
  if (!allowed) return // not configured — allow all

  const fwd = req.headers.get('x-forwarded-for')
  const ip  = fwd ? fwd.split(',')[0].trim() : null

  if (ip !== allowed) {
    return new Response(
      '<!doctype html><html><body style="font-family:sans-serif;text-align:center;padding:4rem">' +
      '<h2>Access Denied</h2><p>This terminal is not authorized to access the kiosk.</p>' +
      '</body></html>',
      { status: 403, headers: { 'Content-Type': 'text/html' } }
    )
  }
}

export const config = {
  matcher: ['/kiosk'],
}
