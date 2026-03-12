export type ModelType = 'chat' | 'image' | 'video';

export interface ActiveModels {
  chat: string;
  image: string;
  video: string;
}

export interface ModelProvider {
  id: string;
  name: string;
  baseUrl: string;
  apiKey?: string;
  isBuiltIn: boolean;
  isDefault: boolean;
}

export interface ModelDefinition {
  id: string;
  apiModel?: string;
  name: string;
  type: ModelType;
  providerId: string;
  isEnabled: boolean;
  apiKey?: string;
  params: any;
}

export interface ModelRegistryState {
  providers: ModelProvider[];
  models: ModelDefinition[];
  activeModels: ActiveModels;
}

export interface JimengGlobalConfig {
  baseUrl?: string;
  sessionToken?: string;
}

// 组合后的完整表结构类型 (用于 Supabase 响应)
export interface UserSettingsRow {
  user_id: string;
  email?: string;
  user_metadata?: any;
  registry_config: ModelRegistryState;
  jimeng_config: JimengGlobalConfig;
}
