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
    .maybeSingle()

  if (error) {
    console.error('Failed to fetch user settings:', error.message)
    return null;
  }

  // 3. 如果用户已登录但没有 settings 数据，返回一个默认结构
  // 避免因为 settings 表为空而导致一直重定向
  if (!data) {
    console.warn('[settings] User authenticated but no settings found. Returning default.');
    return {
        user_id: user.id,
        email: user.email,
        user_metadata: user.user_metadata,
        registry_config: {
            providers: [],
            models: [],
            activeModels: { chat: '', image: '', video: '' }
        },
        jimeng_config: {}
    };
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
