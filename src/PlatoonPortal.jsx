// src/PlatoonPortal.jsx
// Platoon (guild/clan) tab for the Customer Portal.
// Rendered inside SocialPortal.jsx as the 4th "Platoon" tab.

import { useState, useEffect, useRef, useCallback } from 'react'
import {
  searchPlatoons, getPlatoonForUser, getPlatoonMembers, getPlatoonJoinRequests,
  getPlatoonPosts, getPlatoonSessions, getPlatoonUpcoming,
  createPlatoon, joinPlatoon, requestToJoin, cancelJoinRequest,
  approveJoinRequest, denyJoinRequest,
  goAwol, kickPlatoonMember, setPlatoonMemberRole, transferPlatoonAdmin,
  disbandPlatoon, postPlatoonMessage, deletePlatoonPost,
  updatePlatoonSettings, updatePlatoonBadge, uploadPlatoonBadge,
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
    <span style={{ display: 'inline-block', color: '#94a3b8', fontSize: '.78em', fontFamily: 'var(--fd)', letterSpacing: '.03em', ...style }}>
      [{tag}]
    </span>
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

export default function PlatoonPortal({ user }) {
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
    return <PlatoonFinder userId={user.id} onJoined={refresh} />
  }

  return <PlatoonHome platoon={platoon} myRole={myRole} userId={user.id}
    pendingCount={pendingCount} onLeft={refresh} onChanged={refresh} />
}

// Export pendingCount for use in SocialPortal tab indicator
// (resolved via ref pattern — PlatoonPortal.getPendingCount is not used;
// instead SocialPortal polls state via onPendingChange prop)
export function PlatoonTabDot({ platoon, myRole }) {
  // Rendered by SocialPortal when it has platoon data
  return null
}


// ── PlatoonFinder ─────────────────────────────────────────────────────────────

