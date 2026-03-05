// src/SocialPortal.jsx
// Social tab for the Customer Portal — Profile, Friends, Requests.
// Displayed inside CustomerPortal in App.jsx.

import { useState } from 'react'
import { uploadAvatar, updateOwnAvatar, updateSocialProfile } from './supabase.js'

// ── Tier data (mirrors App.jsx) ─────────────────────────────────────────────
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

// ── Stat card ─────────────────────────────────────────────────────────────────
function StatCard({ label, value, sub }) {
  return (
    <div style={{ background: 'var(--surf2)', border: '1px solid var(--bdr)', borderRadius: 6, padding: '.65rem .85rem', textAlign: 'center' }}>
      <div style={{ fontFamily: 'var(--fd)', fontSize: '1.35rem', color: 'var(--accB)' }}>{value}</div>
      <div style={{ fontSize: '.7rem', color: 'var(--muted)', marginTop: '.1rem', textTransform: 'uppercase', letterSpacing: '.05em' }}>{label}</div>
      {sub && <div style={{ fontSize: '.65rem', color: 'var(--muted)', opacity: .75, marginTop: '.1rem' }}>{sub}</div>}
    </div>
  )
}

const MAX_BIO = 150

// ── Main export ──────────────────────────────────────────────────────────────
export default function SocialPortal({ user, users, setUsers, reservations, resTypes, runs, careerRuns, onEditProfile }) {
  const [tab, setTab]                         = useState('profile')
  const [profileStatsSub, setProfileStatsSub] = useState('coop')
  const [avatarUploading, setAvatarUploading] = useState(false)
  const [avatarKey, setAvatarKey]             = useState(() => Date.now())
  const [editing, setEditing]                 = useState(false)
  const [editDraft, setEditDraft]             = useState({})
  const [editSaving, setEditSaving]           = useState(false)

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

  // Versus win/loss (per run, using team assignment)
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

  // Operator since — date of earliest mission
  const operatorSince = myRes.length
    ? fmtMonthYear(myRes.reduce((min, r) => r.date < min ? r.date : min, myRes[0].date))
    : null

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
      motto:        user.motto        || '',
      profession:   user.profession   || '',
      homeBaseCity: user.homeBaseCity || '',
      homeBaseState: user.homeBaseState || '',
      bio:          user.bio          || '',
      hidePhone:    user.hidePhone    ?? false,
      hideEmail:    user.hideEmail    ?? false,
    })
    setEditing(true)
  }

  async function handleSaveSocial() {
    setEditSaving(true)
    try {
      const updated = await updateSocialProfile(user.id, {
        motto:        editDraft.motto.trim()        || null,
        profession:   editDraft.profession.trim()   || null,
        homeBaseCity: editDraft.homeBaseCity.trim() || null,
        homeBaseState: editDraft.homeBaseState.trim() || null,
        bio:          editDraft.bio.trim().slice(0, MAX_BIO) || null,
        hidePhone:    editDraft.hidePhone,
        hideEmail:    editDraft.hideEmail,
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

  // ── Shared label style ───────────────────────────────────────────────────
  const lbl = { color: 'var(--muted)', fontSize: '.87rem' }
  const val = { color: 'var(--txt)',   fontSize: '.87rem' }

  return (
    <>
      {/* ── Sub-tabs ── */}
      <div className="tabs" style={{ marginBottom: '1rem', borderBottom: '1px solid var(--bdr)' }}>
        <button className={`tab${tab === 'profile'  ? ' on' : ''}`} onClick={() => setTab('profile')}>Profile</button>
        <button className={`tab${tab === 'friends'  ? ' on' : ''}`} onClick={() => setTab('friends')}>Friends</button>
        <button className={`tab${tab === 'requests' ? ' on' : ''}`} onClick={() => setTab('requests')}>Requests</button>
      </div>

      {/* ── PROFILE ── */}
      {tab === 'profile' && <>
        {/* Avatar + Identity */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '1.25rem', marginBottom: '1.5rem' }}>
          {/* Avatar circle */}
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

          {/* Name + tier */}
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
            /* ── Display mode ── */
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
                  <span style={val}>
                    {[user.homeBaseCity, user.homeBaseState].filter(Boolean).join(', ')}
                  </span>
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
            /* ── Edit mode ── */
            <div style={{ display: 'flex', flexDirection: 'column', gap: '.65rem' }}>
              <p style={{ margin: 0, fontSize: '.75rem', color: 'var(--muted)' }}>
                Name and callsign are updated in <button className="btn-link" style={{ fontSize: '.75rem' }} onClick={() => { setEditing(false); onEditProfile() }}>Account Settings</button>.
              </p>

              <div>
                <label style={{ fontSize: '.75rem', color: 'var(--muted)', display: 'block', marginBottom: '.2rem' }}>Motto</label>
                <input
                  className="inp"
                  style={{ width: '100%', boxSizing: 'border-box' }}
                  placeholder="Your personal motto…"
                  value={editDraft.motto}
                  maxLength={80}
                  onChange={e => setEditDraft(d => ({ ...d, motto: e.target.value }))}
                />
              </div>

              <div>
                <label style={{ fontSize: '.75rem', color: 'var(--muted)', display: 'block', marginBottom: '.2rem' }}>Profession</label>
                <input
                  className="inp"
                  style={{ width: '100%', boxSizing: 'border-box' }}
                  placeholder="e.g. Software Engineer"
                  value={editDraft.profession}
                  maxLength={60}
                  onChange={e => setEditDraft(d => ({ ...d, profession: e.target.value }))}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '.5rem' }}>
                <div>
                  <label style={{ fontSize: '.75rem', color: 'var(--muted)', display: 'block', marginBottom: '.2rem' }}>City</label>
                  <input
                    className="inp"
                    style={{ width: '100%', boxSizing: 'border-box' }}
                    placeholder="Indianapolis"
                    value={editDraft.homeBaseCity}
                    maxLength={60}
                    onChange={e => setEditDraft(d => ({ ...d, homeBaseCity: e.target.value }))}
                  />
                </div>
                <div>
                  <label style={{ fontSize: '.75rem', color: 'var(--muted)', display: 'block', marginBottom: '.2rem' }}>State</label>
                  <input
                    className="inp"
                    style={{ width: 56, boxSizing: 'border-box' }}
                    placeholder="IN"
                    value={editDraft.homeBaseState}
                    maxLength={4}
                    onChange={e => setEditDraft(d => ({ ...d, homeBaseState: e.target.value }))}
                  />
                </div>
              </div>

              <div>
                <label style={{ fontSize: '.75rem', color: 'var(--muted)', display: 'block', marginBottom: '.2rem' }}>
                  Bio <span style={{ float: 'right', color: editDraft.bio.length > MAX_BIO ? 'var(--danger,#e05)' : 'var(--muted)' }}>{editDraft.bio.length}/{MAX_BIO}</span>
                </label>
                <textarea
                  className="inp"
                  rows={3}
                  style={{ width: '100%', boxSizing: 'border-box', resize: 'vertical' }}
                  placeholder="Tell other operatives a little about yourself…"
                  value={editDraft.bio}
                  maxLength={MAX_BIO}
                  onChange={e => setEditDraft(d => ({ ...d, bio: e.target.value.slice(0, MAX_BIO) }))}
                />
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '.35rem', paddingTop: '.15rem' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '.45rem', cursor: 'pointer', fontSize: '.85rem', color: 'var(--txt)' }}>
                  <input type="checkbox" checked={editDraft.hidePhone} onChange={e => setEditDraft(d => ({ ...d, hidePhone: e.target.checked }))} />
                  Hide my phone number from other operatives
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: '.45rem', cursor: 'pointer', fontSize: '.85rem', color: 'var(--txt)' }}>
                  <input type="checkbox" checked={editDraft.hideEmail} onChange={e => setEditDraft(d => ({ ...d, hideEmail: e.target.checked }))} />
                  Hide my email address from other operatives
                </label>
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
              <StatCard label="Sessions"  value={activeStats.sessions} />
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

      {/* ── FRIENDS ── */}
      {tab === 'friends' && (
        <div className="empty">
          <div className="ei">👥</div>
          <p style={{ color: 'var(--muted)', fontSize: '.9rem' }}>Friends coming soon.</p>
          <p style={{ color: 'var(--muted)', fontSize: '.78rem', marginTop: '.35rem' }}>Connect with other operatives, track friends' scores, and challenge your squad.</p>
        </div>
      )}

      {/* ── REQUESTS ── */}
      {tab === 'requests' && (
        <div className="empty">
          <div className="ei">📨</div>
          <p style={{ color: 'var(--muted)', fontSize: '.9rem' }}>Friend requests coming soon.</p>
        </div>
      )}
    </>
  )
}
