'use client'

import { useEffect } from 'react'
import { supabase } from '@/lib/supabase'

export function usePageView(pagePath: string) {
  useEffect(() => {
    void (async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession()
      await supabase.from('page_views').insert({
        page_path: pagePath,
        user_id: session?.user?.id ?? null,
      })
    })()
  }, [pagePath])
}
