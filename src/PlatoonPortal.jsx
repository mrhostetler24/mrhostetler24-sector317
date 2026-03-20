// src/PlatoonPortal.jsx
// Platoon (guild/clan) tab for the Customer Portal.
// Rendered inside SocialPortal.jsx as the 4th "Platoon" tab.

import { useState, useEffect, useRef, useCallback } from 'react'
import { vizRenderName, audRenderName } from './envRender.jsx'
import {
  emailPlatoonInviteReceived, emailPlatoonRequestReceived,
  emailPlatoonRequestApproved, emailPlatoonRequestDenied,
} from './emails.js'
import {
  searchPlatoons, getPlatoonForUser, getPlatoonMembers, getPlatoonJoinRequests,
  getPlatoonPosts, getPlatoonSessions, getPlatoonUpcoming,
  createPlatoon, joinPlatoon, requestToJoin, cancelJoinRequest,
  approveJoinRequest, denyJoinRequest,
  goAwol, kickPlatoonMember, setPlatoonMemberRole, transferPlatoonAdmin,
  disbandPlatoon, postPlatoonMessage, deletePlatoonPost,
  updatePlatoonTag, updatePlatoonSettings, updatePlatoonBadge, updatePlatoonBadgeColor, uploadPlatoonBadge,
  searchInvitablePlayers, inviteToPlatoon, cancelPlatoonInvite,
  getMyPlatoonInvites, acceptPlatoonInvite, declinePlatoonInvite,
  getPlatoonPendingInvites, getMyJoinRequests,
} from './supabase.js'

// ── Shared helpers ────────────────────────────────────────────────────────────

function Avatar({ url, hidden, name, size = 36 }) {
  const initials = name ? name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase() : ''
  return (
    <div style={{ width: size, height: size, borderRadius: '50%', background: 'var(--surf2)', border: '1px solid var(--bdr)', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
      {url && !hidden
        ? <img src={url} style={{ width: '100%', height: '100%', objectFit: 'cover' }} alt="" />
        : initials
          ? <span style={{ color: 'var(--muted)', fontFamily: 'var(--fd)', fontSize: Math.round(size * 0.3), lineHeight: 1 }}>{initials}</span>
          : <span style={{ color: 'var(--muted)', fontSize: Math.round(size * 0.55) }}>👤</span>}
    </div>
  )
}

const TIER_THRESHOLDS = [
  { key: 'recruit',  min: 0 },  { key: 'initiate', min: 4 },
  { key: 'operator', min: 10 }, { key: 'striker',  min: 18 },
  { key: 'vanguard', min: 28 }, { key: 'sentinel', min: 40 },
  { key: 'enforcer', min: 56 }, { key: 'apex',     min: 71 },
  { key: 'elite',    min: 86 }, { key: 'legend',   min: 100 },
]
function tierKey(runs) {
  const n = runs ?? 0
  let key = 'recruit'
  for (const t of TIER_THRESHOLDS) { if (n >= t.min) key = t.key }
  return key
}
function TierImg({ runs, size = 16 }) {
  const key = tierKey(runs)
  return <img src={`/${key}.png`} alt={key} style={{ width: size, height: size, objectFit: 'contain', display: 'block', flexShrink: 0 }} />
}

function RoleChip({ role }) {
  const c = role === 'admin' ? '#f5c842' : role === 'sergeant' ? '#60a5fa' : '#6b7280'
  const label = role === 'admin' ? 'CO' : role === 'sergeant' ? 'SGT' : 'MBR'
  return (
    <span style={{ display: 'inline-block', background: c + '22', border: `1px solid ${c}66`, color: c, borderRadius: 4, padding: '1px 6px', fontSize: '.62rem', fontFamily: 'var(--fd)', letterSpacing: '.05em', textTransform: 'uppercase', whiteSpace: 'nowrap', flexShrink: 0 }}>
      {label}
    </span>
  )
}

function TagChip({ tag, style }) {
  return (
    <span style={{ display: 'inline-block', color: '#94a3b8', fontFamily: 'var(--fc)', fontWeight: 700, letterSpacing: '.03em', ...style }}>
      [{tag}]
    </span>
  )
}

const TIER_SHINE = {
  apex:   'drop-shadow(0 0 3px rgba(205,127,50,.55)) drop-shadow(0 0 7px rgba(205,127,50,.35)) brightness(1.08)',
  elite:  'drop-shadow(0 0 3px rgba(200,210,220,.6)) drop-shadow(0 0 7px rgba(184,191,199,.35)) brightness(1.13)',
  legend: 'drop-shadow(0 0 4px rgba(245,200,66,.65)) drop-shadow(0 0 9px rgba(245,200,66,.35)) brightness(1.1)',
}
function tierCls(runs) {
  const n = runs ?? 0
  if (n >= 100) return 'legend'
  if (n >= 86)  return 'elite'
  if (n >= 71)  return 'apex'
  if (n >= 56)  return 'enforcer'
  if (n >= 40)  return 'sentinel'
  if (n >= 28)  return 'vanguard'
  if (n >= 18)  return 'striker'
  if (n >= 10)  return 'operator'
  if (n >= 4)   return 'initiate'
  return 'recruit'
}
function TierIcon({ totalRuns, size = 22 }) {
  const cls = tierCls(totalRuns)
  const shine = TIER_SHINE[cls]
  return (
    <img
      src={`/${cls}.png`}
      alt={cls}
      style={{ width: size, height: size, objectFit: 'contain', flexShrink: 0, ...(shine ? { filter: shine } : {}) }}
    />
  )
}

function Confirm({ title, body, confirm = 'Confirm', onConfirm, onCancel, danger = false }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.65)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
      <div style={{ background: 'var(--surf)', border: '1px solid var(--bdr)', borderRadius: 10, padding: '1.5rem', maxWidth: 400, width: '100%' }}>
        <div style={{ fontFamily: 'var(--fd)', fontSize: '1.05rem', color: 'var(--txt)', marginBottom: '.5rem' }}>{title}</div>
        {body && <div style={{ fontSize: '.85rem', color: 'var(--muted)', marginBottom: '1.25rem', lineHeight: 1.5 }}>{body}</div>}
        <div style={{ display: 'flex', gap: '.75rem', justifyContent: 'flex-end' }}>
          <button className="btn btn-s" onClick={onCancel}>Cancel</button>
          <button className="btn btn-s" style={danger ? { background: '#7f1d1d', color: '#f87171', borderColor: '#7f1d1d' } : {}} onClick={onConfirm}>{confirm}</button>
        </div>
      </div>
    </div>
  )
}

function formatDate(ts) {
  if (!ts) return ''
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

const SECTION_HDR = { fontSize: '.65rem', color: 'var(--muted)', fontFamily: 'var(--fc)', letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: '.5rem', marginTop: '1.25rem' }


// ── PlatoonPortal (top-level) ─────────────────────────────────────────────────

export default function PlatoonPortal({ user, onViewProfile, initialSubTab }) {
  const [platoon,    setPlatoon]    = useState(null)
  const [myRole,     setMyRole]     = useState(null)
  const [loading,    setLoading]    = useState(true)
  // Pending join request count for tab dot indicator
  const [pendingCount, setPendingCount] = useState(0)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const rows = await getPlatoonForUser(user.id)
      const row  = Array.isArray(rows) ? rows[0] : rows
      if (row && row.id) {
        setPlatoon(row)
        setMyRole(row.my_role)
        if (row.my_role === 'admin' || row.my_role === 'sergeant') {
          try {
            const reqs = await getPlatoonJoinRequests()
            setPendingCount(Array.isArray(reqs) ? reqs.length : 0)
          } catch { setPendingCount(0) }
        }
      } else {
        setPlatoon(null); setMyRole(null); setPendingCount(0)
      }
    } catch { setPlatoon(null); setMyRole(null) }
    setLoading(false)
  }, [user.id])

  useEffect(() => { refresh() }, [refresh])

  if (loading) return <div style={{ color: 'var(--muted)', fontSize: '.9rem', textAlign: 'center', paddingTop: '2rem' }}>Loading…</div>

  if (!platoon) {
    return <PlatoonFinder userId={user.id} currentUser={user} onJoined={refresh} />
  }

  return <PlatoonHome platoon={platoon} myRole={myRole} userId={user.id} currentUser={user}
    pendingCount={pendingCount} onLeft={refresh} onChanged={refresh} onViewProfile={onViewProfile}
    initialSubTab={initialSubTab} />
}

// Export pendingCount for use in SocialPortal tab indicator
// (resolved via ref pattern — PlatoonPortal.getPendingCount is not used;
// instead SocialPortal polls state via onPendingChange prop)
export function PlatoonTabDot({ platoon, myRole }) {
  // Rendered by SocialPortal when it has platoon data
  return null
}


// ── InviteModal ───────────────────────────────────────────────────────────────

