import { useState, useEffect, useRef, useCallback } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import {
  supabase,
  fetchKioskReservations, fetchResTypes, fetchWaiverDocs,
  fetchUserByPhone, createGuestUser,
  addPlayerToReservation, removePlayerFromReservation,
  kioskSignWaiver, fetchPlayerWaiverStatus,
} from './supabase.js'

const KIOSK_QR_URL = 'https://www.sector317.com/?login=1'

function AccountQR() {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '.6rem',
      background: 'var(--surf)', border: '1px solid var(--bdr)', borderRadius: 10,
      padding: '1.2rem 1.5rem', marginTop: '1rem',
    }}>
      <div style={{ fontSize: '.75rem', fontFamily: 'var(--fd)', letterSpacing: '.1em', color: 'var(--acc)', textTransform: 'uppercase', marginBottom: '.2rem' }}>
        Create or Finish Setting Up Your Account
      </div>
      <QRCodeSVG
        value={KIOSK_QR_URL}
        size={130}
        fgColor="#c8e03a"
        bgColor="#2e2f27"
        level="M"
        style={{ borderRadius: 6 }}
      />
      <div style={{ fontSize: '.78rem', color: 'var(--muted)', textAlign: 'center', maxWidth: 220 }}>
        Scan with your phone to sign in or create an account at Sector 317
      </div>
    </div>
  )
}

// ── Helpers ──────────────────────────────────────────────────
const cleanPh = v => (v || '').replace(/\D/g, '')
const fmtPh = raw => {
  const d = cleanPh(raw)
  if (d.length <= 3) return d
  if (d.length <= 6) return `(${d.slice(0,3)}) ${d.slice(3)}`
  return `(${d.slice(0,3)}) ${d.slice(3,6)}-${d.slice(6,10)}`
}
const fmtDate = iso => {
  if (!iso) return ''
  const d = new Date(iso + 'T12:00:00')
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
}
const fmtTime = t => {
  if (!t) return ''
  const [h, m] = t.split(':').map(Number)
  const ampm = h >= 12 ? 'PM' : 'AM'
  return `${h % 12 || 12}:${String(m).padStart(2,'0')} ${ampm}`
}
function hasValidWaiver(user, activeWaiverDoc) {
  if (!user || !user.waivers || !user.waivers.length) return false
  if (activeWaiverDoc && user.needsRewaiverDocId === activeWaiverDoc.id) return false
  const latest = user.waivers.reduce((a, b) => a.signedAt > b.signedAt ? a : b)
  if (activeWaiverDoc && latest.waiverDocId !== activeWaiverDoc.id) return false
  return Date.now() - new Date(latest.signedAt).getTime() < 365 * 864e5
}