function PlatoonFinder({ userId, onJoined }) {
  const [query,   setQuery]   = useState('')
  const [results, setResults] = useState(null)
  const [searching, setSearching] = useState(false)
  const [detail,  setDetail]  = useState(null)   // platoon to preview
  const [showCreate, setShowCreate] = useState(false)
  const debounce = useRef(null)

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

  return (
    <div>
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
            ? <img src={p.badge_url} style={{ width: 40, height: 40, borderRadius: 6, objectFit: 'cover', flexShrink: 0 }} alt="" />
            : <div style={{ width: 40, height: 40, borderRadius: 6, background: 'var(--surf)', border: '1px solid var(--bdr)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.2rem', flexShrink: 0 }}>🎖️</div>}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem' }}>
              <TagChip tag={p.tag} />
              <span style={{ fontFamily: 'var(--fd)', color: 'var(--txt)', fontSize: '.95rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
            </div>
            {p.description && <div style={{ fontSize: '.78rem', color: 'var(--muted)', marginTop: '.15rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.description}</div>}
          </div>
          <div style={{ textAlign: 'right', flexShrink: 0 }}>
            <div style={{ fontSize: '.75rem', color: 'var(--muted)' }}>{p.member_count} {p.member_count === 1 ? 'member' : 'members'}</div>
            <div style={{ fontSize: '.65rem', marginTop: '.2rem', color: p.is_open ? '#4ade80' : '#f97316' }}>{p.is_open ? 'Open' : 'Approval req.'}</div>
          </div>
        </div>
      ))}

      {detail && (
        <PlatoonDetailModal
          platoon={detail}
          onClose={() => setDetail(null)}
          onJoined={onJoined}
        />
      )}

      {showCreate && (
        <PlatoonCreateModal
          onClose={() => setShowCreate(false)}
          onCreated={onJoined}
        />
      )}
    </div>
  )
}


// ── PlatoonDetailModal ────────────────────────────────────────────────────────

function PlatoonDetailModal({ platoon, onClose, onJoined }) {
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
            ? <img src={platoon.badge_url} style={{ width: 56, height: 56, borderRadius: 8, objectFit: 'cover', flexShrink: 0 }} alt="" />
            : <div style={{ width: 56, height: 56, borderRadius: 8, background: 'var(--surf2)', border: '1px solid var(--bdr)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.6rem' }}>🎖️</div>}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem' }}>
              <TagChip tag={platoon.tag} />
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

function PlatoonCreateModal({ onClose, onCreated }) {
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
    const cleanTag  = tag.trim().toUpperCase()
    const cleanName = name.trim()
    if (!cleanTag || !cleanName) return setErr('Tag and name are required.')
    if (!/^[A-Z0-9]{2,5}$/.test(cleanTag)) return setErr('Tag must be 2–5 letters or numbers.')

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

        <div style={SECTION_HDR}>Tag (2–5 chars)</div>
        <input
          className="inp"
          style={{ width: '100%', boxSizing: 'border-box', fontFamily: 'var(--fd)', textTransform: 'uppercase', letterSpacing: '.05em' }}
          maxLength={5}
          placeholder="S317"
          value={tag}
          onChange={e => setTag(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
        />
        {tag.length >= 2 && <div style={{ fontSize: '.75rem', color: '#94a3b8', marginTop: '.25rem' }}>Preview: <strong>[{tag}]</strong></div>}

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

function PlatoonHome({ platoon, myRole, userId, pendingCount, onLeft, onChanged }) {
  const [subTab,         setSubTab]         = useState('board')
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
      <div style={{ display: 'flex', alignItems: 'center', gap: '.85rem', marginBottom: '1rem', padding: '.75rem', background: 'var(--surf2)', border: '1px solid var(--bdr)', borderRadius: 8 }}>
        {platoon.badge_url
          ? <img src={platoon.badge_url} style={{ width: 48, height: 48, borderRadius: 8, objectFit: 'cover', flexShrink: 0 }} alt="" />
          : <div style={{ width: 48, height: 48, borderRadius: 8, background: 'var(--surf)', border: '1px solid var(--bdr)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.4rem', flexShrink: 0 }}>🎖️</div>}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem', flexWrap: 'wrap' }}>
            <TagChip tag={platoon.tag} style={{ fontSize: '.9em' }} />
            <span style={{ fontFamily: 'var(--fd)', color: 'var(--txt)', fontSize: '1rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{platoon.name}</span>
            <RoleChip role={myRole} />
          </div>
          <div style={{ fontSize: '.75rem', color: 'var(--muted)', marginTop: '.15rem' }}>
            {platoon.member_count} {platoon.member_count === 1 ? 'member' : 'members'} · {platoon.is_open ? 'Open' : 'Approval required'}
          </div>
        </div>
        <button
          style={{ background: 'transparent', border: '1px solid #7f1d1d', color: '#f87171', borderRadius: 6, padding: '.35rem .65rem', fontSize: '.75rem', cursor: 'pointer', flexShrink: 0, fontFamily: 'var(--fd)' }}
          onClick={() => setShowAwolConfirm(true)}
        >Go AWOL</button>
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

      {subTab === 'board'    && <BoardTab    platoon={platoon} userId={userId} />}
      {subTab === 'members'  && <MembersTab  platoon={platoon} myRole={myRole} userId={userId} onChanged={onChanged} />}
      {subTab === 'sessions' && <SessionsTab platoon={platoon} />}
      {subTab === 'upcoming' && <UpcomingTab platoon={platoon} />}
      {subTab === 'settings' && myRole === 'admin' && <SettingsTab platoon={platoon} onChanged={onChanged} onDisbanded={onLeft} />}

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

function BoardTab({ platoon, userId }) {
  const [posts,   setPosts]   = useState([])
  const [loading, setLoading] = useState(true)
  const [offset,  setOffset]  = useState(0)
  const [hasMore, setHasMore] = useState(true)
  const [content, setContent] = useState('')
  const [posting, setPosting] = useState(false)
  const LIMIT = 20

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
        <PostRow key={post.id} post={post} platoonTag={platoon.tag} userId={userId} onDelete={doDelete} />
      ))}

      {hasMore && !loading && (
        <button className="btn btn-s" style={{ width: '100%', marginTop: '.75rem' }} onClick={() => load(offset)}>
          Load older posts
        </button>
      )}
    </div>
  )
}

function PostRow({ post, platoonTag, userId, onDelete }) {
  const initials = post.leaderboard_name ? post.leaderboard_name.slice(0, 2).toUpperCase() : '?'
  const isOwn = post.user_id === userId

  return (
    <div style={{ display: 'flex', gap: '.75rem', padding: '.65rem 0', borderBottom: '1px solid var(--bdr)' }}>
      <Avatar url={post.avatar_url} hidden={post.hide_avatar} name={post.leaderboard_name} size={34} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '.4rem', flexWrap: 'wrap', marginBottom: '.2rem' }}>
          <TagChip tag={platoonTag} />
          <span style={{ fontFamily: 'var(--fd)', fontSize: '.85rem', color: 'var(--txt)' }}>{post.leaderboard_name}</span>
          <span style={{ fontSize: '.7rem', color: 'var(--muted)', marginLeft: 'auto' }}>{formatDate(post.created_at)}</span>
          {isOwn && (
            <button onClick={() => onDelete(post.id)} style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', padding: '0 .2rem', fontSize: '.8rem' }} title="Delete">×</button>
          )}
        </div>
        <div style={{ fontSize: '.85rem', color: 'var(--txt)', lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{post.content}</div>
      </div>
    </div>
  )
}


// ── MembersTab ────────────────────────────────────────────────────────────────

function MembersTab({ platoon, myRole, userId, onChanged }) {
  const [members,   setMembers]   = useState([])
  const [requests,  setRequests]  = useState([])
  const [loading,   setLoading]   = useState(true)
  const [menuOpen,  setMenuOpen]  = useState(null) // userId of open kebab
  const [confirm,   setConfirm]   = useState(null) // { action, target }
  const canManage = myRole === 'admin' || myRole === 'sergeant'

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const [mRows, rRows] = await Promise.all([
        getPlatoonMembers(platoon.id),
        canManage ? getPlatoonJoinRequests() : Promise.resolve([]),
      ])
      setMembers(Array.isArray(mRows) ? mRows : [])
      setRequests(Array.isArray(rRows) ? rRows : [])
    } catch { /* ignore */ }
    setLoading(false)
  }, [platoon.id, canManage])

  useEffect(() => { refresh() }, [refresh])

  const doAction = async (action, targetUserId, extra) => {
    setMenuOpen(null)
    try {
      if (action === 'kick')         await kickPlatoonMember(targetUserId)
      if (action === 'promote')      await setPlatoonMemberRole(targetUserId, 'sergeant')
      if (action === 'demote')       await setPlatoonMemberRole(targetUserId, 'member')
      if (action === 'transfer')     await transferPlatoonAdmin(targetUserId)
      if (action === 'approve-req')  await approveJoinRequest(extra)
      if (action === 'deny-req')     await denyJoinRequest(extra)
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
            <div key={req.id} style={{ display: 'flex', alignItems: 'center', gap: '.75rem', padding: '.6rem', background: 'var(--surf2)', border: '1px solid var(--bdr)', borderRadius: 8, marginBottom: '.4rem' }}>
              <Avatar url={req.avatar_url} name={req.leaderboard_name} size={32} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: 'var(--fd)', fontSize: '.88rem', color: 'var(--txt)' }}>{req.leaderboard_name}</div>
                {req.real_name && <div style={{ fontSize: '.72rem', color: 'var(--muted)' }}>{req.real_name}</div>}
                {req.message && <div style={{ fontSize: '.78rem', color: 'var(--muted)', fontStyle: 'italic', marginTop: '.15rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>"{req.message}"</div>}
              </div>
              <div style={{ display: 'flex', gap: '.4rem', flexShrink: 0 }}>
                <button className="btn btn-p btn-sm" style={{ fontSize: '.72rem', padding: '.25rem .6rem' }} onClick={() => doAction('approve-req', req.user_id, req.id)}>✓ Approve</button>
                <button className="btn btn-s btn-sm" style={{ fontSize: '.72rem', padding: '.25rem .6rem', color: '#f87171', borderColor: '#7f1d1d' }} onClick={() => doAction('deny-req', req.user_id, req.id)}>✕ Deny</button>
              </div>
            </div>
          ))}
        </>
      )}

      {/* Member list */}
      <div style={requests.length > 0 ? SECTION_HDR : { ...SECTION_HDR, marginTop: 0 }}>
        Members ({members.length})
      </div>
      {members.map(m => {
        const isSelf  = m.user_id === userId
        const canAct  = canManage && !isSelf
        const isAdmin = myRole === 'admin'
        const isSgt   = myRole === 'sergeant'

        return (
          <div key={m.user_id} style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: '.75rem', padding: '.6rem 0', borderBottom: '1px solid var(--bdr)' }}>
            <Avatar url={m.avatar_url} hidden={m.hide_avatar} name={m.leaderboard_name} size={36} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '.4rem', flexWrap: 'wrap' }}>
                <span style={{ fontFamily: 'var(--fd)', fontSize: '.9rem', color: 'var(--txt)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.leaderboard_name}</span>
                <RoleChip role={m.role} />
              </div>
              <div style={{ fontSize: '.7rem', color: 'var(--muted)' }}>Joined {formatDate(m.joined_at)}</div>
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

function SessionsTab({ platoon }) {
  const [sessions, setSessions] = useState([])
  const [loading,  setLoading]  = useState(true)

  useEffect(() => {
    getPlatoonSessions(platoon.id)
      .then(rows => setSessions(Array.isArray(rows) ? rows : []))
      .catch(() => setSessions([]))
      .finally(() => setLoading(false))
  }, [platoon.id])

  if (loading) return <div style={{ color: 'var(--muted)', fontSize: '.85rem', textAlign: 'center', paddingTop: '1rem' }}>Loading…</div>
  if (sessions.length === 0) return <div style={{ color: 'var(--muted)', fontSize: '.85rem', textAlign: 'center', paddingTop: '1.5rem' }}>No completed sessions yet.</div>

  return (
    <div>
      {sessions.map(s => (
        <SessionCard key={s.reservation_id} session={s} />
      ))}
    </div>
  )
}

function UpcomingTab({ platoon }) {
  const [sessions, setSessions] = useState([])
  const [loading,  setLoading]  = useState(true)

  useEffect(() => {
    getPlatoonUpcoming(platoon.id)
      .then(rows => setSessions(Array.isArray(rows) ? rows : []))
      .catch(() => setSessions([]))
      .finally(() => setLoading(false))
  }, [platoon.id])

  if (loading) return <div style={{ color: 'var(--muted)', fontSize: '.85rem', textAlign: 'center', paddingTop: '1rem' }}>Loading…</div>
  if (sessions.length === 0) return <div style={{ color: 'var(--muted)', fontSize: '.85rem', textAlign: 'center', paddingTop: '1.5rem' }}>No upcoming sessions.</div>

  return (
    <div>
      {sessions.map(s => (
        <SessionCard key={s.reservation_id} session={s} upcoming />
      ))}
    </div>
  )
}

function SessionCard({ session, upcoming }) {
  const members = Array.isArray(session.member_players) ? session.member_players : []
  const dateStr = session.date ? new Date(session.date + 'T00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) : ''

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '.85rem', padding: '.75rem', background: 'var(--surf2)', border: '1px solid var(--bdr)', borderRadius: 8, marginBottom: '.5rem' }}>
      <div style={{ textAlign: 'center', minWidth: 52, flexShrink: 0 }}>
        <div style={{ fontFamily: 'var(--fd)', fontSize: '.9rem', color: upcoming ? 'var(--acc)' : 'var(--txt)', lineHeight: 1.2 }}>{dateStr}</div>
        {session.start_time && <div style={{ fontSize: '.72rem', color: 'var(--muted)', marginTop: '.15rem' }}>{session.start_time}</div>}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: '.85rem', color: 'var(--txt)', fontFamily: 'var(--fd)' }}>{session.type_name}</div>
        <div style={{ display: 'flex', gap: '.2rem', marginTop: '.35rem', flexWrap: 'wrap' }}>
          {members.slice(0, 8).map(m => (
            <Avatar key={m.user_id} url={m.avatar_url} name={m.leaderboard_name} size={26} />
          ))}
          {members.length > 8 && <div style={{ width: 26, height: 26, borderRadius: '50%', background: 'var(--surf)', border: '1px solid var(--bdr)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '.65rem', color: 'var(--muted)' }}>+{members.length - 8}</div>}
        </div>
      </div>
    </div>
  )
}


// ── SettingsTab ───────────────────────────────────────────────────────────────

function SettingsTab({ platoon, onChanged, onDisbanded }) {
  const [name,       setName]       = useState(platoon.name)
  const [desc,       setDesc]       = useState(platoon.description || '')
  const [isOpen,     setIsOpen]     = useState(platoon.is_open)
  const [badgeFile,  setBadgeFile]  = useState(null)
  const [badgePreview, setBadgePreview] = useState(platoon.badge_url || null)
  const [saving,     setSaving]     = useState(false)
  const [err,        setErr]        = useState('')
  const [saved,      setSaved]      = useState(false)
  const [showDisband, setShowDisband] = useState(false)
  const [disbanding, setDisbanding] = useState(false)

  const handleBadge = (e) => {
    const f = e.target.files[0]
    if (!f) return
    setBadgeFile(f)
    const reader = new FileReader()
    reader.onload = ev => setBadgePreview(ev.target.result)
    reader.readAsDataURL(f)
  }

  const doSave = async () => {
    if (!name.trim()) return setErr('Name is required.')
    setSaving(true); setErr(''); setSaved(false)
    try {
      await updatePlatoonSettings(name.trim(), desc.trim() || null, isOpen)
      if (badgeFile) {
        const url = await uploadPlatoonBadge(platoon.id, badgeFile)
        await updatePlatoonBadge(url)
        setBadgeFile(null)
      }
      setSaved(true)
      onChanged()
    } catch (e) {
      if (e.message?.includes('unique')) setErr('That name is already taken.')
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
          <div style={{ width: 72, height: 72, borderRadius: 10, background: 'var(--surf2)', border: '2px dashed var(--bdr)', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {badgePreview
              ? <img src={badgePreview} style={{ width: '100%', height: '100%', objectFit: 'cover' }} alt="" />
              : <span style={{ fontSize: '2rem' }}>🎖️</span>}
          </div>
          <input type="file" accept="image/*" style={{ display: 'none' }} onChange={handleBadge} />
        </label>
        <div style={{ fontSize: '.78rem', color: 'var(--muted)' }}>Click to change logo</div>
      </div>

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
