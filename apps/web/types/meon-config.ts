// ==========================================
// Meon 文字模型配置类型定义 (子站专用)
// ==========================================

export type ModelType = 'chat'; // 子站只关心 chat

/**
* 1. 提供商配置
* 包含 API Base URL 和 默认 Key
*/
export interface ModelProvider {
  id: string;          // 例如: "openai", "deepseek"
  name: string;        // 显示名称
  baseUrl: string;     // API 请求地址
  apiKey?: string;     // 用户填写的 API Key
  isBuiltIn: boolean;
}

/**
* 2. 文字模型参数
*/
export interface ChatModelParams {
  temperature: number;       // 随机性 (0-2)
  maxTokens?: number;        // 最大输出长度
  topP?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  reasoningEffort?: 'low' | 'medium' | 'high'; // o1/o3 模型专用
}

/**
* 3. 文字模型定义
*/
export interface ChatModelDefinition {
  id: string;            // 内部唯一 ID (例如 "gpt-4o")
  apiModel?: string;     // 实际传给 API 的 model 参数 (例如 "gpt-4o-2024-08-06")
  name: string;          // 显示名称
  type: 'chat';
  providerId: string;    // 关联的提供商 ID
  isEnabled: boolean;    // 是否在列表中显示
  apiKey?: string;       // 模型专属 Key (优先级高于 Provider Key)
  endpoint?: string;     // 模型专属 Endpoint (极少用到，通常用 Provider 的)
  params: ChatModelParams;
}

/**
* 4. 完整的注册中心配置结构
* 对应数据库 user_settings 表的 registry_config 字段
*/
export interface MeonRegistryConfig {
  providers: ModelProvider[];
  models: (ChatModelDefinition | any)[]; // 数组里可能混有 image/video 模型，取出来后需 filter
  activeModels: {
    chat: string; // 当前激活的文字模型 ID
  };
}
