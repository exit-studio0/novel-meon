import { createClient } from '@/utils/supabase/server'
import type { UserSettingsRow } from '@/types/settings'

export async function getUserSettings(): Promise<UserSettingsRow | null> {
  const supabase = await createClient()

  // 1. 获取当前用户信息 (自动携带主站的 Cookie)
  const { data: { user }, error: authError } = await supabase.auth.getUser()

  if (authError || !user) {
    console.warn('[settings] User not authenticated via shared cookie.', {
      error: authError?.message,
      code: authError?.status,
      cause: authError?.cause
    })
    return null;
  }

  console.log('[settings] Successfully authenticated user:', user.id)

  // 2. 利用 RLS 机制安全读取专属数据
  const { data, error } = await supabase
    .from('user_settings')
    .select('registry_config, jimeng_config')
    .eq('user_id', user.id)
    .single()

  if (error) {
    console.error('Failed to fetch user settings:', error.message)
    return null;
  }

  // 3. 返回强类型数据
  return {
    user_id: user.id,
    email: user.email,
    user_metadata: user.user_metadata,
    registry_config: data.registry_config as UserSettingsRow['registry_config'],
    jimeng_config: data.jimeng_config as UserSettingsRow['jimeng_config']
  }
}
