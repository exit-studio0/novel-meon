import { createClient } from '@/utils/supabase/server'
import type { UserSettingsRow } from '@/types/settings'
import { cookies, headers } from 'next/headers'

export type UserSettingsAuthResult = {
  settings: UserSettingsRow | null
  reason?: string
  detail?: string
}

export async function getUserSettings(): Promise<UserSettingsRow | null> {
  const result = await getUserSettingsWithReason()
  return result.settings
}

export async function getUserSettingsWithReason(): Promise<UserSettingsAuthResult> {
  let cookieDebug = ''
  if (process.env.NODE_ENV !== 'production') {
    const cookieStore = await cookies()
    const headerStore = await headers()
    const host = headerStore.get('host') ?? 'unknown-host'
    const cookieNames = cookieStore.getAll().map((c) => c.name)
    const supabaseCookieNames = cookieNames.filter((name) => name.startsWith('sb-'))
    cookieDebug = `host=${host}; totalCookies=${cookieNames.length}; supabaseCookies=${supabaseCookieNames.join(',') || 'none'}`
  }

  const supabase = await createClient()

  // 1. 获取当前用户信息 (自动携带主站的 Cookie)
  const { data: { user }, error: authError } = await supabase.auth.getUser()

  if (authError) {
    console.warn('[settings] User not authenticated via shared cookie.', {
      error: authError?.message,
      code: authError?.status,
      cause: authError?.cause
    })
    return {
      settings: null,
      reason: '鉴权失败：无法读取当前登录态',
      detail: `${authError.message} (status: ${authError.status ?? 'unknown'})${cookieDebug ? `; ${cookieDebug}` : ''}`,
    }
  }

  if (!user) {
    return {
      settings: null,
      reason: '未检测到登录用户',
      detail: `通常是跨子域 Cookie 未带上，或主站登录态尚未同步到 novel 子域。${cookieDebug ? ` ${cookieDebug}` : ''}`,
    }
  }

  console.log('[settings] Successfully authenticated user:', user.id)

  // 2. 利用 RLS 机制安全读取专属数据
  const { data, error } = await supabase
    .from('user_settings')
    .select('registry_config, jimeng_config')
    .eq('user_id', user.id)
    .maybeSingle()

  if (error) {
    console.error('Failed to fetch user settings:', error.message)
    return {
      settings: null,
      reason: '已登录，但读取用户配置失败',
      detail: error.message,
    }
  }

  // 3. 如果用户已登录但没有 settings 数据，返回一个默认结构
  // 避免因为 settings 表为空而导致一直重定向
  if (!data) {
    console.warn('[settings] User authenticated but no settings found. Returning default.');
    return {
      settings: {
        user_id: user.id,
        email: user.email,
        user_metadata: user.user_metadata,
        registry_config: {
            providers: [],
            models: [],
            activeModels: { chat: '', image: '', video: '' }
        },
        jimeng_config: {}
      },
    }
  }

  // 3. 返回强类型数据
  return {
    settings: {
      user_id: user.id,
      email: user.email,
      user_metadata: user.user_metadata,
      registry_config: data.registry_config as UserSettingsRow['registry_config'],
      jimeng_config: data.jimeng_config as UserSettingsRow['jimeng_config']
    },
  }
}