// ── NumPad ───────────────────────────────────────────────────
function NumPad({ value, onChange, mode = 'phone', maxLen }) {
  const max = maxLen ?? (mode === 'pin' ? 6 : 10)
  const tap = d => { if (value.length < max) onChange(value + d) }
  const back = () => onChange(value.slice(0, -1))
  const display = mode === 'pin'
    ? '●'.repeat(value.length).padEnd(6, '○')
    : fmtPh(value)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem', width: '100%', maxWidth: 380 }}>
      <div style={{
        fontSize: mode === 'pin' ? '2.2rem' : '1.6rem', fontWeight: 700,
        letterSpacing: mode === 'pin' ? '.5rem' : '.05rem',
        color: 'var(--txt)', minHeight: 48, display: 'flex', alignItems: 'center',
        justifyContent: 'center', width: '100%',
        borderBottom: '2px solid var(--acc)', paddingBottom: '.4rem',
      }}>
        {display || <span style={{ color: 'var(--muted)' }}>{mode === 'pin' ? '○○○○' : '(___) ___-____'}</span>}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: '.6rem', width: '100%' }}>
        {[1,2,3,4,5,6,7,8,9,'',0,'⌫'].map((d, i) => {
          if (d === '') return <div key={i} />
          return (
            <button key={i} onClick={() => d === '⌫' ? back() : tap(String(d))}
              style={{
                padding: '1.1rem 0', fontSize: d === '⌫' ? '1.3rem' : '1.6rem',
                fontWeight: 700, borderRadius: 10, cursor: 'pointer',
                background: d === '⌫' ? 'var(--surf)' : 'var(--surf2)',
                color: 'var(--txt)', border: '1px solid var(--bdr)',
                minHeight: 70, touchAction: 'manipulation',
              }}>
              {d}
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ── WaiverStatus badge ────────────────────────────────────────
function WaiverBadge({ valid }) {
  return valid
    ? <span style={{ fontSize: '.8rem', padding: '.2rem .6rem', borderRadius: 4, background: 'rgba(90,138,58,.2)', color: '#8acc5a', border: '1px solid rgba(90,138,58,.3)', fontWeight: 600 }}>✓ Waiver Signed</span>
    : <span style={{ fontSize: '.8rem', padding: '.2rem .6rem', borderRadius: 4, background: 'rgba(192,57,43,.15)', color: '#e07060', border: '1px solid rgba(192,57,43,.3)', fontWeight: 600 }}>⚠ Waiver Needed</span>
}

// ── Main KioskPage ────────────────────────────────────────────
export default function KioskPage() {
  const [phase, setPhase] = useState('boot')
  const [bootError, setBootError] = useState(null)
  const [phone, setPhone] = useState('')
  const [reservations, setReservations] = useState([])
  const [resTypes, setResTypes] = useState([])
  const [waiverDoc, setWaiverDoc] = useState(null)
  const [selectedRes, setSelectedRes] = useState(null)
  const [playerWaivers, setPlayerWaivers] = useState({})   // userId -> {waivers, needsRewaiverDocId}
  const [addPhone, setAddPhone] = useState('')
  const [addFound, setAddFound] = useState(null)           // found user object | false | null(idle)
  const [addName, setAddName] = useState('')
  const [addSearching, setAddSearching] = useState(false)
  const [addError, setAddError] = useState(null)
  const [addAdding, setAddAdding] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState(null) // player obj
  const [signingPlayer, setSigningPlayer] = useState(null) // {id, userId, name}
  const [waiverScrolled, setWaiverScrolled] = useState(false)
  const [signedName, setSignedName] = useState('')
  const [signedAgreed, setSignedAgreed] = useState(false)
  const [signing, setSigning] = useState(false)
  const [showExitPin, setShowExitPin] = useState(false)
  const [exitPin, setExitPin] = useState('')
  const [exitShake, setExitShake] = useState(false)
  const [inactivityWarn, setInactivityWarn] = useState(false)
  const [warnSecs, setWarnSecs] = useState(10)
  const [isFullscreen, setIsFullscreen] = useState(!!document.fullscreenElement)
  const [kioskUserId, setKioskUserId] = useState(null)
  const [busyMsg, setBusyMsg] = useState(null)

  // ── Refs ──
  const exitTaps = useRef([])
  const exitTimer = useRef(null)
  const inactivityRef = useRef(null)
  const warnRef = useRef(null)
  const warnIntervalRef = useRef(null)
  const waiverBodyRef = useRef(null)
  const phaseRef = useRef(phase)
  useEffect(() => { phaseRef.current = phase }, [phase])

  // ── Boot: sign in as kiosk ──
  useEffect(() => {
    async function boot() {
      try {
        const resp = await fetch('/api/kiosk-auth', { method: 'POST' })
        const json = await resp.json()
        if (!resp.ok || json.error) { setBootError(json.error || 'Kiosk auth failed.'); return }
        const { error: sessErr } = await supabase.auth.setSession({
          access_token: json.session.access_token,
          refresh_token: json.session.refresh_token,
        })
        if (sessErr) { setBootError(sessErr.message); return }
        setKioskUserId(json.session.user?.id ?? null)
      } catch (e) {
        setBootError('Could not reach authentication server. ' + e.message)
        return
      }
      // preload res types + waiver doc
      try {
        const [types, docs] = await Promise.all([fetchResTypes(), fetchWaiverDocs()])
        setResTypes(types)
        setWaiverDoc(docs.find(d => d.active) ?? null)
      } catch (_) {}
      setPhase('idle')
    }
    boot()
  }, [])

  // ── Inactivity reset ──
  const resetAll = useCallback(() => {
    setPhase('idle')
    setPhone(''); setReservations([]); setSelectedRes(null)
    setPlayerWaivers({}); setAddPhone(''); setAddFound(null)
    setAddName(''); setAddError(null); setConfirmRemove(null)
    setSigningPlayer(null); setWaiverScrolled(false)
    setSignedName(''); setSignedAgreed(false); setSigning(false)
    setInactivityWarn(false); setWarnSecs(10)
    clearInterval(warnIntervalRef.current)
    clearTimeout(warnRef.current)
  }, [])

  const resetInactivity = useCallback(() => {
    clearTimeout(inactivityRef.current)
    clearTimeout(warnRef.current)
    clearInterval(warnIntervalRef.current)
    setInactivityWarn(false)
    setWarnSecs(10)
    inactivityRef.current = setTimeout(() => {
      // show 10s warning
      setInactivityWarn(true)
      setWarnSecs(10)
      let s = 10
      warnIntervalRef.current = setInterval(() => {
        s -= 1
        setWarnSecs(s)
        if (s <= 0) {
          clearInterval(warnIntervalRef.current)
          resetAll()
        }
      }, 1000)
    }, 80000)
  }, [resetAll])

  useEffect(() => {
    const onPointer = () => {
      if (phaseRef.current !== 'idle' && phaseRef.current !== 'boot') resetInactivity()
    }
    document.addEventListener('pointerdown', onPointer)
    return () => document.removeEventListener('pointerdown', onPointer)
  }, [resetInactivity])

  useEffect(() => {
    if (phase !== 'idle' && phase !== 'boot') resetInactivity()
    else { clearTimeout(inactivityRef.current); setInactivityWarn(false) }
  }, [phase, resetInactivity])

  // ── Fullscreen ──
  useEffect(() => {
    const onFsChange = () => setIsFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', onFsChange)
    return () => document.removeEventListener('fullscreenchange', onFsChange)
  }, [])

  const enterFullscreen = () => {
    document.documentElement.requestFullscreen?.().catch(() => {})
  }

  // ── Exit tap pattern (TL ↔ BR alternating × 5) ──
  const recordTap = useCallback((corner) => {
    const taps = exitTaps.current
    const last = taps[taps.length - 1]
    if (last === corner) { exitTaps.current = [corner]; return }
    exitTaps.current = [...taps, corner]
    clearTimeout(exitTimer.current)
    if (exitTaps.current.length >= 5) {
      exitTaps.current = []
      setShowExitPin(true)
      return
    }
    exitTimer.current = setTimeout(() => { exitTaps.current = [] }, 8000)
  }, [])

  // ── Exit PIN ──
  const checkPin = useCallback(() => {
    const correct = import.meta.env.VITE_KIOSK_EXIT_PIN ?? '131824'
    if (exitPin === correct) {
      supabase.auth.signOut().finally(() => { window.location.href = '/' })
    } else {
      setExitShake(true)
      setTimeout(() => { setExitShake(false); setExitPin('') }, 600)
    }
  }, [exitPin])

  useEffect(() => {
    if (exitPin.length === 6) checkPin()
  }, [exitPin, checkPin])

  // ── Search reservations ──
  const doSearch = async () => {
    const ph = cleanPh(phone)
    if (ph.length !== 10) return
    setPhase('searching')
    try {
      const res = await fetchKioskReservations(ph)
      setReservations(res)
      setPhase(res.length ? 'results' : 'not-found')
    } catch (e) {
      setReservations([])
      setPhase('not-found')
    }
  }

  // ── Load waiver status for selected reservation ──
  const openManage = async (res) => {
    setSelectedRes(res)
    setPhase('manage')
    const userIds = res.players.map(p => p.userId).filter(Boolean)
    if (userIds.length) {
      try {
        const statuses = await fetchPlayerWaiverStatus(userIds)
        setPlayerWaivers(statuses)
      } catch (_) {}
    }
  }

  // ── Add player: search ──
  const doAddSearch = async () => {
    const ph = cleanPh(addPhone)
    if (ph.length !== 10) return
    setAddSearching(true); setAddFound(null); setAddError(null)
    try {
      const found = await fetchUserByPhone(ph)
      if (found) {
        const alreadyOn = selectedRes?.players.some(p => p.userId === found.id)
        if (alreadyOn) { setAddError('This player is already on the roster.'); setAddFound(null) }
        else setAddFound(found)
      } else {
        setAddFound(false)
      }
    } catch (_) {
      setAddFound(false)
    } finally {
      setAddSearching(false)
    }
  }

  // ── Add player: confirm ──
  const doAddPlayer = async () => {
    if (!selectedRes) return
    setAddAdding(true); setAddError(null)
    try {
      let player
      if (addFound && addFound.id) {
        player = { userId: addFound.id, name: addFound.name }
      } else {
        const nm = addName.trim()
        if (!nm) { setAddError('Please enter the player\'s name.'); setAddAdding(false); return }
        const guest = await createGuestUser({ name: nm, phone: cleanPh(addPhone), createdByUserId: kioskUserId })
        player = { userId: guest.id, name: guest.name }
      }
      const newPlayer = await addPlayerToReservation(selectedRes.id, player)
      const updatedRes = { ...selectedRes, players: [...selectedRes.players, newPlayer] }
      setSelectedRes(updatedRes)
      setReservations(prev => prev.map(r => r.id === selectedRes.id ? updatedRes : r))
      // fetch waiver status for the new player
      if (newPlayer.userId) {
        try {
          const st = await fetchPlayerWaiverStatus([newPlayer.userId])
          setPlayerWaivers(prev => ({ ...prev, ...st }))
        } catch (_) {}
      }
      setAddPhone(''); setAddFound(null); setAddName(''); setAddError(null)
      setPhase('manage')
    } catch (e) {
      setAddError(e.message || 'Failed to add player.')
    } finally {
      setAddAdding(false)
    }
  }

  // ── Remove player ──
  const doRemovePlayer = async () => {
    if (!confirmRemove || !selectedRes) return
    setBusyMsg('Removing...')
    try {
      await removePlayerFromReservation(confirmRemove.id)
      const updatedRes = { ...selectedRes, players: selectedRes.players.filter(p => p.id !== confirmRemove.id) }
      setSelectedRes(updatedRes)
      setReservations(prev => prev.map(r => r.id === selectedRes.id ? updatedRes : r))
    } catch (_) {}
    setConfirmRemove(null)
    setBusyMsg(null)
  }

  // ── Waiver sign ──
  const doSignWaiver = async () => {
    if (!signingPlayer || !waiverDoc || !signedName.trim() || !signedAgreed) return
    setSigning(true)
    try {
      await kioskSignWaiver(signingPlayer.userId, signedName.trim(), waiverDoc.id)
      setPlayerWaivers(prev => ({
        ...prev,
        [signingPlayer.userId]: {
          waivers: [{ signedAt: new Date().toISOString(), signedName: signedName.trim(), waiverDocId: waiverDoc.id }],
          needsRewaiverDocId: null,
        }
      }))
      setPhase('done')
      setTimeout(() => { setSigningPlayer(null); setWaiverScrolled(false); setSignedName(''); setSignedAgreed(false); setPhase('manage') }, 3000)
    } catch (e) {
      alert('Failed to sign waiver: ' + e.message)
    } finally {
      setSigning(false)
    }
  }

  // ── Waiver scroll detection ──
  const onWaiverScroll = () => {
    const el = waiverBodyRef.current
    if (!el) return
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 20) setWaiverScrolled(true)
  }

  // ── Shared styles ──
  const S = {
    page: { minHeight: '100vh', background: 'var(--bg)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '1.5rem', boxSizing: 'border-box', position: 'relative', overflowX: 'hidden' },
    card: { width: '100%', maxWidth: 560, background: 'var(--surf)', border: '1px solid var(--bdr)', borderRadius: 12, padding: '2rem 1.5rem', boxSizing: 'border-box' },
    title: { fontFamily: 'var(--fd)', letterSpacing: '.12em', color: 'var(--acc)', fontSize: '1rem', marginBottom: '.6rem', textTransform: 'uppercase' },
    h2: { fontSize: '1.5rem', fontWeight: 700, color: 'var(--txt)', marginBottom: '1.2rem' },
    btn: { display: 'block', width: '100%', padding: '1.1rem', fontSize: '1.1rem', fontWeight: 700, borderRadius: 8, cursor: 'pointer', border: 'none', minHeight: 60, touchAction: 'manipulation' },
    btnP: { background: 'var(--acc)', color: 'var(--bg)' },
    btnS: { background: 'var(--surf2)', color: 'var(--txt)', border: '1px solid var(--bdr)' },
    btnDanger: { background: 'rgba(192,57,43,.15)', color: '#e07060', border: '1px solid rgba(192,57,43,.3)' },
    back: { background: 'none', border: 'none', color: 'var(--muted)', fontSize: '1rem', cursor: 'pointer', padding: '.4rem 0', display: 'flex', alignItems: 'center', gap: '.3rem', marginBottom: '1.2rem', touchAction: 'manipulation' },
    playerRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '.9rem 1rem', background: 'var(--bg)', borderRadius: 8, marginBottom: '.6rem', gap: '.5rem', flexWrap: 'wrap' },
  }

  // ── Hidden exit corners ──
  const ExitCorners = () => (
    <>
      <div style={{ position: 'fixed', top: 0, left: 0, width: 120, height: 120, zIndex: 9999, opacity: 0, touchAction: 'manipulation' }}
        onPointerDown={e => { e.stopPropagation(); recordTap('TL') }} />
      <div style={{ position: 'fixed', bottom: 0, right: 0, width: 120, height: 120, zIndex: 9999, opacity: 0, touchAction: 'manipulation' }}
        onPointerDown={e => { e.stopPropagation(); recordTap('BR') }} />
    </>
  )

  // ── Exit PIN modal ──
  const ExitPinModal = () => (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.85)', zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1.5rem' }}>
      <div style={{ ...S.card, maxWidth: 400, textAlign: 'center' }}>
        <div style={S.title}>Staff Access</div>
        <div style={{ ...S.h2, marginBottom: '.5rem' }}>Enter PIN to Exit</div>
        <div style={{ marginBottom: '1.5rem', animation: exitShake ? 'kiosk-shake .5s' : 'none' }}>
          <NumPad value={exitPin} onChange={setExitPin} mode="pin" />
        </div>
        <button style={{ ...S.btn, ...S.btnS, width: '100%' }} onClick={() => { setShowExitPin(false); setExitPin('') }}>Cancel</button>
      </div>
      <style>{`@keyframes kiosk-shake{0%,100%{transform:translateX(0)}25%{transform:translateX(-8px)}75%{transform:translateX(8px)}}`}</style>
    </div>
  )

  // ── Inactivity warning ──
  const InactivityWarning = () => (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.88)', zIndex: 9000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1.5rem' }}
      onPointerDown={() => { clearInterval(warnIntervalRef.current); setInactivityWarn(false); resetInactivity() }}>
      <div style={{ ...S.card, textAlign: 'center', maxWidth: 380 }}>
        <div style={{ fontSize: '3.5rem', marginBottom: '.5rem' }}>⏱</div>
        <div style={{ ...S.h2 }}>Still there?</div>
        <div style={{ color: 'var(--muted)', marginBottom: '1.5rem', fontSize: '1.05rem' }}>Screen will reset in</div>
        <div style={{ fontSize: '4rem', fontWeight: 800, color: 'var(--acc)', marginBottom: '1.5rem' }}>{warnSecs}</div>
        <button style={{ ...S.btn, ...S.btnP }}>Tap to Continue</button>
      </div>
    </div>
  )

  // ── Confirm remove modal ──
  const ConfirmRemoveModal = () => (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.82)', zIndex: 8000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1.5rem' }}>
      <div style={{ ...S.card, maxWidth: 400, textAlign: 'center' }}>
        <div style={{ fontSize: '2rem', marginBottom: '.5rem' }}>⚠</div>
        <div style={{ ...S.h2, fontSize: '1.2rem' }}>Remove {confirmRemove?.name}?</div>
        <div style={{ color: 'var(--muted)', marginBottom: '1.5rem', fontSize: '.95rem' }}>They will be removed from this session.</div>
        <div style={{ display: 'flex', gap: '.75rem' }}>
          <button style={{ ...S.btn, ...S.btnS, flex: 1 }} onClick={() => setConfirmRemove(null)}>Cancel</button>
          <button style={{ ...S.btn, ...S.btnDanger, flex: 1 }} onClick={doRemovePlayer}>Remove</button>
        </div>
      </div>
    </div>
  )

  // ── BOOT ──
  if (phase === 'boot') return (
    <div style={S.page}>
      <img src="/logo.png" alt="Sector 317" style={{ height: 80, opacity: .8, marginBottom: '2rem' }} />
      {bootError
        ? <>
          <div style={{ color: '#e07060', textAlign: 'center', maxWidth: 380, fontSize: '1rem', marginBottom: '1.5rem' }}>{bootError}</div>
          <button style={{ ...S.btn, ...S.btnP, maxWidth: 260 }} onClick={() => { setBootError(null); setPhase('boot') }}>Retry</button>
        </>
        : <div style={{ width: 48, height: 48, border: '3px solid var(--bdr)', borderTop: '3px solid var(--acc)', borderRadius: '50%', animation: 'kspin .8s linear infinite' }} />
      }
      <style>{`@keyframes kspin{to{transform:rotate(360deg)}}`}</style>
    </div>
  )

  // ── IDLE ──
  if (phase === 'idle') return (
    <div style={{ ...S.page, cursor: 'pointer', userSelect: 'none' }}
      onPointerDown={() => { enterFullscreen(); setPhase('phone') }}>
      <ExitCorners />
      <img src="/logo.png" alt="Sector 317" style={{ height: 110, opacity: .9, marginBottom: '3rem' }} />
      <div style={{ fontFamily: 'var(--fd)', letterSpacing: '.2em', fontSize: '1.4rem', color: 'var(--acc)', textTransform: 'uppercase', marginBottom: '.8rem' }}>Self-Service Check-In</div>
      <div style={{ color: 'var(--muted)', fontSize: '1.05rem', marginBottom: '3.5rem' }}>Look up your reservation, manage your team, and sign your waiver.</div>
      <div style={{ fontFamily: 'var(--fd)', letterSpacing: '.15em', fontSize: '1.1rem', color: 'var(--txt)', opacity: .6, animation: 'kpulse 2s ease-in-out infinite' }}>TOUCH TO BEGIN</div>
      <div style={{ position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '.4rem' }}
        onPointerDown={e => e.stopPropagation()}>
        <QRCodeSVG value={KIOSK_QR_URL} size={80} fgColor="#c8e03a" bgColor="#25261f" level="M" style={{ borderRadius: 4, opacity: .7 }} />
        <div style={{ fontSize: '.65rem', color: 'var(--muted)', letterSpacing: '.06em', textTransform: 'uppercase' }}>Scan to create / sign in</div>
      </div>
      {!isFullscreen && (
        <button style={{ position: 'fixed', bottom: 16, right: 16, background: 'none', border: '1px solid var(--bdr)', color: 'var(--muted)', fontSize: '.8rem', padding: '.4rem .8rem', borderRadius: 6, cursor: 'pointer' }}
          onPointerDown={e => { e.stopPropagation(); enterFullscreen() }}>
          ⛶ Full Screen
        </button>
      )}
      <style>{`@keyframes kpulse{0%,100%{opacity:.4}50%{opacity:.9}}`}</style>
    </div>
  )

  // ── PHONE ENTRY ──
  if (phase === 'phone') return (
    <div style={S.page}>
      <ExitCorners />
      {inactivityWarn && <InactivityWarning />}
      <div style={{ ...S.card, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1.2rem' }}>
        <div style={S.title}>Find Your Reservation</div>
        <div style={{ ...S.h2, textAlign: 'center', marginBottom: 0 }}>Enter your phone number</div>
        <NumPad value={phone} onChange={setPhone} mode="phone" />
        <button style={{ ...S.btn, ...S.btnP, marginTop: '.4rem', opacity: cleanPh(phone).length === 10 ? 1 : .45 }}
          disabled={cleanPh(phone).length !== 10}
          onClick={doSearch}>
          Search →
        </button>
        <button style={{ ...S.btn, ...S.btnS, marginTop: '-.4rem' }} onClick={() => { setPhone(''); setPhase('idle') }}>Cancel</button>
      </div>
    </div>
  )

  // ── SEARCHING ──
  if (phase === 'searching') return (
    <div style={S.page}>
      <ExitCorners />
      <div style={{ width: 56, height: 56, border: '3px solid var(--bdr)', borderTop: '3px solid var(--acc)', borderRadius: '50%', animation: 'kspin .8s linear infinite', marginBottom: '1.5rem' }} />
      <div style={{ color: 'var(--muted)', fontSize: '1.05rem' }}>Looking up your reservation…</div>
      <style>{`@keyframes kspin{to{transform:rotate(360deg)}}`}</style>
    </div>
  )

  // ── NOT FOUND ──
  if (phase === 'not-found') return (
    <div style={S.page}>
      <ExitCorners />
      {inactivityWarn && <InactivityWarning />}
      <div style={{ ...S.card, textAlign: 'center' }}>
        <div style={{ fontSize: '2.5rem', marginBottom: '.8rem' }}>🔍</div>
        <div style={{ ...S.h2 }}>No reservations found</div>
        <div style={{ color: 'var(--muted)', marginBottom: '1.8rem', fontSize: '1rem' }}>
          No upcoming reservations were found for {fmtPh(phone)}.<br /><br />
          If you believe this is an error, please see a staff member.
        </div>
        <button style={{ ...S.btn, ...S.btnP, marginBottom: '.75rem' }} onClick={() => { setPhone(''); setPhase('phone') }}>Try a Different Number</button>
        <button style={{ ...S.btn, ...S.btnS }} onClick={() => { setPhone(''); setPhase('idle') }}>Return to Home</button>
      </div>
    </div>
  )

  // ── RESULTS ──
  if (phase === 'results') return (
    <div style={{ ...S.page, justifyContent: 'flex-start', paddingTop: '2rem' }}>
      <ExitCorners />
      {inactivityWarn && <InactivityWarning />}
      <div style={{ width: '100%', maxWidth: 560 }}>
        <button style={S.back} onClick={() => { setPhone(''); setPhase('phone') }}>← Back</button>
        <div style={S.title}>Your Reservations</div>
        <div style={{ ...S.h2, marginBottom: '1.2rem' }}>Select a booking to manage</div>
        {reservations.map(res => {
          const rt = resTypes.find(t => t.id === res.typeId)
          const playerNames = res.players.map(p => p.name).join(' · ')
          return (
            <div key={res.id} style={{ background: 'var(--surf)', border: '1px solid var(--bdr)', borderRadius: 10, padding: '1.2rem 1.4rem', marginBottom: '1rem' }}>
              <div style={{ fontSize: '1.05rem', fontWeight: 700, color: 'var(--acc)', marginBottom: '.2rem' }}>
                {fmtDate(res.date)} at {fmtTime(res.startTime)}
              </div>
              <div style={{ fontSize: '.95rem', color: 'var(--txt)', marginBottom: '.3rem' }}>{rt?.name ?? 'Session'}</div>
              {playerNames && <div style={{ fontSize: '.85rem', color: 'var(--muted)', marginBottom: '1rem' }}>Players: {playerNames}</div>}
              <button style={{ ...S.btn, ...S.btnP }} onClick={() => openManage(res)}>
                Manage This Booking →
              </button>
            </div>
          )
        })}
        <button style={{ ...S.btn, ...S.btnS, marginTop: '.5rem' }} onClick={() => { setPhone(''); setPhase('idle') }}>Done — Return Home</button>
      </div>
    </div>
  )

  // ── MANAGE ──
  if (phase === 'manage' && selectedRes) {
    const rt = resTypes.find(t => t.id === selectedRes.typeId)
    // open play: cap = playerCount (booked seats); private: cap = rt.maxPlayers
    const maxP = rt?.style === 'open'
      ? (selectedRes.playerCount || 0)
      : (rt?.maxPlayers ?? null)
    const atMax = maxP !== null && maxP > 0 && selectedRes.players.length >= maxP
    return (
      <div style={{ ...S.page, justifyContent: 'flex-start', paddingTop: '2rem' }}>
        <ExitCorners />
        {inactivityWarn && <InactivityWarning />}
        {confirmRemove && <ConfirmRemoveModal />}
        {busyMsg && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.7)', zIndex: 7000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ color: 'var(--txt)', fontSize: '1.1rem' }}>{busyMsg}</div>
          </div>
        )}
        <div style={{ width: '100%', maxWidth: 560 }}>
          <button style={S.back} onClick={() => { setSelectedRes(null); setPlayerWaivers({}); setPhase('results') }}>← Back to Results</button>
          <div style={S.title}>Manage Booking</div>
          <div style={{ fontSize: '1.05rem', fontWeight: 700, color: 'var(--txt)', marginBottom: '.2rem' }}>
            {fmtDate(selectedRes.date)} at {fmtTime(selectedRes.startTime)}
          </div>
          <div style={{ fontSize: '.9rem', color: 'var(--muted)', marginBottom: '1.5rem' }}>{rt?.name ?? 'Session'}</div>

          <div style={{ borderTop: '1px solid var(--bdr)', paddingTop: '1.2rem', marginBottom: '1rem' }}>
            <div style={{ ...S.title, marginBottom: '.8rem' }}>Team Members</div>
            {selectedRes.players.length === 0 && (
              <div style={{ color: 'var(--muted)', fontSize: '.95rem', padding: '.6rem 0', marginBottom: '.5rem' }}>No players added yet.</div>
            )}
            {selectedRes.players.map(player => {
              const pw = player.userId ? playerWaivers[player.userId] : null
              const valid = pw ? hasValidWaiver({ waivers: pw.waivers, needsRewaiverDocId: pw.needsRewaiverDocId }, waiverDoc) : false
              const canSign = !!player.userId && !valid && !!waiverDoc
              return (
                <div key={player.id} style={S.playerRow}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: '1rem', color: 'var(--txt)', marginBottom: '.2rem' }}>{player.name}</div>
                    <WaiverBadge valid={valid} />
                  </div>
                  <div style={{ display: 'flex', gap: '.5rem', flexShrink: 0 }}>
                    {canSign && (
                      <button style={{ padding: '.5rem .9rem', borderRadius: 6, fontSize: '.85rem', fontWeight: 600, cursor: 'pointer', background: 'var(--acc)', color: 'var(--bg)', border: 'none', touchAction: 'manipulation' }}
                        onClick={() => { setSigningPlayer(player); setSignedName(player.name); setWaiverScrolled(false); setPhase('waiver-read') }}>
                        Sign Waiver
                      </button>
                    )}
                    <button style={{ padding: '.5rem .9rem', borderRadius: 6, fontSize: '1rem', fontWeight: 700, cursor: 'pointer', background: 'var(--surf2)', color: 'var(--muted)', border: '1px solid var(--bdr)', touchAction: 'manipulation' }}
                      onClick={() => setConfirmRemove(player)} title="Remove player">
                      —
                    </button>
                  </div>
                </div>
              )
            })}
          </div>

          {!atMax && (
            <button style={{ ...S.btn, ...S.btnS, marginBottom: '.75rem' }} onClick={() => { setAddPhone(''); setAddFound(null); setAddName(''); setAddError(null); setPhase('add-player') }}>
              + Add Team Member
            </button>
          )}
          {atMax && <div style={{ color: 'var(--muted)', fontSize: '.85rem', textAlign: 'center', marginBottom: '.75rem' }}>Team is full ({maxP} player{maxP !== 1 ? 's' : ''} maximum)</div>}

          <button style={{ ...S.btn, ...S.btnP }} onClick={() => { setSelectedRes(null); setPlayerWaivers({}); setPhase('idle') }}>
            Done — Return Home
          </button>
          <AccountQR />
        </div>
      </div>
    )
  }

  // ── ADD PLAYER ──
  if (phase === 'add-player') return (
    <div style={{ ...S.page, justifyContent: 'flex-start', paddingTop: '2rem' }}>
      <ExitCorners />
      {inactivityWarn && <InactivityWarning />}
      <div style={{ width: '100%', maxWidth: 560 }}>
        <button style={S.back} onClick={() => { setAddPhone(''); setAddFound(null); setAddName(''); setAddError(null); setPhase('manage') }}>← Back</button>
        <div style={S.title}>Add Team Member</div>
        <div style={{ ...S.h2, marginBottom: '1.2rem' }}>Enter their phone number</div>

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem', marginBottom: '1.2rem' }}>
          <NumPad value={addPhone} onChange={v => { setAddPhone(v); setAddFound(null); setAddName(''); setAddError(null) }} mode="phone" />
          <button style={{ ...S.btn, ...S.btnP, opacity: cleanPh(addPhone).length === 10 ? 1 : .45 }}
            disabled={cleanPh(addPhone).length !== 10 || addSearching}
            onClick={doAddSearch}>
            {addSearching ? 'Searching…' : 'Search →'}
          </button>
        </div>

        {addFound && (
          <div style={{ ...S.playerRow, marginBottom: '1rem' }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700, fontSize: '1.05rem', color: 'var(--txt)' }}>{addFound.name}</div>
              <div style={{ fontSize: '.8rem', color: 'var(--muted)', marginTop: '.2rem' }}>Found in system</div>
            </div>
            <button style={{ ...S.btn, ...S.btnP, width: 'auto', padding: '.6rem 1.2rem', fontSize: '.95rem' }}
              disabled={addAdding} onClick={doAddPlayer}>
              {addAdding ? 'Adding…' : 'Add to Session'}
            </button>
          </div>
        )}

        {addFound === false && (
          <div style={{ background: 'var(--surf)', border: '1px solid var(--bdr)', borderRadius: 10, padding: '1.2rem', marginBottom: '1rem' }}>
            <div style={{ fontWeight: 600, color: 'var(--txt)', marginBottom: '.6rem' }}>Player not found — enter their name</div>
            <input
              type="text" placeholder="Full name" value={addName}
              onChange={e => setAddName(e.target.value)}
              style={{ width: '100%', padding: '.9rem 1rem', fontSize: '1.05rem', borderRadius: 8, border: '1px solid var(--bdr)', background: 'var(--bg)', color: 'var(--txt)', boxSizing: 'border-box', marginBottom: '.8rem' }}
            />
            <button style={{ ...S.btn, ...S.btnP, opacity: addName.trim() ? 1 : .45 }}
              disabled={!addName.trim() || addAdding} onClick={doAddPlayer}>
              {addAdding ? 'Adding…' : 'Add as Guest'}
            </button>
          </div>
        )}

        {addError && <div style={{ color: '#e07060', fontSize: '.9rem', textAlign: 'center', marginBottom: '.8rem' }}>{addError}</div>}
      </div>
    </div>
  )

  // ── WAIVER READ ──
  if (phase === 'waiver-read') return (
    <div style={{ ...S.page, justifyContent: 'flex-start', paddingTop: '2rem' }}>
      <ExitCorners />
      {inactivityWarn && <InactivityWarning />}
      <div style={{ width: '100%', maxWidth: 560 }}>
        <button style={S.back} onClick={() => setPhase('manage')}>← Back</button>
        <div style={S.title}>Waiver &amp; Liability Agreement</div>
        <div style={{ fontSize: '1rem', color: 'var(--muted)', marginBottom: '1rem' }}>
          Signing for: <strong style={{ color: 'var(--txt)' }}>{signingPlayer?.name}</strong>
        </div>
        <div
          ref={waiverBodyRef}
          onScroll={onWaiverScroll}
          style={{ height: '55vh', overflowY: 'auto', background: 'var(--bg)', border: '1px solid var(--bdr)', borderRadius: 8, padding: '1.2rem', marginBottom: '1rem', fontSize: '.9rem', lineHeight: 1.6, color: 'var(--txt)' }}
          dangerouslySetInnerHTML={{ __html: waiverDoc?.body ?? '<p>No waiver document available.</p>' }}
        />
        {!waiverScrolled && (
          <div style={{ textAlign: 'center', color: 'var(--muted)', fontSize: '.85rem', marginBottom: '.5rem', animation: 'kpulse 2s ease-in-out infinite' }}>
            ↓ Scroll to the bottom to continue
          </div>
        )}
        <button style={{ ...S.btn, ...S.btnP, opacity: waiverScrolled ? 1 : .35 }}
          disabled={!waiverScrolled}
          onClick={() => setPhase('waiver-sign')}>
          Continue to Sign →
        </button>
      </div>
      <style>{`@keyframes kpulse{0%,100%{opacity:.4}50%{opacity:.9}}`}</style>
    </div>
  )

  // ── WAIVER SIGN ──
  if (phase === 'waiver-sign') return (
    <div style={{ ...S.page, justifyContent: 'flex-start', paddingTop: '2rem' }}>
      <ExitCorners />
      {inactivityWarn && <InactivityWarning />}
      <div style={{ width: '100%', maxWidth: 560 }}>
        <button style={S.back} onClick={() => setPhase('waiver-read')}>← Back to Waiver</button>
        <div style={S.title}>Sign Waiver</div>
        <div style={{ ...S.h2, marginBottom: '1.2rem' }}>Confirm your agreement</div>

        <div style={{ marginBottom: '1.2rem' }}>
          <label style={{ display: 'block', fontSize: '.9rem', color: 'var(--muted)', marginBottom: '.4rem' }}>Full Legal Name</label>
          <input type="text" value={signedName} onChange={e => setSignedName(e.target.value)}
            style={{ width: '100%', padding: '.9rem 1rem', fontSize: '1.1rem', borderRadius: 8, border: '1px solid var(--bdr)', background: 'var(--bg)', color: 'var(--txt)', boxSizing: 'border-box' }} />
        </div>

        <label style={{ display: 'flex', alignItems: 'flex-start', gap: '.8rem', cursor: 'pointer', background: 'var(--surf)', border: '1px solid var(--bdr)', borderRadius: 8, padding: '1rem', marginBottom: '1.5rem', touchAction: 'manipulation' }}>
          <input type="checkbox" checked={signedAgreed} onChange={e => setSignedAgreed(e.target.checked)}
            style={{ width: 22, height: 22, flexShrink: 0, marginTop: 2, accentColor: 'var(--acc)', cursor: 'pointer' }} />
          <span style={{ fontSize: '.95rem', color: 'var(--txt)', lineHeight: 1.5 }}>
            I have read and agree to the terms of the Sector 317 liability waiver. I understand and accept all risks associated with participation.
          </span>
        </label>

        <button style={{ ...S.btn, ...S.btnP, opacity: signedName.trim() && signedAgreed ? 1 : .4 }}
          disabled={!signedName.trim() || !signedAgreed || signing}
          onClick={doSignWaiver}>
          {signing ? 'Signing…' : 'Sign Waiver'}
        </button>
      </div>
    </div>
  )

  // ── DONE ──
  if (phase === 'done') return (
    <div style={S.page}>
      <ExitCorners />
      <div style={{ ...S.card, textAlign: 'center' }}>
        <div style={{ fontSize: '3.5rem', marginBottom: '.8rem' }}>✅</div>
        <div style={{ ...S.h2 }}>Waiver Signed!</div>
        <div style={{ color: 'var(--muted)', fontSize: '1rem' }}>
          {signingPlayer?.name}'s waiver has been recorded.<br />Returning to your booking in a moment…
        </div>
      </div>
    </div>
  )

  return null
}
