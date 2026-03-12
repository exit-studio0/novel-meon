import React, { useState } from 'react';
import {
  ChevronLeft,
  UserCircle,
  Settings2,
  Mail,
  Bell,
  HardDrive
} from 'lucide-react';

interface SettingsModalProps {
  onClose: () => void;
  user?: any;
  onRecoverFiles: () => void;
}

export const SettingsModal = ({ onClose, user, onRecoverFiles }: SettingsModalProps) => {
  const [activeTab, setActiveTab] = useState('account');
  const [recoverStatus, setRecoverStatus] = useState<string>('');

  const handleRecover = () => {
    onRecoverFiles();
    setRecoverStatus('已尝试恢复孤立文件');
    setTimeout(() => setRecoverStatus(''), 3000);
  };

  // 侧边栏菜单项
  const menuItems = [
    { id: 'account', label: '帐户', icon: UserCircle },
    { id: 'api', label: 'API 设置', icon: Settings2 },
    { id: 'system', label: '系统', icon: HardDrive },
    { id: 'assistant', label: '助手', icon: Mail },
    { id: 'notifications', label: '通知', icon: Bell },
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
                  <div className="p-8 border border-dashed border-neutral-800 rounded-xl text-center bg-neutral-900/30">
                    <p className="text-sm text-neutral-500">API 配置功能开发中...</p>
                  </div>
                </section>
              )}

              {activeTab === 'system' && (
                <section className="animate-in fade-in slide-in-from-bottom-2 duration-300">
                  <div>
                    <h3 className="text-sm font-semibold text-neutral-200 mb-4">数据恢复</h3>
                    <div className="bg-neutral-900/50 rounded-xl border border-neutral-800 p-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="text-sm font-medium text-neutral-300">恢复孤立文件</div>
                          <div className="text-xs text-neutral-500 mt-1">
                            尝试从浏览器缓存中找回未正常保存或丢失关联的文件片段，并将其放入"恢复的文件"文件夹。
                          </div>
                        </div>
                        <button
                          onClick={handleRecover}
                          className="px-3 py-1.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 text-xs font-medium rounded-md transition-colors border border-neutral-700"
                        >
                          开始扫描
                        </button>
                      </div>
                      {recoverStatus && (
                        <div className="mt-3 text-xs text-green-500 flex items-center gap-1 animate-in fade-in slide-in-from-top-1">
                          ✓ {recoverStatus}
                        </div>
                      )}
                    </div>
                  </div>
                </section>
              )}

              {/* 其余标签页的内容占位 */}
              {['assistant', 'notifications'].includes(activeTab) && (
                <section className="animate-in fade-in slide-in-from-bottom-2 duration-300">
                  <div className="text-sm text-neutral-500">正在加载 {menuItems.find(i => i.id === activeTab)?.label} 配置...</div>
                </section>
              )}
            </div>
          </div>
        </main>
      </div>
    </div>
  );
};
