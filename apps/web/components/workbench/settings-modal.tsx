import React, { useState, useEffect } from 'react';
import {
  ChevronLeft,
  UserCircle,
  Settings2,
  Mail,
  Bell,
  Trash2,
  RotateCcw,
  FileText,
  Eye
} from 'lucide-react';
import { findOrphanIds, type FsNode } from './workbench';

interface SettingsModalProps {
  onClose: () => void;
  user?: any;
  root?: FsNode;
  onRecover?: (id: string) => void;
  onDeleteOrphan?: (id: string) => void;
}

export const SettingsModal = ({ onClose, user, root, onRecover, onDeleteOrphan }: SettingsModalProps) => {
  const [activeTab, setActiveTab] = useState('account');
  const [orphanFiles, setOrphanFiles] = useState<string[]>([]);
  const [previewContent, setPreviewContent] = useState<string | null>(null);

  useEffect(() => {
    if (activeTab === 'recovery' && root) {
      setOrphanFiles(findOrphanIds(root));
    }
  }, [activeTab, root]);

  const handleRecover = (id: string) => {
    onRecover?.(id);
    setOrphanFiles(prev => prev.filter(fid => fid !== id));
  };

  const handleDelete = (id: string) => {
    if (confirm('确定要永久删除这个文件吗？此操作无法撤销。')) {
      onDeleteOrphan?.(id);
      setOrphanFiles(prev => prev.filter(fid => fid !== id));
      if (previewContent && id === previewContent.split(':')[0]) {
        setPreviewContent(null);
      }
    }
  };

  const handlePreview = (id: string) => {
    const key = `fs:${id}`;
    const markdown = window.localStorage.getItem(`${key}:markdown`) ?? "无内容";
    setPreviewContent(markdown);
  };

  // 侧边栏菜单项
  const menuItems = [
    { id: 'account', label: '帐户', icon: UserCircle },
    { id: 'api', label: 'API 设置', icon: Settings2 },
    { id: 'assistant', label: '助手', icon: Mail },
    { id: 'notifications', label: '通知', icon: Bell },
    { id: 'recovery', label: '文件恢复', icon: RotateCcw },
  ];

  return (
    // 深色模式背景 - Fixed positioning for modal overlay
    <div className="fixed inset-0 z-50 min-h-screen bg-[#0a0a0a] flex items-center justify-center p-4 md:p-8 font-sans text-neutral-200">
      {/* 主浮动容器 - 深色版 */}
      <div className="w-full max-w-5xl h-[85vh] bg-[#121212] rounded-xl shadow-[0_20px_50px_rgba(0,0,0,0.5)] border border-neutral-800 flex overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        
        {/* 侧边栏 - 较暗的背景以区分内容区 */}
        <nav className="w-64 border-r border-neutral-800 flex flex-col py-6 bg-[#181818]">
          {/* 返回首页按钮 */}
          <div className="px-4 mb-6">
            <button 
              onClick={onClose}
              className="flex items-center gap-2 text-neutral-400 hover:text-white transition-colors text-sm font-medium group"
            >
              <ChevronLeft size={16} className="group-hover:-translate-x-0.5 transition-transform" />
              <span>首页</span>
            </button>
          </div>

          <div className="px-3">
            <h2 className="px-3 py-2 text-xs font-semibold text-neutral-500 uppercase tracking-wider">帐户</h2>
            <div className="mt-1 space-y-0.5">
              {menuItems.map((item) => (
                <button
                  key={item.id}
                  onClick={() => setActiveTab(item.id)}
                  className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-all duration-200 ${
                    activeTab === item.id
                      ? 'bg-neutral-800 text-white font-medium shadow-sm'
                      : 'text-neutral-400 hover:bg-neutral-800/50 hover:text-neutral-200'
                  }`}
                >
                  <item.icon size={18} strokeWidth={activeTab === item.id ? 2 : 1.5} />
                  {item.label}
                </button>
              ))}
            </div>
          </div>
        </nav>

        {/* 主内容区 */}
        <main className="flex-1 flex flex-col bg-[#121212] overflow-y-auto">
          <div className="max-w-2xl mx-auto w-full px-8 py-10">
            
            {/* 标题 */}
            <div className="border-b border-neutral-800 pb-5 mb-8">
              <h1 className="text-xl font-semibold text-white tracking-tight">
                {menuItems.find(i => i.id === activeTab)?.label || '帐户'}
              </h1>
            </div>

            {/* 内容板块 */}
            <div className="space-y-12">
              
              {activeTab === 'account' && (
                <section className="animate-in fade-in slide-in-from-bottom-2 duration-300">
                  <div>
                    <div className="text-sm font-semibold text-neutral-200">用户名称</div>
                    <div className="text-xs text-neutral-500 mt-1.5 font-mono">
                      {user?.user_metadata?.full_name || user?.user_metadata?.name || user?.email?.split('@')[0] || 'User'}
                    </div>
                  </div>
                </section>
              )}

              {activeTab === 'api' && (
                <section className="animate-in fade-in slide-in-from-bottom-2 duration-300">
                  <div className="space-y-6">
                    <div className="rounded-xl border border-neutral-800 bg-neutral-900/30 p-6">
                      <div className="mb-4">
                        <h3 className="text-sm font-medium text-neutral-200">API 配置</h3>
                        <p className="text-xs text-neutral-500 mt-1">这些设置已从主站同步，如需修改请前往主站设置。</p>
                      </div>
                      
                      <div className="space-y-4">
                        {(user?.registry_config?.providers || []).map((provider: any) => (
                          <div key={provider.id} className="p-4 rounded-lg bg-neutral-900 border border-neutral-800">
                            <div className="flex items-center justify-between mb-3">
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-medium text-neutral-200">{provider.name}</span>
                                {provider.isBuiltIn && (
                                  <span className="px-1.5 py-0.5 rounded text-[10px] bg-blue-500/10 text-blue-400 font-medium border border-blue-500/20">
                                    内置
                                  </span>
                                )}
                              </div>
                              <span className="text-xs text-neutral-500 font-mono">{provider.id}</span>
                            </div>
                            
                            <div className="space-y-3">
                              <div>
                                <label className="block text-xs text-neutral-500 mb-1.5">Base URL</label>
                                <div className="px-3 py-2 rounded bg-neutral-950 border border-neutral-800 text-xs text-neutral-400 font-mono truncate select-all">
                                  {provider.baseUrl}
                                </div>
                              </div>
                              <div>
                                <label className="block text-xs text-neutral-500 mb-1.5">API Key</label>
                                <div className="px-3 py-2 rounded bg-neutral-950 border border-neutral-800 text-xs text-neutral-400 font-mono truncate">
                                  {provider.apiKey ? (
                                    <span className="flex items-center gap-1">
                                      sk-••••••••••••••••
                                      <span className="text-neutral-600 ml-1">(已配置)</span>
                                    </span>
                                  ) : (
                                    <span className="text-neutral-600 italic">未配置</span>
                                  )}
                                </div>
                              </div>
                            </div>
                          </div>
                        ))}

                        {(!user?.registry_config?.providers || user.registry_config.providers.length === 0) && (
                          <div className="text-center py-8 text-sm text-neutral-500">
                            暂无 API 提供商配置
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </section>
              )}

              {activeTab === 'recovery' && (
                <section className="animate-in fade-in slide-in-from-bottom-2 duration-300">
                  <div className="space-y-4">
                    <p className="text-sm text-neutral-400">
                      以下文件存在于本地缓存中，但未链接到当前项目的文件树。您可以恢复它们或永久删除。
                    </p>
                    
                    {orphanFiles.length === 0 ? (
                      <div className="p-8 border border-dashed border-neutral-800 rounded-xl text-center bg-neutral-900/30">
                        <p className="text-sm text-neutral-500">没有发现可恢复的文件。</p>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {orphanFiles.map(id => (
                          <div key={id} className="flex items-center justify-between p-3 rounded-lg border border-neutral-800 bg-neutral-900/50 hover:bg-neutral-900 transition-colors">
                            <div className="flex items-center gap-3 min-w-0">
                              <FileText size={18} className="text-neutral-500 shrink-0" />
                              <div className="flex flex-col min-w-0">
                                <span className="text-sm font-medium text-neutral-200 truncate">
                                  Recovered_{id.slice(0, 6)}
                                </span>
                                <span className="text-xs text-neutral-500 font-mono">{id}</span>
                              </div>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              <button
                                onClick={() => {
                                  const key = `fs:${id}`;
                                  const content = window.localStorage.getItem(`${key}:markdown`) ?? "无内容";
                                  setPreviewContent(content);
                                }}
                                className="p-2 rounded hover:bg-neutral-800 text-neutral-400 hover:text-white transition-colors"
                                title="预览"
                              >
                                <Eye size={16} />
                              </button>
                              <button
                                onClick={() => handleRecover(id)}
                                className="p-2 rounded hover:bg-blue-900/30 text-blue-400 hover:text-blue-300 transition-colors"
                                title="恢复"
                              >
                                <RotateCcw size={16} />
                              </button>
                              <button
                                onClick={() => handleDelete(id)}
                                className="p-2 rounded hover:bg-red-900/30 text-red-400 hover:text-red-300 transition-colors"
                                title="删除"
                              >
                                <Trash2 size={16} />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {previewContent !== null && (
                      <div className="mt-6 border-t border-neutral-800 pt-6">
                        <div className="flex items-center justify-between mb-2">
                          <h3 className="text-sm font-medium text-neutral-300">文件预览</h3>
                          <button 
                            onClick={() => setPreviewContent(null)}
                            className="text-xs text-neutral-500 hover:text-neutral-300"
                          >
                            关闭预览
                          </button>
                        </div>
                        <div className="p-4 rounded-lg bg-neutral-900 border border-neutral-800 text-sm font-mono text-neutral-400 whitespace-pre-wrap max-h-60 overflow-y-auto">
                          {previewContent || <span className="italic opacity-50">（空文件）</span>}
                        </div>
                      </div>
                    )}
                  </div>
                </section>
              )}
            </div>
          </div>
        </main>
      </div>
    </div>
  );
};
