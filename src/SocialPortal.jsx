// src/SocialPortal.jsx
// Social tab for the Customer Portal — Profile, Friends, Connect.

import { useState, useEffect, useRef, useCallback } from 'react'
import {
  uploadAvatar, updateOwnAvatar, updateSocialProfile,
  sendFriendRequest, cancelFriendRequest, acceptFriendRequest, rejectFriendRequest,
  removeFriend, searchPlayers, getRecentlyMet, getFriendProfile,
  fetchFriends, fetchReceivedRequests, fetchSentRequests,
} from './supabase.js'

// ── Tier data ────────────────────────────────────────────────────────────────
const TIER_THRESHOLDS = [
  { key: 'recruit',  name: 'Recruit',  min: 0 },
  { key: 'initiate', name: 'Initiate', min: 4 },
  { key: 'operator', name: 'Operator', min: 10 },
  { key: 'striker',  name: 'Striker',  min: 18 },
  { key: 'vanguard', name: 'Vanguard', min: 28 },
  { key: 'sentinel', name: 'Sentinel', min: 40 },
  { key: 'enforcer', name: 'Enforcer', min: 56 },
  { key: 'apex',     name: 'Apex',     min: 71 },
  { key: 'elite',    name: 'Elite',    min: 86 },
  { key: 'legend',   name: 'Legend',   min: 100 },
]
const TIER_COLORS = {
  recruit: '#e8e8e8', initiate: '#8b95c9', operator: '#4db6ac',
  striker: '#85b07a', vanguard: '#5a9a6a', sentinel: '#6b9dcf',
  enforcer: '#c94a5a', apex: '#cd7f32', elite: '#b8bfc7', legend: '#f5c842',
}
const TIER_SVGS = (() => {
  const SP = 'M0,-1 .23,-.32 .95,-.31 .36,.12 .59,.81 0,.38 -.59,.81 -.36,.12 -.95,-.31 -.23,-.32Z'
  const star = (cx, cy, sz) => `<path d="${SP}" fill="currentColor" transform="translate(${cx},${cy}) scale(${sz})"/>`
  const cf = (py, ey, hw) => {
    const ht = ey - py, len = Math.hypot(10, ht), nx = ht / len * hw, ny = 10 / len * hw
    const iy = ey + ny, ipy = iy - ht * (10 - nx) / 10, f = v => +v.toFixed(1)
    return `<polygon points="0,${ey} 10,${py} 20,${ey} ${f(20 - nx)},${f(iy)} 10,${f(ipy)} ${f(nx)},${f(iy)}" fill="currentColor"/>`
  }
  const s = (w, h, vw, vh, c) => `<svg width="${w * 2}" height="${h * 2}" viewBox="0 0 ${vw} ${vh}" xmlns="http://www.w3.org/2000/svg">${c}</svg>`
  return {
    recruit:  s(14, 12, 20, 17, cf(2, 14, 3.5)),
    initiate: s(14, 17, 20, 24, cf(2, 9, 3.5) + cf(13, 20, 3.5)),
    operator: s(14, 18, 20, 26, cf(2, 8, 3.0) + cf(10.5, 16.5, 3.0) + star(10, 22, 3.2)),
    striker:  s(10, 20, 12, 24, '<rect x="3" y="1" width="6" height="22" fill="currentColor"/>'),
    vanguard: s(16, 20, 20, 24, '<rect x="1" y="1" width="6" height="22" fill="currentColor"/><rect x="13" y="1" width="6" height="22" fill="currentColor"/>'),
    sentinel: s(16, 20, 20, 24, '<path d="M10,2 L18,5 L18,12 Q18,21 10,23 Q2,21 2,12 L2,5 Z" stroke="currentColor" stroke-width="2.8" fill="none" stroke-linejoin="miter"/>'),
    enforcer: s(22, 14, 28, 18, '<path d="M14,9 C11,6 6,5 0,7 C3,10 9,10 14,10Z" fill="currentColor"/><path d="M14,9 C17,6 22,5 28,7 C25,10 19,10 14,10Z" fill="currentColor"/><ellipse cx="14" cy="12" rx="2.5" ry="3.5" fill="currentColor"/>'),
    apex:     s(16, 16, 20, 20, star(10, 10, 8.5)),
    elite:    s(22, 14, 28, 18, star(7, 9, 5.5) + star(21, 9, 5.5)),
    legend:   s(28, 22, 56, 44, '<path d="M 0,40 L 0,28 L 12,16 L 22,30 L 28,10 L 34,30 L 44,16 L 56,28 L 56,40 Z" fill="currentColor"/>' + star(12, 12, 5) + star(28, 6, 6) + star(44, 12, 5)),
  }
})()

function getTierInfo(runs) {
  const n = runs ?? 0
  let idx = 0
  for (let i = TIER_THRESHOLDS.length - 1; i >= 0; i--) {
    if (n >= TIER_THRESHOLDS[i].min) { idx = i; break }
  }
  const current = TIER_THRESHOLDS[idx]
  const next = TIER_THRESHOLDS[idx + 1] ?? null
  const runsToNext = next ? next.min - n : 0
  const sessionsToNext = next ? Math.ceil(runsToNext / 2) : 0
  return { current, next, runsToNext, sessionsToNext }
}

