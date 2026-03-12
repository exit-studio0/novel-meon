import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export async function createClient() {
  const cookieStore = await cookies()

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, {
                ...options,
                // 关键点：保持与主站完全一致的 domain 策略
                domain: process.env.NODE_ENV === 'production' ? '.meonai.art' : undefined,
              })
            })
          } catch (error) {
            // Next.js 中如果在 Server Component 渲染期间尝试设置 Cookie 会报错，这里 catch 掉即可
          }
        },
      },
    }
  )
}
