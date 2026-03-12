"use client";

import { cn } from "@/lib/utils";
import TailwindAdvancedEditor from "@/components/tailwind/advanced-editor";
import {
  ArrowUp,
  ChevronDown,
  ChevronLeft,
  FileCode,
  FilePlus,
  FileText,
  Folder,
  FolderPlus,
  MessageSquare,
  Plus,
  Search,
  Settings,
  Sparkles,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { SettingsModal } from "@/components/workbench/settings-modal";

export type FsNodeType = "folder" | "file";

export type FsNode = {
  id: string;
  type: FsNodeType;
  name: string;
  children?: FsNode[];
  content?: string;
};

type ConversationMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

type Conversation = {
  id: string;
  title: string;
  createdAt: number;
  messages: ConversationMessage[];
};

type ContextMenuState = { x: number; y: number; nodeId: string } | null;

function uid(prefix: string) {
  return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
}

const emptyEditorContent = { type: "doc", content: [{ type: "paragraph" }] };

function isFolder(node: FsNode): node is FsNode & { children: FsNode[] } {
  return node.type === "folder";
}

function defaultRoot(): FsNode {
  return { id: "root", type: "folder", name: "Root/", children: [] };
}

function setCookie(name: string, value: string, maxAgeSeconds: number) {
  document.cookie = `${encodeURIComponent(name)}=${encodeURIComponent(value)}; path=/; max-age=${maxAgeSeconds}; samesite=lax`;
}

function getCookie(name: string) {
  const encoded = encodeURIComponent(name);
  const parts = document.cookie.split(";").map((p) => p.trim());
  for (const p of parts) {
    if (!p.startsWith(`${encoded}=`)) continue;
    const raw = p.slice(encoded.length + 1);
    return decodeURIComponent(raw);
  }
  return null;
}

function findNode(root: FsNode, id: string): { node: FsNode; parent: FsNode | null } | null {
  if (root.id === id) return { node: root, parent: null };
  if (!root.children?.length) return null;
  for (const child of root.children) {
    if (child.id === id) return { node: child, parent: root };
    const nested = findNode(child, id);
    if (nested) return nested;
  }
  return null;
}

function updateNode(root: FsNode, id: string, updater: (n: FsNode) => FsNode): FsNode {
  if (root.id === id) return updater(root);
  if (!root.children?.length) return root;
  return { ...root, children: root.children.map((c) => updateNode(c, id, updater)) };
}

function removeNode(root: FsNode, id: string): FsNode {
  if (!root.children?.length) return root;
  return { ...root, children: root.children.filter((c) => c.id !== id).map((c) => removeNode(c, id)) };
}

function detachNode(root: FsNode, id: string): { next: FsNode; detached: FsNode | null } {
  const found = findNode(root, id);
  if (!found || !found.parent) return { next: root, detached: null };
  return { next: removeNode(root, id), detached: found.node };
}

function attachNode(root: FsNode, parentId: string, child: FsNode): FsNode {
  return updateNode(root, parentId, (n) => {
    if (!isFolder(n)) return n;
    return { ...n, children: n.children ? [...n.children, child] : [child] };
  });
}

function isDescendant(root: FsNode, ancestorId: string, maybeDescendantId: string) {
  const found = findNode(root, ancestorId);
  if (!found) return false;
  const walk = (node: FsNode): boolean => {
    if (node.id === maybeDescendantId) return true;
    return !!node.children?.some(walk);
  };
  return found.node.children?.some(walk) ?? false;
}

function collectFolderOptions(root: FsNode, excludeId?: string) {
  const out: Array<{ id: string; name: string; depth: number }> = [];
  const walk = (node: FsNode, depth: number) => {
    if (node.type !== "folder") return;
    if (node.id !== excludeId) out.push({ id: node.id, name: node.name, depth });
    node.children?.forEach((c) => walk(c, depth + 1));
  };
  walk(root, 0);
  return out;
}

function fileIcon(name: string) {
  const lower = name.toLowerCase();
  if (lower.endsWith(".ts") || lower.endsWith(".tsx") || lower.endsWith(".js") || lower.endsWith(".jsx")) {
    return <FileCode size={14} />;
  }
  return <FileText size={14} />;
}

function rowGuides(depth: number) {
  if (depth <= 0) return null;
  return (
    <div className="flex h-full">
      {Array.from({ length: depth }, (_, idx) => idx + 1).map((level) => (
        <div
          key={level}
          className={cn(
            "w-3 shrink-0",
            level === depth ? "border-l border-zinc-800/70" : "border-l border-zinc-900",
          )}
        />
      ))}
    </div>
  );
}

export function findOrphanIds(root: FsNode): string[] {
  if (typeof window === "undefined") return [];

  const existingIds = new Set<string>();
  const walk = (n: FsNode) => {
    existingIds.add(n.id);
    n.children?.forEach(walk);
  };
  walk(root);

  const orphans: string[] = [];
  for (let i = 0; i < window.localStorage.length; i++) {
    const key = window.localStorage.key(i);
    if (key?.startsWith("fs:") && (key.endsWith(":markdown") || key.endsWith(":novel-content"))) {
      const parts = key.split(":");
      if (parts.length === 3) {
        const id = parts[1];
        if (!existingIds.has(id) && !orphans.includes(id)) {
          orphans.push(id);
        }
      }
    }
  }
  return orphans;
}

function recoverOrphans(root: FsNode): FsNode {
  const orphans = findOrphanIds(root);
  if (orphans.length === 0) return root;

  let newRoot = { ...root };
  let recoveredFolder = newRoot.children?.find((c) => c.name === "恢复的文件" && c.type === "folder");
  let targetId = recoveredFolder?.id;

  if (!recoveredFolder) {
    targetId = uid("f_recovered");
    recoveredFolder = {
      id: targetId,
      type: "folder",
      name: "恢复的文件",
      children: [],
    };
    newRoot = attachNode(newRoot, "root", recoveredFolder);
  }

  let currentRoot = newRoot;
  for (const orphanId of orphans) {
    const fileNode: FsNode = {
      id: orphanId,
      type: "file",
      name: `Recovered_${orphanId.slice(0, 6)}.md`,
      content: "",
    };
    currentRoot = attachNode(currentRoot, targetId!, fileNode);
  }

  return currentRoot;
}

import type { UserSettingsRow } from "@/types/settings";
import type { MeonRegistryConfig, ChatModelDefinition } from "@/types/meon-config";
import { getActiveChatModelConfig } from "@/utils/model-config";

export default function Workbench({ user }: { user?: UserSettingsRow }) {
  const [root, setRoot] = useState<FsNode>(() => defaultRoot());
  const [isLoaded, setIsLoaded] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(["root"]));
  const [activeFileId, setActiveFileId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState>(null);
  const [renaming, setRenaming] = useState<{ nodeId: string; value: string } | null>(null);
  const [moveTarget, setMoveTarget] = useState<{ nodeId: string; targetFolderId: string } | null>(null);

  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [projectConversations, setProjectConversations] = useState<Record<string, Conversation[]>>({});
  const [activeConversationIdByProject, setActiveConversationIdByProject] = useState<Record<string, string | null>>({});
  const [draft, setDraft] = useState("");
  const [chatSaveStatus, setChatSaveStatus] = useState("已保存");

  const [selectedModelId, setSelectedModelId] = useState<string | null>(null);
  const [isModelSelectorOpen, setIsModelSelectorOpen] = useState(false);
  const modelSelectorRef = useRef<HTMLDivElement>(null);

  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  const chatModels = useMemo(() => {
    if (!user?.registry_config) return [];
    const config = user.registry_config as unknown as MeonRegistryConfig;
    return (config.models || []).filter((m: any) => m.type === "chat" && m.isEnabled) as ChatModelDefinition[];
  }, [user]);

  const currentModelName = useMemo(() => {
    if (!selectedModelId) return "选择模型";
    const found = chatModels.find(m => m.id === selectedModelId);
    return found ? found.name : selectedModelId;
  }, [selectedModelId, chatModels]);

  useEffect(() => {
    if (user?.registry_config) {
      const config = user.registry_config as unknown as MeonRegistryConfig;
      if (config.activeModels?.chat) {
        setSelectedModelId(config.activeModels.chat);
      }
    }
  }, [user]);

  useEffect(() => {
    if (!isModelSelectorOpen) return;
    const onClick = (e: MouseEvent) => {
      if (modelSelectorRef.current && !modelSelectorRef.current.contains(e.target as Node)) {
        setIsModelSelectorOpen(false);
      }
    };
    window.addEventListener("mousedown", onClick);
    return () => window.removeEventListener("mousedown", onClick);
  }, [isModelSelectorOpen]);

  useEffect(() => {
    const raw = window.localStorage.getItem("meon:fs:v1");
    let loaded = defaultRoot();
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (parsed?.id === "root") loaded = parsed;
      } catch {}
    }
    // setRoot(recoverOrphans(loaded));
    // 禁用自动恢复功能，以避免显示 "恢复的文件" 文件夹
    setRoot(loaded);
    setIsLoaded(true);
  }, []);

  useEffect(() => {
    if (!isLoaded) return;
    const timer = setTimeout(() => {
      window.localStorage.setItem("meon:fs:v1", JSON.stringify(root));
    }, 1000);
    return () => clearTimeout(timer);
  }, [root, isLoaded]);

  const activeProject = useMemo(() => {
    if (!activeProjectId) return null;
    const found = findNode(root, activeProjectId);
    return found?.node.type === "folder" ? found.node : null;
  }, [root, activeProjectId]);

  const conversations = useMemo(() => {
    if (!activeProjectId) return [];
    return projectConversations[activeProjectId] ?? [];
  }, [activeProjectId, projectConversations]);

  const activeConversationId = useMemo(() => {
    if (!activeProjectId) return null;
    return activeConversationIdByProject[activeProjectId] ?? conversations[0]?.id ?? null;
  }, [activeProjectId, activeConversationIdByProject, conversations]);

  const activeConversation = useMemo(() => {
    if (!activeProjectId) return null;
    return conversations.find((c) => c.id === activeConversationId) ?? null;
  }, [activeProjectId, conversations, activeConversationId]);

  const activeFile = useMemo(() => {
    if (!activeFileId) return null;
    return findNode(root, activeFileId)?.node ?? null;
  }, [root, activeFileId]);

  const activeStorageKey = useMemo(() => {
    if (!activeFileId) return null;
    return `fs:${activeFileId}`;
  }, [activeFileId]);

  const foldersForMove = useMemo(() => {
    if (!moveTarget) return [];
    const found = findNode(root, moveTarget.nodeId);
    const isProjectFolder = !!found && found.node.type === "folder" && found.parent?.id === "root" && found.node.id !== "root";
    const scopedRootId = activeProjectId ?? null;
    const allowed = collectFolderOptions(root, moveTarget.nodeId).filter((f) => !isDescendant(root, moveTarget.nodeId, f.id));
    if (isProjectFolder) return allowed.filter((f) => f.id === "root");
    if (!scopedRootId) return allowed;
    return allowed.filter((f) => f.id === scopedRootId || isDescendant(root, scopedRootId, f.id));
  }, [root, moveTarget, activeProjectId]);

  const menuRef = useRef<HTMLDivElement | null>(null);
  const renameInputRef = useRef<HTMLInputElement | null>(null);
  const didHydrateChatRef = useRef(false);
  const chatPersistTimerRef = useRef<number | null>(null);

  useEffect(() => {
    const fromLocalStorageRaw = window.localStorage.getItem("meon:chat:v1");
    const fromCookieRaw = getCookie("meon_chat_v1");
    const parse = (raw: string | null) => {
      if (!raw) return null;
      try {
        return JSON.parse(raw) as {
          v: number;
          activeProjectId?: string | null;
          projectConversations?: Record<string, Conversation[]>;
          activeConversationIdByProject?: Record<string, string | null>;
        };
      } catch {
        return null;
      }
    };
    const parsed = parse(fromLocalStorageRaw) ?? parse(fromCookieRaw);
    if (parsed?.v === 1) {
      setProjectConversations(parsed.projectConversations ?? {});
      setActiveConversationIdByProject(parsed.activeConversationIdByProject ?? {});
      setActiveProjectId(parsed.activeProjectId ?? null);
    }
    didHydrateChatRef.current = true;
  }, []);

  useEffect(() => {
    if (!didHydrateChatRef.current) return;
    if (chatPersistTimerRef.current) window.clearTimeout(chatPersistTimerRef.current);
    setChatSaveStatus("未保存");
    chatPersistTimerRef.current = window.setTimeout(() => {
      const payload = {
        v: 1,
        activeProjectId,
        projectConversations,
        activeConversationIdByProject,
      };
      window.localStorage.setItem("meon:chat:v1", JSON.stringify(payload));

      const tryCookie = (data: unknown) => {
        const raw = JSON.stringify(data);
        if (raw.length <= 3500) return raw;
        return null;
      };

      const minimal = {
        v: 1,
        activeProjectId,
        activeConversationIdByProject,
        projectConversations: Object.fromEntries(
          Object.entries(projectConversations).map(([pid, cs]) => [
            pid,
            (cs ?? []).slice(0, 3).map((c) => ({
              id: c.id,
              title: c.title,
              createdAt: c.createdAt,
              messages: (c.messages ?? []).slice(-2),
            })),
          ]),
        ),
      };

      const cookieValue = tryCookie(payload) ?? tryCookie(minimal) ?? JSON.stringify({ v: 1, activeProjectId });
      setCookie("meon_chat_v1", cookieValue, 60 * 60 * 24 * 30);
      setChatSaveStatus("已保存");
    }, 200);
    return () => {
      if (chatPersistTimerRef.current) window.clearTimeout(chatPersistTimerRef.current);
    };
  }, [projectConversations, activeConversationIdByProject, activeProjectId]);

  useEffect(() => {
    if (!activeProjectId) return;
    if ((projectConversations[activeProjectId]?.length ?? 0) > 0) return;
    const id = uid("c");
    const next: Conversation = {
      id,
      title: "对话 1",
      createdAt: Date.now(),
      messages: [],
    };
    setProjectConversations((prev) => ({ ...prev, [activeProjectId]: [next] }));
    setActiveConversationIdByProject((prev) => ({ ...prev, [activeProjectId]: id }));
  }, [activeProjectId, projectConversations]);

  useEffect(() => {
    if (!contextMenu) return;
    const onPointerDown = (e: PointerEvent) => {
      const el = menuRef.current;
      if (!el) return;
      if (e.target instanceof Node && el.contains(e.target)) return;
      setContextMenu(null);
    };
    const onEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") setContextMenu(null);
    };
    window.addEventListener("pointerdown", onPointerDown, { capture: true });
    window.addEventListener("keydown", onEscape);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, { capture: true });
      window.removeEventListener("keydown", onEscape);
    };
  }, [contextMenu]);

  useEffect(() => {
    if (!renaming) return;
    const id = window.requestAnimationFrame(() => {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    });
    return () => window.cancelAnimationFrame(id);
  }, [renaming?.nodeId]);

  const toggleExpanded = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const nodeIsInActiveProject = (nodeId: string) => {
    if (!activeProjectId) return true;
    if (nodeId === "root") return true;
    if (nodeId === activeProjectId) return true;
    return isDescendant(root, activeProjectId, nodeId);
  };

  const createFolder = (parentId: string) => {
    if (!nodeIsInActiveProject(parentId)) return;
    const id = uid("f");
    const name = "新建文件夹";
    setRoot((prev) => attachNode(prev, parentId, { id, type: "folder", name, children: [] }));
    setExpanded((prev) => new Set(prev).add(parentId));
    setRenaming({ nodeId: id, value: name });
  };

  const createMdFile = (parentId: string) => {
    if (parentId === "root") return;
    if (!nodeIsInActiveProject(parentId)) return;
    const id = uid("md");
    const name = "新建文档.md";
    setRoot((prev) => attachNode(prev, parentId, { id, type: "file", name, content: "" }));
    setExpanded((prev) => new Set(prev).add(parentId));
    setActiveFileId(id);
    setRenaming({ nodeId: id, value: name });
    const key = `fs:${id}`;
    window.localStorage.setItem(`${key}:novel-content`, JSON.stringify(emptyEditorContent));
    window.localStorage.setItem(`${key}:markdown`, "");
    window.localStorage.setItem(`${key}:html-content`, "");
  };

  const deleteNodeById = (id: string) => {
    if (!nodeIsInActiveProject(id)) return;
    const found = findNode(root, id);
    if (found?.node.type === "file") {
      const key = `fs:${id}`;
      window.localStorage.removeItem(`${key}:html-content`);
      window.localStorage.removeItem(`${key}:novel-content`);
      window.localStorage.removeItem(`${key}:markdown`);
    }
    setRoot((prev) => removeNode(prev, id));
    setExpanded((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    setActiveFileId((prev) => (prev === id ? null : prev));
  };

  const commitRename = (nodeId: string, value: string) => {
    if (!nodeIsInActiveProject(nodeId)) {
      setRenaming(null);
      return;
    }
    setRoot((prev) => {
      const found = findNode(prev, nodeId);
      const trimmed = value.trim() || "未命名";
      const nextName =
        found?.node.type === "file" && !trimmed.toLowerCase().endsWith(".md") ? `${trimmed}.md` : trimmed;
      return updateNode(prev, nodeId, (n) => ({ ...n, name: nextName }));
    });
    setRenaming(null);
  };

  const startMove = (nodeId: string) => {
    const found = findNode(root, nodeId);
    const isProjectFolder = !!found && found.node.type === "folder" && found.parent?.id === "root" && found.node.id !== "root";
    if (isProjectFolder) return;
    if (!nodeIsInActiveProject(nodeId)) return;
    setMoveTarget({ nodeId, targetFolderId: "root" });
  };

  const commitMove = () => {
    if (!moveTarget) return;
    const { nodeId, targetFolderId } = moveTarget;
    if (nodeId === "root") return;
    if (nodeId === targetFolderId) return;
    if (isDescendant(root, nodeId, targetFolderId)) return;
    if (activeProjectId) {
      if (!nodeIsInActiveProject(nodeId)) return;
      if (!(targetFolderId === activeProjectId || nodeIsInActiveProject(targetFolderId))) return;
      if (targetFolderId === "root") return;
    }

    setRoot((prev) => {
      const { next, detached } = detachNode(prev, nodeId);
      if (!detached) return prev;
      return attachNode(next, targetFolderId, detached);
    });
    setExpanded((prev) => new Set(prev).add(targetFolderId));
    setMoveTarget(null);
  };

  const newConversation = () => {
    if (!activeProjectId) return;
    const id = uid("c");
    const next: Conversation = {
      id,
      title: `对话 ${(projectConversations[activeProjectId]?.length ?? 0) + 1}`,
      createdAt: Date.now(),
      messages: [],
    };
    setProjectConversations((prev) => ({
      ...prev,
      [activeProjectId]: [next, ...(prev[activeProjectId] ?? [])],
    }));
    setActiveConversationIdByProject((prev) => ({ ...prev, [activeProjectId]: id }));
  };

  const recoverFile = (orphanId: string) => {
    // 恢复到当前激活的项目文件夹，或者根目录
    const targetFolderId = activeProjectId ?? "root";
    if (!nodeIsInActiveProject(targetFolderId)) return;

    const fileNode: FsNode = {
      id: orphanId,
      type: "file",
      name: `Recovered_${orphanId.slice(0, 6)}.md`,
      content: "",
    };
    setRoot((prev) => attachNode(prev, targetFolderId, fileNode));
    setExpanded((prev) => new Set(prev).add(targetFolderId));
    setActiveFileId(orphanId);
  };

  const deleteOrphanFile = (orphanId: string) => {
    const key = `fs:${orphanId}`;
    window.localStorage.removeItem(`${key}:html-content`);
    window.localStorage.removeItem(`${key}:novel-content`);
    window.localStorage.removeItem(`${key}:markdown`);
    // 触发 UI 更新可能需要在 SettingsModal 内部处理，或者通过修改 root 触发（但这里没有修改 root）
    // 由于我们传递了 onRecover/onDelete 给 SettingsModal，它可以在调用后更新自己的列表状态
  };

  const [isGenerating, setIsGenerating] = useState(false);

  const sendMessage = async () => {
    if (!activeProjectId) return;
    const content = draft.trim();
    if (!content || !activeConversationId) return;
    setDraft("");

    // 1. 添加用户消息到界面
    const userMsgId = uid("m");
    setProjectConversations((prev) => ({
      ...prev,
      [activeProjectId]: (prev[activeProjectId] ?? []).map((c) => {
        if (c.id !== activeConversationId) return c;
        return { ...c, messages: [...c.messages, { id: userMsgId, role: "user", content }] };
      }),
    }));

    // 2. 准备 AI 回复的消息占位
    const assistantMsgId = uid("m");
    setIsGenerating(true);
    setProjectConversations((prev) => ({
      ...prev,
      [activeProjectId]: (prev[activeProjectId] ?? []).map((c) => {
        if (c.id !== activeConversationId) return c;
        return { ...c, messages: [...c.messages, { id: assistantMsgId, role: "assistant", content: "" }] }; // 初始为空
      }),
    }));

    try {
      // 3. 获取当前模型配置
      const config = user?.registry_config as unknown as MeonRegistryConfig;
      const requestConfig = getActiveChatModelConfig(config, selectedModelId || undefined);

      if (!requestConfig || !requestConfig.apiKey) {
        throw new Error("未配置有效的模型或 API Key");
      }

      // 4. 调用 OpenAI 兼容接口
      const response = await fetch(`${requestConfig.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${requestConfig.apiKey}`,
        },
        body: JSON.stringify({
          model: requestConfig.modelName,
          messages: [
            // 获取当前对话的历史消息
            ...(projectConversations[activeProjectId]?.find(c => c.id === activeConversationId)?.messages.map(m => ({
              role: m.role,
              content: m.content
            })) || []),
            { role: "user", content }
          ],
          stream: true, // 启用流式传输
          ...requestConfig.params,
        }),
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`API Error: ${response.status} - ${errText}`);
      }

      if (!response.body) throw new Error("No response body");

      // 5. 处理流式响应
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let fullContent = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split("\n").filter((line) => line.trim() !== "");

        for (const line of lines) {
          if (line === "data: [DONE]") break;
          if (line.startsWith("data: ")) {
            try {
              const jsonStr = line.slice(6);
              const json = JSON.parse(jsonStr);
              const delta = json.choices[0]?.delta?.content || "";
              
              if (delta) {
                fullContent += delta;
                
                // 实时更新 UI
                setProjectConversations((prev) => ({
                  ...prev,
                  [activeProjectId]: (prev[activeProjectId] ?? []).map((c) => {
                    if (c.id !== activeConversationId) return c;
                    return {
                      ...c,
                      messages: c.messages.map((m) =>
                        m.id === assistantMsgId ? { ...m, content: fullContent } : m
                      ),
                    };
                  }),
                }));
              }
            } catch (e) {
              console.warn("Failed to parse chunk", e);
            }
          }
        }
      }

    } catch (error: any) {
      console.error("Chat error:", error);
      // 将错误信息显示在对话中
      setProjectConversations((prev) => ({
        ...prev,
        [activeProjectId]: (prev[activeProjectId] ?? []).map((c) => {
          if (c.id !== activeConversationId) return c;
          return {
            ...c,
            messages: c.messages.map((m) =>
              m.id === assistantMsgId ? { ...m, content: `Error: ${error.message || "请求失败"}` } : m
            ),
          };
        }),
      }));
    } finally {
      setIsGenerating(false);
    }
  };

  const downloadTextFile = (filename: string, text: string, mime: string) => {
    const safe = filename.replaceAll("/", "_");
    const blob = new Blob([text], { type: mime });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = safe;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
  };

  const exportFileById = (id: string) => {
    const found = findNode(root, id);
    if (!found || found.node.type !== "file") return;
    const key = `fs:${id}`;
    const markdown = window.localStorage.getItem(`${key}:markdown`) ?? "";
    downloadTextFile(found.node.name || "export.md", markdown, "text/markdown;charset=utf-8");
  };

  const exportFolderById = (id: string) => {
    if (id === "root") return;
    const found = findNode(root, id);
    if (!found || found.node.type !== "folder") return;
    const files: Array<{ id: string; name: string; markdown: string }> = [];
    const walk = (n: FsNode) => {
      if (n.type === "file") {
        const key = `fs:${n.id}`;
        const markdown = window.localStorage.getItem(`${key}:markdown`) ?? "";
        files.push({ id: n.id, name: n.name, markdown });
        return;
      }
      n.children?.forEach(walk);
    };
    walk(found.node);
    const payload = {
      v: 1,
      exportedAt: Date.now(),
      folder: { id: found.node.id, name: found.node.name },
      tree: found.node,
      files,
    };
    downloadTextFile(`${found.node.name || "folder"}.meon.json`, JSON.stringify(payload, null, 2), "application/json");
  };

  const renderTree = (node: FsNode, depth: number, parentId: string | null) => {
    if (node.type !== "folder") return null;
    const isOpen = expanded.has(node.id);
    const isRoot = node.id === "root";
    const isProjectFolder = parentId === "root" && node.id !== "root";
    const isInProject = nodeIsInActiveProject(node.id);
    const isDisabled = !!activeProjectId && !isInProject && node.id !== "root";
    const isProjectDimmed = !!activeProjectId && isProjectFolder && node.id !== activeProjectId;

    const row =
      renaming?.nodeId === node.id ? (
        <div
          key={node.id}
          onContextMenu={(e) => {
            e.preventDefault();
            if (isDisabled) return;
            setContextMenu({ x: e.clientX, y: e.clientY, nodeId: node.id });
          }}
          className={cn(
            "flex h-7 select-none items-center gap-2 px-3 text-xs transition-colors",
            "text-zinc-500 hover:bg-zinc-800/50",
            isDisabled || isProjectDimmed ? "opacity-40" : null,
          )}
        >
          {rowGuides(depth)}
          <ChevronDown
            size={14}
            className={cn("shrink-0 text-zinc-600 transition-transform", isOpen ? "rotate-0" : "-rotate-90")}
          />
          <span className="text-zinc-600">
            <Folder size={14} />
          </span>
          <input
            ref={renameInputRef}
            value={renaming.value}
            onChange={(e) => setRenaming({ nodeId: node.id, value: e.target.value })}
            onBlur={() => commitRename(node.id, renaming.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitRename(node.id, renaming.value);
              if (e.key === "Escape") setRenaming(null);
            }}
            className="h-5 w-full rounded bg-zinc-900 px-2 text-xs text-zinc-200 outline-none ring-1 ring-zinc-700 focus:ring-blue-500/50"
          />
        </div>
      ) : (
        <button
          key={node.id}
          type="button"
          onClick={() => {
            if (isDisabled) return;
            if (isProjectFolder && !activeProjectId) {
              setActiveProjectId(node.id);
              setActiveFileId(null);
              setExpanded((prev) => new Set(prev).add("root").add(node.id));
              return;
            }
            if (isProjectDimmed) return;
            toggleExpanded(node.id);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowRight" && !isOpen) toggleExpanded(node.id);
            if (e.key === "ArrowLeft" && isOpen) toggleExpanded(node.id);
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            if (isDisabled || isProjectDimmed) return;
            setContextMenu({ x: e.clientX, y: e.clientY, nodeId: node.id });
          }}
          aria-expanded={isOpen}
          className={cn(
            "flex h-7 w-full cursor-pointer select-none items-center gap-2 px-3 text-xs transition-colors",
            "text-zinc-500 hover:bg-zinc-800/50",
            isDisabled || isProjectDimmed ? "opacity-40" : null,
          )}
        >
          {rowGuides(depth)}
          <ChevronDown
            size={14}
            className={cn("shrink-0 text-zinc-600 transition-transform", isOpen ? "rotate-0" : "-rotate-90")}
          />
          <span className="text-zinc-600">
            <Folder size={14} />
          </span>
          <span className={cn("truncate", isRoot ? "text-zinc-300" : "text-zinc-400")}>{node.name}</span>
        </button>
      );

    const children = isOpen
      ? node.children?.map((c) => {
          if (c.type === "folder") return renderTree(c, depth + 1, node.id);
          const isInProject2 = nodeIsInActiveProject(c.id);
          const isDisabled2 = !!activeProjectId && !isInProject2;
          const isActive = activeFileId === c.id;
          const isRenaming = renaming?.nodeId === c.id;
          return isRenaming ? (
            <div
              key={c.id}
              onContextMenu={(e) => {
                e.preventDefault();
                if (isDisabled2) return;
                setContextMenu({ x: e.clientX, y: e.clientY, nodeId: c.id });
              }}
              className={cn(
                "flex h-7 w-full select-none items-center gap-2 px-3 text-xs transition-colors",
                "text-zinc-500 hover:bg-zinc-800/50",
                isDisabled2 ? "opacity-40" : null,
              )}
            >
              {rowGuides(depth + 1)}
              <span className={cn("shrink-0", isActive ? "text-zinc-300" : "text-zinc-600")}>{fileIcon(c.name)}</span>
              <input
                ref={renameInputRef}
                value={renaming.value}
                onChange={(e) => setRenaming({ nodeId: c.id, value: e.target.value })}
                onBlur={() => commitRename(c.id, renaming.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitRename(c.id, renaming.value);
                  if (e.key === "Escape") setRenaming(null);
                }}
                className="h-5 w-full rounded bg-zinc-900 px-2 text-xs text-zinc-200 outline-none ring-1 ring-zinc-700 focus:ring-blue-500/50"
              />
            </div>
          ) : (
            <button
              key={c.id}
              type="button"
              onClick={() => {
                if (isDisabled2) return;
                setActiveFileId(c.id);
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                if (isDisabled2) return;
                setContextMenu({ x: e.clientX, y: e.clientY, nodeId: c.id });
              }}
              aria-selected={isActive}
              className={cn(
                "flex h-7 w-full cursor-pointer select-none items-center gap-2 px-3 text-xs transition-colors",
                isActive ? "bg-zinc-800 text-white" : "text-zinc-500 hover:bg-zinc-800/50",
                isDisabled2 ? "opacity-40" : null,
              )}
            >
              {rowGuides(depth + 1)}
              <span className={cn("shrink-0", isActive ? "text-zinc-300" : "text-zinc-600")}>{fileIcon(c.name)}</span>
              <span className="truncate">{c.name}</span>
            </button>
          );
        })
      : null;

    return (
      <div key={`${node.id}_wrap`}>
        {row}
        {children}
      </div>
    );
  };

  return (
    <div className="flex h-screen w-full overflow-hidden bg-[#121212] font-sans text-zinc-300 selection:bg-blue-500/30">
      <aside className="flex w-60 shrink-0 flex-col border-r border-zinc-800 bg-[#121212]">
        <div className="flex items-center justify-between p-3 px-4 text-[10px] font-bold uppercase tracking-wider text-zinc-600">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate">项目: {activeProject?.name ?? root.name}</span>
            {activeProjectId ? (
              <button
                onClick={() => {
                  setActiveProjectId(null);
                  setActiveFileId(null);
                  setDraft("");
                }}
                className="rounded-md px-1 py-1 text-zinc-500 hover:bg-zinc-800/60 hover:text-zinc-200"
                type="button"
                title="返回 Root/"
              >
                <ChevronLeft size={14} />
              </button>
            ) : null}
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => createFolder(activeProjectId ?? "root")}
              className="inline-flex items-center gap-1 rounded-md px-1 py-1 text-zinc-500 hover:bg-zinc-800/60 hover:text-zinc-200"
              type="button"
              title="新建文件夹"
            >
              <FolderPlus size={14} />
            </button>
            {activeProjectId ? (
              <button
                onClick={() => createMdFile(activeProjectId)}
                className="inline-flex items-center gap-1 rounded-md px-1 py-1 text-zinc-500 hover:bg-zinc-800/60 hover:text-zinc-200"
                type="button"
                title="新建 MD"
              >
                <FilePlus size={14} />
              </button>
            ) : null}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto py-1">{renderTree(root, 0, null)}</div>
        
        {/* 用户信息区域 */}
        {user && (
          <div className="border-t border-zinc-800 p-3">
            <div className="flex items-center gap-2 rounded-md bg-zinc-900/50 p-2">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-600/20 text-xs font-medium text-blue-400">
                {user.email?.slice(0, 2).toUpperCase() || 'U'}
              </div>
              <div className="flex min-w-0 flex-1 flex-col justify-center">
                <span className="truncate text-xs font-medium text-zinc-300">
                  {user.user_metadata?.full_name || user.user_metadata?.name || user.email?.split('@')[0] || 'User'}
                </span>
                <span className="truncate text-[10px] text-zinc-500">
                  {user.email}
                </span>
              </div>
              <button
                onClick={() => setIsSettingsOpen(true)}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200 transition-colors"
                title="设置"
                type="button"
              >
                <Settings size={14} />
              </button>
            </div>
          </div>
        )}
      </aside>

      {isSettingsOpen && (
        <SettingsModal
          onClose={() => setIsSettingsOpen(false)}
          user={user}
          root={root}
          onRecover={recoverFile}
          onDeleteOrphan={deleteOrphanFile}
        />
      )}

      <main className="flex min-w-0 flex-1 flex-col bg-[#0d0d0d]">
        <div className="flex h-9 shrink-0 items-center overflow-x-auto border-b border-zinc-800 bg-[#121212]">
          <div className="flex h-full flex-1 items-center gap-2 px-4 text-xs text-zinc-400">
            <MessageSquare size={14} className="text-zinc-500" />
            <span className="truncate">Workbench</span>
          </div>
          <div className="flex items-center gap-2 px-2 text-zinc-600">
            <button className="rounded p-1 hover:bg-zinc-800/60 hover:text-zinc-300" type="button">
              <X size={14} />
            </button>
          </div>
        </div>

        <div className="flex h-9 shrink-0 items-center overflow-x-auto border-b border-zinc-800 bg-[#121212]">
          <div className="flex h-full items-center gap-2 border-r border-zinc-800 bg-[#0d0d0d] px-4 text-xs text-zinc-300">
            {activeFile ? (
              <>
                <span className="text-blue-400">{fileIcon(activeFile.name)}</span>
                <span className="truncate">{activeFile.name}</span>
                <X
                  size={12}
                  className="ml-1 cursor-pointer text-zinc-600 hover:text-zinc-300"
                  onClick={() => setActiveFileId(null)}
                />
              </>
            ) : (
              <span className="text-zinc-500">未选择文件</span>
            )}
          </div>
          <div className="h-full flex-1 border-b border-zinc-800" />
        </div>

        <div className="flex-1 overflow-hidden">
          {activeFile?.type === "file" && activeStorageKey ? (
            <div className="flex h-full min-w-0 flex-col">
              <div className="flex-1 min-w-0 overflow-auto p-4">
                <TailwindAdvancedEditor
                  key={activeStorageKey}
                  storageKey={activeStorageKey}
                  wrapperClassName="max-w-none"
                  editorClassName="max-w-none sm:mb-0 sm:rounded-none sm:border-0 sm:shadow-none bg-transparent"
                />
              </div>
            </div>
          ) : (
            <div className="flex-1 overflow-auto p-6 text-sm text-zinc-500">
              <div className="mb-2 text-zinc-400">在左侧新建并选择 md 文件开始编辑。</div>
              <div className="text-xs text-zinc-600">右键文件夹可新建文件夹或 md 文件，也可重命名、删除、移动。</div>
            </div>
          )}
        </div>
      </main>

      <aside className="flex w-[380px] shrink-0 flex-col border-l border-zinc-800 bg-[#1c1c1c]">
        <div className="flex h-9 shrink-0 items-center justify-between border-b border-zinc-800 px-3 text-xs font-medium text-zinc-300">
          <div className="flex items-center gap-2">
            <span>聊天</span>
            <span className="rounded bg-[#252525] px-2 py-0.5 text-[10px] text-zinc-500">{chatSaveStatus}</span>
          </div>
          <button
            onClick={newConversation}
            disabled={!activeProjectId}
            className={cn(
              "inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium",
              activeProjectId ? "text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200" : "cursor-not-allowed text-zinc-600",
            )}
            type="button"
          >
            <Plus size={12} />
            新对话
          </button>
        </div>

        <div className="flex max-h-44 shrink-0 flex-col gap-2 overflow-y-auto border-b border-zinc-800 p-3">
          <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-600">历史对话</div>
          <div className="space-y-1">
            {conversations.map((c) => {
              const isActive = c.id === activeConversationId;
              return (
                <button
                  key={c.id}
                  onClick={() => {
                    if (!activeProjectId) return;
                    setActiveConversationIdByProject((prev) => ({ ...prev, [activeProjectId]: c.id }));
                  }}
                  className={cn(
                    "flex w-full items-center justify-between rounded-lg border px-2 py-1.5 text-left text-[12px] transition-colors",
                    isActive
                      ? "border-zinc-700 bg-[#252525] text-zinc-200"
                      : "border-zinc-800 bg-transparent text-zinc-400 hover:bg-zinc-800/40",
                  )}
                  type="button"
                >
                  <span className="truncate">{c.title}</span>
                  <span className="ml-2 shrink-0 text-[10px] text-zinc-600">{c.messages.length}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {!activeProjectId ? (
            <div className="flex h-full items-center justify-center rounded-xl border border-zinc-800 bg-[#151515] p-6 text-sm text-zinc-500">
              请选择 Root/ 下的一个项目文件夹后开始聊天。
            </div>
          ) : activeConversation?.messages.length === 0 ? (
            // 空状态占位 - 可自定义内容
            <div className="flex h-full flex-col items-center justify-center space-y-4 text-center">
               <div className="rounded-full bg-zinc-800/50 p-4">
                 <Sparkles className="h-6 w-6 text-zinc-500" />
               </div>
               <div className="space-y-1">
                 <h3 className="text-sm font-medium text-zinc-300">开始新的对话</h3>
                 <p className="text-xs text-zinc-500">选择模型并发送消息以开始</p>
               </div>
            </div>
          ) : (
            <div className="space-y-4">
            {activeConversation?.messages.map((m) => (
              <div
                key={m.id}
                className={cn(
                  "max-w-[92%] rounded-xl border p-3 text-[13px] leading-relaxed shadow-sm",
                  m.role === "user"
                    ? "ml-auto border-zinc-800 bg-[#252525] text-zinc-200"
                    : "mr-auto border-zinc-800/70 bg-[#1f1f1f] text-zinc-300",
                )}
              >
                {m.content}
              </div>
            ))}

            <div className="space-y-1.5 px-1">
              <div className="flex items-center gap-2 text-[11px] text-zinc-500">
                <Search size={12} />
                <span>
                  已阅读 <span className="font-medium text-zinc-400">about-acme.md</span>
                </span>
              </div>
              <div className="flex items-center gap-2 text-[11px] text-zinc-500">
                <Search size={12} />
                <span>
                  已阅读 <span className="font-medium text-zinc-400">brand-guidelines.pdf</span>
                </span>
              </div>
              <div className="flex items-center gap-2 text-[11px] text-zinc-500">
                <div className="h-3 w-3 animate-spin rounded-full border-2 border-zinc-700 border-t-zinc-400" />
                <span>
                  思考中 <span className="text-zinc-400">...</span>
                </span>
              </div>
            </div>
            </div>
          )}
        </div>

        <div className="shrink-0 border-t border-zinc-800 bg-[#1c1c1c] p-4">
          <div className="relative rounded-xl border border-zinc-700 bg-[#252525] shadow-inner transition-all focus-within:border-blue-500/50 focus-within:ring-1 focus-within:ring-blue-500/20">
            <textarea
              placeholder="计划、搜索、构建任何东西..."
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  if (!isGenerating) sendMessage();
                }
              }}
              disabled={!activeProjectId || isGenerating}
              className={cn(
                "w-full resize-none bg-transparent p-4 pb-12 text-[13px] outline-none placeholder:text-zinc-500",
                activeProjectId ? "text-zinc-100" : "cursor-not-allowed text-zinc-600",
              )}
              rows={3}
            />
            <div className="absolute bottom-3 left-3 right-3 flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <button
                  className="flex items-center gap-1 rounded-full border border-zinc-700 bg-zinc-800 px-3 py-1 text-[11px] font-medium text-zinc-400 transition-colors hover:text-zinc-200"
                  type="button"
                >
                  <Sparkles size={12} className="text-blue-400" />
                  Agent
                  <ChevronDown size={10} />
                </button>
                <div className="relative" ref={modelSelectorRef}>
                  <button
                    onClick={() => setIsModelSelectorOpen(!isModelSelectorOpen)}
                    className="flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-medium text-zinc-500 hover:text-zinc-300"
                    type="button"
                  >
                    {currentModelName}
                    <ChevronDown size={10} className={cn("transition-transform", isModelSelectorOpen ? "rotate-180" : "")} />
                  </button>
                  
                  {isModelSelectorOpen && (
                    <div className="absolute bottom-full left-0 z-50 mb-2 w-48 overflow-hidden rounded-lg border border-zinc-800 bg-[#1e1e1e] shadow-xl">
                      <div className="p-1">
                        {chatModels.length === 0 ? (
                          <div className="px-3 py-2 text-xs text-zinc-500">无可用模型</div>
                        ) : (
                          chatModels.map(model => (
                            <button
                              key={model.id}
                              onClick={() => {
                                setSelectedModelId(model.id);
                                setIsModelSelectorOpen(false);
                              }}
                              className={cn(
                                "flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-xs transition-colors",
                                model.id === selectedModelId
                                  ? "bg-zinc-800 text-zinc-200"
                                  : "text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-300"
                              )}
                              type="button"
                            >
                              <span className="truncate">{model.name}</span>
                              {model.id === selectedModelId && <div className="h-1.5 w-1.5 rounded-full bg-blue-500" />}
                            </button>
                          ))
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
              <button
                onClick={sendMessage}
                disabled={!activeProjectId || isGenerating || !draft.trim()}
                className={cn(
                  "flex h-8 w-8 items-center justify-center rounded-full transition-all",
                  activeProjectId && draft.trim() && !isGenerating
                    ? "scale-105 bg-zinc-100 text-black shadow-lg"
                    : "bg-zinc-800 text-zinc-600",
                )}
                type="button"
              >
                {isGenerating ? (
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-zinc-600 border-t-zinc-400" />
                ) : (
                  <ArrowUp size={16} strokeWidth={3} />
                )}
              </button>
            </div>
          </div>
        </div>
      </aside>

      {contextMenu ? (
        <div
          ref={menuRef}
          style={{ left: contextMenu.x, top: contextMenu.y }}
          className="fixed z-50 w-44 overflow-hidden rounded-lg border border-zinc-800 bg-[#1e1e1e] shadow-xl"
        >
          {(() => {
            const found = findNode(root, contextMenu.nodeId);
            const nodeType = found?.node.type;
            const isRoot = contextMenu.nodeId === "root";
            const isOutOfProject = !!activeProjectId && !nodeIsInActiveProject(contextMenu.nodeId);

            return (
              <>
                {nodeType === "folder" ? (
                  <>
                    <button
                      onClick={() => {
                        setContextMenu(null);
                        createFolder(contextMenu.nodeId);
                      }}
                      className="flex w-full items-center justify-between px-3 py-2 text-xs text-zinc-300 hover:bg-zinc-800/60"
                      type="button"
                    >
                      新建文件夹 <Plus size={12} className="text-zinc-500" />
                    </button>
                    {!isRoot ? (
                      <button
                        onClick={() => {
                          setContextMenu(null);
                          createMdFile(contextMenu.nodeId);
                        }}
                        className="flex w-full items-center justify-between px-3 py-2 text-xs text-zinc-300 hover:bg-zinc-800/60"
                        type="button"
                      >
                        新建 md <FileText size={12} className="text-zinc-500" />
                      </button>
                    ) : null}
                    {!isRoot ? (
                      <>
                        <div className="h-px bg-zinc-800" />
                        <button
                          onClick={() => {
                            setContextMenu(null);
                            exportFolderById(contextMenu.nodeId);
                          }}
                          className="flex w-full items-center justify-between px-3 py-2 text-xs text-zinc-300 hover:bg-zinc-800/60"
                          type="button"
                        >
                          导出文件夹 <span className="text-zinc-500">↓</span>
                        </button>
                      </>
                    ) : null}
                    <div className="h-px bg-zinc-800" />
                  </>
                ) : null}

                {nodeType === "file" ? (
                  <>
                    <button
                      onClick={() => {
                        setContextMenu(null);
                        exportFileById(contextMenu.nodeId);
                      }}
                      className="flex w-full items-center justify-between px-3 py-2 text-xs text-zinc-300 hover:bg-zinc-800/60"
                      type="button"
                    >
                      导出文件 <span className="text-zinc-500">↓</span>
                    </button>
                    <div className="h-px bg-zinc-800" />
                  </>
                ) : null}

                <button
                  onClick={() => {
                    const found2 = findNode(root, contextMenu.nodeId);
                    if (found2) setRenaming({ nodeId: found2.node.id, value: found2.node.name });
                    setContextMenu(null);
                  }}
                  disabled={isRoot || isOutOfProject}
                  className={cn(
                    "flex w-full items-center justify-between px-3 py-2 text-xs",
                    isRoot || isOutOfProject ? "cursor-not-allowed text-zinc-600" : "text-zinc-300 hover:bg-zinc-800/60",
                  )}
                  type="button"
                >
                  重命名 <span className="text-zinc-500">F2</span>
                </button>

                <button
                  onClick={() => {
                    if (!isRoot) startMove(contextMenu.nodeId);
                    setContextMenu(null);
                  }}
                  disabled={isRoot || isOutOfProject}
                  className={cn(
                    "flex w-full items-center justify-between px-3 py-2 text-xs",
                    isRoot || isOutOfProject ? "cursor-not-allowed text-zinc-600" : "text-zinc-300 hover:bg-zinc-800/60",
                  )}
                  type="button"
                >
                  移动 <span className="text-zinc-500">…</span>
                </button>

                <div className="h-px bg-zinc-800" />

                <button
                  onClick={() => {
                    if (!isRoot) deleteNodeById(contextMenu.nodeId);
                    setContextMenu(null);
                  }}
                  disabled={isRoot || isOutOfProject}
                  className={cn(
                    "flex w-full items-center justify-between px-3 py-2 text-xs",
                    isRoot || isOutOfProject ? "cursor-not-allowed text-zinc-600" : "text-rose-300 hover:bg-rose-500/10",
                  )}
                  type="button"
                >
                  删除 <span className="text-zinc-500">Del</span>
                </button>
              </>
            );
          })()}
        </div>
      ) : null}

      {moveTarget ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md overflow-hidden rounded-xl border border-zinc-800 bg-[#1b1b1b] shadow-2xl">
            <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
              <div className="text-sm font-medium text-zinc-200">移动到…</div>
              <button
                onClick={() => setMoveTarget(null)}
                className="rounded p-1 text-zinc-500 hover:bg-zinc-800/60 hover:text-zinc-200"
                type="button"
              >
                <X size={14} />
              </button>
            </div>
            <div className="p-4">
              <div className="mb-2 text-xs text-zinc-500">选择目标文件夹</div>
              <div className="max-h-56 overflow-y-auto rounded-lg border border-zinc-800">
                {foldersForMove.map((f) => {
                  const isActive = f.id === moveTarget.targetFolderId;
                  return (
                    <button
                      key={f.id}
                      onClick={() => setMoveTarget((prev) => (prev ? { ...prev, targetFolderId: f.id } : prev))}
                      className={cn(
                        "flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition-colors",
                        isActive ? "bg-zinc-800 text-zinc-200" : "text-zinc-400 hover:bg-zinc-800/50",
                      )}
                      type="button"
                    >
                      <span className="text-zinc-600" style={{ paddingLeft: `${f.depth * 10}px` }}>
                        <Folder size={14} />
                      </span>
                      <span className="truncate">{f.name}</span>
                    </button>
                  );
                })}
              </div>
              <div className="mt-4 flex items-center justify-end gap-2">
                <button
                  onClick={() => setMoveTarget(null)}
                  className="rounded-md border border-zinc-800 bg-transparent px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800/40"
                  type="button"
                >
                  取消
                </button>
                <button
                  onClick={commitMove}
                  className="rounded-md bg-zinc-100 px-3 py-1.5 text-xs font-medium text-black hover:bg-white"
                  type="button"
                >
                  移动
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
