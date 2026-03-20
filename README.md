# Sector 317

Indoor tactical simulation experience — booking and management system.
**Live at: https://sector317.com**

## Stack

- **Frontend:** React + Vite
- **Backend:** Supabase (Postgres, Auth, RLS, RPCs)
- **Hosting:** Vercel

## Project Structure

```
sector317/
├── api/                          Vercel serverless functions
│   ├── kiosk-auth.js             kiosk PIN authentication
│   └── kiosk-exit.js             kiosk exit / session teardown
├── public/
│   ├── leaderboard.html          public leaderboard (no login required)
│   ├── logo.png                  🚫 never overwrite
│   └── hero.png                  🚫 never overwrite
├── src/
│   ├── App.jsx                   main app shell + routing
│   ├── LandingPage.jsx           public landing page
│   ├── AdminPortal.jsx           manager / staff portal
│   ├── CustomerPortal.jsx        customer-facing portal
│   ├── KioskPage.jsx             front-desk kiosk (/kiosk)
│   ├── OpsView.jsx               real-time ops / session management
│   ├── SocialPortal.jsx          social hub (friends, platoons, leaderboard)
│   ├── PlatoonPortal.jsx         platoon/clan management
│   ├── MerchPortal.jsx           merchandise management
│   ├── SchedulePanel.jsx         staff schedule
│   ├── supabase.js               DB/auth barrel (re-exports domain modules)
│   ├── supabase.client.js        Supabase singleton client
│   ├── supabase.social.js        social + platoon functions
│   ├── supabase.merch.js         merchandise functions
│   ├── utils.js                  shared utilities + formatting
│   └── ui.jsx                    shared UI components
├── supabase/
│   └── migrations/               all schema changes (apply in order)
├── index.html
├── vite.config.js
├── vercel.json
└── .env.local                    🚫 never commit
```

## Development

```bash
npm install
npm run dev
```

## Environment Variables

Create `.env.local` with:

```
# Client-side (Vite)
VITE_SUPABASE_URL=your_project_url
VITE_SUPABASE_ANON_KEY=your_anon_key

# Server-side (Vercel functions only)
SUPABASE_URL=your_project_url
SUPABASE_ANON_KEY=your_anon_key
KIOSK_EMAIL=kiosk@sector317.com
KIOSK_PASSWORD=your_kiosk_password
KIOSK_UNLOCK_PIN=6-digit pin
KIOSK_EXIT_PIN=6-digit pin
```

All server-side vars must also be set in the Vercel project dashboard.

## Database Migrations

Migrations live in `supabase/migrations/` and are applied in filename order via the Supabase SQL Editor or CLI. Never edit a migration that has already been applied — add a new one instead.

## Public Leaderboard

Accessible at `https://sector317.com/leaderboard.html` — no login required.

## Deployment

Pushes to `main` deploy automatically via Vercel.