function InviteModal({ platoon, senderName, onClose }) {
  const [query,    setQuery]    = useState('')
  const [results,  setResults]  = useState([])
  const [searching, setSearching] = useState(false)
  const [invited,  setInvited]  = useState(new Set()) // user_ids successfully invited
  const [sending,  setSending]  = useState(null)      // user_id currently being sent
  const debounce = useRef(null)

  const doSearch = useCallback(async (q) => {
    if (!q || q.length < 2) { setResults([]); return }
    setSearching(true)
    try {
      // Strip formatting chars so phone numbers work ("317-555-0100" → "3175550100")
      const digits = q.replace(/[\s\-().+]/g, '')
      const searchQ = /^\d+$/.test(digits) && digits.length >= 2 ? digits : q
      const rows = await searchInvitablePlayers(platoon.id, searchQ)
      setResults(Array.isArray(rows) ? rows : [])
    } catch { setResults([]) }
    setSearching(false)
  }, [platoon.id])

  useEffect(() => {
    clearTimeout(debounce.current)
    debounce.current = setTimeout(() => doSearch(query), 350)
    return () => clearTimeout(debounce.current)
  }, [query, doSearch])

  const handleInvite = async (userId) => {
    setSending(userId)
    try {
      await inviteToPlatoon(userId)
      setInvited(prev => new Set([...prev, userId]))
      setResults(prev => prev.filter(r => r.id !== userId))
      emailPlatoonInviteReceived(userId, {
        platoonTag:  platoon.tag,
        platoonName: platoon.name,
        inviterName: senderName,
      })
    } catch (e) {
      if (e.message === 'already_in_platoon') alert('That operative has already enlisted in a platoon.')
      else alert('Could not send invite: ' + e.message)
    }
    setSending(null)
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.7)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
      <div style={{ background: 'var(--surf)', border: '1px solid var(--bdr)', borderRadius: 10, padding: '1.5rem', maxWidth: 440, width: '100%', maxHeight: '80vh', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontFamily: 'var(--fd)', fontSize: '1rem', color: 'var(--txt)' }}>
            Invite to [{platoon.tag}]
          </div>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', color: 'var(--muted)', fontSize: '1.2rem', cursor: 'pointer', lineHeight: 1 }}
          >✕</button>
        </div>

        {/* Search input */}
        <input
          className="inp"
          style={{ width: '100%', boxSizing: 'border-box' }}
          placeholder="Search by name or phone…"
          value={query}
          onChange={e => setQuery(e.target.value)}
          autoFocus
          autoComplete="off"
        />

        {/* Results */}
        <div style={{ overflowY: 'auto', flex: 1 }}>
          {searching && (
            <div style={{ fontSize: '.8rem', color: 'var(--muted)', textAlign: 'center', padding: '.5rem 0' }}>Searching…</div>
          )}

          {!searching && query.length >= 2 && results.length === 0 && (
            <div style={{ fontSize: '.85rem', color: 'var(--muted)', textAlign: 'center', padding: '.75rem 0', fontStyle: 'italic' }}>
              No eligible operatives found.
            </div>
          )}

          {!searching && query.length < 2 && invited.size === 0 && (
            <div style={{ fontSize: '.82rem', color: 'var(--muted)', textAlign: 'center', padding: '.75rem 0' }}>
              Type a name or phone number to search.
            </div>
          )}

          {invited.size > 0 && results.length === 0 && query.length < 2 && (
            <div style={{ fontSize: '.85rem', color: '#4ade80', textAlign: 'center', padding: '.75rem 0' }}>
              {invited.size} invite{invited.size !== 1 ? 's' : ''} sent ✓
            </div>
          )}

          {results.map(p => (
            <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: '.75rem', padding: '.55rem 0', borderBottom: '1px solid var(--bdr)' }}>
              <Avatar url={p.avatar_url} hidden={p.hide_avatar} name={p.leaderboard_name} size={34} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '.9rem', color: 'var(--txt)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {p.leaderboard_name}
                </div>
                {p.phone_last4 && (
                  <div style={{ fontSize: '.72rem', color: 'var(--muted)' }}>••••{p.phone_last4}</div>
                )}
              </div>
              <button
                className="btn btn-p btn-s"
                style={{ fontSize: '.75rem', padding: '3px 10px', whiteSpace: 'nowrap', flexShrink: 0 }}
                disabled={sending === p.id}
                onClick={() => handleInvite(p.id)}
              >
                {sending === p.id ? '…' : 'Invite'}
              </button>
            </div>
          ))}
        </div>

        <button className="btn btn-s" style={{ width: '100%' }} onClick={onClose}>Done</button>
      </div>
    </div>
  )
}


// ── PlatoonFinder ─────────────────────────────────────────────────────────────

