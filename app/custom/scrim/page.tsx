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
  const [partyMembers, setPartyMembers] = useState<{ user_id: string; display_name: string; peak_rating: number }[]>([])
  const [queuing, setQueuing] = useState(false)
  const [queueEntryId, setQueueEntryId] = useState<string | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const [busy, setBusy] = useState(false)
  // Party creation
  const [friendSearch, setFriendSearch] = useState('')
  const [searchResult, setSearchResult] = useState<{ id: string; display_name: string; peak_rating: number } | null>(null)

  useEffect(() => {
    const load = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.user) { router.push('/login'); return }
      const uid = session.user.id
      setMyUserId(uid)

      const { data: pm } = await supabase.from('party_members').select('party_id').eq('user_id', uid).maybeSingle()
      const partyId = (pm as { party_id: string } | null)?.party_id ?? null
      setMyPartyId(partyId)

      if (partyId) {
        // Check if already matched to a scrim
        const { data: scrim } = await supabase.from('scrim_sessions')
          .select('id').or(`alpha_party_id.eq.${partyId},bravo_party_id.eq.${partyId}`)
          .in('status', ['lobby', 'end_requested']).maybeSingle()
        if (scrim) { router.push(`/custom/scrim/${(scrim as { id: string }).id}`); return }

        // Check if already in scrim queue
        const { data: qe } = await supabase.from('queue_entries').select('id, status').eq('party_id', partyId).eq('queue_type', 'scrim').eq('status', 'waiting').maybeSingle()
        if (qe) { setQueueEntryId((qe as { id: string }).id); setQueuing(true) }

        await loadPartyMembers(partyId)
      }
    }
    void load()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router])

  const loadPartyMembers = async (partyId: string) => {
    const { data: members } = await supabase.from('party_members').select('user_id').eq('party_id', partyId)
    const uids = ((members ?? []) as { user_id: string }[]).map(m => m.user_id)
    if (uids.length > 0) {
      const { data: profiles } = await supabase.from('profiles').select('id, display_name, peak_rating').in('id', uids)
      setPartyMembers((profiles ?? []).map((p: { id: string; display_name: string | null; peak_rating: number | null }) => ({
        user_id: p.id, display_name: p.display_name ?? '不明', peak_rating: p.peak_rating ?? 1500,
      })))
    }
  }

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
      await supabase.rpc('rpc_scrim_create_match')
      const { data: scrim } = await supabase.from('scrim_sessions')
        .select('id').or(`alpha_party_id.eq.${myPartyId},bravo_party_id.eq.${myPartyId}`)
        .in('status', ['lobby', 'end_requested']).maybeSingle()
      if (scrim) { router.push(`/custom/scrim/${(scrim as { id: string }).id}`) }
    }, 5000)
    return () => clearInterval(iv)
  }, [queuing, myPartyId, router])

  const createParty = async () => {
    setBusy(true)
    const { data, error } = await supabase.rpc('rpc_create_party')
    setBusy(false)
    if (error) { showToast(error.message, 'error'); return }
    const pid = (data as { id?: string })?.id
    // Reload to get party
    window.location.reload()
  }

  const searchFriend = async () => {
    if (!friendSearch.trim()) return
    const { data } = await supabase.from('profiles').select('id, display_name, peak_rating').eq('display_name', friendSearch.trim()).maybeSingle()
    if (data) setSearchResult(data as { id: string; display_name: string; peak_rating: number })
    else showToast('ユーザーが見つかりません', 'error')
  }

  const inviteMember = async (targetId: string) => {
    if (!myPartyId) return
    setBusy(true)
    const { error } = await supabase.rpc('rpc_invite_to_party', { p_party_id: myPartyId, p_invitee_user_id: targetId })
    setBusy(false)
    if (error) showToast(error.message, 'error')
    else { showToast('招待を送りました', 'success'); setSearchResult(null); setFriendSearch('') }
  }

  const startQueue = async () => {
    if (!myPartyId) return
    const avgPeak = partyMembers.length > 0 ? Math.round(partyMembers.reduce((s, m) => s + m.peak_rating, 0) / partyMembers.length) : 1500
    setBusy(true)
    const { data, error } = await supabase.from('queue_entries').insert({
      party_id: myPartyId, queue_type: 'scrim', status: 'waiting',
      party_size: partyMembers.length, avg_rating: avgPeak,
      min_rating: partyMembers.length > 0 ? Math.min(...partyMembers.map(m => m.peak_rating)) : 1500,
      max_rating: partyMembers.length > 0 ? Math.max(...partyMembers.map(m => m.peak_rating)) : 1500,
      party_size_bonus: 0, wait_expand_level: 0,
    }).select('id').single()
    setBusy(false)
    if (error) { showToast(error.message, 'error'); return }
    setQueueEntryId((data as { id: string }).id)
    setQueuing(true)
    await supabase.from('parties').update({ status: 'queued' }).eq('id', myPartyId)
  }

  const cancelQueue = async () => {
    if (queueEntryId) await supabase.from('queue_entries').update({ status: 'cancelled', cancelled_at: new Date().toISOString() }).eq('id', queueEntryId)
    if (myPartyId) await supabase.from('parties').update({ status: 'open' }).eq('id', myPartyId)
    setQueuing(false); setQueueEntryId(null)
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
      <button type="button" className="btn-ghost" style={{ marginTop: 8 }} onClick={() => router.push('/custom')}>← カスタムに戻る</button>

      {/* No party: create one */}
      {!myPartyId && (
        <div className="section card-strong" style={{ textAlign: 'center', padding: 32 }}>
          <p style={{ fontWeight: 700 }}>パーティに参加していません</p>
          <p className="muted" style={{ fontSize: 12 }}>パーティを作成するか、ソロで助っ人としてキューに入れます</p>
          <div className="row" style={{ justifyContent: 'center', gap: 8, marginTop: 16 }}>
            <button className="btn-primary" onClick={createParty} disabled={busy}>パーティを作成</button>
          </div>
        </div>
      )}

      {/* Has party */}
      {myPartyId && (
        <>
          <div className="section card-strong">
            <div className="row" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
              <h2 style={{ margin: 0 }}>パーティ ({partyMembers.length}人)</h2>
              <span className="muted" style={{ fontSize: 12 }}>ソロ〜4人で参加可能</span>
            </div>
            <div className="stack" style={{ gap: 8 }}>
              {partyMembers.map(m => (
                <div key={m.user_id} className="card" style={{ padding: '10px 14px' }}>
                  <div className="row" style={{ justifyContent: 'space-between' }}>
                    <span style={{ fontWeight: 700 }}>{m.display_name}</span>
                    <span className="mono" style={{ fontSize: 12, color: 'var(--cyan)' }}>PEAK {m.peak_rating}</span>
                  </div>
                </div>
              ))}
            </div>

            {/* Invite member */}
            {partyMembers.length < 4 && !queuing && (
              <div style={{ marginTop: 12 }}>
                <div className="stat-label" style={{ marginBottom: 6 }}>メンバーを招待</div>
                <div className="row" style={{ gap: 8 }}>
                  <input value={friendSearch} onChange={e => setFriendSearch(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') void searchFriend() }}
                    placeholder="表示名を入力..." style={{ flex: 1 }} aria-label="招待するユーザーの表示名" />
                  <button className="btn-ghost btn-sm" onClick={() => void searchFriend()}>検索</button>
                </div>
                {searchResult && (
                  <div className="card" style={{ padding: '10px 14px', marginTop: 8 }}>
                    <div className="row" style={{ justifyContent: 'space-between' }}>
                      <div>
                        <span style={{ fontWeight: 700 }}>{searchResult.display_name}</span>
                        <span className="mono muted" style={{ fontSize: 11, marginLeft: 8 }}>PEAK {searchResult.peak_rating}</span>
                      </div>
                      <button className="btn-primary btn-sm" onClick={() => inviteMember(searchResult.id)} disabled={busy}>招待</button>
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="div" />
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <div>
                <span className="stat-label">PEAK平均</span>
                <div className="mono" style={{ fontSize: 20, fontWeight: 800 }}>{avgPeak}</div>
              </div>
              {!queuing ? (
                <button className="btn-primary" onClick={startQueue} disabled={busy}>
                  {partyMembers.length === 1 ? 'ソロで助っ人キュー開始' : 'Scrim キュー開始'}
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
          </div>

          {queuing && (
            <div className="section card" style={{ textAlign: 'center', padding: 24 }}>
              <div className="pulse" style={{ width: 12, height: 12, borderRadius: '50%', background: 'var(--magenta)', margin: '0 auto 12px', boxShadow: '0 0 20px var(--magenta)' }} />
              <p style={{ fontWeight: 700 }}>マッチング中...</p>
              <p className="muted" style={{ fontSize: 12 }}>
                {partyMembers.length < 4
                  ? `助っ人として参加 — ${partyMembers.length}人パーティでPEAK平均が近い相手を検索中`
                  : 'PEAK平均が近いパーティを検索しています'
                }
              </p>
            </div>
          )}
        </>
      )}
    </main>
  )
}