function getTierSvg1x(key) {
  return TIER_SVGS[key]
    .replace(/ width="(\d+)"/, (m, v) => ` width="${v / 2}"`)
    .replace(/ height="(\d+)"/, (m, v) => ` height="${v / 2}"`)
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function fmtSec(s) {
  if (!s && s !== 0) return '—'
  const m = Math.floor(s / 60), sec = s % 60
  return `${m}:${String(sec).padStart(2, '0')}`
}

function fmtMonthYear(dateStr) {
  if (!dateStr) return null
  const [y, m] = dateStr.split('-')
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${months[parseInt(m, 10) - 1]} ${y}`
}

function fmtPhone(p) {
  if (!p) return null
  const d = p.replace(/\D/g, '')
  if (d.length === 10) return `(${d.slice(0,3)}) ${d.slice(3,6)}-${d.slice(6)}`
  if (d.length === 11 && d[0] === '1') return `+1 (${d.slice(1,4)}) ${d.slice(4,7)}-${d.slice(7)}`
  return p
}

function computeStats(runArr) {
  if (!runArr.length) return null
  const scores = runArr.map(r => r.score ?? 0)
  const times = runArr.filter(r => r.elapsedSeconds != null).map(r => r.elapsedSeconds)
  return {
    sessions: new Set(runArr.map(r => r.reservationId)).size,
    runs:     runArr.length,
    best:     Math.max(...scores),
    avg:      Math.round(scores.reduce((a, b) => a + b, 0) / scores.length * 10) / 10,
    objRate:  Math.round(runArr.filter(r => r.objectiveComplete).length / runArr.length * 100),
    avgTime:  times.length ? Math.round(times.reduce((a, b) => a + b, 0) / times.length) : null,
  }
}

// ── Small reusable components ─────────────────────────────────────────────────
function StatCard({ label, value, sub }) {
  return (
    <div style={{ background: 'var(--surf2)', border: '1px solid var(--bdr)', borderRadius: 6, padding: '.65rem .85rem', textAlign: 'center' }}>
      <div style={{ fontFamily: 'var(--fd)', fontSize: '1.35rem', color: 'var(--accB)' }}>{value}</div>
      <div style={{ fontSize: '.7rem', color: 'var(--muted)', marginTop: '.1rem', textTransform: 'uppercase', letterSpacing: '.05em' }}>{label}</div>
      {sub && <div style={{ fontSize: '.65rem', color: 'var(--muted)', opacity: .75, marginTop: '.1rem' }}>{sub}</div>}
    </div>
  )
}

function MiniAvatar({ url, hidden, size = 36 }) {
  return (
    <div style={{ width: size, height: size, borderRadius: '50%', background: 'var(--surf2)', border: '1px solid var(--bdr)', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: Math.round(size * 0.4) }}>
      {url && !hidden
        ? <img src={url} style={{ width: '100%', height: '100%', objectFit: 'cover' }} alt="" />
        : <span style={{ color: 'var(--muted)' }}>👤</span>}
    </div>
  )
}

function TierChip({ runs }) {
  const { current: tier } = getTierInfo(runs ?? 0)
  const col = TIER_COLORS[tier.key]
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: '.2rem',
      background: col + '22', border: `1px solid ${col}66`,
      borderRadius: 4, padding: '1px 5px', fontSize: '.62rem',
      color: col, fontFamily: 'var(--fd)', textTransform: 'uppercase', letterSpacing: '.05em',
      whiteSpace: 'nowrap', flexShrink: 0,
    }}>
      <span style={{ color: col, display: 'inline-flex', lineHeight: 1 }} dangerouslySetInnerHTML={{ __html: getTierSvg1x(tier.key) }} />
      {tier.name}
    </span>
  )
}

// ── Friend Profile Modal ──────────────────────────────────────────────────────
function FriendProfileModal({ userId, onClose }) {
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    setProfile(null)
    getFriendProfile(userId).then(({ data }) => {
      const row = Array.isArray(data) ? data[0] : data
      setProfile(row ?? null)
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [userId])

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.72)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '1rem' }}
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div style={{ background: 'var(--surf)', border: '1px solid var(--bdr)', borderRadius: 8, padding: '1.5rem', maxWidth: 380, width: '100%', maxHeight: '82vh', overflowY: 'auto', position: 'relative' }}>
        <button onClick={onClose} style={{ position: 'absolute', top: '.6rem', right: '.75rem', background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: '1.1rem', lineHeight: 1 }}>✕</button>

        {loading && <div style={{ textAlign: 'center', color: 'var(--muted)', padding: '2.5rem 0' }}>Loading…</div>}
        {!loading && !profile && <div style={{ textAlign: 'center', color: 'var(--muted)', padding: '2.5rem 0' }}>Profile not found.</div>}

        {!loading && profile && (() => {
          const { current: tier } = getTierInfo(profile.total_runs ?? 0)
          const col = TIER_COLORS[tier.key]
          return (
            <>
              {/* Avatar + identity */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1.25rem' }}>
                <div style={{ width: 64, height: 64, borderRadius: '50%', background: 'var(--surf2)', border: '2px solid var(--bdr)', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.6rem', flexShrink: 0 }}>
                  {profile.avatar_url && !profile.hide_avatar
                    ? <img src={profile.avatar_url} style={{ width: '100%', height: '100%', objectFit: 'cover' }} alt="" />
                    : <span style={{ color: 'var(--muted)' }}>👤</span>}
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontFamily: 'var(--fd)', fontSize: '1.15rem', color: 'var(--txt)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{profile.leaderboard_name}</div>
                  {profile.real_name && <div style={{ fontSize: '.82rem', color: 'var(--muted)', marginTop: '.1rem' }}>{profile.real_name}</div>}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '.4rem', marginTop: '.35rem', flexWrap: 'wrap' }}>
                    <span style={{ color: col, display: 'inline-flex', alignItems: 'center' }} dangerouslySetInnerHTML={{ __html: getTierSvg1x(tier.key) }} />
                    <span style={{ fontFamily: 'var(--fd)', fontSize: '.75rem', color: col, textTransform: 'uppercase', letterSpacing: '.06em' }}>{tier.name}</span>
                  </div>
                </div>
              </div>

              {/* Stats */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: '.5rem', marginBottom: '1rem' }}>
                <StatCard label="Total Runs" value={profile.total_runs ?? 0} />
                <StatCard label="Avg Score"  value={profile.avg_score != null ? Number(profile.avg_score).toFixed(1) : '—'} />
                <StatCard label="Best Run"   value={profile.best_run   != null ? Number(profile.best_run).toFixed(1)   : '—'} />
              </div>

              {/* Detail fields */}
              {(profile.profession || profile.home_base_city || profile.home_base_state ||
                profile.bio || profile.motto || profile.phone_last4 || profile.email) && (
                <div style={{ background: 'var(--surf2)', border: '1px solid var(--bdr)', borderRadius: 6, padding: '.65rem .85rem', display: 'flex', flexDirection: 'column', gap: '.35rem', fontSize: '.85rem' }}>
                  {profile.profession && (
                    <div><span style={{ color: 'var(--muted)' }}>Profession:</span> <span style={{ color: 'var(--txt)' }}>{profile.profession}</span></div>
                  )}
                  {(profile.home_base_city || profile.home_base_state) && (
                    <div><span style={{ color: 'var(--muted)' }}>Home Base:</span> <span style={{ color: 'var(--txt)' }}>{[profile.home_base_city, profile.home_base_state].filter(Boolean).join(', ')}</span></div>
                  )}
                  {profile.phone_last4 && (
                    <div><span style={{ color: 'var(--muted)' }}>Phone:</span> <span style={{ color: 'var(--txt)' }}>••••{profile.phone_last4}</span></div>
                  )}
                  {profile.email && (
                    <div><span style={{ color: 'var(--muted)' }}>Email:</span> <span style={{ color: 'var(--txt)', wordBreak: 'break-all' }}>{profile.email}</span></div>
                  )}
                  {profile.motto && (
                    <div style={{ fontStyle: 'italic', color: 'var(--muted)' }}>"{profile.motto}"</div>
                  )}
                  {profile.bio && (
                    <div style={{ marginTop: '.25rem', color: 'var(--txt)', lineHeight: 1.5 }}>{profile.bio}</div>
                  )}
                </div>
              )}
            </>
          )
        })()}
      </div>
    </div>
  )
}

const MAX_BIO = 150

// ── Main export ───────────────────────────────────────────────────────────────
export default function SocialPortal({ user, users, setUsers, reservations, resTypes, runs, careerRuns, onEditProfile, onFriendsChanged }) {
  const [tab, setTab]                         = useState('profile')
  const [profileStatsSub, setProfileStatsSub] = useState('coop')
  const [avatarUploading, setAvatarUploading] = useState(false)
  const [avatarKey, setAvatarKey]             = useState(() => Date.now())
  const [editing, setEditing]                 = useState(false)
  const [editDraft, setEditDraft]             = useState({})
  const [editSaving, setEditSaving]           = useState(false)

  // Friends state
  const [friendships, setFriendships]         = useState([])
  const [receivedRequests, setReceivedRequests] = useState([])
  const [sentRequests, setSentRequests]       = useState([])
  const [recentlyMet, setRecentlyMet]         = useState([])
  const [friendLoading, setFriendLoading]     = useState(false)
  const [searchQuery, setSearchQuery]         = useState('')
  const [searchResults, setSearchResults]     = useState([])
  const [searching, setSearching]             = useState(false)
  const [profileModal, setProfileModal]       = useState(null) // userId string
  const searchTimerRef                        = useRef(null)

  // ── Stats computation ────────────────────────────────────────────────────
  const myRes = reservations.filter(r => r.userId === user.id)
  const myResMap = Object.fromEntries(myRes.map(r => [r.id, r]))
  const myRuns = runs.filter(rn => myResMap[rn.reservationId] && rn.score != null)

  const coopResIds = new Set(
    myRes.filter(r => resTypes.find(t => t.id === r.typeId)?.mode === 'coop').map(r => r.id)
  )
  const versResIds = new Set(
    myRes.filter(r => resTypes.find(t => t.id === r.typeId)?.mode === 'versus').map(r => r.id)
  )
  const coopRuns = myRuns.filter(rn => coopResIds.has(rn.reservationId))
  const versRuns = myRuns.filter(rn => versResIds.has(rn.reservationId))

  const teamLetter = n => n === 1 ? 'A' : n === 2 ? 'B' : null
  const versWins = versRuns.filter(rn => {
    const res = myResMap[rn.reservationId]
    const pl = res?.players?.find(p => p.userId === user.id)
    return pl?.team && rn.winningTeam && teamLetter(pl.team) === rn.winningTeam
  }).length
  const versLosses = versRuns.filter(rn => {
    const res = myResMap[rn.reservationId]
    const pl = res?.players?.find(p => p.userId === user.id)
    return pl?.team && rn.winningTeam && teamLetter(pl.team) !== rn.winningTeam
  }).length

  const operatorSince = myRes.length
    ? fmtMonthYear(myRes.reduce((min, r) => r.date < min ? r.date : min, myRes[0].date))
    : null

  // ── Friend helpers ───────────────────────────────────────────────────────
  const friendIds = new Set(
    friendships.map(f => f.user_id_1 === user.id ? f.user_id_2 : f.user_id_1)
  )
  const resolveUser = id => {
    const u = (users ?? []).find(u => u.id === id)
    return u ?? { id, name: 'Operative', leaderboardName: null, avatarUrl: null, hideAvatar: false }
  }

  const loadFriends = useCallback(async () => {
    setFriendLoading(true)
    try {
      const [{ data: fs }, { data: recv }, { data: sent }] = await Promise.all([
        fetchFriends(user.id),
        fetchReceivedRequests(user.id),
        fetchSentRequests(user.id),
      ])
      setFriendships(fs ?? [])
      setReceivedRequests(recv ?? [])
      setSentRequests(sent ?? [])
    } finally {
      setFriendLoading(false)
    }
  }, [user.id])

  useEffect(() => {
    if (tab === 'friends' || tab === 'connect') loadFriends()
  }, [tab, loadFriends])

  useEffect(() => {
    if (tab !== 'connect') return
    getRecentlyMet().then(({ data }) => setRecentlyMet(data ?? []))
  }, [tab])

  // Debounced search
  useEffect(() => {
    const q = searchQuery.trim()
    if (q.length < 2) { setSearchResults([]); return }
    clearTimeout(searchTimerRef.current)
    searchTimerRef.current = setTimeout(async () => {
      setSearching(true)
      const { data } = await searchPlayers(q)
      setSearchResults(data ?? [])
      setSearching(false)
    }, 400)
    return () => clearTimeout(searchTimerRef.current)
  }, [searchQuery])

  // ── Friend action handlers ───────────────────────────────────────────────
  async function handleAccept(fromId) {
    await acceptFriendRequest(fromId)
    await loadFriends()
    onFriendsChanged?.()
  }

  async function handleIgnore(fromId) {
    await rejectFriendRequest(fromId)
    setReceivedRequests(prev => prev.filter(r => r.from_user_id !== fromId))
  }

  async function handleRemoveFriend(otherId) {
    if (!window.confirm('Remove this operative from your squad?')) return
    await removeFriend(otherId)
    setFriendships(prev => prev.filter(f => f.user_id_1 !== otherId && f.user_id_2 !== otherId))
    onFriendsChanged?.()
  }

  async function handleSendRequest(toId) {
    await sendFriendRequest(toId)
    setSentRequests(prev => [...prev, { to_user_id: toId, created_at: new Date().toISOString() }])
  }

  async function handleCancelRequest(toId) {
    await cancelFriendRequest(toId)
    setSentRequests(prev => prev.filter(r => r.to_user_id !== toId))
  }

  // ── Avatar upload ────────────────────────────────────────────────────────
  const handleAvatarChange = async e => {
    const file = e.target.files?.[0]
    if (!file) return
    setAvatarUploading(true)
    try {
      const url = await uploadAvatar(user.id, file)
      await updateOwnAvatar(user.id, url)
      setUsers(prev => prev.map(u => u.id === user.id ? { ...u, avatarUrl: url } : u))
      setAvatarKey(Date.now())
    } catch (err) {
      alert('Upload failed: ' + err.message)
    } finally {
      setAvatarUploading(false)
    }
  }

  // ── Social profile edit ──────────────────────────────────────────────────
  function startEditing() {
    setEditDraft({
      motto:         user.motto         || '',
      profession:    user.profession    || '',
      homeBaseCity:  user.homeBaseCity  || '',
      homeBaseState: user.homeBaseState || '',
      bio:           user.bio           || '',
      hidePhone:     user.hidePhone     ?? false,
      hideEmail:     user.hideEmail     ?? false,
      hideName:      user.hideName      ?? false,
      hideAvatar:    user.hideAvatar    ?? false,
      hideBio:       user.hideBio       ?? false,
    })
    setEditing(true)
  }

  async function handleSaveSocial() {
    setEditSaving(true)
    try {
      const updated = await updateSocialProfile(user.id, {
        motto:         editDraft.motto.trim()         || null,
        profession:    editDraft.profession.trim()    || null,
        homeBaseCity:  editDraft.homeBaseCity.trim()  || null,
        homeBaseState: editDraft.homeBaseState.trim() || null,
        bio:           editDraft.bio.trim().slice(0, MAX_BIO) || null,
        hidePhone:     editDraft.hidePhone,
        hideEmail:     editDraft.hideEmail,
        hideName:      editDraft.hideName,
        hideAvatar:    editDraft.hideAvatar,
        hideBio:       editDraft.hideBio,
      })
      setUsers(prev => prev.map(u => u.id === user.id ? updated : u))
      setEditing(false)
    } catch (err) {
      alert('Save failed: ' + err.message)
    } finally {
      setEditSaving(false)
    }
  }

  const activeStats = profileStatsSub === 'coop' ? computeStats(coopRuns) : computeStats(versRuns)

  const lbl = { color: 'var(--muted)', fontSize: '.87rem' }
  const val = { color: 'var(--txt)',   fontSize: '.87rem' }

  const SECTION_HDR = { fontSize: '.7rem', fontFamily: 'var(--fd)', letterSpacing: '.1em', color: 'var(--acc2)', textTransform: 'uppercase', marginBottom: '.5rem' }

  return (
    <>
      {profileModal && (
        <FriendProfileModal userId={profileModal} onClose={() => setProfileModal(null)} />
      )}

      {/* ── Sub-tabs ── */}
      <div className="tabs" style={{ marginBottom: '1rem', borderBottom: '1px solid var(--bdr)' }}>
        <button className={`tab${tab === 'profile' ? ' on' : ''}`} onClick={() => setTab('profile')}>Profile</button>
        <button className={`tab${tab === 'friends' ? ' on' : ''}`} onClick={() => setTab('friends')}>
          Friends
          {receivedRequests.length > 0 && (
            <span style={{ marginLeft: '.35rem', background: '#e04444', color: '#fff', borderRadius: 10, fontSize: '.6rem', padding: '1px 5px', fontFamily: 'var(--fd)', verticalAlign: 'middle' }}>
              {receivedRequests.length}
            </span>
          )}
        </button>
        <button className={`tab${tab === 'connect' ? ' on' : ''}`} onClick={() => setTab('connect')}>Connect</button>
      </div>

      {/* ════════════════════════════════════════════════════════
          PROFILE TAB
      ════════════════════════════════════════════════════════ */}
      {tab === 'profile' && <>
        {/* Avatar + Identity */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '1.25rem', marginBottom: '1.5rem' }}>
          <div style={{ position: 'relative', flexShrink: 0 }}>
            <div style={{ width: 84, height: 84, borderRadius: '50%', background: 'var(--surf2)', border: '2px solid var(--bdr)', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '2.2rem' }}>
              {user.avatarUrl
                ? <img src={`${user.avatarUrl}?_=${avatarKey}`} style={{ width: '100%', height: '100%', objectFit: 'cover' }} alt="" />
                : <span style={{ color: 'var(--muted)' }}>👤</span>}
            </div>
            <label
              title={avatarUploading ? 'Uploading…' : 'Change photo'}
              style={{ position: 'absolute', bottom: 0, right: 0, background: 'var(--acc)', borderRadius: '50%', width: 24, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: avatarUploading ? 'default' : 'pointer', fontSize: '.75rem', border: '2px solid var(--bg)', boxSizing: 'border-box', color: '#111209' }}
            >
              {avatarUploading ? '…' : '✎'}
              <input type="file" accept="image/*" style={{ display: 'none' }} onChange={handleAvatarChange} disabled={avatarUploading} />
            </label>
          </div>

          <div style={{ flex: 1, minWidth: 0, paddingTop: '.25rem' }}>
            <div style={{ fontFamily: 'var(--fd)', fontSize: '1.3rem', color: 'var(--txt)', lineHeight: 1.2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user.name}</div>
            <div style={{ fontSize: '.85rem', color: 'var(--acc2)', marginTop: '.15rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {user.leaderboardName || <span style={{ color: 'var(--muted)' }}>No callsign set</span>}
            </div>
            {careerRuns != null && (() => {
              const { current: tier } = getTierInfo(careerRuns)
              const col = TIER_COLORS[tier.key]
              return (
                <div style={{ display: 'flex', alignItems: 'center', gap: '.35rem', marginTop: '.45rem', flexWrap: 'wrap' }}>
                  <span style={{ color: col, display: 'inline-flex', alignItems: 'center' }} dangerouslySetInnerHTML={{ __html: getTierSvg1x(tier.key) }} />
                  <span style={{ fontFamily: 'var(--fd)', fontSize: '.78rem', color: col, textTransform: 'uppercase', letterSpacing: '.06em' }}>{tier.name}</span>
                  <span style={{ fontSize: '.72rem', color: 'var(--muted)' }}>· {careerRuns} career run{careerRuns !== 1 ? 's' : ''}</span>
                </div>
              )
            })()}
            {user.motto && !editing && (
              <div style={{ fontSize: '.8rem', color: 'var(--muted)', fontStyle: 'italic', marginTop: '.4rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>"{user.motto}"</div>
            )}
          </div>
        </div>

        {/* ── Operative Info ── */}
        <div style={{ background: 'var(--surf2)', border: '1px solid var(--bdr)', borderRadius: 6, padding: '.75rem 1rem', marginBottom: '1.25rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '.65rem' }}>
            <div style={{ fontSize: '.7rem', fontFamily: 'var(--fd)', letterSpacing: '.1em', color: 'var(--acc2)', textTransform: 'uppercase' }}>Operative Info</div>
            {!editing && (
              <div style={{ display: 'flex', gap: '.5rem' }}>
                <button className="btn btn-s btn-sm" onClick={startEditing}>✎ Edit Social</button>
                <button className="btn btn-s btn-sm" onClick={onEditProfile}>⚙ Account</button>
              </div>
            )}
          </div>

          {!editing ? (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: '.3rem .85rem', fontSize: '.87rem' }}>
                <span style={lbl}>Name</span>
                <span style={val}>{user.name}</span>

                <span style={lbl}>Callsign</span>
                <span style={{ ...val, color: 'var(--accB)' }}>{user.leaderboardName || <span style={{ color: 'var(--muted)' }}>—</span>}</span>

                {user.profession && <>
                  <span style={lbl}>Profession</span>
                  <span style={val}>{user.profession}</span>
                </>}

                {(user.homeBaseCity || user.homeBaseState) && <>
                  <span style={lbl}>Home Base</span>
                  <span style={val}>{[user.homeBaseCity, user.homeBaseState].filter(Boolean).join(', ')}</span>
                </>}

                {operatorSince && <>
                  <span style={lbl}>Operative Since</span>
                  <span style={val}>{operatorSince}</span>
                </>}

                <span style={lbl}>Phone</span>
                <span style={val}>
                  {user.phone ? fmtPhone(user.phone) : '—'}
                  {user.phone && user.hidePhone && <span style={{ marginLeft: '.5rem', fontSize: '.72rem', color: 'var(--muted)', background: 'var(--surf3,var(--bdr))', borderRadius: 3, padding: '1px 5px' }}>private</span>}
                </span>

                <span style={lbl}>Email</span>
                <span style={{ ...val, wordBreak: 'break-all' }}>
                  {user.email || '—'}
                  {user.email && user.hideEmail && <span style={{ marginLeft: '.5rem', fontSize: '.72rem', color: 'var(--muted)', background: 'var(--surf3,var(--bdr))', borderRadius: 3, padding: '1px 5px' }}>private</span>}
                </span>
              </div>

              {user.bio && (
                <div style={{ marginTop: '.75rem', padding: '.55rem .65rem', background: 'var(--bg)', borderRadius: 4, fontSize: '.84rem', color: 'var(--txt)', lineHeight: 1.5, borderLeft: '2px solid var(--bdr)' }}>
                  {user.bio}
                </div>
              )}
            </>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '.65rem' }}>
              <p style={{ margin: 0, fontSize: '.75rem', color: 'var(--muted)' }}>
                Name and callsign are updated in <button className="btn-link" style={{ fontSize: '.75rem' }} onClick={() => { setEditing(false); onEditProfile() }}>Account Settings</button>.
              </p>

              <div>
                <label style={{ fontSize: '.75rem', color: 'var(--muted)', display: 'block', marginBottom: '.2rem' }}>Motto</label>
                <input className="inp" style={{ width: '100%', boxSizing: 'border-box' }} placeholder="Your personal motto…" value={editDraft.motto} maxLength={80} onChange={e => setEditDraft(d => ({ ...d, motto: e.target.value }))} />
              </div>

              <div>
                <label style={{ fontSize: '.75rem', color: 'var(--muted)', display: 'block', marginBottom: '.2rem' }}>Profession</label>
                <input className="inp" style={{ width: '100%', boxSizing: 'border-box' }} placeholder="e.g. Software Engineer" value={editDraft.profession} maxLength={60} onChange={e => setEditDraft(d => ({ ...d, profession: e.target.value }))} />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '.5rem' }}>
                <div>
                  <label style={{ fontSize: '.75rem', color: 'var(--muted)', display: 'block', marginBottom: '.2rem' }}>City</label>
                  <input className="inp" style={{ width: '100%', boxSizing: 'border-box' }} placeholder="Indianapolis" value={editDraft.homeBaseCity} maxLength={60} onChange={e => setEditDraft(d => ({ ...d, homeBaseCity: e.target.value }))} />
                </div>
                <div>
                  <label style={{ fontSize: '.75rem', color: 'var(--muted)', display: 'block', marginBottom: '.2rem' }}>State</label>
                  <input className="inp" style={{ width: 56, boxSizing: 'border-box' }} placeholder="IN" value={editDraft.homeBaseState} maxLength={4} onChange={e => setEditDraft(d => ({ ...d, homeBaseState: e.target.value }))} />
                </div>
              </div>

              <div>
                <label style={{ fontSize: '.75rem', color: 'var(--muted)', display: 'block', marginBottom: '.2rem' }}>
                  Bio <span style={{ float: 'right', color: editDraft.bio.length > MAX_BIO ? 'var(--danger,#e05)' : 'var(--muted)' }}>{editDraft.bio.length}/{MAX_BIO}</span>
                </label>
                <textarea className="inp" rows={3} style={{ width: '100%', boxSizing: 'border-box', resize: 'vertical' }} placeholder="Tell other operatives a little about yourself…" value={editDraft.bio} maxLength={MAX_BIO} onChange={e => setEditDraft(d => ({ ...d, bio: e.target.value.slice(0, MAX_BIO) }))} />
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '.35rem', paddingTop: '.15rem' }}>
                <div style={{ fontSize: '.72rem', fontFamily: 'var(--fd)', color: 'var(--acc2)', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: '.1rem' }}>Privacy</div>
                {[
                  ['hidePhone',  'Hide my phone number from other operatives'],
                  ['hideEmail',  'Hide my email address from other operatives'],
                  ['hideName',   'Hide my real name from other operatives'],
                  ['hideAvatar', 'Hide my profile picture from other operatives'],
                  ['hideBio',    'Hide my bio, motto, profession & home base from other operatives'],
                ].map(([field, label]) => (
                  <label key={field} style={{ display: 'flex', alignItems: 'center', gap: '.45rem', cursor: 'pointer', fontSize: '.85rem', color: 'var(--txt)' }}>
                    <input type="checkbox" checked={editDraft[field] ?? false} onChange={e => setEditDraft(d => ({ ...d, [field]: e.target.checked }))} />
                    {label}
                  </label>
                ))}
              </div>

              <div style={{ display: 'flex', gap: '.5rem', paddingTop: '.25rem' }}>
                <button className="btn btn-s" onClick={handleSaveSocial} disabled={editSaving} style={{ minWidth: 90 }}>
                  {editSaving ? 'Saving…' : '✓ Save'}
                </button>
                <button className="btn btn-s btn-sm" onClick={() => setEditing(false)} disabled={editSaving}>Cancel</button>
              </div>
            </div>
          )}
        </div>

        {/* Match Stats */}
        <div>
          <div style={{ fontSize: '.7rem', fontFamily: 'var(--fd)', letterSpacing: '.1em', color: 'var(--acc2)', textTransform: 'uppercase', marginBottom: '.65rem' }}>Match Stats</div>
          <div className="tabs" style={{ marginBottom: '1rem', borderBottom: '1px solid var(--bdr)' }}>
            <button className={`tab${profileStatsSub === 'coop'   ? ' on' : ''}`} onClick={() => setProfileStatsSub('coop')}>Co-op ({coopRuns.length})</button>
            <button className={`tab${profileStatsSub === 'versus' ? ' on' : ''}`} onClick={() => setProfileStatsSub('versus')}>Versus ({versRuns.length})</button>
          </div>
          {!activeStats && (
            <div className="empty" style={{ paddingTop: '1.25rem' }}>
              <div className="ei">{profileStatsSub === 'coop' ? '🤝' : '⚔'}</div>
              <p style={{ color: 'var(--muted)', fontSize: '.88rem' }}>No {profileStatsSub === 'coop' ? 'co-op' : 'versus'} runs yet.</p>
            </div>
          )}
          {activeStats && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: '.5rem', marginBottom: '.75rem' }}>
              <StatCard label="Sessions"   value={activeStats.sessions} />
              <StatCard label="Total Runs" value={activeStats.runs} />
              <StatCard label="Best Score" value={activeStats.best} />
              <StatCard label="Avg Score"  value={activeStats.avg.toFixed(1)} />
              <StatCard label="Obj Rate"   value={`${activeStats.objRate}%`} />
              <StatCard label="Avg Time"   value={fmtSec(activeStats.avgTime)} />
              {profileStatsSub === 'versus' && versRuns.length > 0 && <>
                <StatCard label="Wins"   value={versWins}
                  sub={versWins + versLosses > 0 ? `${Math.round(versWins / (versWins + versLosses) * 100)}% W/L` : undefined} />
                <StatCard label="Losses" value={versLosses} />
              </>}
            </div>
          )}
        </div>
      </>}

      {/* ════════════════════════════════════════════════════════
          FRIENDS TAB
      ════════════════════════════════════════════════════════ */}
      {tab === 'friends' && (
        <div>
          {friendLoading && <div style={{ color: 'var(--muted)', fontSize: '.85rem', marginBottom: '.75rem' }}>Loading…</div>}

          {/* Pending received requests */}
          {receivedRequests.length > 0 && (
            <div style={{ marginBottom: '1.5rem' }}>
              <div style={SECTION_HDR}>Pending Requests</div>
              {receivedRequests.map(req => {
                const sender = resolveUser(req.from_user_id)
                return (
                  <div key={req.from_user_id} style={{ display: 'flex', alignItems: 'center', gap: '.75rem', padding: '.55rem 0', borderBottom: '1px solid var(--bdr)' }}>
                    <MiniAvatar url={sender.avatarUrl} hidden={sender.hideAvatar} />
                    <span style={{ flex: 1, fontSize: '.9rem', color: 'var(--txt)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {sender.leaderboardName || sender.name || 'Operative'}
                    </span>
                    <button className="btn btn-s" onClick={() => handleAccept(req.from_user_id)} title="Accept" style={{ padding: '3px 10px', fontSize: '.8rem' }}>✓</button>
                    <button className="btn btn-s btn-sm" onClick={() => handleIgnore(req.from_user_id)} title="Ignore" style={{ padding: '3px 8px', fontSize: '.8rem' }}>✕</button>
                  </div>
                )
              })}
            </div>
          )}

          {/* Friends list */}
          <div>
            <div style={SECTION_HDR}>Your Squad</div>
            {!friendLoading && friendships.length === 0 && (
              <div className="empty">
                <div className="ei">👥</div>
                <p style={{ color: 'var(--muted)', fontSize: '.9rem' }}>No friends yet.</p>
                <p style={{ color: 'var(--muted)', fontSize: '.78rem', marginTop: '.35rem' }}>Head to the Connect tab to find operatives.</p>
              </div>
            )}
            {friendships.map(f => {
              const otherId = f.user_id_1 === user.id ? f.user_id_2 : f.user_id_1
              const friend = resolveUser(otherId)
              return (
                <div
                  key={otherId}
                  style={{ display: 'flex', alignItems: 'center', gap: '.75rem', padding: '.55rem 0', borderBottom: '1px solid var(--bdr)', cursor: 'pointer' }}
                  onClick={() => setProfileModal(otherId)}
                >
                  <MiniAvatar url={friend.avatarUrl} hidden={friend.hideAvatar} />
                  <span style={{ flex: 1, fontSize: '.9rem', color: 'var(--txt)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {friend.leaderboardName || friend.name || 'Operative'}
                  </span>
                  <span style={{ fontSize: '.72rem', color: 'var(--muted)' }}>View →</span>
                  <button
                    className="btn btn-s btn-sm"
                    title="Remove from squad"
                    onClick={e => { e.stopPropagation(); handleRemoveFriend(otherId) }}
                    style={{ fontSize: '.72rem', padding: '2px 7px', opacity: .55 }}
                  >✕</button>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════
          CONNECT TAB
      ════════════════════════════════════════════════════════ */}
      {tab === 'connect' && (
        <div>
          {/* Search */}
          <div style={{ marginBottom: '1rem' }}>
            <input
              className="inp"
              style={{ width: '100%', boxSizing: 'border-box' }}
              placeholder="🔍 Search by name or phone…"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              autoComplete="off"
            />
            {searching && <div style={{ fontSize: '.78rem', color: 'var(--muted)', marginTop: '.4rem' }}>Searching…</div>}
          </div>

          {/* Search results */}
          {searchResults.length > 0 && (
            <div style={{ marginBottom: '1.5rem' }}>
              {searchResults.map(p => {
                const isFriend  = friendIds.has(p.id)
                const isPending = sentRequests.some(r => r.to_user_id === p.id) ||
                                  receivedRequests.some(r => r.from_user_id === p.id)
                return (
                  <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: '.75rem', padding: '.55rem 0', borderBottom: '1px solid var(--bdr)' }}>
                    <MiniAvatar url={p.avatar_url} hidden={p.hide_avatar} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: '.9rem', color: 'var(--txt)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.leaderboard_name}</div>
                      {p.phone_last4 && <div style={{ fontSize: '.73rem', color: 'var(--muted)' }}>••••{p.phone_last4}</div>}
                    </div>
                    <TierChip runs={p.total_runs} />
                    {isFriend ? (
                      <span style={{ fontSize: '.75rem', color: 'var(--muted)', whiteSpace: 'nowrap' }}>Friends</span>
                    ) : isPending ? (
                      <span style={{ fontSize: '.75rem', color: 'var(--muted)', whiteSpace: 'nowrap' }}>Pending</span>
                    ) : (
                      <button className="btn btn-s" onClick={() => handleSendRequest(p.id)} style={{ fontSize: '.75rem', padding: '3px 10px', whiteSpace: 'nowrap' }}>Add</button>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          {/* Sent requests */}
          {sentRequests.length > 0 && (
            <div style={{ marginBottom: '1.5rem' }}>
              <div style={SECTION_HDR}>Sent Requests</div>
              {sentRequests.map(req => {
                const recipient = resolveUser(req.to_user_id)
                return (
                  <div key={req.to_user_id} style={{ display: 'flex', alignItems: 'center', gap: '.75rem', padding: '.55rem 0', borderBottom: '1px solid var(--bdr)' }}>
                    <MiniAvatar url={recipient.avatarUrl} hidden={recipient.hideAvatar} />
                    <span style={{ flex: 1, fontSize: '.9rem', color: 'var(--txt)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {recipient.leaderboardName || recipient.name || 'Operative'}
                    </span>
                    <button className="btn btn-s btn-sm" onClick={() => handleCancelRequest(req.to_user_id)} style={{ fontSize: '.75rem', padding: '3px 10px', whiteSpace: 'nowrap' }}>Cancel</button>
                  </div>
                )
              })}
            </div>
          )}

          {/* Recently met */}
          {recentlyMet.length > 0 && (
            <div>
              <div style={SECTION_HDR}>Recently Met</div>
              {recentlyMet.map(p => {
                const isFriend  = friendIds.has(p.id)
                const isPending = sentRequests.some(r => r.to_user_id === p.id) ||
                                  receivedRequests.some(r => r.from_user_id === p.id)
                return (
                  <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: '.75rem', padding: '.55rem 0', borderBottom: '1px solid var(--bdr)' }}>
                    <MiniAvatar url={p.avatar_url} hidden={p.hide_avatar} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: '.9rem', color: 'var(--txt)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.leaderboard_name}</div>
                      {p.phone_last4 && <div style={{ fontSize: '.73rem', color: 'var(--muted)' }}>••••{p.phone_last4}</div>}
                    </div>
                    <TierChip runs={p.total_runs} />
                    {isFriend ? (
                      <span style={{ fontSize: '.75rem', color: 'var(--muted)', whiteSpace: 'nowrap' }}>Friends</span>
                    ) : isPending ? (
                      <span style={{ fontSize: '.75rem', color: 'var(--muted)', whiteSpace: 'nowrap' }}>Pending</span>
                    ) : (
                      <button className="btn btn-s" onClick={() => handleSendRequest(p.id)} style={{ fontSize: '.75rem', padding: '3px 10px', whiteSpace: 'nowrap' }}>Add</button>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          {!friendLoading && sentRequests.length === 0 && recentlyMet.length === 0 && searchResults.length === 0 && !searching && (
            <div className="empty">
              <div className="ei">🔍</div>
              <p style={{ color: 'var(--muted)', fontSize: '.9rem' }}>Search for operatives by name or phone number.</p>
              <p style={{ color: 'var(--muted)', fontSize: '.78rem', marginTop: '.35rem' }}>Players you've shared a lane with will also appear here.</p>
            </div>
          )}
        </div>
      )}
    </>
  )
}
