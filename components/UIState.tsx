'use client'

const shimmerStyle: React.CSSProperties = {
  background: 'linear-gradient(90deg, rgba(255,255,255,0.04) 25%, rgba(255,255,255,0.08) 50%, rgba(255,255,255,0.04) 75%)',
  backgroundSize: '200% 100%',
  animation: 'shimmer 1.5s infinite',
  borderRadius: 8,
}

export function SkeletonLine({ width = '100%', height = 16 }: { width?: string | number; height?: number }) {
  return <div style={{ ...shimmerStyle, width, height, marginBottom: 8 }} />
}

export function SkeletonCard({ lines = 3 }: { lines?: number }) {
  return (
    <div className="card" style={{ padding: 16 }}>
      {Array.from({ length: lines }).map((_, i) => (
        <SkeletonLine key={i} width={i === 0 ? '60%' : i === lines - 1 ? '40%' : '80%'} />
      ))}
    </div>
  )
}

export function LoadingSkeleton({ cards = 2 }: { cards?: number }) {
  return (
    <>
      <style>{`@keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }`}</style>
      <div className="stack">
        {Array.from({ length: cards }).map((_, i) => (
          <SkeletonCard key={i} />
        ))}
      </div>
    </>
  )
}

export function LoadingCard({
  title = '読み込み中...',
  message = 'データを取得しています',
}: {
  title?: string
  message?: string
}) {
  return (
    <>
      <style>{`@keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }`}</style>
      <div className="card" style={{ padding: 16 }}>
        <SkeletonLine width="50%" height={20} />
        <SkeletonLine width="70%" />
        <SkeletonLine width="30%" />
        <p className="muted" style={{ marginTop: 8, fontSize: '0.8rem' }}>{title} {message}</p>
      </div>
    </>
  )
}

export function EmptyCard({
  title = 'データがありません',
  message = 'まだ表示できる内容がありません',
}: {
  title?: string
  message?: string
}) {
  return (
    <div className="card">
      <h3>{title}</h3>
      <p className="muted">{message}</p>
    </div>
  )
}