import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

type CookieItem = { name: string; value: string }

function getExpectedSupabaseCookieBaseName() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!url) return null

  try {
    const host = new URL(url).hostname
    const projectRef = host.split('.')[0]
    if (!projectRef) return null
    return `sb-${projectRef}-auth-token`
  } catch {
    return null
  }
}

function withSupabaseCookieAlias(cookies: CookieItem[]) {
  const expectedBase = getExpectedSupabaseCookieBaseName()
  if (!expectedBase) return cookies

  const hasExpected = cookies.some(
    (cookie) => cookie.name === expectedBase || cookie.name.startsWith(`${expectedBase}.`)
  )
  if (hasExpected) return cookies

  const fallbackBase = cookies.find((cookie) =>
    /^sb-.+-auth-token$/.test(cookie.name)
  )
  if (!fallbackBase) return cookies

  const aliasCookies: CookieItem[] = [{ name: expectedBase, value: fallbackBase.value }]
  const fallbackPrefix = `${fallbackBase.name}.`
  const chunkAliases = cookies
    .filter((cookie) => cookie.name.startsWith(fallbackPrefix))
    .map((cookie) => ({
      name: cookie.name.replace(fallbackBase.name, expectedBase),
      value: cookie.value,
    }))

  return [...cookies, ...aliasCookies, ...chunkAliases]
}

export async function createClient() {
  const cookieStore = await cookies()

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return withSupabaseCookieAlias(cookieStore.getAll())
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
