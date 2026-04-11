'use client'

import { useEffect, useState } from 'react'

type TutorialStep = {
  title: string
  body: string
}

type TutorialProps = {
  pageKey: string
  steps: TutorialStep[]
}

export function TutorialButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        width: 32,
        height: 32,
        borderRadius: '50%',
        fontSize: '1rem',
        fontWeight: 'bold',
        padding: 0,
        lineHeight: '32px',
        textAlign: 'center',
      }}
    >
      ?
    </button>
  )
}

export function Tutorial({ pageKey, steps }: TutorialProps) {
  const [visible, setVisible] = useState(false)
  const [step, setStep] = useState(0)

  useEffect(() => {
    const key = `tutorial_seen_${pageKey}`
    if (!localStorage.getItem(key)) {
      setVisible(true)
    }
  }, [pageKey])

  const close = () => {
    setVisible(false)
    setStep(0)
    localStorage.setItem(`tutorial_seen_${pageKey}`, '1')
  }

  const reopen = () => {
    setStep(0)
    setVisible(true)
  }

  if (!visible) {
    return <TutorialButton onClick={reopen} />
  }

  const current = steps[step]

  return (
    <>
      <TutorialButton onClick={reopen} />
      <div
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 9999,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: 'rgba(0, 0, 0, 0.7)',
        }}
        onClick={close}
      >
        <div
          style={{
            maxWidth: 480,
            width: '90%',
            borderRadius: 12,
            padding: 24,
            backgroundColor: 'var(--card-strong, #121830)',
            border: '1px solid var(--line-strong, rgba(140, 160, 220, 0.28))',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <h3 style={{ margin: 0 }}>{current.title}</h3>
            <span className="muted" style={{ fontSize: '0.85rem' }}>
              {step + 1} / {steps.length}
            </span>
          </div>

          <p style={{ whiteSpace: 'pre-wrap', lineHeight: 1.7 }}>{current.body}</p>

          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 20, gap: 8 }}>
            <div>
              {step > 0 && (
                <button onClick={() => setStep(step - 1)}>戻る</button>
              )}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={close}>閉じる</button>
              {step < steps.length - 1 && (
                <button onClick={() => setStep(step + 1)}>次へ</button>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
