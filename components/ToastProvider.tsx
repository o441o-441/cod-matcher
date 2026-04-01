'use client'

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react'

type ToastType = 'success' | 'error' | 'info'

type ToastItem = {
  id: number
  message: string
  type: ToastType
}

type ToastContextType = {
  showToast: (message: string, type?: ToastType) => void
}

const ToastContext = createContext<ToastContextType | null>(null)

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])

  const showToast = useCallback((message: string, type: ToastType = 'info') => {
    const id = Date.now() + Math.floor(Math.random() * 1000)

    setToasts((prev) => [...prev, { id, message, type }])

    window.setTimeout(() => {
      setToasts((prev) => prev.filter((toast) => toast.id !== id))
    }, 2800)
  }, [])

  const value = useMemo(() => ({ showToast }), [showToast])

  return (
    <ToastContext.Provider value={value}>
      {children}

      <div
        style={{
          position: 'fixed',
          top: 20,
          right: 20,
          zIndex: 9999,
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
          width: 'min(360px, calc(100vw - 32px))',
        }}
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            style={{
              border: '1px solid rgba(255,255,255,0.12)',
              borderRadius: 14,
              padding: '12px 14px',
              backdropFilter: 'blur(10px)',
              boxShadow: '0 16px 40px rgba(0,0,0,0.28)',
              background:
                toast.type === 'success'
                  ? 'rgba(70, 211, 154, 0.16)'
                  : toast.type === 'error'
                  ? 'rgba(255, 107, 129, 0.16)'
                  : 'rgba(110, 168, 254, 0.16)',
              color: '#eaf0ff',
            }}
          >
            <strong style={{ display: 'block', marginBottom: 4 }}>
              {toast.type === 'success'
                ? '成功'
                : toast.type === 'error'
                ? 'エラー'
                : 'お知らせ'}
            </strong>
            <div>{toast.message}</div>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast() {
  const context = useContext(ToastContext)

  if (!context) {
    throw new Error('useToast must be used within ToastProvider')
  }

  return context
}