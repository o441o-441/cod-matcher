'use client'

import { useEffect, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useFeatureReleases, isReleased, isTbd, releaseLabel, FEATURE_META, type FeatureKey } from '@/lib/featureReleases'

// ============================================================
// 機能の段階公開ゲート (ページ単位)
// 未公開機能のページを開くと公開予定日時のロック画面を被せる。
// 管理者は公開前でも動作確認できるようバイパス。
// クライアント側ゲートなのでUX用の施錠であり、
// 実効ガードはDBトリガー (trg_feature_gate) が担う。
// ============================================================

// タブ内コンテンツ用のコンパクトなロック表示 (ページ全面ゲートは FeatureGate)
export function FeatureLockCard({ featureKey }: { featureKey: FeatureKey }) {
  const fr = useFeatureReleases()
  const meta = FEATURE_META[featureKey]
  return (
    <div className="section">
      <div className="card-strong" style={{ textAlign: 'center', padding: '40px 24px' }}>
        <div style={{ fontSize: 36, marginBottom: 6 }}>🔒</div>
        <div className="eyebrow">COMING SOON</div>
        <h2 style={{ margin: '8px 0 4px' }}>{meta.label}</h2>
        <p className="muted" style={{ fontSize: 13, margin: '0 0 14px' }}>{meta.desc}</p>
        <div className="mono" style={{ fontSize: 20, fontWeight: 800, color: 'var(--cyan)' }}>
          {fr ? (isTbd(fr, featureKey) ? '公開時期未定' : `${releaseLabel(fr, featureKey)} 公開予定`) : '公開日時を確認中...'}
        </div>
        {fr && isTbd(fr, featureKey) && (
          <p className="muted" style={{ fontSize: 12, margin: '10px 0 0' }}>再開が決まったらDiscordでお知らせします</p>
        )}
      </div>
    </div>
  )
}

const PATH_GATES: { prefix: string; key: FeatureKey }[] = [
  { prefix: '/match', key: 'ranked' },
  { prefix: '/custom/eights', key: '8s' },
  { prefix: '/custom/board', key: 'scrim' },
  { prefix: '/tournaments', key: 'tournament' },
]

export default function FeatureGate() {
  const pathname = usePathname()
  const router = useRouter()
  const fr = useFeatureReleases()
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null)

  useEffect(() => {
    let cancelled = false
    const check = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.user) { if (!cancelled) setIsAdmin(false); return }
      const { data: prof } = await supabase
        .from('profiles').select('is_admin').eq('id', session.user.id)
        .maybeSingle<{ is_admin: boolean }>()
      if (!cancelled) setIsAdmin(!!prof?.is_admin)
    }
    void check()
    return () => { cancelled = true }
  }, [])

  const gate = PATH_GATES.find(g => pathname.startsWith(g.prefix))
  // 読込中 (fr/isAdmin が null) はロックしない — 公開済みユーザーの表示を遅らせないため。
  // 未公開ページを開いた一瞬だけ中身が見えても、書き込みはDB側で拒否される。
  if (!gate || !fr || isAdmin !== false) return null
  if (isReleased(fr, gate.key)) return null

  const meta = FEATURE_META[gate.key]
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 6000, display: 'grid', placeItems: 'center', background: 'rgba(5,8,14,0.96)', padding: 20 }}>
      <div className="card-strong" style={{ maxWidth: 440, width: '100%', textAlign: 'center', padding: '36px 28px' }}>
        <div style={{ fontSize: 40, marginBottom: 8 }}>🔒</div>
        <div className="eyebrow">COMING SOON</div>
        <h2 style={{ margin: '10px 0 6px', fontSize: 22 }}>{meta.label}</h2>
        <p className="muted" style={{ fontSize: 13, margin: '0 0 16px' }}>{meta.desc}</p>
        <div className="card" style={{ padding: '14px 16px', marginBottom: 20, borderColor: 'rgba(0,229,255,0.35)' }}>
          <span className="stat-label">公開予定</span>
          <div className="mono" style={{ fontSize: 22, fontWeight: 800, color: 'var(--cyan)', marginTop: 4 }}>
            {isTbd(fr, gate.key) ? '時期未定' : releaseLabel(fr, gate.key)}
          </div>
          {isTbd(fr, gate.key) && (
            <p className="muted" style={{ fontSize: 12, margin: '8px 0 0' }}>再開が決まったらDiscordでお知らせします</p>
          )}
        </div>
        <button className="btn-primary" style={{ width: '100%' }} onClick={() => router.push('/')}>トップへ戻る</button>
      </div>
    </div>
  )
}
