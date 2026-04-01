import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Deno runtime is used for Supabase Edge Functions. In the Next.js/TypeScript
// workspace the global `Deno` symbol may not be present during static type
// checking. Declare it here to avoid TS errors when this file is excluded from
// the main TS build (we also updated tsconfig.json to exclude this folder).
declare const Deno: any

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

Deno.serve(async (req: any) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    let authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Missing Authorization header' }),
        {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      )
    }
    // Normalize Authorization header: allow both "Bearer <token>" and raw token
    if (!/^Bearer\s+/i.test(authHeader)) {
      authHeader = `Bearer ${authHeader}`
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')
    if (!supabaseUrl || !supabaseAnonKey) {
      return new Response(
        JSON.stringify({ error: 'Server misconfiguration' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const supabaseUser = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    })

    const {
      data: { user },
      error: authError,
    } = await supabaseUser.auth.getUser()

    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      )
    }

    const body = await req.json().catch(() => ({}))
    const teamId = body.teamId as string | undefined

    if (!teamId) {
      return new Response(
        JSON.stringify({ error: 'teamId is required' }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      )
    }

    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if (!serviceRoleKey) {
      return new Response(
        JSON.stringify({ error: 'Server misconfiguration' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const supabaseAdmin = createClient(Deno.env.get('SUPABASE_URL')!, serviceRoleKey)

    const { data: appUser, error: appUserError } = await supabaseAdmin
      .from('users')
      .select('id')
      .eq('auth_user_id', user.id)
      .single()

    if (appUserError || !appUser) {
      return new Response(
        JSON.stringify({ error: 'App user not found' }),
        {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      )
    }

    const { data: membership, error: membershipError } = await supabaseAdmin
      .from('team_members')
      .select('team_id')
      .eq('user_id', appUser.id)
      .eq('team_id', teamId)
      .maybeSingle()

    if (membershipError || !membership) {
      return new Response(
        JSON.stringify({ error: 'Not allowed to leave this queue' }),
        {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      )
    }

    const { error: deleteError } = await supabaseAdmin
      .from('match_queue')
      .delete()
      .eq('team_id', teamId)

    if (deleteError) {
      return new Response(
        JSON.stringify({ error: deleteError.message }),
        {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      )
    }

    return new Response(
      JSON.stringify({ success: true, teamId }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    )
  } catch (error) {
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    )
  }
})