'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/components/ToastProvider'

export default function ScrimQueuePage() {
  const router = useRouter()
  const { showToast } = useToast()
  const [myUserId, setMyUserId] = useState<string | null>(null)
  const [myPartyId, setMyPartyId] = useState<string | null>(null)
  const [partyMembers, setPartyMembers] = useState<{ display_name: string; peak_rating: number }[]>([])
  const [queuing, setQueuing] = useState(false)
  const [queueEntryId, setQueueEntryId] = useState<string | null>(null)
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    const load = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.user) { router.push('/login'); return }
      setMyUserId(session.user.id)

      const { data: pm } = await supabase.from('party_members').select('party_id').eq('user_id', session.user.id).maybeSingle()
      if (!pm?.party_id) return

      const { data: party } = await supabase.from('parties').select('id, status').eq('id', pm.party_id).maybeSingle()
      if (!party) return
      setMyPartyId(party.id)

      // Check if already in scrim queue
      const { data: qe } = await supabase.from('queue_entries').select('id, status').eq('party_id', party.id).eq('queue_type', 'scrim').eq('status', 'waiting').maybeSingle()
      if (qe) { setQueueEntryId(qe.id); setQueuing(true) }

      // Check if already matched to a scrim
      const { data: scrim } = await supabase.from('scrim_sessions')
        .select('id').or(`alpha_party_id.eq.${party.id},bravo_party_id.eq.${party.id}`)
        .in('status', ['lobby', 'end_requested']).maybeSingle()
      if (scrim) { router.push(`/custom/scrim/${scrim.id}`); return }

      // Get members
      const { data: members } = await supabase.from('party_members').select('user_id').eq('party_id', party.id)
      const uids = ((members ?? []) as { user_id: string }[]).map(m => m.user_id)
      if (uids.length > 0) {
        const { data: profiles } = await supabase.from('profiles').select('display_name, peak_rating').in('id', uids)
        setPartyMembers((profiles ?? []).map((p: { display_name: string | null; peak_rating: number | null }) => ({
          display_name: p.display_name ?? '不明', peak_rating: p.peak_rating ?? 1500,
        })))
      }
    }
    void load()
  }, [router])

  // Queue timer
  useEffect(() => {
    if (!queuing) { setElapsed(0); return }
    const iv = setInterval(() => setElapsed(e => e + 1), 1000)
    return () => clearInterval(iv)
  }, [queuing])

  // Poll for match
  useEffect(() => {
    if (!queuing || !myPartyId) return
    const iv = setInterval(async () => {
      // Try to create match
      await supabase.rpc('rpc_scrim_create_match')
      // Check if matched
      const { data: scrim } = await supabase.from('scrim_sessions')
        .select('id').or(`alpha_party_id.eq.${myPartyId},bravo_party_id.eq.${myPartyId}`)
        .in('status', ['lobby', 'end_requested']).maybeSingle()
      if (scrim) { router.push(`/custom/scrim/${scrim.id}`) }
    }, 5000)
    return () => clearInterval(iv)
  }, [queuing, myPartyId, router])

  const startQueue = async () => {
    if (!myPartyId) { showToast('パーティに参加してください', 'error'); return }
    if (partyMembers.length < 4) { showToast('4人パーティが必要です', 'error'); return }

    const avgPeak = Math.round(partyMembers.reduce((s, m) => s + m.peak_rating, 0) / partyMembers.length)

    const { data, error } = await supabase.from('queue_entries').insert({
      party_id: myPartyId, queue_type: 'scrim', status: 'waiting',
      party_size: partyMembers.length, avg_rating: avgPeak,
      min_rating: Math.min(...partyMembers.map(m => m.peak_rating)),
      max_rating: Math.max(...partyMembers.map(m => m.peak_rating)),
      party_size_bonus: 0, wait_expand_level: 0,
    }).select('id').single()

    if (error) { showToast(error.message, 'error'); return }
    setQueueEntryId((data as { id: string }).id)
    setQueuing(true)
    await supabase.from('parties').update({ status: 'queued' }).eq('id', myPartyId)
  }

  const cancelQueue = async () => {
    if (queueEntryId) {
      await supabase.from('queue_entries').update({ status: 'cancelled', cancelled_at: new Date().toISOString() }).eq('id', queueEntryId)
    }
    if (myPartyId) await supabase.from('parties').update({ status: 'open' }).eq('id', myPartyId)
    setQueuing(false)
    setQueueEntryId(null)
  }

  const avgPeak = partyMembers.length > 0 ? Math.round(partyMembers.reduce((s, m) => s + m.peak_rating, 0) / partyMembers.length) : 0
  const mm = Math.floor(elapsed / 60)
  const ss = elapsed % 60

  return (
    <main>
      <div className="eyebrow">CUSTOM / SCRIM</div>
      <h1 className="display" style={{ fontSize: 'clamp(1.5rem, 3vw, 2.2rem)', marginTop: 6 }}>
        <em>Scrim キュー</em>
      </h1>
      <button className="btn-ghost" style={{ marginTop: 8 }} onClick={() => router.push('/custom')}>← カスタムに戻る</button>

      <div className="section card-strong">
        <h2 style={{ marginTop: 0 }}>パーティ</h2>
        {partyMembers.length === 0 ? (
          <p className="muted">パーティに参加していません。マッチページからパーティを作成してください。</p>
        ) : (
          <>
            <div className="stack" style={{ gap: 8 }}>
              {partyMembers.map((m, i) => (
                <div key={i} className="card" style={{ padding: '10px 14px' }}>
                  <div className="row" style={{ justifyContent: 'space-between' }}>
                    <span style={{ fontWeight: 700 }}>{m.display_name}</span>
                    <span className="mono" style={{ fontSize: 12, color: 'var(--cyan)' }}>PEAK {m.peak_rating}</span>
                  </div>
                </div>
              ))}
            </div>
            <div className="div" />
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <div>
                <span className="stat-label">PEAK平均</span>
                <div className="mono" style={{ fontSize: 20, fontWeight: 800 }}>{avgPeak}</div>
              </div>
              {!queuing ? (
                <button className="btn-primary" onClick={startQueue} disabled={partyMembers.length < 4}>
                  {partyMembers.length < 4 ? '4人必要です' : 'Scrim キュー開始'}
                </button>
              ) : (
                <div className="row" style={{ gap: 12 }}>
                  <div style={{ textAlign: 'center' }}>
                    <div className="stat-label">待機時間</div>
                    <div className="mono" style={{ fontSize: 18, fontWeight: 700, color: 'var(--cyan)' }}>
                      {mm}:{ss.toString().padStart(2, '0')}
                    </div>
                  </div>
                  <button className="btn-danger btn-sm" onClick={cancelQueue}>キャンセル</button>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {queuing && (
        <div className="section card" style={{ textAlign: 'center', padding: 24 }}>
          <div className="pulse" style={{ width: 12, height: 12, borderRadius: '50%', background: 'var(--cyan)', margin: '0 auto 12px', boxShadow: '0 0 20px var(--cyan)' }} />
          <p style={{ fontWeight: 700 }}>マッチング中...</p>
          <p className="muted" style={{ fontSize: 12 }}>PEAK平均が近いパーティを検索しています</p>
        </div>
      )}
    </main>
  )
}
