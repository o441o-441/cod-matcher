'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/components/ToastProvider'
import { LoadingCard, EmptyCard } from '@/components/UIState'
import { CONTROLLER_GROUPS } from '@/lib/controllers'

type AffiliateRow = {
  controller_name: string
  url: string
}

const allControllers = CONTROLLER_GROUPS.flatMap((g) => g.options)

export default function AdminAffiliatesPage() {
  const router = useRouter()
  const { showToast } = useToast()

  const [loading, setLoading] = useState(true)
  const [authorized, setAuthorized] = useState(false)
  const [links, setLinks] = useState<AffiliateRow[]>([])
  const [selectedController, setSelectedController] = useState('')
  const [urlInput, setUrlInput] = useState('')
  const [saving, setSaving] = useState(false)

  const fetchLinks = async () => {
    const { data } = await supabase
      .from('affiliate_urls')
      .select('controller_name, url')
      .order('controller_name')
    setLinks((data ?? []) as AffiliateRow[])
  }

  useEffect(() => {
    const init = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession()
      if (!session?.user) { router.push('/login'); return }

      const { data: me } = await supabase
        .from('profiles')
        .select('is_admin')
        .eq('id', session.user.id)
        .maybeSingle<{ is_admin: boolean | null }>()

      if (!me?.is_admin) {
        showToast('このページにアクセスする権限がありません', 'error')
        router.push('/menu')
        return
      }

      setAuthorized(true)
      await fetchLinks()
      setLoading(false)
    }
    void Promise.resolve().then(init)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleSave = async () => {
    if (!selectedController || !urlInput.trim()) {
      showToast('コントローラーとURLを入力してください', 'error')
      return
    }
    setSaving(true)
    const { error } = await supabase
      .from('affiliate_urls')
      .upsert({ controller_name: selectedController, url: urlInput.trim(), updated_at: new Date().toISOString() }, { onConflict: 'controller_name' })
    setSaving(false)

    if (error) {
      showToast(error.message || '保存に失敗しました', 'error')
      return
    }
    showToast('保存しました', 'success')
    setSelectedController('')
    setUrlInput('')
    await fetchLinks()
  }

  const handleDelete = async (name: string) => {
    if (!confirm(`${name} のリンクを削除しますか？`)) return
    await supabase.from('affiliate_urls').delete().eq('controller_name', name)
    showToast('削除しました', 'success')
    await fetchLinks()
  }

  if (loading || !authorized) {
    return (
      <main>
        <h1>購入リンク管理</h1>
        <LoadingCard message="読み込み中..." />
      </main>
    )
  }

  return (
    <main>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div>
          <h1>購入リンク管理</h1>
          <p className="muted">コントローラーのアフィリエイトリンクを管理</p>
        </div>
        <div className="row">
          <button onClick={() => router.push('/admin/dashboard')}>ダッシュボード</button>
          <button onClick={() => router.push('/menu')}>メニューへ戻る</button>
        </div>
      </div>

      <div className="section card-strong">
        <h2>リンク追加 / 更新</h2>
        <div className="card stack">
          <select value={selectedController} onChange={(e) => setSelectedController(e.target.value)}>
            <option value="">コントローラーを選択</option>
            {CONTROLLER_GROUPS.map((g) => (
              <optgroup key={g.manufacturer} label={g.manufacturer}>
                {g.options.map((opt) => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
              </optgroup>
            ))}
          </select>
          <input
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            placeholder="https://amazon.co.jp/dp/..."
          />
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button onClick={handleSave} disabled={saving}>
              {saving ? '保存中...' : '保存'}
            </button>
          </div>
        </div>
      </div>

      <div className="section card-strong">
        <h2>登録済みリンク（{links.length}件）</h2>
        {links.length === 0 ? (
          <EmptyCard title="まだリンクがありません" message="" />
        ) : (
          <div className="stack">
            {links.map((l) => (
              <div key={l.controller_name} className="card">
                <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <h3 style={{ marginTop: 0 }}>{l.controller_name}</h3>
                    <p className="muted" style={{ wordBreak: 'break-all' }}>{l.url}</p>
                  </div>
                  <div className="row">
                    <button onClick={() => { setSelectedController(l.controller_name); setUrlInput(l.url) }}>
                      編集
                    </button>
                    <button onClick={() => handleDelete(l.controller_name)}>
                      削除
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  )
}
