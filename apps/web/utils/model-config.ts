import type { ChatModelDefinition, MeonRegistryConfig } from "@/types/meon-config";

/** 
 * 获取当前激活的文字模型配置 
 * @param config 从数据库 user_settings 表读出的 registry_config 
 * @param overrideModelId (可选) 强制指定要使用的模型 ID，用于临时覆盖默认配置
 */ 
export function getActiveChatModelConfig(config: MeonRegistryConfig, overrideModelId?: string) { 
  // 1. 找到当前激活的模型 ID 
  const activeModelId = overrideModelId || config.activeModels?.chat; 
   
  if (!activeModelId) return null;

  // 2. 在模型列表中找到该模型 
  const model = config.models.find((m: any) => m.id === activeModelId && m.type === 'chat') as ChatModelDefinition | undefined; 
  if (!model) return null; 
   
  // 3. 找到对应的提供商 
  const provider = config.providers.find(p => p.id === model.providerId); 
  if (!provider) return null; 
   
  // 4. 计算最终的 API Key (模型专属 Key > 提供商 Key) 
  const finalApiKey = model.apiKey || provider.apiKey; 
   
  // 5. 计算最终的 Base URL 
  const finalBaseUrl = model.endpoint || provider.baseUrl; 
   
  return { 
    modelName: model.apiModel || model.id, // 实际传给 API 的模型名 
    apiKey: finalApiKey, 
    baseUrl: finalBaseUrl, 
    params: model.params 
  }; 
}