function PlatoonFinder({ userId, currentUser, onJoined }) {
  const [query,        setQuery]        = useState('')
  const [results,      setResults]      = useState(null)
  const [searching,    setSearching]    = useState(false)
  const [detail,       setDetail]       = useState(null)   // platoon to preview
  const [showCreate,   setShowCreate]   = useState(false)
  const [invites,      setInvites]      = useState([])     // pending invites for this user
  const [invActing,    setInvActing]    = useState(null)   // invite id being acted on
  const [myRequests,   setMyRequests]   = useState([])     // outbound pending join requests
  const [reqActing,    setReqActing]    = useState(null)   // request platoon_id being cancelled
  const debounce = useRef(null)

  useEffect(() => {
    getMyPlatoonInvites().then(rows => setInvites(Array.isArray(rows) ? rows : [])).catch(() => {})
    getMyJoinRequests().then(rows => setMyRequests(Array.isArray(rows) ? rows : [])).catch(() => {})
  }, [])

  const doSearch = useCallback(async (q) => {
    setSearching(true)
    try {
      const rows = await searchPlatoons(q)
      setResults(Array.isArray(rows) ? rows : [])
    } catch { setResults([]) }
    setSearching(false)
  }, [])

  useEffect(() => {
    clearTimeout(debounce.current)
    debounce.current = setTimeout(() => doSearch(query), 300)
    return () => clearTimeout(debounce.current)
  }, [query, doSearch])

  const handleAcceptInvite = async (invite) => {
    setInvActing(invite.id)
    try {
      await acceptPlatoonInvite(invite.id)
      onJoined()
    } catch (e) {
      alert(e.message === 'already_in_platoon' ? 'You are already in a platoon.' : 'Error: ' + e.message)
      setInvActing(null)
    }
  }

  const handleDeclineInvite = async (inviteId) => {
    setInvActing(inviteId)
    try {
      await declinePlatoonInvite(inviteId)
      setInvites(prev => prev.filter(i => i.id !== inviteId))
    } catch { /* ignore */ }
    setInvActing(null)
  }

  const handleCancelRequest = async (platoonId) => {
    setReqActing(platoonId)
    try {
      await cancelJoinRequest(platoonId)
      setMyRequests(prev => prev.filter(r => r.platoon_id !== platoonId))
    } catch { /* ignore */ }
    setReqActing(null)
  }

  const pendingPlatoonIds = new Set(myRequests.map(r => r.platoon_id))

  return (
    <div>
      {/* Pending invites */}
      {invites.length > 0 && (
        <div style={{ marginBottom: '1.25rem' }}>
          <div style={SECTION_HDR}>Pending Invitations ({invites.length})</div>
          {invites.map(inv => (
            <div key={inv.id} style={{ display: 'flex', alignItems: 'center', gap: '.85rem', padding: '.65rem', background: 'var(--surf2)', border: '1px solid #2563eb44', borderRadius: 8, marginBottom: '.4rem' }}>
              {inv.platoon_badge_url
                ? <img src={inv.platoon_badge_url} style={{ width: 52, height: 52, borderRadius: 8, objectFit: 'cover', flexShrink: 0 }} alt="" />
                : <div style={{ width: 52, height: 52, borderRadius: 8, background: inv.platoon_badge_color || 'var(--surf)', border: '1px solid var(--bdr)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.4rem', flexShrink: 0 }}>🎖️</div>}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '.4rem' }}>
                  <TagChip tag={inv.platoon_tag} style={{ color: inv.platoon_badge_color || '#94a3b8' }} />
                  <span style={{ fontFamily: 'var(--fd)', fontSize: '.92rem', color: 'var(--txt)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{inv.platoon_name}</span>
                </div>
                <div style={{ fontSize: '.72rem', color: 'var(--muted)', marginTop: '.1rem' }}>
                  Invited by {inv.from_leaderboard_name}
                </div>
              </div>
              <div style={{ display: 'flex', gap: '.35rem', flexShrink: 0 }}>
                <button
                  className="btn btn-p btn-s"
                  style={{ fontSize: '.72rem', padding: '.25rem .6rem' }}
                  disabled={invActing === inv.id}
                  onClick={() => handleAcceptInvite(inv)}
                >
                  {invActing === inv.id ? '…' : 'Enlist'}
                </button>
                <button
                  className="btn btn-s btn-s"
                  style={{ fontSize: '.72rem', padding: '.25rem .6rem', color: '#f87171', borderColor: '#7f1d1d' }}
                  disabled={invActing === inv.id}
                  onClick={() => handleDeclineInvite(inv.id)}
                >
                  Decline
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Pending join requests (outbound) */}
      {myRequests.length > 0 && (
        <div style={{ marginBottom: '1.25rem' }}>
          <div style={SECTION_HDR}>Pending Requests ({myRequests.length})</div>
          {myRequests.map(req => (
            <div key={req.request_id} style={{ display: 'flex', alignItems: 'center', gap: '.85rem', padding: '.65rem', background: 'var(--surf2)', border: '1px solid #f9731644', borderRadius: 8, marginBottom: '.4rem' }}>
              {req.badge_url
                ? <img src={req.badge_url} style={{ width: 52, height: 52, borderRadius: 8, objectFit: 'cover', flexShrink: 0 }} alt="" />
                : <div style={{ width: 52, height: 52, borderRadius: 8, background: req.badge_color || 'var(--surf)', border: '1px solid var(--bdr)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.4rem', flexShrink: 0 }}>🎖️</div>}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '.4rem' }}>
                  <TagChip tag={req.platoon_tag} style={{ color: req.badge_color || '#94a3b8' }} />
                  <span style={{ fontFamily: 'var(--fd)', fontSize: '.92rem', color: 'var(--txt)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{req.platoon_name}</span>
                </div>
                <div style={{ fontSize: '.72rem', color: '#f97316', marginTop: '.1rem' }}>
                  Awaiting approval
                </div>
              </div>
              <button
                className="btn btn-s"
                style={{ fontSize: '.72rem', padding: '.25rem .6rem', color: '#f87171', borderColor: '#7f1d1d', flexShrink: 0 }}
                disabled={reqActing === req.platoon_id}
                onClick={() => handleCancelRequest(req.platoon_id)}
              >
                {reqActing === req.platoon_id ? '…' : 'Cancel'}
              </button>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', gap: '.5rem', marginBottom: '1rem', alignItems: 'center' }}>
        <input
          className="inp"
          style={{ flex: 1 }}
          placeholder="Search platoons by name or tag…"
          value={query}
          onChange={e => setQuery(e.target.value)}
        />
        <button className="btn btn-p" onClick={() => setShowCreate(true)}>+ Create</button>
      </div>

      {searching && <div style={{ color: 'var(--muted)', fontSize: '.85rem' }}>Searching…</div>}

      {results && results.length === 0 && !searching && (
        <div style={{ color: 'var(--muted)', fontSize: '.85rem', textAlign: 'center', paddingTop: '1.5rem' }}>
          No platoons found.{' '}
          <span
            style={{ color: 'var(--accB)', cursor: 'pointer', textDecoration: 'underline', textUnderlineOffset: '2px' }}
            onClick={() => setShowCreate(true)}
          >Create yours →</span>
        </div>
      )}

      {results && results.map(p => (
        <div
          key={p.id}
          onClick={() => setDetail(p)}
          style={{ display: 'flex', alignItems: 'center', gap: '.85rem', padding: '.75rem', background: 'var(--surf2)', border: '1px solid var(--bdr)', borderRadius: 8, marginBottom: '.5rem', cursor: 'pointer', transition: 'border-color .15s' }}
          onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--acc)'}
          onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--bdr)'}
        >
          {p.badge_url
            ? <img src={p.badge_url} style={{ width: 54, height: 54, borderRadius: 8, objectFit: 'cover', flexShrink: 0 }} alt="" />
            : <div style={{ width: 54, height: 54, borderRadius: 8, background: p.badge_color || 'var(--surf)', border: '1px solid var(--bdr)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.5rem', flexShrink: 0 }}>🎖️</div>}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem' }}>
              <TagChip tag={p.tag} style={{ color: p.badge_color || '#94a3b8' }} />
              <span style={{ fontFamily: 'var(--fd)', color: 'var(--txt)', fontSize: '.95rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
            </div>
            {p.description && <div style={{ fontSize: '.78rem', color: 'var(--muted)', marginTop: '.15rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.description}</div>}
          </div>
          <div style={{ textAlign: 'right', flexShrink: 0 }}>
            <div style={{ fontSize: '.75rem', color: 'var(--muted)' }}>{p.member_count} {p.member_count === 1 ? 'member' : 'members'}</div>
            {pendingPlatoonIds.has(p.id)
              ? <div style={{ fontSize: '.65rem', marginTop: '.2rem', color: '#f97316' }}>Request pending</div>
              : <div style={{ fontSize: '.65rem', marginTop: '.2rem', color: p.is_open ? '#4ade80' : '#f97316' }}>{p.is_open ? 'Open' : 'Approval req.'}</div>}
          </div>
        </div>
      ))}

      {detail && (
        <PlatoonDetailModal
          platoon={detail}
          currentUser={currentUser}
          onClose={() => setDetail(null)}
          onJoined={onJoined}
        />
      )}

      {showCreate && (
        <PlatoonCreateModal
          onClose={() => setShowCreate(false)}
          onCreated={onJoined}
          userAccess={currentUser.access}
        />
      )}
    </div>
  )
}


// ── PlatoonDetailModal ────────────────────────────────────────────────────────

function PlatoonDetailModal({ platoon, currentUser, onClose, onJoined }) {
  const [message,   setMessage]   = useState('')
  const [loading,   setLoading]   = useState(false)
  const [requested, setRequested] = useState(false)
  const [err,       setErr]       = useState('')

  const doAction = async () => {
    setLoading(true); setErr('')
    try {
      if (platoon.is_open) {
        await joinPlatoon(platoon.id)
        onJoined()
        onClose()
      } else {
        await requestToJoin(platoon.id, message || null)
        setRequested(true)
        // Email platoon officers
        try {
          const members = await getPlatoonMembers(platoon.id)
          const officers = (Array.isArray(members) ? members : [])
            .filter(m => m.role === 'admin' || m.role === 'sergeant')
            .map(m => m.user_id)
          if (officers.length) {
            const applicantName = currentUser?.leaderboardName || currentUser?.name || 'An operative'
            emailPlatoonRequestReceived(officers, {
              applicantName,
              platoonTag:  platoon.tag,
              platoonName: platoon.name,
              message:     message || null,
            })
          }
        } catch { /* email is fire-and-forget */ }
      }
    } catch (e) {
      setErr(e.message === 'already_in_platoon' ? 'You are already in a platoon.' : e.message)
    }
    setLoading(false)
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.65)', zIndex: 1500, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
      <div style={{ background: 'var(--surf)', border: '1px solid var(--bdr)', borderRadius: 10, padding: '1.5rem', maxWidth: 420, width: '100%' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1rem' }}>
          {platoon.badge_url
            ? <img src={platoon.badge_url} style={{ width: 72, height: 72, borderRadius: 10, objectFit: 'cover', flexShrink: 0 }} alt="" />
            : <div style={{ width: 72, height: 72, borderRadius: 10, background: platoon.badge_color || 'var(--surf2)', border: '1px solid var(--bdr)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '2rem' }}>🎖️</div>}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem' }}>
              <TagChip tag={platoon.tag} style={{ color: platoon.badge_color || '#94a3b8' }} />
              <span style={{ fontFamily: 'var(--fd)', fontSize: '1.1rem', color: 'var(--txt)' }}>{platoon.name}</span>
            </div>
            <div style={{ fontSize: '.78rem', color: 'var(--muted)', marginTop: '.15rem' }}>
              {platoon.member_count} {platoon.member_count === 1 ? 'member' : 'members'} · {platoon.is_open ? 'Open enrollment' : 'Approval required'}
            </div>
          </div>
        </div>

        {platoon.description && (
          <div style={{ fontSize: '.85rem', color: 'var(--txt)', lineHeight: 1.5, marginBottom: '1rem', background: 'var(--surf2)', padding: '.65rem .85rem', borderRadius: 6 }}>
            {platoon.description}
          </div>
        )}

        {requested ? (
          <div style={{ textAlign: 'center', padding: '1rem 0' }}>
            <div style={{ color: '#4ade80', fontSize: '1rem', marginBottom: '.5rem' }}>✓ Request sent</div>
            <div style={{ fontSize: '.82rem', color: 'var(--muted)' }}>You'll be notified once an officer reviews your request.</div>
            <button className="btn btn-s" style={{ marginTop: '1rem' }} onClick={onClose}>Close</button>
          </div>
        ) : (
          <>
            {!platoon.is_open && (
              <div style={{ marginBottom: '1rem' }}>
                <div style={SECTION_HDR}>Message (optional)</div>
                <textarea
                  className="inp"
                  rows={3}
                  style={{ width: '100%', resize: 'vertical', boxSizing: 'border-box' }}
                  placeholder="Introduce yourself to the platoon officers…"
                  value={message}
                  onChange={e => setMessage(e.target.value)}
                />
              </div>
            )}
            {err && <div style={{ color: '#f87171', fontSize: '.82rem', marginBottom: '.75rem' }}>{err}</div>}
            <div style={{ display: 'flex', gap: '.75rem', justifyContent: 'flex-end' }}>
              <button className="btn btn-s" onClick={onClose}>Cancel</button>
              <button className="btn btn-p" disabled={loading} onClick={doAction}>
                {loading ? '…' : platoon.is_open ? 'Enlist →' : 'Request to Join'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}


// ── PlatoonCreateModal ────────────────────────────────────────────────────────

function PlatoonCreateModal({ onClose, onCreated, userAccess }) {
  const [tag,       setTag]       = useState('')
  const [name,      setName]      = useState('')
  const [desc,      setDesc]      = useState('')
  const [isOpen,    setIsOpen]    = useState(true)
  const [badgeFile, setBadgeFile] = useState(null)
  const [badgePreview, setBadgePreview] = useState(null)
  const [saving,    setSaving]    = useState(false)
  const [err,       setErr]       = useState('')

  const handleBadge = (e) => {
    const f = e.target.files[0]
    if (!f) return
    setBadgeFile(f)
    const reader = new FileReader()
    reader.onload = ev => setBadgePreview(ev.target.result)
    reader.readAsDataURL(f)
  }

  const doCreate = async () => {
    const cleanTag  = tag.trim()
    const cleanName = name.trim()
    if (!cleanTag || !cleanName) return setErr('Tag and name are required.')
    if (!/^\S{2,5}$/.test(cleanTag)) return setErr('Tag must be 2–5 characters, no spaces.')

    setSaving(true); setErr('')
    try {
      const result = await createPlatoon(cleanTag, cleanName, desc.trim() || null, isOpen)
      const platoonId = Array.isArray(result) ? result[0] : result
      if (badgeFile && platoonId) {
        const url = await uploadPlatoonBadge(platoonId, badgeFile)
        await updatePlatoonBadge(url)
      }
      onCreated()
      onClose()
    } catch (e) {
      if (e.message?.includes('platoons_tag_unique') || e.message?.includes('unique')) setErr('That tag or name is already taken.')
      else if (e.message === 'already_in_platoon') setErr('You are already in a platoon.')
      else setErr(e.message || 'Failed to create platoon.')
    }
    setSaving(false)
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.65)', zIndex: 1500, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
      <div style={{ background: 'var(--surf)', border: '1px solid var(--bdr)', borderRadius: 10, padding: '1.5rem', maxWidth: 440, width: '100%', maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ fontFamily: 'var(--fd)', fontSize: '1.1rem', color: 'var(--txt)', marginBottom: '1.25rem' }}>Create a Platoon</div>

        {/* Badge upload */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1rem' }}>
          <label style={{ cursor: 'pointer' }}>
            <div style={{ width: 64, height: 64, borderRadius: 10, background: 'var(--surf2)', border: '2px dashed var(--bdr)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', flexShrink: 0 }}>
              {badgePreview
                ? <img src={badgePreview} style={{ width: '100%', height: '100%', objectFit: 'cover' }} alt="" />
                : <span style={{ fontSize: '1.8rem' }}>🎖️</span>}
            </div>
            <input type="file" accept="image/*" style={{ display: 'none' }} onChange={handleBadge} />
          </label>
          <div style={{ fontSize: '.78rem', color: 'var(--muted)', lineHeight: 1.5 }}>Click the badge to upload a logo <br />(optional — can add later)</div>
        </div>

        {(() => {
          const isSiteAdmin = ['staff','manager','admin'].includes(userAccess)
          const maxLen = isSiteAdmin ? 5 : 4
          return <>
            <div style={SECTION_HDR}>Tag (2–{maxLen} chars)</div>
            <input
              className="inp"
              style={{ width: '100%', boxSizing: 'border-box', fontFamily: 'var(--fd)', textTransform: 'uppercase', letterSpacing: '.05em' }}
              maxLength={maxLen}
              placeholder="S317"
              value={tag}
              onChange={e => setTag(e.target.value.replace(/\s/g, ''))}
            />
            {tag.length >= 2 && <div style={{ fontSize: '.75rem', color: '#94a3b8', marginTop: '.25rem' }}>Preview: <strong>[{tag}]</strong></div>}
            {!isSiteAdmin && <div style={{ fontSize: '.72rem', color: 'var(--muted)', marginTop: '.2rem' }}>5-character tags are reserved for staff.</div>}
          </>
        })()}

        <div style={SECTION_HDR}>Platoon Name</div>
        <input className="inp" style={{ width: '100%', boxSizing: 'border-box' }} placeholder="Sector 317 Elite" value={name} onChange={e => setName(e.target.value)} />

        <div style={SECTION_HDR}>Description (optional)</div>
        <textarea className="inp" rows={3} style={{ width: '100%', resize: 'vertical', boxSizing: 'border-box' }} placeholder="Who are you? What do you stand for?" value={desc} onChange={e => setDesc(e.target.value)} />

        <div style={{ marginTop: '1rem', display: 'flex', alignItems: 'center', gap: '.75rem' }}>
          <button
            onClick={() => setIsOpen(o => !o)}
            style={{ display: 'flex', alignItems: 'center', gap: '.5rem', background: isOpen ? '#052e16' : '#2d1b00', border: `1px solid ${isOpen ? '#166534' : '#92400e'}`, borderRadius: 6, padding: '.4rem .75rem', cursor: 'pointer', color: isOpen ? '#4ade80' : '#fb923c', fontSize: '.82rem', fontFamily: 'var(--fd)' }}
          >
            {isOpen ? '🔓 Open Enrollment' : '🔒 Approval Required'}
          </button>
          <span style={{ fontSize: '.75rem', color: 'var(--muted)' }}>{isOpen ? 'Anyone can join instantly' : 'Requests need officer approval'}</span>
        </div>

        {err && <div style={{ color: '#f87171', fontSize: '.82rem', marginTop: '.75rem' }}>{err}</div>}

        <div style={{ display: 'flex', gap: '.75rem', justifyContent: 'flex-end', marginTop: '1.25rem' }}>
          <button className="btn btn-s" disabled={saving} onClick={onClose}>Cancel</button>
          <button className="btn btn-p" disabled={saving || !tag.trim() || !name.trim()} onClick={doCreate}>
            {saving ? 'Creating…' : 'Create Platoon'}
          </button>
        </div>
      </div>
    </div>
  )
}


// ── PlatoonHome ───────────────────────────────────────────────────────────────

function PlatoonHome({ platoon, myRole, userId, currentUser, pendingCount, onLeft, onChanged, onViewProfile, initialSubTab }) {
  const [subTab,         setSubTab]         = useState(() => {
    const valid = ['board','members','sessions','upcoming','settings']
    return initialSubTab && valid.includes(initialSubTab) ? initialSubTab : 'board'
  })
  const [showAwolConfirm, setShowAwolConfirm] = useState(false)
  const [awolErr,        setAwolErr]        = useState('')
  const [awolLoading,    setAwolLoading]    = useState(false)

  const doGoAwol = async () => {
    setAwolLoading(true); setAwolErr('')
    try {
      await goAwol()
      onLeft()
    } catch (e) {
      if (e.message === 'must_transfer_admin') {
        setAwolErr('You are the last commanding officer. Transfer command to another member before going AWOL.')
      } else {
        setAwolErr(e.message || 'Failed to leave platoon.')
      }
      setAwolLoading(false)
      setShowAwolConfirm(false)
    }
  }

  const tabs = [
    { key: 'board',    label: 'Board' },
    { key: 'members',  label: 'Members', dot: (myRole === 'admin' || myRole === 'sergeant') && pendingCount > 0 ? pendingCount : 0 },
    { key: 'sessions', label: 'Sessions' },
    { key: 'upcoming', label: 'Upcoming' },
    ...(myRole === 'admin' ? [{ key: 'settings', label: 'Settings' }] : []),
  ]

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '.85rem', marginBottom: '1rem', padding: '.75rem 1rem', background: 'var(--surf2)', border: '1px solid var(--bdr)', borderRadius: 8 }}>
        {/* Badge icon */}
        {platoon.badge_url
          ? <img src={platoon.badge_url} style={{ width: 56, height: 56, borderRadius: 8, objectFit: 'cover', flexShrink: 0 }} alt="" />
          : <div style={{ width: 56, height: 56, borderRadius: 8, background: 'var(--surf)', border: '1px solid var(--bdr)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.5rem', flexShrink: 0 }}>🎖️</div>}
        {/* TAG — sized to match text block height (~two text lines) */}
        <div style={{ fontFamily: 'var(--fc)', fontWeight: 900, fontSize: '1.85rem', lineHeight: 1.15, letterSpacing: '.03em', color: platoon.badge_color || '#94a3b8', flexShrink: 0, userSelect: 'none' }}>
          [{platoon.tag}]
        </div>
        {/* Name + meta */}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '.2rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem', flexWrap: 'wrap' }}>
            <span style={{ fontFamily: 'var(--fd)', color: 'var(--txt)', fontSize: '1.05rem', fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{platoon.name}</span>
            <RoleChip role={myRole} />
          </div>
          <div style={{ fontSize: '.78rem', color: 'var(--muted)' }}>
            {platoon.member_count} {platoon.member_count === 1 ? 'member' : 'members'} · {platoon.is_open ? 'Open enrollment' : 'Approval required'}
          </div>
        </div>
      </div>

      {awolErr && <div style={{ color: '#f87171', fontSize: '.82rem', marginBottom: '.75rem', padding: '.5rem .75rem', background: '#7f1d1d22', borderRadius: 6, border: '1px solid #7f1d1d' }}>{awolErr}</div>}

      {/* Sub-tab navigation */}
      <div className="tabs" style={{ marginBottom: '1rem', borderBottom: '1px solid var(--bdr)' }}>
        {tabs.map(t => (
          <button key={t.key} className={`tab${subTab === t.key ? ' on' : ''}`} onClick={() => setSubTab(t.key)}>
            {t.label}
            {t.dot > 0 && (
              <span style={{ marginLeft: '.35rem', background: '#e04444', color: '#fff', borderRadius: 10, fontSize: '.6rem', padding: '1px 5px', fontFamily: 'var(--fd)', verticalAlign: 'middle' }}>
                {t.dot}
              </span>
            )}
          </button>
        ))}
      </div>

      {subTab === 'board'    && <BoardTab    platoon={platoon} userId={userId} myRole={myRole} />}
      {subTab === 'members'  && <MembersTab  platoon={platoon} myRole={myRole} userId={userId} currentUser={currentUser} onChanged={onChanged} onViewProfile={onViewProfile} />}
      {subTab === 'sessions' && <SessionsTab platoon={platoon} />}
      {subTab === 'upcoming' && <UpcomingTab platoon={platoon} />}
      {subTab === 'settings' && myRole === 'admin' && <SettingsTab platoon={platoon} onChanged={onChanged} onDisbanded={onLeft} userAccess={currentUser.access} />}

      <div style={{ textAlign: 'right', marginTop: '1.5rem', paddingTop: '.75rem', borderTop: '1px solid var(--bdr)' }}>
        <button onClick={() => setShowAwolConfirm(true)} style={{ background: 'none', border: 'none', color: 'var(--muted)', fontSize: '.72rem', cursor: 'pointer', opacity: .5 }}>
          Go AWOL
        </button>
      </div>

      {showAwolConfirm && (
        <Confirm
          title="Go AWOL?"
          body={`You are about to leave ${platoon.name}. You will lose your [${platoon.tag}] tag and access to the platoon board. This cannot be undone.`}
          confirm="Go AWOL"
          danger
          onConfirm={doGoAwol}
          onCancel={() => setShowAwolConfirm(false)}
        />
      )}
      {awolLoading && <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', zIndex: 2100, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--muted)' }}>Leaving platoon…</div>}
    </div>
  )
}


// ── BoardTab ──────────────────────────────────────────────────────────────────

function BoardTab({ platoon, userId, myRole }) {
  const [posts,   setPosts]   = useState([])
  const [loading, setLoading] = useState(true)
  const [offset,  setOffset]  = useState(0)
  const [hasMore, setHasMore] = useState(true)
  const [content, setContent] = useState('')
  const [posting, setPosting] = useState(false)
  const LIMIT = 50

  const load = useCallback(async (newOffset = 0) => {
    setLoading(true)
    try {
      const rows = await getPlatoonPosts(platoon.id, LIMIT, newOffset)
      const arr  = Array.isArray(rows) ? rows : []
      setPosts(p => newOffset === 0 ? arr : [...p, ...arr])
      setHasMore(arr.length === LIMIT)
      setOffset(newOffset + arr.length)
    } catch { /* ignore */ }
    setLoading(false)
  }, [platoon.id])

  useEffect(() => { load(0) }, [load])

  const doPost = async () => {
    if (!content.trim() || posting) return
    setPosting(true)
    try {
      await postPlatoonMessage(platoon.id, content.trim())
      setContent('')
      await load(0)
    } catch { /* ignore */ }
    setPosting(false)
  }

  const doDelete = async (postId) => {
    try {
      await deletePlatoonPost(postId)
      setPosts(p => p.filter(x => x.id !== postId))
    } catch { /* ignore */ }
  }

  return (
    <div>
      {/* Post input */}
      <div style={{ display: 'flex', gap: '.5rem', marginBottom: '1rem', alignItems: 'flex-end' }}>
        <textarea
          className="inp"
          rows={2}
          style={{ flex: 1, resize: 'vertical', boxSizing: 'border-box' }}
          placeholder="Post a message to your platoon…"
          value={content}
          onChange={e => setContent(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doPost() } }}
        />
        <button className="btn btn-p" disabled={!content.trim() || posting} onClick={doPost} style={{ height: 'fit-content' }}>
          {posting ? '…' : 'Post'}
        </button>
      </div>

      {loading && posts.length === 0 && <div style={{ color: 'var(--muted)', fontSize: '.85rem', textAlign: 'center', paddingTop: '1rem' }}>Loading…</div>}
      {!loading && posts.length === 0 && <div style={{ color: 'var(--muted)', fontSize: '.85rem', textAlign: 'center', paddingTop: '1.5rem' }}>No posts yet. Be the first!</div>}

      {posts.map(post => (
        <PostRow key={post.id} post={post} userId={userId} myRole={myRole} onDelete={doDelete} />
      ))}

      {hasMore && !loading && (
        <button className="btn btn-s" style={{ width: '100%', marginTop: '.75rem' }} onClick={() => load(offset)}>
          Load More
        </button>
      )}
    </div>
  )
}

function PostRow({ post, userId, myRole, onDelete }) {
  // System notes (automated events: join / AWOL) render as a centered info line
  if (post.user_id === null) {
    return (
      <div style={{ textAlign: 'center', padding: '.4rem 0', borderBottom: '1px solid var(--bdr)', color: 'var(--muted)', fontSize: '.75rem', fontStyle: 'italic', letterSpacing: '.01em' }}>
        {post.content}
        <span style={{ marginLeft: '.45rem', opacity: .55 }}>· {formatDate(post.created_at)}</span>
      </div>
    )
  }

  const initials = post.leaderboard_name ? post.leaderboard_name.slice(0, 2).toUpperCase() : '?'
  const isOwn = post.user_id === userId
  const canDelete = isOwn || myRole === 'admin' || myRole === 'sergeant'

  return (
    <div style={{ display: 'flex', gap: '.75rem', padding: '.65rem 0', borderBottom: '1px solid var(--bdr)' }}>
      <Avatar url={post.avatar_url} hidden={post.hide_avatar} name={post.leaderboard_name} size={34} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '.4rem', flexWrap: 'wrap', marginBottom: '.2rem' }}>
          <TierImg runs={post.total_runs} size={16} />
          <span style={{ fontFamily: 'var(--fd)', fontSize: '.85rem', color: 'var(--txt)' }}>{post.leaderboard_name}</span>
          <RoleChip role={post.member_role || 'member'} />
          <span style={{ fontSize: '.7rem', color: 'var(--muted)', marginLeft: 'auto' }}>{formatDate(post.created_at)}</span>
          {canDelete && (
            <button onClick={() => onDelete(post.id)} style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', padding: '0 .2rem', fontSize: '.8rem' }} title="Delete">×</button>
          )}
        </div>
        <div style={{ fontSize: '.85rem', color: 'var(--txt)', lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{post.content}</div>
      </div>
    </div>
  )
}


// ── MembersTab ────────────────────────────────────────────────────────────────

function MembersTab({ platoon, myRole, userId, currentUser, onChanged, onViewProfile }) {
  const [members,        setMembers]        = useState([])
  const [requests,       setRequests]       = useState([])
  const [pendingInvites, setPendingInvites] = useState([])
  const [loading,        setLoading]        = useState(true)
  const [menuOpen,       setMenuOpen]       = useState(null) // userId of open kebab
  const [confirm,        setConfirm]        = useState(null) // { action, target }
  const [showInvite,     setShowInvite]     = useState(false)
  const canManage = myRole === 'admin' || myRole === 'sergeant'

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const [mRows, rRows, iRows] = await Promise.all([
        getPlatoonMembers(platoon.id),
        canManage ? getPlatoonJoinRequests() : Promise.resolve([]),
        getPlatoonPendingInvites(),
      ])
      setMembers(Array.isArray(mRows) ? mRows : [])
      setRequests(Array.isArray(rRows) ? rRows : [])
      setPendingInvites(Array.isArray(iRows) ? iRows : [])
    } catch { /* ignore */ }
    setLoading(false)
  }, [platoon.id, canManage])

  useEffect(() => { refresh() }, [refresh])

  const doAction = async (action, targetUserId, extra) => {
    setMenuOpen(null)
    try {
      if (action === 'kick')           await kickPlatoonMember(targetUserId)
      if (action === 'promote')        await setPlatoonMemberRole(targetUserId, 'sergeant')
      if (action === 'demote')         await setPlatoonMemberRole(targetUserId, 'member')
      if (action === 'transfer')       await transferPlatoonAdmin(targetUserId)
      if (action === 'approve-req') {
        await approveJoinRequest(extra)
        emailPlatoonRequestApproved(targetUserId, { platoonTag: platoon.tag, platoonName: platoon.name })
      }
      if (action === 'deny-req') {
        await denyJoinRequest(extra)
        emailPlatoonRequestDenied(targetUserId, { platoonTag: platoon.tag, platoonName: platoon.name })
      }
      if (action === 'cancel-invite')  await cancelPlatoonInvite(extra)
      await refresh(); onChanged()
    } catch (e) { console.error(e) }
  }

  if (loading) return <div style={{ color: 'var(--muted)', fontSize: '.85rem', textAlign: 'center', paddingTop: '1rem' }}>Loading…</div>

  return (
    <div>
      {/* Pending join requests */}
      {canManage && requests.length > 0 && (
        <>
          <div style={SECTION_HDR}>Pending Requests ({requests.length})</div>
          {requests.map(req => (
            <div key={req.id} style={{ display: 'flex', alignItems: 'center', gap: '.75rem', padding: '.6rem', background: 'var(--surf2)', border: '1px solid var(--bdr)', borderRadius: 8, marginBottom: '.4rem', cursor: onViewProfile ? 'pointer' : 'default' }} onClick={() => onViewProfile && onViewProfile(req.user_id)}>
              <Avatar url={req.avatar_url} name={req.leaderboard_name} size={32} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: 'var(--fd)', fontSize: '.88rem', color: 'var(--txt)' }}>{req.leaderboard_name}</div>
                {req.real_name && <div style={{ fontSize: '.72rem', color: 'var(--muted)' }}>{req.real_name}</div>}
                {req.message && <div style={{ fontSize: '.78rem', color: 'var(--muted)', fontStyle: 'italic', marginTop: '.15rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>"{req.message}"</div>}
              </div>
              <div style={{ display: 'flex', gap: '.4rem', flexShrink: 0 }}>
                <button className="btn btn-p btn-sm" style={{ fontSize: '.72rem', padding: '.25rem .6rem' }} onClick={e => { e.stopPropagation(); doAction('approve-req', req.user_id, req.id) }}>✓ Approve</button>
                <button className="btn btn-s btn-sm" style={{ fontSize: '.72rem', padding: '.25rem .6rem', color: '#f87171', borderColor: '#7f1d1d' }} onClick={e => { e.stopPropagation(); doAction('deny-req', req.user_id, req.id) }}>✕ Deny</button>
              </div>
            </div>
          ))}
        </>
      )}

      {/* Pending outgoing invites */}
      {pendingInvites.length > 0 && (
        <>
          <div style={SECTION_HDR}>Pending Invites ({pendingInvites.length})</div>
          {pendingInvites.map(inv => (
            <div key={inv.id} style={{ display: 'flex', alignItems: 'center', gap: '.75rem', padding: '.6rem', background: 'var(--surf2)', border: '1px solid var(--bdr)', borderRadius: 8, marginBottom: '.4rem' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: 'var(--fd)', fontSize: '.88rem', color: 'var(--txt)' }}>{inv.to_leaderboard_name}</div>
                <div style={{ fontSize: '.72rem', color: 'var(--muted)' }}>Invited by {inv.from_leaderboard_name}</div>
              </div>
              {(canManage || inv.from_user_id === userId) && (
                <button
                  className="btn btn-s"
                  style={{ fontSize: '.72rem', padding: '.25rem .6rem', color: '#f87171', borderColor: '#7f1d1d', flexShrink: 0 }}
                  onClick={() => doAction('cancel-invite', null, inv.id)}
                >Revoke</button>
              )}
            </div>
          ))}
        </>
      )}

      {/* Member list header + Invite button */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', ...(requests.length > 0 ? SECTION_HDR : { ...SECTION_HDR, marginTop: 0 }) }}>
        <span>Members ({members.length})</span>
        <button
          className="btn btn-s"
          style={{ fontSize: '.72rem', padding: '2px 10px', marginLeft: '.5rem' }}
          onClick={() => setShowInvite(true)}
        >+ Invite</button>
      </div>
      {members.map(m => {
        const isSelf  = m.user_id === userId
        const canAct  = canManage && !isSelf
        const isAdmin = myRole === 'admin'
        const isSgt   = myRole === 'sergeant'

        return (
          <div key={m.user_id} style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: '.75rem', padding: '.6rem 0', borderBottom: '1px solid var(--bdr)' }}>
            <div
              style={{ display: 'flex', alignItems: 'center', gap: '.5rem', cursor: onViewProfile ? 'pointer' : 'default', flexShrink: 0 }}
              onClick={() => onViewProfile && onViewProfile(m.user_id)}
            >
              <Avatar url={m.avatar_url} hidden={m.hide_avatar} name={m.leaderboard_name} size={36} />
            </div>
            <div style={{ flex: 1, minWidth: 0, cursor: onViewProfile ? 'pointer' : 'default' }} onClick={() => onViewProfile && onViewProfile(m.user_id)}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '.4rem', flexWrap: 'wrap' }}>
                <TierIcon totalRuns={m.total_runs} size={20} />
                <span style={{ fontFamily: 'var(--fd)', fontSize: '.9rem', color: 'var(--txt)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {platoon.tag && <span style={{ color: platoon.badge_color || '#94a3b8', marginRight: '.25em', fontFamily: 'var(--fc)', fontWeight: 700, letterSpacing: '.03em' }}>[{platoon.tag}]</span>}
                  {m.leaderboard_name}
                </span>
                <RoleChip role={m.role} />
              </div>
              <div style={{ fontSize: '.7rem', color: 'var(--muted)' }}>
                {m.leaderboard_score != null && <span style={{ marginRight: '.5rem' }}>{Number(m.leaderboard_score).toFixed(1)} pts · {m.total_runs ?? 0} run{m.total_runs !== 1 ? 's' : ''}</span>}
                Joined {formatDate(m.joined_at)}
              </div>
            </div>

            {canAct && (
              <div style={{ position: 'relative', flexShrink: 0 }}>
                <button
                  style={{ background: 'none', border: '1px solid var(--bdr)', borderRadius: 4, color: 'var(--muted)', cursor: 'pointer', padding: '.25rem .5rem', fontSize: '.75rem' }}
                  onClick={() => setMenuOpen(menuOpen === m.user_id ? null : m.user_id)}
                >⋯</button>
                {menuOpen === m.user_id && (
                  <div style={{ position: 'absolute', right: 0, top: '100%', background: 'var(--surf)', border: '1px solid var(--bdr)', borderRadius: 6, minWidth: 160, zIndex: 100, boxShadow: '0 4px 12px rgba(0,0,0,.4)' }}>
                    {isAdmin && m.role === 'member'   && <MenuItem label="Promote to Sergeant" onClick={() => setConfirm({ action: 'promote',  target: m })} />}
                    {isAdmin && m.role === 'sergeant'  && <MenuItem label="Demote to Member"    onClick={() => setConfirm({ action: 'demote',   target: m })} />}
                    {isAdmin                           && <MenuItem label="Transfer Command"    onClick={() => setConfirm({ action: 'transfer', target: m })} />}
                    {(isAdmin || (isSgt && m.role === 'member')) && <MenuItem label="Kick" danger onClick={() => setConfirm({ action: 'kick', target: m })} />}
                  </div>
                )}
              </div>
            )}
          </div>
        )
      })}

      {confirm && (
        <Confirm
          title={
            confirm.action === 'kick'     ? `Kick ${confirm.target.leaderboard_name}?` :
            confirm.action === 'transfer' ? `Transfer command to ${confirm.target.leaderboard_name}?` :
            confirm.action === 'promote'  ? `Promote ${confirm.target.leaderboard_name} to Sergeant?` :
                                            `Demote ${confirm.target.leaderboard_name} to Member?`
          }
          body={
            confirm.action === 'kick'     ? `${confirm.target.leaderboard_name} will be removed from the platoon and lose their [${platoon.tag}] tag.` :
            confirm.action === 'transfer' ? `You will become a Sergeant and ${confirm.target.leaderboard_name} will become the Commanding Officer.` :
            null
          }
          confirm={confirm.action === 'kick' ? 'Kick' : 'Confirm'}
          danger={confirm.action === 'kick'}
          onConfirm={() => { const c = confirm; setConfirm(null); doAction(c.action, c.target.user_id) }}
          onCancel={() => setConfirm(null)}
        />
      )}

      {showInvite && <InviteModal platoon={platoon} senderName={currentUser?.leaderboardName || currentUser?.name || 'An officer'} onClose={() => setShowInvite(false)} />}

      {/* close menu on outside click */}
      {menuOpen && <div style={{ position: 'fixed', inset: 0, zIndex: 99 }} onClick={() => setMenuOpen(null)} />}
    </div>
  )
}

function MenuItem({ label, onClick, danger }) {
  return (
    <button
      onClick={onClick}
      style={{ display: 'block', width: '100%', textAlign: 'left', background: 'none', border: 'none', padding: '.5rem .85rem', cursor: 'pointer', fontSize: '.83rem', color: danger ? '#f87171' : 'var(--txt)', fontFamily: 'var(--fc)' }}
      onMouseEnter={e => { e.currentTarget.style.background = 'var(--surf2)' }}
      onMouseLeave={e => { e.currentTarget.style.background = 'none' }}
    >
      {label}
    </button>
  )
}


// ── SessionsTab ───────────────────────────────────────────────────────────────

const PAGE_SZ = 10

// Group sessions that share the same date+start_time into a single timeslot entry.
// Order is preserved (sessions arrive sorted newest-first from the RPC).
function groupByTimeslot(sessions) {
  const map = new Map()
  sessions.forEach(s => {
    const key = `${s.date}|${s.start_time}`
    if (!map.has(key)) map.set(key, { key, date: s.date, start_time: s.start_time, sessions: [] })
    map.get(key).sessions.push(s)
  })
  return [...map.values()]
}

function TimeslotGroup({ group, upcoming }) {
  const [open, setOpen] = useState(false)
  const dateStr = group.date
    ? new Date(group.date + 'T00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
    : ''

  // Collect unique platoon members across all lanes for the parent header
  const platoonMembers = []
  const seen = new Set()
  group.sessions.forEach(s => {
    const mems = Array.isArray(s.member_players) ? s.member_players : []
    mems.forEach(p => {
      if (!seen.has(p.user_id)) { seen.add(p.user_id); platoonMembers.push(p) }
    })
  })

  return (
    <div style={{ background: 'var(--surf2)', border: '1px solid var(--bdr)', borderRadius: 8, marginBottom: '.65rem', overflow: 'hidden' }}>
      {/* Collapsed timeslot header */}
      <div
        style={{ display: 'flex', alignItems: 'flex-start', gap: '.75rem', padding: '.65rem .85rem', cursor: 'pointer', userSelect: 'none', borderBottom: open ? '1px solid var(--bdr)' : 'none' }}
        onClick={() => setOpen(o => !o)}
      >
        <div style={{ textAlign: 'center', minWidth: 52, flexShrink: 0 }}>
          <div style={{ fontFamily: 'var(--fd)', fontSize: '.85rem', color: upcoming ? 'var(--acc)' : 'var(--txt)', lineHeight: 1.2 }}>{dateStr}</div>
          {group.start_time && <div style={{ fontSize: '.7rem', color: 'var(--muted)', marginTop: '.1rem' }}>{group.start_time}</div>}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: '.82rem', color: 'var(--txt)', fontFamily: 'var(--fd)', marginBottom: '.4rem' }}>
            {group.sessions[0]?.type_name}
            <span style={{ color: 'var(--muted)', fontWeight: 400 }}> · {group.sessions.length} lanes</span>
          </div>
          {/* Platoon members full row — same style as SessionCard */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.4rem .75rem', alignItems: 'center' }}>
            {platoonMembers.map(p => {
              const roleLabel = p.platoon_role ? (p.platoon_role === 'admin' ? 'CO' : p.platoon_role === 'sergeant' ? 'SGT' : null) : null
              return (
                <div key={p.user_id} style={{ display: 'inline-flex', alignItems: 'center', gap: '.3rem', flexShrink: 0, whiteSpace: 'nowrap' }}>
                  <Avatar url={p.avatar_url} name={p.leaderboard_name} size={20} />
                  <TierIcon totalRuns={p.total_runs ?? 0} size={16} />
                  {p.platoon_tag && (
                    <span style={{ fontFamily: 'var(--fc)', fontWeight: 700, letterSpacing: '.03em', fontSize: '.7rem', color: p.platoon_badge_color || '#94a3b8' }}>
                      [{p.platoon_tag}]
                    </span>
                  )}
                  <span style={{ fontFamily: 'var(--fc)', fontWeight: 700, fontSize: '.8rem', color: 'var(--txt)' }}>
                    {p.leaderboard_name}
                  </span>
                  {roleLabel && (
                    <span style={{ fontSize: '.62rem', fontFamily: 'var(--fd)', color: 'var(--muted)', letterSpacing: '.06em' }}>{roleLabel}</span>
                  )}
                </div>
              )
            })}
          </div>
        </div>
        <span style={{ fontSize: '.75rem', color: 'var(--muted)', flexShrink: 0, paddingTop: '.2rem' }}>{open ? '▾' : '▸'}</span>
      </div>
      {/* Expanded: one SessionCard per lane with full participant list */}
      {open && (
        <div style={{ padding: '.65rem .85rem' }}>
          {group.sessions.map((s, i) => (
            <div key={s.reservation_id}>
              <div style={{ fontSize: '.7rem', fontFamily: 'var(--fd)', color: 'var(--muted)', letterSpacing: '.07em', textTransform: 'uppercase', marginBottom: '.3rem', marginTop: i > 0 ? '.75rem' : 0 }}>
                Lane {i + 1}{s.type_name ? ` · ${s.type_name}` : ''}
              </div>
              <SessionCard session={s} upcoming={upcoming} />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function SessionsTab({ platoon }) {
  const [sessions, setSessions] = useState([])
  const [loading,  setLoading]  = useState(true)
  const [page,     setPage]     = useState(0)

  useEffect(() => {
    getPlatoonSessions(platoon.id)
      .then(rows => setSessions(Array.isArray(rows) ? rows : []))
      .catch(() => setSessions([]))
      .finally(() => setLoading(false))
  }, [platoon.id])

  if (loading) return <div style={{ color: 'var(--muted)', fontSize: '.85rem', textAlign: 'center', paddingTop: '1rem' }}>Loading…</div>
  if (sessions.length === 0) return <div style={{ color: 'var(--muted)', fontSize: '.85rem', textAlign: 'center', paddingTop: '1.5rem' }}>No completed sessions yet.</div>

  const groups     = groupByTimeslot(sessions)
  const totalPages = Math.ceil(groups.length / PAGE_SZ)
  const pageGroups = groups.slice(page * PAGE_SZ, (page + 1) * PAGE_SZ)

  return (
    <div>
      {pageGroups.map(g =>
        g.sessions.length === 1
          ? <SessionCard key={g.key} session={g.sessions[0]} />
          : <TimeslotGroup key={g.key} group={g} />
      )}
      {totalPages > 1 && (
        <div style={{ display: 'flex', gap: '.5rem', justifyContent: 'center', padding: '.75rem 0', alignItems: 'center' }}>
          <button className="btn btn-sm btn-s" disabled={page === 0} onClick={() => setPage(p => p - 1)}>← Prev</button>
          <span style={{ fontSize: '.8rem', color: 'var(--muted)' }}>{page + 1} / {totalPages}</span>
          <button className="btn btn-sm btn-s" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>Next →</button>
        </div>
      )}
    </div>
  )
}

function UpcomingTab({ platoon }) {
  const [sessions, setSessions] = useState([])
  const [loading,  setLoading]  = useState(true)
  const [page,     setPage]     = useState(0)

  useEffect(() => {
    getPlatoonUpcoming(platoon.id)
      .then(rows => {
        const arr = Array.isArray(rows) ? rows : []
        arr.sort((a, b) => {
          const da = (a.date || '') + (a.start_time || '')
          const db = (b.date || '') + (b.start_time || '')
          return da < db ? -1 : da > db ? 1 : 0
        })
        setSessions(arr)
      })
      .catch(() => setSessions([]))
      .finally(() => setLoading(false))
  }, [platoon.id])

  if (loading) return <div style={{ color: 'var(--muted)', fontSize: '.85rem', textAlign: 'center', paddingTop: '1rem' }}>Loading…</div>
  if (sessions.length === 0) return <div style={{ color: 'var(--muted)', fontSize: '.85rem', textAlign: 'center', paddingTop: '1.5rem' }}>No upcoming sessions.</div>

  const groups     = groupByTimeslot(sessions)
  const totalPages = Math.ceil(groups.length / PAGE_SZ)
  const pageGroups = groups.slice(page * PAGE_SZ, (page + 1) * PAGE_SZ)

  return (
    <div>
      {pageGroups.map(g =>
        g.sessions.length === 1
          ? <SessionCard key={g.key} session={g.sessions[0]} upcoming />
          : <TimeslotGroup key={g.key} group={g} upcoming />
      )}
      {totalPages > 1 && (
        <div style={{ display: 'flex', gap: '.5rem', justifyContent: 'center', padding: '.75rem 0', alignItems: 'center' }}>
          <button className="btn btn-sm btn-s" disabled={page === 0} onClick={() => setPage(p => p - 1)}>← Prev</button>
          <span style={{ fontSize: '.8rem', color: 'var(--muted)' }}>{page + 1} / {totalPages}</span>
          <button className="btn btn-sm btn-s" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>Next →</button>
        </div>
      )}
    </div>
  )
}

function SessionCard({ session, upcoming }) {
  const [expanded, setExpanded] = useState(false)
  const members = Array.isArray(session.member_players) ? session.member_players : []
  const runs    = Array.isArray(session.runs) ? session.runs : []
  const dateStr = session.date ? new Date(session.date + 'T00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) : ''
  const hasDetails = !upcoming && runs.length > 0

  const fmtSec = s => { if (s == null) return null; const m = Math.floor(s / 60), sec = s % 60; return `${m}:${String(sec).padStart(2, '0')}` }
  const VIZ = { V: 'Standard', C: 'Cosmic', R: 'Rave', S: 'Strobe', CS: 'Cosmic+Strobe', B: 'Dark' }
  const AUD = { C: 'Cranked', O: 'Off', T: 'Tunes' }
  const TC  = { 1: { name: 'Blue', col: '#3b82f6' }, 2: { name: 'Red', col: '#ef4444' } }
  const OPD = { easy: 'Easy', medium: 'Medium', hard: 'Hard', elite: 'Elite' }
  const Pill = ({ v, children }) => <span style={{ display: 'inline-block', background: 'var(--bg2)', border: '1px solid var(--bdr)', borderRadius: 4, padding: '1px 6px', fontSize: '.65rem', marginRight: '.25rem' }}>{v != null ? <span style={{ color: 'var(--muted)' }}>{v}</span> : children}</span>
  const ns = { fontFamily: 'var(--fd)', fontSize: '.65rem', fontWeight: 700, lineHeight: 1 }
  const audCode = rn => rn.audio || (rn.cranked ? 'C' : 'T')
  const roleColor = role => { if (!role) return 'var(--muted)'; const r = role.toLowerCase(); if (r.includes('hunt')) return '#c8e03a'; if (r.includes('coyot')) return '#c4a882'; return 'var(--muted)' }

  // Member lookup for enriching run-derived player entries
  const memberMap = {}
  members.forEach(m => { memberMap[m.user_id] = m })

  // All players to show in header: for upcoming use all_players; for sessions derive from runs
  // Non-platoon mates are shown muted (is_member = false)
  const displayPlayers = Array.isArray(session.all_players)
    ? session.all_players
    : (() => {
        if (runs.length === 0) return members.map(m => ({ ...m, is_member: true }))
        const seenP = new Set()
        const result = []
        runs.forEach(rn => {
          if (!seenP.has(rn.user_id)) {
            seenP.add(rn.user_id)
            const mem = memberMap[rn.user_id]
            result.push({
              user_id: rn.user_id,
              leaderboard_name: rn.leaderboard_name,
              avatar_url: mem?.avatar_url ?? null,
              is_member: !!rn.is_member,
              platoon_role: mem?.platoon_role ?? null,
              platoon_tag: mem?.platoon_tag ?? null,
              platoon_badge_color: mem?.platoon_badge_color ?? null,
              total_runs: mem?.total_runs ?? null,
            })
          }
        })
        result.sort((a, b) => (b.is_member ? 1 : 0) - (a.is_member ? 1 : 0))
        return result
      })()

  // Group runs by run_number
  const groups = {}
  runs.forEach(rn => { const k = rn.run_number ?? 0; (groups[k] = groups[k] || []).push(rn) })
  const sortedGroups = Object.entries(groups).sort(([a], [b]) => Number(a) - Number(b))

  return (
    <div style={{ background: 'var(--surf2)', border: '1px solid var(--bdr)', borderRadius: 8, marginBottom: '.65rem', overflow: 'hidden' }}>
      {/* Header — clickable to expand if there are run details */}
      <div
        style={{ display: 'flex', alignItems: 'flex-start', gap: '.75rem', padding: '.65rem .85rem', borderBottom: expanded ? '1px solid var(--bdr)' : 'none', cursor: hasDetails ? 'pointer' : 'default', userSelect: 'none' }}
        onClick={() => hasDetails && setExpanded(e => !e)}
      >
        {/* Date/time */}
        <div style={{ textAlign: 'center', minWidth: 52, flexShrink: 0 }}>
          <div style={{ fontFamily: 'var(--fd)', fontSize: '.85rem', color: upcoming ? 'var(--acc)' : 'var(--txt)', lineHeight: 1.2 }}>{dateStr}</div>
          {session.start_time && <div style={{ fontSize: '.7rem', color: 'var(--muted)', marginTop: '.1rem' }}>{session.start_time}</div>}
        </div>

        {/* Type + player list */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: '.88rem', color: 'var(--txt)', fontFamily: 'var(--fd)', marginBottom: '.4rem' }}>{session.type_name}</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.4rem .75rem', alignItems: 'center' }}>
            {displayPlayers.map(p => {
              const isMember = !!p.is_member
              const roleLabel = isMember && p.platoon_role ? (p.platoon_role === 'admin' ? 'CO' : p.platoon_role === 'sergeant' ? 'SGT' : null) : null
              return (
                <div key={p.user_id} style={{ display: 'inline-flex', alignItems: 'center', gap: '.3rem', opacity: isMember ? 1 : 0.45, flexShrink: 0, whiteSpace: 'nowrap' }}>
                  <Avatar url={p.avatar_url} name={p.leaderboard_name} size={20} />
                  {isMember && <TierIcon totalRuns={p.total_runs ?? 0} size={16} />}
                  {isMember && p.platoon_tag && (
                    <span style={{ fontFamily: 'var(--fc)', fontWeight: 700, letterSpacing: '.03em', fontSize: '.7rem', color: p.platoon_badge_color || '#94a3b8' }}>
                      [{p.platoon_tag}]
                    </span>
                  )}
                  <span style={{ fontFamily: 'var(--fc)', fontWeight: isMember ? 700 : 400, fontSize: '.8rem', color: isMember ? 'var(--txt)' : 'var(--muted)' }}>
                    {p.leaderboard_name}
                  </span>
                  {roleLabel && (
                    <span style={{ fontSize: '.62rem', fontFamily: 'var(--fd)', color: 'var(--muted)', letterSpacing: '.06em' }}>{roleLabel}</span>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        {/* Right side: winner badge + chevron */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '.35rem', flexShrink: 0 }}>
          {session.war_winner_team != null && TC[session.war_winner_team] && (
            <div style={{ background: TC[session.war_winner_team].col + '18', border: `1px solid ${TC[session.war_winner_team].col}44`, borderRadius: 5, padding: '.25rem .6rem', fontSize: '.7rem', fontFamily: 'var(--fd)', color: TC[session.war_winner_team].col, whiteSpace: 'nowrap' }}>
              {TC[session.war_winner_team].name} wins
            </div>
          )}
          {hasDetails && (
            <span style={{ fontSize: '.75rem', color: 'var(--muted)', marginTop: '.1rem' }}>{expanded ? '▾' : '▸'}</span>
          )}
        </div>
      </div>

      {/* Run details — only when expanded */}
      {expanded && !upcoming && sortedGroups.length > 0 && (
        <div style={{ padding: '.6rem .85rem' }}>
          {session.mode === 'versus' ? (
            sortedGroups.map(([runNum, grp]) => {
              const runWinTeam = grp[0]?.winning_team != null ? Number(grp[0].winning_team) : null
              const runTime = fmtSec(grp[0]?.elapsed_seconds)
              const rEnv = grp[0]
              // Deduplicate to unique teams (grp has one entry per player, not per team)
              const uniqueTeams = [...new Set(grp.map(r => r.team))].sort((a, b) => (a ?? 0) - (b ?? 0))
              return (
                <div key={runNum} style={{ marginBottom: '.5rem', border: '1px solid var(--bdr)', borderRadius: 6, overflow: 'hidden', background: 'var(--surf)' }}>
                  <div style={{ background: 'var(--bg2)', padding: '.28rem .75rem', fontSize: '.65rem', fontFamily: 'var(--fd)', letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--muted)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '.3rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '.4rem', flexWrap: 'wrap' }}>
                      <span style={{ color: 'var(--txt)', fontWeight: 700 }}>Run {runNum}</span>
                      {rEnv?.structure && <span>Structure: {rEnv.structure}</span>}
                      {rEnv?.visual && <span style={{marginRight:'.35rem'}}>{vizRenderName(rEnv.visual, VIZ[rEnv.visual]||rEnv.visual, ns)}<span style={{color:'var(--muted)'}}> Viz</span></span>}
                      <span style={{marginRight:'.35rem'}}>{audRenderName(audCode(rEnv??{}), AUD[audCode(rEnv??{})]||'Tunes', ns)}<span style={{color:'var(--muted)'}}> Aud</span></span>
                    </div>
                    <div style={{ display: 'flex', gap: '.4rem', alignItems: 'center', flexShrink: 0 }}>
                      {runTime && <span>{runTime}</span>}
                      {runWinTeam != null && <span style={{ color: TC[runWinTeam]?.col ?? 'var(--acc)', fontWeight: 700 }}>{(TC[runWinTeam]?.name ?? 'Team ' + runWinTeam) + ' wins'}</span>}
                    </div>
                  </div>
                  <div style={{ display: 'flex' }}>
                    {uniqueTeams.map((teamKey, ti) => {
                      const teamPlayers = grp.filter(r => Number(r.team) === Number(teamKey))
                      const rn = teamPlayers[0]
                      const tc = TC[teamKey] || { name: 'Team ' + (teamKey ?? '?'), col: 'var(--muted)' }
                      const won = rn?.winning_team != null && Number(teamKey) === Number(rn?.winning_team)
                      const displayRole = rn?.role ? rn.role.charAt(0).toUpperCase() + rn.role.slice(1) : null
                      return (
                        <div key={teamKey} style={{ flex: 1, padding: '.5rem .75rem', borderLeft: `3px solid ${tc.col}`, borderRight: ti < uniqueTeams.length - 1 ? '1px solid var(--bdr)' : 'none', background: won ? tc.col + '18' : undefined }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '.3rem', marginBottom: '.25rem', flexWrap: 'wrap' }}>
                            <div style={{ width: 8, height: 8, borderRadius: '50%', background: tc.col, flexShrink: 0 }} />
                            <span style={{ fontWeight: 700, fontSize: '.78rem', color: tc.col }}>{tc.name}</span>
                            {displayRole && <span style={{ fontSize: '.7rem', fontWeight: 700, color: roleColor(displayRole), textTransform: 'capitalize' }}>· {displayRole}</span>}
                          </div>
                          <div style={{ fontFamily: 'var(--fd)', fontSize: '1.25rem', fontWeight: 700, color: won ? tc.col : 'var(--txt)' }}>{rn?.score != null ? Number(rn.score).toFixed(1) : '—'}</div>
                          <div style={{ display: 'flex', gap: '.2rem', flexWrap: 'wrap', marginTop: '.2rem' }}>
                            {displayRole === 'Hunter' && rn?.objective_complete != null && <span style={{ fontSize: '.62rem', padding: '1px 5px', borderRadius: 3, background: rn.objective_complete ? 'rgba(34,197,94,.12)' : 'rgba(239,68,68,.1)', color: rn.objective_complete ? '#4ade80' : '#f87171', border: '1px solid ' + (rn.objective_complete ? 'rgba(34,197,94,.3)' : 'rgba(239,68,68,.3)') }}>{rn.objective_complete ? '✓ Objective' : '✗ Objective'}</span>}
                            {won && <span style={{ fontSize: '.62rem', padding: '1px 5px', borderRadius: 3, background: 'rgba(34,197,94,.12)', color: '#4ade80', border: '1px solid rgba(34,197,94,.3)' }}>✓ Won</span>}
                          </div>
                          <div style={{ marginTop: '.35rem', display: 'flex', flexWrap: 'wrap', gap: '.15rem .4rem' }}>
                            {teamPlayers.map(r2 => (
                              <span key={r2.user_id} style={{ fontSize: '.66rem', color: r2.is_member ? 'var(--accB)' : 'var(--muted)', fontWeight: r2.is_member ? 700 : 400 }}>{r2.leaderboard_name || '—'}</span>
                            ))}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })
          ) : (
            // Co-op: same block structure as versus
            <div>
              {sortedGroups.map(([runNum, grp]) => {
                const rEnv = grp[0]
                const runTime = fmtSec(rEnv?.elapsed_seconds)
                return (
                  <div key={runNum} style={{ marginBottom: '.5rem', border: '1px solid var(--bdr)', borderRadius: 6, overflow: 'hidden', background: 'var(--surf)' }}>
                    <div style={{ background: 'var(--bg2)', padding: '.28rem .75rem', fontSize: '.65rem', fontFamily: 'var(--fd)', letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--muted)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '.3rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '.4rem', flexWrap: 'wrap' }}>
                        <span style={{ color: 'var(--txt)', fontWeight: 700 }}>Run {runNum}</span>
                        {rEnv?.structure && <span>Structure: {rEnv.structure}</span>}
                        {rEnv?.visual && <span style={{ marginRight: '.35rem' }}>{vizRenderName(rEnv.visual, VIZ[rEnv.visual] || rEnv.visual, ns)}<span style={{ color: 'var(--muted)' }}> Viz</span></span>}
                        <span style={{ marginRight: '.35rem' }}>{audRenderName(audCode(rEnv ?? {}), AUD[audCode(rEnv ?? {})] || 'Tunes', ns)}<span style={{ color: 'var(--muted)' }}> Aud</span></span>
                        {rEnv?.live_op_difficulty && <span>OP: {OPD[rEnv.live_op_difficulty] || rEnv.live_op_difficulty}</span>}
                      </div>
                      {runTime && <span>{runTime}</span>}
                    </div>
                    <div style={{ padding: '.5rem .75rem' }}>
                      <div style={{ fontFamily: 'var(--fd)', fontSize: '1.25rem', fontWeight: 700, color: 'var(--txt)', marginBottom: '.2rem' }}>{rEnv?.score != null ? Number(rEnv.score).toFixed(1) : '—'}</div>
                      <div style={{ display: 'flex', gap: '.2rem', flexWrap: 'wrap', marginBottom: grp.length ? '.35rem' : 0 }}>
                        {rEnv?.targets_eliminated != null && <span style={{ fontSize: '.62rem', padding: '1px 5px', borderRadius: 3, background: rEnv.targets_eliminated ? 'rgba(34,197,94,.12)' : 'rgba(239,68,68,.1)', color: rEnv.targets_eliminated ? '#4ade80' : '#f87171', border: '1px solid ' + (rEnv.targets_eliminated ? 'rgba(34,197,94,.3)' : 'rgba(239,68,68,.3)') }}>{rEnv.targets_eliminated ? '✓ Targets' : '✗ Missed'}</span>}
                        {rEnv?.objective_complete != null && <span style={{ fontSize: '.62rem', padding: '1px 5px', borderRadius: 3, background: rEnv.objective_complete ? 'rgba(34,197,94,.12)' : 'rgba(239,68,68,.1)', color: rEnv.objective_complete ? '#4ade80' : '#f87171', border: '1px solid ' + (rEnv.objective_complete ? 'rgba(34,197,94,.3)' : 'rgba(239,68,68,.3)') }}>{rEnv.objective_complete ? '✓ Objective' : '✗ Objective'}</span>}
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.15rem .4rem' }}>
                        {grp.map(r2 => (
                          <span key={r2.user_id} style={{ fontSize: '.66rem', color: r2.is_member ? 'var(--accB)' : 'var(--muted)', fontWeight: r2.is_member ? 700 : 400 }}>{r2.leaderboard_name || '—'}</span>
                        ))}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}


// ── SettingsTab ───────────────────────────────────────────────────────────────

function SettingsTab({ platoon, onChanged, onDisbanded, userAccess }) {
  const [tag,          setTag]          = useState(platoon.tag)
  const [name,         setName]         = useState(platoon.name)
  const [desc,         setDesc]         = useState(platoon.description || '')
  const [isOpen,       setIsOpen]       = useState(platoon.is_open)
  const [badgeFile,    setBadgeFile]    = useState(null)
  const [badgePreview, setBadgePreview] = useState(platoon.badge_url || null)
  const [badgeColor,   setBadgeColor]   = useState(platoon.badge_color || '#4ade80')
  const [saving,       setSaving]       = useState(false)
  const [err,          setErr]          = useState('')
  const [saved,        setSaved]        = useState(false)
  const [showDisband,  setShowDisband]  = useState(false)
  const [disbanding,   setDisbanding]   = useState(false)

  const handleBadge = (e) => {
    const f = e.target.files[0]
    if (!f) return
    setBadgeFile(f)
    const reader = new FileReader()
    reader.onload = ev => setBadgePreview(ev.target.result)
    reader.readAsDataURL(f)
  }

  const doSave = async () => {
    const cleanTag = tag.trim()
    if (!cleanTag || !/^\S{2,5}$/.test(cleanTag)) return setErr('Tag must be 2–5 characters, no spaces.')
    if (!name.trim()) return setErr('Name is required.')
    setSaving(true); setErr(''); setSaved(false)
    try {
      if (cleanTag !== platoon.tag) await updatePlatoonTag(cleanTag)
      await updatePlatoonSettings(name.trim(), desc.trim() || null, isOpen)
      await updatePlatoonBadgeColor(badgeColor)
      if (badgeFile) {
        const url = await uploadPlatoonBadge(platoon.id, badgeFile)
        await updatePlatoonBadge(url)
        setBadgeFile(null)
      }
      setSaved(true)
      onChanged()
    } catch (e) {
      if (e.message?.includes('platoons_tag_unique') || e.message?.includes('unique') && e.message?.includes('tag')) setErr('That tag is already taken.')
      else if (e.message?.includes('unique')) setErr('That name is already taken.')
      else if (e.message?.includes('invalid_tag')) setErr('Tag must be 2–5 uppercase letters/digits.')
      else setErr(e.message || 'Failed to save.')
    }
    setSaving(false)
  }

  const doDisband = async () => {
    setDisbanding(true)
    try {
      await disbandPlatoon()
      onDisbanded()
    } catch (e) {
      setErr(e.message || 'Failed to disband.')
      setDisbanding(false)
      setShowDisband(false)
    }
  }

  return (
    <div>
      {/* Badge */}
      <div style={SECTION_HDR}>Platoon Badge</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
        <label style={{ cursor: 'pointer' }}>
          <div style={{ width: 72, height: 72, borderRadius: 10, background: badgePreview ? 'transparent' : badgeColor, border: '2px dashed var(--bdr)', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {badgePreview
              ? <img src={badgePreview} style={{ width: '100%', height: '100%', objectFit: 'cover' }} alt="" />
              : <span style={{ fontSize: '2rem' }}>🎖️</span>}
          </div>
          <input type="file" accept="image/*" style={{ display: 'none' }} onChange={handleBadge} />
        </label>
        <div style={{ fontSize: '.78rem', color: 'var(--muted)' }}>Click to change logo</div>
      </div>

      <div style={SECTION_HDR}>Badge Color</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '.75rem' }}>
        <input
          type="color"
          value={/^#[0-9A-Fa-f]{6}$/.test(badgeColor) ? badgeColor : '#4ade80'}
          onChange={e => setBadgeColor(e.target.value)}
          style={{ width: 40, height: 40, padding: 2, borderRadius: 6, border: '1px solid var(--bdr)', background: 'none', cursor: 'pointer', flexShrink: 0 }}
        />
        <input
          className="inp"
          value={badgeColor}
          onChange={e => {
            const v = e.target.value
            setBadgeColor(v)
          }}
          onBlur={e => {
            const v = e.target.value.trim()
            if (!/^#[0-9A-Fa-f]{6}$/.test(v)) setBadgeColor('#4ade80')
          }}
          maxLength={7}
          placeholder="#4ade80"
          style={{ width: 100, fontFamily: 'monospace' }}
        />
        <div style={{ width: 28, height: 28, borderRadius: 5, background: /^#[0-9A-Fa-f]{6}$/.test(badgeColor) ? badgeColor : '#4ade80', border: '1px solid var(--bdr)', flexShrink: 0 }} />
        <span style={{ fontSize: '.75rem', color: 'var(--muted)' }}>Used as tag accent &amp; badge background</span>
      </div>

      {(() => {
        const isSiteAdmin = ['staff','manager','admin'].includes(userAccess)
        const maxLen = isSiteAdmin ? 5 : 4
        return <>
          <div style={SECTION_HDR}>Platoon Tag</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '.65rem', flexWrap: 'wrap' }}>
            <input
              className="inp"
              value={tag}
              onChange={e => setTag(e.target.value.replace(/\s/g, '').slice(0, maxLen))}
              placeholder={`2–${maxLen} chars`}
              maxLength={maxLen}
              style={{ width: 100, fontFamily: 'var(--fc)', fontWeight: 700, letterSpacing: '.08em' }}
            />
            <span style={{ fontSize: '.75rem', color: 'var(--muted)' }}>2–{maxLen} uppercase letters &amp; digits · shown as [{tag || '???'}]</span>
          </div>
          {!isSiteAdmin && <div style={{ fontSize: '.72rem', color: 'var(--muted)', marginTop: '.2rem' }}>5-character tags are reserved for staff.</div>}
        </>
      })()}

      <div style={SECTION_HDR}>Platoon Name</div>
      <input className="inp" style={{ width: '100%', boxSizing: 'border-box' }} value={name} onChange={e => setName(e.target.value)} />

      <div style={SECTION_HDR}>Description</div>
      <textarea className="inp" rows={3} style={{ width: '100%', resize: 'vertical', boxSizing: 'border-box' }} value={desc} onChange={e => setDesc(e.target.value)} />

      <div style={{ marginTop: '1rem', display: 'flex', alignItems: 'center', gap: '.75rem' }}>
        <button
          onClick={() => setIsOpen(o => !o)}
          style={{ display: 'flex', alignItems: 'center', gap: '.5rem', background: isOpen ? '#052e16' : '#2d1b00', border: `1px solid ${isOpen ? '#166534' : '#92400e'}`, borderRadius: 6, padding: '.4rem .75rem', cursor: 'pointer', color: isOpen ? '#4ade80' : '#fb923c', fontSize: '.82rem', fontFamily: 'var(--fd)' }}
        >
          {isOpen ? '🔓 Open Enrollment' : '🔒 Approval Required'}
        </button>
        <span style={{ fontSize: '.75rem', color: 'var(--muted)' }}>{isOpen ? 'Anyone can join instantly' : 'Requests need officer approval'}</span>
      </div>

      {err   && <div style={{ color: '#f87171', fontSize: '.82rem', marginTop: '.75rem' }}>{err}</div>}
      {saved && <div style={{ color: '#4ade80', fontSize: '.82rem', marginTop: '.75rem' }}>✓ Saved</div>}

      <button className="btn btn-p" disabled={saving} onClick={doSave} style={{ marginTop: '1.25rem' }}>
        {saving ? 'Saving…' : 'Save Changes'}
      </button>

      {/* Danger zone */}
      <div style={{ marginTop: '2.5rem', paddingTop: '1.25rem', borderTop: '1px solid var(--bdr)' }}>
        <div style={{ fontSize: '.75rem', color: '#f87171', fontFamily: 'var(--fd)', letterSpacing: '.05em', textTransform: 'uppercase', marginBottom: '.75rem' }}>Danger Zone</div>
        <button
          style={{ background: '#7f1d1d22', border: '1px solid #7f1d1d', color: '#f87171', borderRadius: 6, padding: '.5rem 1rem', cursor: 'pointer', fontSize: '.85rem', fontFamily: 'var(--fd)' }}
          onClick={() => setShowDisband(true)}
        >Disband Platoon</button>
        <div style={{ fontSize: '.75rem', color: 'var(--muted)', marginTop: '.5rem' }}>All members will lose their [{platoon.tag}] tag. This cannot be undone.</div>
      </div>

      {showDisband && (
        <Confirm
          title={`Disband ${platoon.name}?`}
          body={`All ${platoon.member_count} members will lose their [${platoon.tag}] tag. This cannot be undone.`}
          confirm="Disband"
          danger
          onConfirm={doDisband}
          onCancel={() => setShowDisband(false)}
        />
      )}
      {disbanding && <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', zIndex: 2100, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--muted)' }}>Disbanding…</div>}
    </div>
  )
}
