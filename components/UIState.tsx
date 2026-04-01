'use client'

export function LoadingCard({
  title = '読み込み中...',
  message = 'データを取得しています',
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