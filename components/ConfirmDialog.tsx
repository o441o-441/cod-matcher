'use client'

type ConfirmDialogProps = {
  open: boolean
  title?: string
  message: string
  confirmText?: string
  cancelText?: string
  danger?: boolean
  loading?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export default function ConfirmDialog({
  open,
  title = '確認',
  message,
  confirmText = 'OK',
  cancelText = 'キャンセル',
  danger = false,
  loading = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  if (!open) return null

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.45)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '20px',
        zIndex: 10000,
      }}
      onClick={onCancel}
    >
      <div
        className="card-strong"
        style={{
          width: '100%',
          maxWidth: '460px',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2>{title}</h2>
        <p>{message}</p>

        <div className="section row" style={{ justifyContent: 'flex-end' }}>
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            style={{
              background: 'rgba(255,255,255,0.08)',
              boxShadow: 'none',
            }}
          >
            {cancelText}
          </button>

          <button
            type="button"
            onClick={onConfirm}
            disabled={loading}
            style={
              danger
                ? {
                    background:
                      'linear-gradient(180deg, #ff6b81 0%, #e85d75 100%)',
                    boxShadow: '0 8px 24px rgba(255, 107, 129, 0.28)',
                  }
                : undefined
            }
          >
            {loading ? '処理中...' : confirmText}
          </button>
        </div>
      </div>
    </div>
  )
}