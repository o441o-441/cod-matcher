'use client'

type DataPoint = {
  matchIndex: number
  rating: number
}

type RatingChartProps = {
  data: DataPoint[]
  width?: number
  height?: number
}

export default function RatingChart({ data, width = 600, height = 250 }: RatingChartProps) {
  if (data.length === 0) {
    return <p className="muted">データがありません</p>
  }

  const pad = { top: 20, right: 20, bottom: 35, left: 50 }
  const w = width - pad.left - pad.right
  const h = height - pad.top - pad.bottom

  const minR = Math.min(...data.map((d) => d.rating))
  const maxR = Math.max(...data.map((d) => d.rating))
  const rRange = maxR - minR || 100
  const rMin = minR - rRange * 0.1
  const rMax = maxR + rRange * 0.1

  const maxMatch = Math.max(...data.map((d) => d.matchIndex))
  const minMatch = Math.min(...data.map((d) => d.matchIndex))
  const mRange = maxMatch - minMatch || 1

  const x = (i: number) => pad.left + ((i - minMatch) / mRange) * w
  const y = (r: number) => pad.top + (1 - (r - rMin) / (rMax - rMin)) * h

  const points = data.map((d) => `${x(d.matchIndex)},${y(d.rating)}`).join(' ')

  // Y axis labels (5 ticks)
  const yTicks: number[] = []
  for (let i = 0; i <= 4; i++) {
    yTicks.push(Math.round(rMin + ((rMax - rMin) * i) / 4))
  }

  // X axis labels
  const xTicks: number[] = []
  const step = Math.max(1, Math.floor(mRange / 5))
  for (let i = minMatch; i <= maxMatch; i += step) {
    xTicks.push(i)
  }
  if (!xTicks.includes(maxMatch)) xTicks.push(maxMatch)

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      style={{ width: '100%', maxWidth: width, height: 'auto' }}
    >
      {/* Grid lines */}
      {yTicks.map((t) => (
        <line
          key={`g-${t}`}
          x1={pad.left}
          y1={y(t)}
          x2={width - pad.right}
          y2={y(t)}
          stroke="rgba(140,160,220,0.1)"
          strokeWidth={1}
        />
      ))}

      {/* Y axis labels */}
      {yTicks.map((t) => (
        <text
          key={`y-${t}`}
          x={pad.left - 8}
          y={y(t) + 4}
          textAnchor="end"
          fill="rgba(138,147,181,0.8)"
          fontSize={11}
        >
          {t}
        </text>
      ))}

      {/* X axis labels */}
      {xTicks.map((t) => (
        <text
          key={`x-${t}`}
          x={x(t)}
          y={height - 8}
          textAnchor="middle"
          fill="rgba(138,147,181,0.8)"
          fontSize={11}
        >
          {t}
        </text>
      ))}

      {/* X axis title */}
      <text
        x={pad.left + w / 2}
        y={height - 0}
        textAnchor="middle"
        fill="rgba(138,147,181,0.5)"
        fontSize={10}
      >
        対戦数
      </text>

      {/* Line */}
      <polyline
        fill="none"
        stroke="var(--accent-cyan, #00e5ff)"
        strokeWidth={2}
        strokeLinejoin="round"
        strokeLinecap="round"
        points={points}
      />

      {/* Area fill */}
      <polygon
        fill="rgba(0,229,255,0.08)"
        points={`${x(minMatch)},${y(rMin)} ${points} ${x(maxMatch)},${y(rMin)}`}
      />

      {/* Data points */}
      {data.map((d, i) => (
        <circle
          key={i}
          cx={x(d.matchIndex)}
          cy={y(d.rating)}
          r={data.length > 30 ? 2 : 3.5}
          fill="var(--accent-cyan, #00e5ff)"
        />
      ))}

      {/* Latest rating label */}
      {data.length > 0 && (
        <text
          x={x(data[data.length - 1].matchIndex) + 6}
          y={y(data[data.length - 1].rating) - 8}
          fill="#fff"
          fontSize={12}
          fontWeight="bold"
        >
          {data[data.length - 1].rating}
        </text>
      )}
    </svg>
  )
}
