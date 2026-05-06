'use client'

import { useEffect, useRef } from 'react'

type ConfirmDialogProps = {
  open: boolean
  title?: string
  message: string
  confirmText?: string
  cancelText?: string
  danger?: boolean
  loading?: boolean
  onConfirm: () => void | Promise<void>
  onCancel: () => void | Promise<void>
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
  const cancelRef = useRef<HTMLButtonElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)

  // Focus cancel button on open + trap focus
  useEffect(() => {
    if (!open) return
    cancelRef.current?.focus()

    const el = dialogRef.current
    if (!el) return

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onCancel(); return }
      if (e.key !== 'Tab') return

      const focusable = el.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )
      if (focusable.length === 0) return

      const first = focusable[0]
      const last = focusable[focusable.length - 1]

      if (e.shiftKey) {
        if (document.activeElement === first) { e.preventDefault(); last.focus() }
      } else {
        if (document.activeElement === last) { e.preventDefault(); first.focus() }
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, onCancel])

  if (!open) return null

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
      aria-describedby="confirm-dialog-msg"
      ref={dialogRef}
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
        <h2 id="confirm-dialog-title">{title}</h2>
        <p id="confirm-dialog-msg">{message}</p>

        <div className="section row" style={{ justifyContent: 'flex-end' }}>
          <button
            type="button"
            ref={cancelRef}
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
