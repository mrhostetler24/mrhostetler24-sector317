// src/envRender.jsx
// Shared env label rendering — used in analytics widget, match summary pills, and staff table.

const vizColor  = { V: '#dce3ef', C: '#e879f9', B: '#1a2533' }
const vizExtra  = {
  B: { textShadow: '0 0 8px rgba(0,255,65,.9),0 0 18px rgba(0,255,65,.55),0 0 32px rgba(0,255,65,.2)' },
}
const vizClass  = { C: 'viz-cosmic' }
const audColor  = { O: 'var(--muted)', T: '#38bdf8' }
const raveColors = ['#f472b6','#fb923c','#facc15','#4ade80','#60a5fa','#c084fc']

export function vizRenderName(code, name, baseStyle) {
  if (code === 'S') {
    return <span style={baseStyle} className="viz-strobe">{name}</span>
  }
  if (code === 'R') {
    const letters = (name || '').split('')
    const dur = 2
    return (
      <span style={baseStyle}>
        {letters.map((ch, i) => (
          <span key={i} style={{
            color: raveColors[i % raveColors.length],
            animation: `raveGlow ${dur}s ease-out infinite`,
            animationDelay: `${(i * dur / letters.length).toFixed(2)}s`,
          }}>{ch}</span>
        ))}
      </span>
    )
  }
  return <span style={{ ...baseStyle, color: vizColor[code] ?? 'var(--accB)', ...(vizExtra[code] || {}) }} className={vizClass[code] || ''}>{name}</span>
}

export function audRenderName(code, name, baseStyle) {
  if (code === 'C') {
    return <span style={{ ...baseStyle, color: '#f97316' }} className="aud-cranked">{name}</span>
  }
  return <span style={{ ...baseStyle, color: audColor[code] ?? 'var(--accB)' }}>{name}</span>
}
