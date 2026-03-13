// src/envRender.jsx
// Shared env label rendering — used in analytics widget, match summary pills, and staff table.

const vizColor  = { V: '#dce3ef', C: '#a78bfa', B: '#1a2533' }
const vizExtra  = { B: { textShadow: '0 0 8px rgba(0,255,65,.9),0 0 18px rgba(0,255,65,.55),0 0 32px rgba(0,255,65,.2)' } }
const audColor  = { O: 'var(--muted)', T: '#38bdf8' }
const raveColors = ['#f472b6','#fb923c','#facc15','#4ade80','#60a5fa','#c084fc']

export function vizRenderName(code, name, baseStyle) {
  if (code === 'S') {
    return (
      <span style={baseStyle}>
        {(name || '').split('').map((ch, i) => (
          <span key={i} style={i % 2 === 0
            ? { color: '#ffffff', textShadow: '0 0 3px rgba(255,255,255,.5)' }
            : { color: '#1c2333', textShadow: '-1px -1px 0 #fff,1px -1px 0 #fff,-1px 1px 0 #fff,1px 1px 0 #fff', opacity: 0.45 }
          }>{ch}</span>
        ))}
      </span>
    )
  }
  if (code === 'R') {
    return (
      <span style={baseStyle}>
        {(name || '').split('').map((ch, i) => (
          <span key={i} style={{ color: raveColors[i % raveColors.length] }}>{ch}</span>
        ))}
      </span>
    )
  }
  return <span style={{ ...baseStyle, color: vizColor[code] ?? 'var(--accB)', ...(vizExtra[code] || {}) }}>{name}</span>
}

export function audRenderName(code, name, baseStyle) {
  if (code === 'C') {
    return <span style={{ ...baseStyle, color: '#f97316' }} className="aud-cranked">{name}</span>
  }
  return <span style={{ ...baseStyle, color: audColor[code] ?? 'var(--accB)' }}>{name}</span>
}
