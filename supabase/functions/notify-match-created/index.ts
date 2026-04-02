// supabase/functions/notify-match-created/index.ts
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

type MatchRow = {
  id: string
  team1_id: string
  team2_id: string
  discord_notified_at: string | null
}

type TeamRow = {
  id: string
  name: string
}

type TeamMemberRow = {
  team_id: string
  user_id: string
  role: string
}

type UserRow = {
  id: string
  display_name: string | null
  discord_name: string | null
}

serve(async (req) => {
  try {
    if (req.method !== 'POST') {
      return new Response(
        JSON.stringify({ error: 'Method not allowed' }),
        {
          status: 405,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    }

    const webhookUrl = Deno.env.get('DISCORD_MATCH_WEBHOOK_URL')
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

    if (!webhookUrl) {
      return new Response(
        JSON.stringify({ error: 'Missing DISCORD_MATCH_WEBHOOK_URL secret' }),
        {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    }

    if (!supabaseUrl || !serviceRoleKey) {
      return new Response(
        JSON.stringify({ error: 'Missing Supabase environment variables' }),
        {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey)

    const body = await req.json().catch(() => null)
    const matchId = body?.matchId as string | undefined

    if (!matchId) {
      return new Response(
        JSON.stringify({ error: 'matchId is required' }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    }

    const { data: match, error: matchError } = await supabase
      .from('matches')
      .select('id, team1_id, team2_id, discord_notified_at')
      .eq('id', matchId)
      .single<MatchRow>()

    if (matchError || !match) {
      return new Response(
        JSON.stringify({
          error: 'Match not found',
          details: matchError?.message ?? null,
        }),
        {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    }

    if (match.discord_notified_at) {
      return new Response(
        JSON.stringify({
          success: true,
          skipped: true,
          reason: 'already_notified',
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    }

    const teamIds = [match.team1_id, match.team2_id]

    const { data: teams, error: teamsError } = await supabase
      .from('teams')
      .select('id, name')
      .in('id', teamIds)

    if (teamsError || !teams || teams.length !== 2) {
      return new Response(
        JSON.stringify({
          error: 'Failed to load teams',
          details: teamsError?.message ?? null,
        }),
        {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    }

    const team1 = teams.find((t) => t.id === match.team1_id) as TeamRow | undefined
    const team2 = teams.find((t) => t.id === match.team2_id) as TeamRow | undefined

    if (!team1 || !team2) {
      return new Response(
        JSON.stringify({ error: 'Team lookup failed' }),
        {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    }

    const { data: ownerMembers, error: ownerMembersError } = await supabase
      .from('team_members')
      .select('team_id, user_id, role')
      .in('team_id', teamIds)
      .eq('role', 'owner')

    if (ownerMembersError || !ownerMembers || ownerMembers.length < 2) {
      return new Response(
        JSON.stringify({
          error: 'Failed to load team owners',
          details: ownerMembersError?.message ?? null,
        }),
        {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    }

    const team1OwnerMember = ownerMembers.find(
      (m) => m.team_id === team1.id
    ) as TeamMemberRow | undefined

    const team2OwnerMember = ownerMembers.find(
      (m) => m.team_id === team2.id
    ) as TeamMemberRow | undefined

    if (!team1OwnerMember || !team2OwnerMember) {
      return new Response(
        JSON.stringify({ error: 'Owner member lookup failed' }),
        {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    }

    const ownerUserIds = [team1OwnerMember.user_id, team2OwnerMember.user_id]

    const { data: ownerUsers, error: ownerUsersError } = await supabase
      .from('users')
      .select('id, display_name, discord_name')
      .in('id', ownerUserIds)

    if (ownerUsersError || !ownerUsers || ownerUsers.length < 2) {
      return new Response(
        JSON.stringify({
          error: 'Failed to load owner users',
          details: ownerUsersError?.message ?? null,
        }),
        {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    }

    const team1OwnerUser = ownerUsers.find(
      (u) => u.id === team1OwnerMember.user_id
    ) as UserRow | undefined

    const team2OwnerUser = ownerUsers.find(
      (u) => u.id === team2OwnerMember.user_id
    ) as UserRow | undefined

    if (!team1OwnerUser || !team2OwnerUser) {
      return new Response(
        JSON.stringify({ error: 'Owner user lookup failed' }),
        {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    }

    const team1OwnerDiscordName =
      team1OwnerUser.discord_name ||
      team1OwnerUser.display_name ||
      '未設定'

    const team2OwnerDiscordName =
      team2OwnerUser.discord_name ||
      team2OwnerUser.display_name ||
      '未設定'

    const payload = {
      content: '新しいマッチが成立しました',
      embeds: [
        {
          title: 'マッチ成立',
          description: `${team1.name} vs ${team2.name}`,
          fields: [
            {
              name: 'チーム1',
              value: team1.name,
              inline: false,
            },
            {
              name: 'チーム1 owner のDiscord名',
              value: team1OwnerDiscordName,
              inline: false,
            },
            {
              name: 'チーム2',
              value: team2.name,
              inline: false,
            },
            {
              name: 'チーム2 owner のDiscord名',
              value: team2OwnerDiscordName,
              inline: false,
            },
            {
              name: 'Match ID',
              value: match.id,
              inline: false,
            },
          ],
        },
      ],
    }

    const discordRes = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })

    if (!discordRes.ok) {
      const discordText = await discordRes.text()
      return new Response(
        JSON.stringify({
          error: 'Discord webhook failed',
          details: discordText,
        }),
        {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    }

    const { error: updateError } = await supabase
      .from('matches')
      .update({
        discord_notified_at: new Date().toISOString(),
      })
      .eq('id', match.id)
      .is('discord_notified_at', null)

    if (updateError) {
      return new Response(
        JSON.stringify({
          error: 'Notification sent but failed to save discord_notified_at',
          details: updateError.message,
        }),
        {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    }

    return new Response(
      JSON.stringify({
        success: true,
        matchId: match.id,
        team1: team1.name,
        team2: team2.name,
        team1OwnerDiscordName,
        team2OwnerDiscordName,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    )
  } catch (error) {
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    )
  }
})