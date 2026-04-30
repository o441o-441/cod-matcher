import { supabase } from './supabase'
import { getFingerprint } from './fingerprint'
import { discordSnowflakeToDate } from './discord-snowflake'

export async function runSecurityChecks(): Promise<void> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) return

  const identities = session.user.identities ?? []
  const discordIdentity = identities.find(i => i.provider === 'discord')
  const discordUserId =
    discordIdentity?.identity_data?.provider_id ??
    discordIdentity?.identity_data?.user_id ??
    session.user.user_metadata?.provider_id ??
    session.user.user_metadata?.sub

  const discordCreatedAt = discordUserId
    ? discordSnowflakeToDate(String(discordUserId))?.toISOString() ?? null
    : null

  const fingerprintHash = await getFingerprint()

  await fetch('/api/security/log', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({
      fingerprint_hash: fingerprintHash,
      discord_created_at: discordCreatedAt,
    }),
  })
}
