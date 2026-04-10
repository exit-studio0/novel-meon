import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

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

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return withSupabaseCookieAlias(request.cookies.getAll())
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => request.cookies.set(name, value))
          
          supabaseResponse = NextResponse.next({
            request,
          })
          
          cookiesToSet.forEach(({ name, value, options }) => {
            supabaseResponse.cookies.set(name, value, {
              ...options,
              domain: process.env.NODE_ENV === 'production' ? '.meonai.art' : undefined,
            })
          })
        },
      },
    }
  )

  // 刷新 Session
  // 即使不需要用户信息，调用 getUser 也会确保存储在 Cookie 中的 Session 是最新的
  const { data: { user } } = await supabase.auth.getUser()

  // 如果没有登录，且当前页面不是公开页面，可以在这里做重定向
  // 但我们的逻辑是在 page.tsx 里做重定向，这里只负责刷新 Session
  
  return supabaseResponse
}
