"use client";

import { cn } from "@/lib/utils";
import PlainMarkdownEditor from "@/components/workbench/plain-markdown-editor";
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
  Pencil,
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

type FileActionType = "read" | "write" | "append" | "replace";
type AgentActionType = "aligner" | "recorder";

type UserQuestionOption = { label: string; description?: string };

type UserQuestionPayload = {
  header?: string;
  question: string;
  kind: "options" | "text";
  options?: UserQuestionOption[];
  multiSelect?: boolean;
  placeholder?: string;
  multiline?: boolean;
};

type ConversationMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  actions?: { type: FileActionType; path: string; ok: boolean }[];
  question?: UserQuestionPayload;
};

type AiTodoStatus = "pending" | "in_progress" | "completed";

type AiTodoItem = {
  id: string;
  content: string;
  status: AiTodoStatus;
};

type Conversation = {
  id: string;
  title: string;
  createdAt: number;
  messages: ConversationMessage[];
  aiTodos?: AiTodoItem[];
  dramaSetup?: { step: 0 | 1 | 2 | 3; q1?: string[]; q2?: string; q3?: string };
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
  return { id: "root", type: "folder", name: "(根目录)", children: [] };
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
  const [openFileIdsByProject, setOpenFileIdsByProject] = useState<Record<string, string[]>>({});
  const [activeFileIdByProject, setActiveFileIdByProject] = useState<Record<string, string | null>>({});
  const [contextMenu, setContextMenu] = useState<ContextMenuState>(null);
  const [renaming, setRenaming] = useState<{ nodeId: string; value: string } | null>(null);
  const [moveTarget, setMoveTarget] = useState<{ nodeId: string; targetFolderId: string } | null>(null);

  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [projectConversations, setProjectConversations] = useState<Record<string, Conversation[]>>({});
  const [activeConversationIdByProject, setActiveConversationIdByProject] = useState<Record<string, string | null>>({});
  const [draft, setDraft] = useState("");
  const [chatSaveStatus, setChatSaveStatus] = useState("已保存");
  const [chatCaret, setChatCaret] = useState(0);
  const [commandActiveIndex, setCommandActiveIndex] = useState(0);
  const [dismissedCommandToken, setDismissedCommandToken] = useState<string | null>(null);

  const [selectedModelId, setSelectedModelId] = useState<string | null>(null);
  const [isModelSelectorOpen, setIsModelSelectorOpen] = useState(false);
  const modelSelectorRef = useRef<HTMLDivElement>(null);

  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [fileVersions, setFileVersions] = useState<Record<string, number>>({});

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
        if (parsed?.id === "root") {
          loaded = parsed;
          if (loaded.name !== "(根目录)") loaded.name = "(根目录)";
        }
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

  const activeFileId = useMemo(() => {
    if (!activeProjectId) return null;
    return activeFileIdByProject[activeProjectId] ?? null;
  }, [activeProjectId, activeFileIdByProject]);

  const openTabs = useMemo(() => {
    if (!activeProjectId) return [];
    return openFileIdsByProject[activeProjectId] ?? [];
  }, [activeProjectId, openFileIdsByProject]);

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
  const abortControllerRef = useRef<AbortController | null>(null);
  const pendingWriteConfirmRef = useRef<{ episode: number } | null>(null);
  const pendingStartupOutlineRef = useRef<{ q1: string[]; q2: string; q3: string } | null>(null);
  const chatInputRef = useRef<HTMLTextAreaElement | null>(null);

  const openFileInTab = (fileId: string) => {
    if (!activeProjectId) return;
    setOpenFileIdsByProject((prev) => {
      const current = prev[activeProjectId] ?? [];
      if (current.includes(fileId)) return prev;
      return { ...prev, [activeProjectId]: [...current, fileId] };
    });
    setActiveFileIdByProject((prev) => ({ ...prev, [activeProjectId]: fileId }));
  };

  const activateTab = (fileId: string) => {
    if (!activeProjectId) return;
    setActiveFileIdByProject((prev) => ({ ...prev, [activeProjectId]: fileId }));
  };

  const closeTab = (fileId: string) => {
    if (!activeProjectId) return;
    const pid = activeProjectId;
    setOpenFileIdsByProject((prev) => {
      const current = prev[pid] ?? [];
      const idx = current.indexOf(fileId);
      if (idx === -1) return prev;
      const nextTabs = current.filter((x) => x !== fileId);
      if (fileId === activeFileId) {
        const nextActive = nextTabs[idx] ?? nextTabs[idx - 1] ?? null;
        setActiveFileIdByProject((p) => ({ ...p, [pid]: nextActive }));
      }
      return { ...prev, [pid]: nextTabs };
    });
  };

  const removeFileFromAllTabs = (fileId: string) => {
    setOpenFileIdsByProject((prev) => {
      const entries = Object.entries(prev).map(([pid, ids]) => [pid, (ids ?? []).filter((x) => x !== fileId)] as const);
      return Object.fromEntries(entries);
    });
    setActiveFileIdByProject((prev) => {
      const next: Record<string, string | null> = { ...prev };
      for (const [pid, active] of Object.entries(prev)) {
        if (active === fileId) next[pid] = null;
      }
      return next;
    });
  };

  useEffect(() => {
    const raw = window.localStorage.getItem("meon:tabs:v1");
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as {
        v: number;
        openFileIdsByProject?: Record<string, string[]>;
        activeFileIdByProject?: Record<string, string | null>;
      };
      if (parsed?.v !== 1) return;
      if (parsed.openFileIdsByProject) setOpenFileIdsByProject(parsed.openFileIdsByProject);
      if (parsed.activeFileIdByProject) setActiveFileIdByProject(parsed.activeFileIdByProject);
    } catch {}
  }, []);

  useEffect(() => {
    const payload = {
      v: 1,
      openFileIdsByProject,
      activeFileIdByProject,
    };
    window.localStorage.setItem("meon:tabs:v1", JSON.stringify(payload));
  }, [openFileIdsByProject, activeFileIdByProject]);

  useEffect(() => {
    if (!activeProjectId) return;
    const pid = activeProjectId;
    const current = openFileIdsByProject[pid] ?? [];
    const filtered = current.filter((id) => {
      const found = findNode(root, id);
      return !!found && found.node.type === "file" && nodeIsInActiveProject(id);
    });
    const same =
      filtered.length === current.length && filtered.every((id, idx) => id === current[idx]);
    if (!same) {
      setOpenFileIdsByProject((prev) => ({ ...prev, [pid]: filtered }));
    }
    const active = activeFileIdByProject[pid] ?? null;
    const nextActive = active && filtered.includes(active) ? active : filtered[0] ?? null;
    if (nextActive !== active) {
      setActiveFileIdByProject((prev) => ({ ...prev, [pid]: nextActive }));
    }
  }, [root, activeProjectId, openFileIdsByProject, activeFileIdByProject]);

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
    const name = "新项目";

    // 预置 main-agent.md 内容
    const mainAgentContent = `---
name: Short-Drama-CN
description: 将Claude Code的输出转换为适合中国微短剧的创作风格，特点是对话极简犀利、场景描述精炼、节奏紧凑、冲突密集，符合1-3分钟短视频的观看习惯
---

# 写作风格总则
- 对话口语化，贴近生活但去掉语气词赘述，每句不超过15字
- 场景描述极简，只写必要动作和表情，避免心理描写和环境渲染
- 冲突直接外化，通过行动和对话展现，拒绝内心独白
- 节奏如鼓点，每个场景3-5个节拍完成（铺垫-冲突-转折）
- 情绪饱和度高，用极端情境代替细腻铺垫
- 语言现代网感，可用流行梗但避免过时网络用语

## 具体行为
- 写对话时：直接切入矛盾核心，第一句话就要有信息量，删掉所有"你知道吗""其实吧"等填充词
- 写动作时：只写"他扇了她一巴掌"，不写"他愤怒地扬起右手，狠狠地..."
- 写转折时：用动作或台词直接翻转，如"总裁撕掉合同：'我不同意'"，不做心理铺垫
- 写爽点时：密集叠加3个递进动作，如"推门-亮身份-全场跪"
- 写虐点时：一句话见血，如"妈妈选择了妹妹"，不煽情不渲染
- 处理伏笔时：埋设用细节动作（如捡起一张照片），回收用台词点破
- 每场结尾：必须留钩子，可以是未完成的动作、说一半的话、或突然出现的人

## 主 Agent 提示词逻辑

### 节奏控制
- 单集时长控制在1-3分钟内，信息密度极高
- 每集必须有至少1个冲突点或反转
- 对话简短有力，避免冗长独白
- 场景转换迅速，1-3个场景解决一集剧情

### 爽点分布
- 第1集：强开场钩子，3分钟内必须抓住观众
- 第1-10集：每2-3集一个小高潮
- 第11-20集：免费段末尾设置强悬念，激发付费
- 第21集后：5集一个中型爽点，20集一个大爆点
- 全剧：至少10个以上反转，保持观众新鲜感

### 开场要求
- 前3集决定成败，必须包含：
  - 强冲突开场（如被欺辱、身份曝光、意外事件）
  - 主角困境展示（让观众产生共情）
  - 悬念设置（引发好奇心）
  - 第一个小爽点（给观众即时满足）

### 付费转化设计
- 第18-20集：剧情达到小高潮
- 第20-21集：设置强悬念或重大转折
- 付费后立即给予情感回报
- 每10集保证至少3个值得讨论的话题点

### 情感曲线
- 虐点和爽点交替出现，避免情绪疲劳
- 压抑不超过3集，必须释放
- 甜宠剧：甜虐比例7:3
- 复仇剧：前期虐3-5集，后期持续爽

### 人物塑造快速化
- 第1集必须建立主角人设
- 用标签化特征快速让观众记住角色
- 通过极端事件展示性格，而非缓慢铺垫
- 配角功能明确，不拖泥带水

## 用户启动引导（主 Agent 首轮对话）

当用户开始一个新的短剧项目时，主 Agent **必须先进行创作方向确认**，不要直接生成剧情，而是先询问用户以下问题。

主 Agent 开场白模板：

你是一位**专门创作爆款短剧剧本的编剧助手**，擅长快节奏叙事、密集爽点设计和反转情节编排，让观众一集接一集停不下来。

让我们开始创作你的短剧故事！

开始创作短剧剧本之前，我们先做“方向三问”，并且**分三次提问**（一问一答再问下一问），不要一次把三问全部抛给用户。

第1问（先问这一问，等用户回答后再继续）：

**Q1：剧本方向（选择1-2个）**
甜宠【甜蜜互宠】 | 虐恋【虐心情深】 | 萌宝【亲子温馨】 | 团宠【全员宠爱】 | 真假千金【身份互换】 | 女强复仇【逆袭打脸】 | 宫斗【权谋争斗】 | 逆袭【咸鱼翻身】 | 重生【重活一世】 | 战神【王者归来】 | 赘婿【隐忍崛起】 | 神医【妙手回春】 | 鉴宝【慧眼识珠】 | 年代【时代变迁】 | 乡村【田园生活】 | 神豪【一夜暴富】 | 职场【商战风云】 | 高手下山【隐世高人】 | 都市脑洞【奇思妙想】 | 无敌流【开局巅峰】

第2问（收到 Q1 答案后再问）：

**Q2：结局类型（选择1个）**
大团圆【皆大欢喜】 | 开放式【留白想象】 | 反转【意外惊喜】 | 悲剧【遗憾收场】

第3问（收到 Q2 答案后再问）：

**Q3：核心爽点（一句话）**
示例：女主当众打脸渣男渣女 / 男主隐藏身份震惊全场 / 萌宝助攻撮合父母 / 落魄少爷逆袭豪门

在收到三问回答后，主 Agent 才进入 **故事大纲 → 人物小传 → 集目录 → 剧本正文** 的创作流程。`;

    // 预置 main-agentch.md 内容
    const mainAgentChContent = `[角色]
你是一名专业的短剧编剧，负责创作完整的短剧项目，包括剧情简介、故事大纲、人物小传、集目录和每集正文。你精通剧本写作、人物塑造、情节设计和节奏把控，并通过与两个SubAgent协作确保创作质量。

[任务]
管理完整的剧本创作工作流程，包括剧情构思与讨论、故事架构搭建、人物设计塑造、分集规划、剧本正文创作。确保每个阶段的质量把控和一致性检查，协调sub-agent完成对齐验证和进度记录，为用户提供从创意到剧本的专业创作服务。

[技能]
- **故事架构**：构建完整的故事世界观、主线剧情、支线情节
- **人物塑造**：创造立体的人物形象、设计人物强光、安排人物关系
- **剧本写作**：专业的剧本格式、生动的对话、精准的场景描述
- **节奏控制**：把握剧情起承转合、控制冲突张力、安排高潮节点
- **一致性维护**：确保前后剧情连贯、人物行为合理、设定不矛盾
- **流程调度**：调用专业sub-agent完成质量检查和进度记录
- **逻辑合理性把控**：注意时间、年龄、数量等基本逻辑的合理性
- **模板遵循原则**：修改内容时可以根据需要联动调整相关部分，确保整体一致性，但所有调整都必须符合对应的模板规范
- **结构完整原则**：修改后的文档必须保持模板的完整结构，不能遗漏必要的标题、标记或段落，不能打乱模板定义的层级关系
- **文件管理**：维护outline.md、character.md、episode_index.md、episodes等项目文档

[文件结构]
新项目/
  ├─ agent-settings/          # Agent 配置文件夹
  │   ├─ main-agent.md        # 主 Agent (Short-Drama-CN) 配置文件
  │   ├─ script-aligner.md    # 剧本质量检查员配置文件
  │   └─ script-recorder.md   # 进度记录员配置文件
  ├─ episodes/                # 剧本正文文件夹（初始为空）
  │   ├─ EP-01.md        # 第一集
  │   ├─ EP-02.md        # 第二集
  │   └─ ...
  ├─ episode_index.md         # 集目录（初始为空）
  ├─ character.md             # 人物小传（初始为空）
  ├─ outline.md               # 剧情简介和故事大纲（初始为空）
  └─ script.progress.md       # 创作进度记录（初始为空）

[总体规则]
- 严格按照 故事大纲 → 人物小传 → 集目录 → 剧本正文 的流程创作
- 创作内容必须先通过 script-aligner 检查后才能写入文档
- 文档写入成功后必须调用 script-recorder 记录创作进度
- 工作流程：创作 → aligner检查 → (修改) → 再检查 → 通过后写入文档 → recorder记录 → 通知用户
- 无论用户如何打断或提出新的修改意见，在完成当前回答后，始终引导用户进入到流程的下一步，保持对话的连贯性和结构性
- 确保文件在各阶段的完整性
- 始终使用**中文**进行创作和交流

[自动触发规则]
- 每次主 Agent 生成或修改任何关键文档（outline.md、character.md、episode_index.md、EP-XX.md）前，必须自动调用 script-aligner 进行检查；除非用户明确下达跳过检查的指令。
- 当 script-aligner 返回 FAIL 时，主 Agent 必须根据 aligner 指示进行修正并重新提交检查；通常检查1次，必要时最多复检2次；仅在明确 FAIL 时进入修订，第2次仍 FAIL 则强制通过并附带建议，允许Agent根据此建议最后修改，不再检查。
- 在文档被写入 repository（写入文件系统或数据库）后，必须自动调用 script-recorder 记录变更并更新 script.progress.md。
- 任何章节关键字（如付费点、主要反转、人物死亡、身份揭露）被新增/修改时，script-recorder 要立即标记为“高影响变更”，并在记录中单独列出影响点与关联集数。
- 定期（例如每完成10集）触发一次全量对齐检查：由主 Agent 调用 script-aligner 对 outline.md + episode_index.md + 最近10集 EP 文件进行批量检查，并生成汇总报告。
- 若用户发出 \`/check all\`，则触发手动全量检查；若发出 \`/record now\`，则立即调用 script-recorder 生成一次快照记录。`;

    // 预置 script-aligner.md 内容
    const scriptAlignerContent = `---
name: script-aligner
description: 剧本质量检查员，负责对主 Agent 产出的各类文档进行格式、风格、逻辑和节奏的自动化校验，并以结构化问题清单返回修改建议或PASS结果。
---

[角色]
你是剧本检查员（script-aligner），精通短剧写作法则、节奏控制、人物一致性与伏笔管理，负责把关每次主 Agent 的输出，确保其符合项目规范与观众体验要求。

[任务]
- 读取主 Agent 提交的文档（outline.md / character.md / episode_index.md / EP-XX.md）
- 建立基于项目写作规范的检查基准
- 对文档进行分项校验并输出结构化结果（PASS 或 FAIL + 详细问题）
- 若 FAIL，提供明确的修改方向与示例（最小可行修改），便于主 Agent 快速修正

[技能]
- 节奏与信息密度评估
- 冲突/爽点/付费点分布检测
- 人物人设一致性检测与记忆点确认
- 场景/镜头数量限制检测
- 伏笔埋设与回收检查
- 基本事实与逻辑矛盾检出（时间、年龄、数量等）

[检查流程]
1. 读取基准文档
   - 读取已完成的相关文档
   - 提取关键设定和约束（世界观、人物关系、重要道具、关键时间线）
   - 建立检查基准

2. 执行分项检查
   对于 outline 检查：
   - 类型是否明确（如甜宠/复仇/悬疑）
   - 集数是否合理（建议单线 80-100 集或按用户需求调整）
   - 冲突是否够强烈且持续
   - 结构是否完整（起承转合清晰）
   - 基本逻辑是否合理（核心事件能否驱动后续剧情）

   对于 character 检查：
   - 主角是否有记忆点（标签/事件）
   - 人物标签是否清晰、一致
   - 人物关系网是否合理且可推动剧情
   - 与故事大纲是否匹配（动机/背景无冲突）
   - 人物设定是否符合常识或类型期待

   对于 episode_index 检查：
   - 爽点分布是否符合法则（每2-3集小高潮等）
   - 第20集是否设置付费点（如有商业化设计）
   - 话题点是否充足（每10集≥3）
   - 与大纲是否对应，是否存在掉线集

   对于 EP-XX 检查：
   - 与集目录是否一致（事件、人物出场）
   - 人物表现是否符合人设
   - 场景数量（建议 1-3 个，不超过）
   - 对话是否简短有力（检查句长与冗余填充词）
   - 信息密度是否足够高（是否有无关冗余）
   - 是否有冲突/反转（缺失则标注）
   - 伏笔处理是否恰当（是否被提前揭示或遗失）
   - 特殊集数特殊要求（如第1集需钩子，第20集需付费节点）
   - 剧情发展是否符合逻辑（时间线、动机自洽）

3. 第四步：判定结果
   - 如无问题：输出 PASS
   - 如有问题：输出具体问题，要求主 Agent 修改

[输出规范]
- 当检查通过：

【检查通过】
✅ **检查状态：PASS**

- 当检查未通过：
【检查未通过】
❌ **检查状态：FAIL**
需要修改以下问题：
**问题1**：<具体问题描述>
- 位置：<第几集/哪个部分>
- 原因：<违反了什么规则>
- 修改方向：<具体怎么改，给出改写示例或最小可行改动>

**问题2**：<如有>

请修改后重新提交检查。`;

    // 预置 script-recorder.md 内容
    const scriptRecorderContent = `---
name: script-recorder
description: 创作进度记录员，负责在文档写入后提取关键信息、维护进度追踪与变更日志，生成可回溯的 script.progress.md。
---

[角色]
你是 script-recorder，精通版本记录、变更影响评估与进度统计。你的职责是保证每次写入都有清晰、结构化的记录，支持后续复盘与审计。

[任务]
- 在主 Agent 将文档写入项目后（或在收到手动 /record 指令后），读取 outline.md、character.md、episode_index.md 与新写入的 EP-XX.md
- 提取并记录关键信息：集数、标题、主要事件、爽点/付费点、伏笔条目、变更摘要、作者/时间戳
- 生成或更新 script.progress.md，包含最新进度百分比、已完成集数、待完成集数、重要未回收伏笔列表、近期修改历史
- 对每次变更计算影响范围（列出受影响的集数与文档）并根据影响程度标注优先级
- 在记录中保持最小可追溯单元（每次变更生成一条日志条目），并保留原始改动前/后摘要

[输出规范]
- 输出为 markdown 格式（script.progress.md）：
  - 项目基本信息（项目名、当前版本、最后更新时间）
  - 进度概览（已完成X集 / 总X集，百分比）
  - 变更日志（时间戳、作者、变更摘要、影响范围、是否高影响）
  - 未回收伏笔列表（条目、首次出现集数、预期回收集数或待定）
  - 关键节点表（第1集钩子、第20集付费点、每10集讨论话题）
  - 建议操作（如需要重新审核大纲、回写伏笔、调整付费点）

[自动计算与规则]
- 进度计算：已完成集数 / 计划总集数 * 100%，当计划总集数变更时记录变更原因
- 伏笔追踪：每个伏笔分配唯一ID（e.g. F-001），记录首次出现集数、标签、预期回收集、当前状态（未回收/部分回收/已回收）
- 影响评估：当某次变更涉及“付费点/主要反转/人物死亡/身份揭露”等关键字，自动标注为高影响；当高影响变更影响超过3集时，标记为“需大纲审查”
- 历史保留：保留至少20条最新变更记录，旧记录归档但可检索

[行为细则]
- 记录要清晰、可检索、便于导出（markdown/CSV/JSON）
- 对每次记录给出简要摘要（1-2 行）与详细说明（若为高影响变更）
- 对于主 Agent 的合并修改，记录要列出所有子修改点（例如同时修改人物设定和第5-8集剧情）
- 提供 \`get_progress_summary()\` 的简短文本摘要，便于在通知或 UI 中直接展示

[触发与接口]
- 接收触发：文档写入后自动触发，或收到 \`/record\` 指令
- 输入格式：outline.md、character.md、episode_index.md、EP-XX.md 的文本
- 输出格式：markdown（script.progress.md），并可选 JSON 快照用于外部系统同步

[示例条目]
# \`http://script.progress.md/\` （示例）

项目名：<Project Name>
当前版本：v1.2
最后更新时间：2026-03-13 14:22

进度概览：已完成 12 / 80 集（15%）

变更日志：

- 2026-03-13 14:10 | 作者：主Agent-Alice | 修改：EP-12 对话精简，修复 F-003 伏笔未回收问题 | 影响：EP-12，EP-15（中）
- 2026-03-12 09:05 | 作者：主Agent-Alice | 新增第20集付费节点草案 | 影响：EP-20（高）

未回收伏笔：

- F-001：遗失的照片（首次：EP-01，预期回收：EP-10）
- F-002：陌生号码（首次：EP-03，预期回收：EP-08）

关键节点：

- 第1集：强钩子（须在前30秒内完成）
- 第20集：付费节点（须在付费后立即给出情感回报）`;

    // 辅助函数：创建文件节点并保存内容
    const createFileNode = (filename: string, content: string): FsNode => {
      const fileId = uid("md");
      const key = `fs:${fileId}`;
      const jsonContent = {
        type: "doc",
        content: content.split('\n').map(line => ({
          type: "paragraph",
          content: line ? [{ type: "text", text: line }] : []
        }))
      };

      window.localStorage.setItem(`${key}:novel-content`, JSON.stringify(jsonContent));
      window.localStorage.setItem(`${key}:markdown`, content);
      window.localStorage.setItem(`${key}:html-content`, "");

      return { id: fileId, type: "file", name: filename, content: "" };
    };

    // 1. 创建 agent-settings 文件夹及其内容
    const agentSettingsFolderId = uid("f");
    const agentSettingsChildren = [
      createFileNode("main-agent.md", mainAgentContent),
      createFileNode("main-agentch.md", mainAgentChContent),
      createFileNode("script-aligner.md", scriptAlignerContent),
      createFileNode("script-recorder.md", scriptRecorderContent)
    ];
    const agentSettingsFolder: FsNode = {
      id: agentSettingsFolderId,
      type: "folder",
      name: "agent-settings",
      children: agentSettingsChildren
    };

    // 2. 创建 episodes 文件夹（为空）
    const episodesFolderId = uid("f");
    const episodesFolder: FsNode = {
      id: episodesFolderId,
      type: "folder",
      name: "episodes",
      children: []
    };

    // 3. 创建根目录下的其他空文件
    const rootFiles = [
      createFileNode("episode_index.md", ""),
      createFileNode("character.md", ""),
      createFileNode("outline.md", ""),
      createFileNode("script.progress.md", "")
    ];

    setRoot((prev) => attachNode(prev, parentId, { 
      id, 
      type: "folder", 
      name, 
      children: [
        agentSettingsFolder,
        episodesFolder,
        ...rootFiles
      ] 
    }));
    setExpanded((prev) => new Set(prev).add(parentId).add(id).add(agentSettingsFolderId).add(episodesFolderId));
    setRenaming({ nodeId: id, value: name });
  };

  const createMdFile = (parentId: string) => {
    if (parentId === "root") return;
    if (!nodeIsInActiveProject(parentId)) return;
    const id = uid("md");
    const name = "新建文档.md";
    setRoot((prev) => attachNode(prev, parentId, { id, type: "file", name, content: "" }));
    setExpanded((prev) => new Set(prev).add(parentId));
    openFileInTab(id);
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
    removeFileFromAllTabs(id);
    setRoot((prev) => removeNode(prev, id));
    setExpanded((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
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
    openFileInTab(orphanId);
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
  const [questionSelections, setQuestionSelections] = useState<Record<string, string[]>>({});
  const [questionAnswered, setQuestionAnswered] = useState<Record<string, boolean>>({});
  const [questionTextInputs, setQuestionTextInputs] = useState<Record<string, string>>({});

  const activeConversationTodos = useMemo(() => {
    return activeConversation?.aiTodos ?? [];
  }, [activeConversation?.aiTodos]);

  const stopGenerating = () => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setIsGenerating(false);
  };

  // --- File System Capabilities ---
  const checkFileAccess = (path: string, type: FileActionType = "read") => {
    const normalized = path.replace(/\\/g, "/").replace(/^\.\//, "");
    const isWriteLike = type === "write" || type === "append" || type === "replace";
    if (isWriteLike && (normalized.startsWith("agent-settings/") || normalized.includes("/agent-settings/"))) return false;
    return true;
  };

  const generateFileTreeContext = (node: FsNode, depth = 0): string => {
    if (node.id === "root") {
      return node.children?.map((c) => generateFileTreeContext(c, depth)).join("\n") || "";
    }
    const indent = "  ".repeat(depth);
    let output = `${indent}- ${node.name} (${node.type})`;
    if (node.type === "folder" && node.children) {
      output += "\n" + node.children.map((c) => generateFileTreeContext(c, depth + 1)).join("\n");
    }
    return output;
  };

  const executeFsAction = (type: FileActionType, path: string, content?: string, options?: { search?: string }): string => {
    if (!activeProjectId) return "Error: No active project.";
    const normalizedPath = path.replace(/\\/g, "/");
    if (!checkFileAccess(normalizedPath, type)) return `Error: Access denied to '${path}'.`;

    const parts = normalizedPath.split("/").filter((p) => p && p !== ".");
    if (parts.length === 0) return "Error: Invalid path.";

    const findFolderByPath = (startNode: FsNode, pathParts: string[]): FsNode | null => {
      if (pathParts.length === 0) return startNode;
      const [currentName, ...rest] = pathParts;
      const child = startNode.children?.find((c) => c.name === currentName && c.type === "folder");
      if (!child) return null;
      return findFolderByPath(child, rest);
    };

    const projectRoot = findNode(root, activeProjectId)?.node;
    if (!projectRoot) return "Error: Project root not found.";

    if (type === "write" || type === "append" || type === "replace") {
      const fileName = parts[parts.length - 1];
      const folderPath = parts.slice(0, -1);
      
      let parentNode = projectRoot;
      if (folderPath.length > 0) {
        const foundFolder = findFolderByPath(projectRoot, folderPath);
        if (!foundFolder) return `Error: Folder '${folderPath.join("/")}' not found.`;
        parentNode = foundFolder;
      }
      
      const existingFile = parentNode.children?.find((c) => c.name === fileName && c.type === "file");
      const fileContent = content || "";

      if (existingFile) {
        const key = `fs:${existingFile.id}`;
        
        let finalContent = fileContent;
        if (type === "append") {
            const currentContent = window.localStorage.getItem(`${key}:markdown`) ?? "";
            finalContent = currentContent + (currentContent && !currentContent.endsWith("\n") ? "\n" : "") + fileContent;
        } else if (type === "replace") {
            const currentContent = window.localStorage.getItem(`${key}:markdown`) ?? "";
            const searchStr = options?.search;
            if (!searchStr) return "Error: Missing 'search' attribute for replace action.";
            if (!currentContent.includes(searchStr)) return `Error: String '${searchStr}' not found in file.`;
            // Replace only the first occurrence to be safe, or all? usually first is safer for context
            // Use a callback function for the replacement to prevent special replacement patterns (like $&, $1) from being processed
            finalContent = currentContent.replace(searchStr, () => fileContent);
        }

        window.localStorage.setItem(`${key}:markdown`, finalContent);
        // Remove novel-content and html-content to force re-render from markdown
        window.localStorage.removeItem(`${key}:novel-content`);
        window.localStorage.removeItem(`${key}:html-content`);
        
        // Dispatch storage event manually for same-window updates
        window.dispatchEvent(new StorageEvent('storage', {
            key: `${key}:markdown`,
            newValue: finalContent,
            storageArea: window.localStorage
        }));
        
        setFileVersions((prev) => ({ ...prev, [existingFile.id]: (prev[existingFile.id] || 0) + 1 }));
        return `Success: ${type === "append" ? "Appended to" : type === "replace" ? "Replaced content in" : "Updated"} file '${path}'.`;
      } else {
        if (type === "append" || type === "replace") {
             if (type === "replace") return `Error: File '${path}' not found for replace action.`;
            // Treat append as write for new files
        }
        const fileId = uid("md");
        const key = `fs:${fileId}`;
        window.localStorage.setItem(`${key}:markdown`, fileContent);
        window.localStorage.removeItem(`${key}:novel-content`);
        window.localStorage.removeItem(`${key}:html-content`);
        
        // Dispatch storage event manually for same-window updates
        window.dispatchEvent(new StorageEvent('storage', {
            key: `${key}:markdown`,
            newValue: fileContent,
            storageArea: window.localStorage
        }));

        const newFileNode: FsNode = { id: fileId, type: "file", name: fileName, content: "" };
        setRoot((prev) => attachNode(prev, parentNode.id, newFileNode));
        setFileVersions((prev) => ({ ...prev, [fileId]: 1 }));
        return `Success: Created file '${path}'.`;
      }
    } else if (type === "read") {
        let targetNode = projectRoot;
        for (const part of parts) {
            const child = targetNode.children?.find((c) => c.name === part);
            if (!child) return `Error: File '${path}' not found.`;
            targetNode = child;
        }
        if (targetNode.type !== "file") return `Error: '${path}' is not a file.`;
        
        const key = `fs:${targetNode.id}`;
        const markdown = window.localStorage.getItem(`${key}:markdown`) ?? "";
        return `Content of '${path}':\n${markdown}`;
    }
    return "Error: Unknown action.";
  };

  type DramaCommand =
    | { kind: "outline"; setup: { q1: string[]; q2: string; q3: string } }
    | { kind: "character" }
    | { kind: "catalog" }
    | { kind: "write"; episode: number; force?: boolean }
    | { kind: "compress" }
    | { kind: "checkAll" }
    | { kind: "recordNow" };

  const parseDramaCommand = (raw: string): DramaCommand | null => {
    const t = raw.trim();
    if (!t.startsWith("/")) return null;
    const parts = t.split(/\s+/).filter(Boolean);
    const cmd = parts[0]?.toLowerCase();
    if (cmd === "/character") return { kind: "character" };
    if (cmd === "/catalog") return { kind: "catalog" };
    if (cmd === "/compress") return { kind: "compress" };
    if (cmd === "/check" && parts[1]?.toLowerCase() === "all") return { kind: "checkAll" };
    if (cmd === "/record") return { kind: parts[1]?.toLowerCase() === "now" ? "recordNow" : "recordNow" };
    if (cmd === "/write") {
      const nRaw = parts[1];
      const n = nRaw ? Number.parseInt(nRaw, 10) : NaN;
      if (!Number.isFinite(n) || n <= 0) return null;
      const force = parts.some((p) => p === "--force" || p === "-f" || p === "!" || p.toLowerCase() === "force");
      return { kind: "write", episode: n, force };
    }
    return null;
  };

  const formatEpisodeFile = (episode: number) => `EP-${String(episode).padStart(2, "0")}.md`;

  const commandCatalog = useMemo(
    () =>
      [
        { title: "/character", insert: "/character", description: "生成人物小传（需要 outline.md）" },
        { title: "/catalog", insert: "/catalog", description: "生成分集目录（需要 outline.md + character.md）" },
        { title: "/write", insert: "/write 1", description: "生成指定集数（例如 /write 12）" },
        { title: "/check all", insert: "/check all", description: "全量一致性检查（最近10集）" },
        { title: "/record now", insert: "/record now", description: "立即更新 script.progress.md" },
        { title: "/compress", insert: "/compress", description: "生成 context.summary.md" },
      ] as const,
    [],
  );

  const commandHint = useMemo(() => {
    if (!activeProjectId || isGenerating) return null;
    const caret = Math.max(0, Math.min(chatCaret, draft.length));
    const before = draft.slice(0, caret);
    if (before.includes("\n")) return null;
    if (!before.startsWith("/")) return null;
    const token = before.trim();
    if (!token.startsWith("/")) return null;
    const tokenPrefix = token.split(/\s+/)[0] ?? "/";
    if (dismissedCommandToken && dismissedCommandToken === tokenPrefix) return null;
    const q = tokenPrefix.toLowerCase();
    const items = commandCatalog.filter((c) => c.title.toLowerCase().startsWith(q));
    if (items.length === 0) return null;
    const start = before.length - tokenPrefix.length;
    const end = before.length;
    return { tokenPrefix, items, replace: { start, end } };
  }, [activeProjectId, isGenerating, chatCaret, draft, dismissedCommandToken, commandCatalog]);

  useEffect(() => {
    if (!commandHint) {
      setCommandActiveIndex(0);
      return;
    }
    setDismissedCommandToken((prev) => (prev === commandHint.tokenPrefix ? prev : null));
    setCommandActiveIndex((prev) => {
      const max = commandHint.items.length - 1;
      return Math.max(0, Math.min(prev, max));
    });
  }, [commandHint]);

  const applyCommandHint = (insert: string) => {
    if (!commandHint) return;
    const next = draft.slice(0, commandHint.replace.start) + insert + draft.slice(commandHint.replace.end);
    setDraft(next);
    setDismissedCommandToken(null);
    const nextCaret = commandHint.replace.start + insert.length;
    setChatCaret(nextCaret);
    window.requestAnimationFrame(() => {
      const el = chatInputRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(nextCaret, nextCaret);
    });
  };

  const getMarkdownByPath = (path: string) => {
    if (!activeProjectId) return null;
    const normalizedPath = path.replace(/\\/g, "/").replace(/^\.\//, "");
    const parts = normalizedPath.split("/").filter((p) => p && p !== ".");
    if (parts.length === 0) return null;
    const projectRoot = findNode(root, activeProjectId)?.node;
    if (!projectRoot) return null;
    let targetNode = projectRoot;
    for (const part of parts) {
      const child = targetNode.children?.find((c) => c.name === part);
      if (!child) return null;
      targetNode = child;
    }
    if (targetNode.type !== "file") return null;
    const key = `fs:${targetNode.id}`;
    return window.localStorage.getItem(`${key}:markdown`) ?? "";
  };

  type StartupState = { step: 0 | 1 | 2 | 3; q1?: string[]; q2?: string; q3?: string };

  const getStartup = (c: Conversation | null) => c?.dramaSetup as StartupState | undefined;

  const setStartup = (updater: (prev: StartupState) => StartupState) => {
    if (!activeProjectId || !activeConversationId) return;
    setProjectConversations((prev) => ({
      ...prev,
      [activeProjectId]: (prev[activeProjectId] ?? []).map((c) => {
        if (c.id !== activeConversationId) return c;
        const current = getStartup(c) ?? { step: 0 };
        return { ...c, dramaSetup: updater(current) };
      }),
    }));
  };

  const pushAssistantQuestion = (q: UserQuestionPayload) => {
    if (!activeProjectId || !activeConversationId) return;
    const msg: ConversationMessage = { id: uid("m"), role: "assistant", content: "", question: q };
    setProjectConversations((prev) => ({
      ...prev,
      [activeProjectId]: (prev[activeProjectId] ?? []).map((c) => {
        if (c.id !== activeConversationId) return c;
        return { ...c, messages: [...c.messages, msg] };
      }),
    }));
  };

  const startupQ1Options = useMemo(
    () => [
      "甜宠【甜蜜互宠】",
      "虐恋【虐心情深】",
      "萌宝【亲子温馨】",
      "团宠【全员宠爱】",
      "真假千金【身份互换】",
      "女强复仇【逆袭打脸】",
      "宫斗【权谋争斗】",
      "逆袭【咸鱼翻身】",
      "重生【重活一世】",
      "战神【王者归来】",
      "赘婿【隐忍崛起】",
      "神医【妙手回春】",
      "鉴宝【慧眼识珠】",
      "年代【时代变迁】",
      "乡村【田园生活】",
      "神豪【一夜暴富】",
      "职场【商战风云】",
      "高手下山【隐世高人】",
      "都市脑洞【奇思妙想】",
      "无敌流【开局巅峰】",
    ],
    [],
  );

  const askStartupQ1 = () =>
    pushAssistantQuestion({
      header: "创作启动",
      question: "Q1：剧本方向（选择1-2个）",
      kind: "options",
      options: startupQ1Options.map((label) => ({ label })),
      multiSelect: true,
    });

  const askStartupQ2 = () =>
    pushAssistantQuestion({
      header: "创作启动",
      question: "Q2：结局类型（选择1个）",
      kind: "options",
      options: [
        { label: "大团圆【皆大欢喜】" },
        { label: "开放式【留白想象】" },
        { label: "反转【意外惊喜】" },
        { label: "悲剧【遗憾收场】" },
      ],
      multiSelect: false,
    });

  const askStartupQ3 = () =>
    pushAssistantQuestion({
      header: "创作启动",
      question: "Q3：核心爽点（一句话）",
      kind: "text",
      placeholder: "例如：女主当众打脸渣男渣女",
      multiline: false,
    });

  useEffect(() => {
    if (!activeProjectId || !activeConversationId) return;
    const c = projectConversations[activeProjectId]?.find((x) => x.id === activeConversationId) ?? null;
    if (!c) return;
    if (c.messages.length > 0) return;
    const outline = getMarkdownByPath("outline.md") ?? "";
    if (outline.trim()) return;
    const s = getStartup(c) ?? { step: 0 };
    if (s.step !== 0) return;
    setStartup(() => ({ step: 0 }));
    askStartupQ1();
  }, [activeProjectId, activeConversationId, projectConversations]);

  const listEpisodeMarkdowns = () => {
    if (!activeProjectId) return [];
    const projectRoot = findNode(root, activeProjectId)?.node;
    if (!projectRoot) return [];
    const episodesFolder = projectRoot.children?.find((c) => c.type === "folder" && c.name === "episodes");
    if (!episodesFolder || episodesFolder.type !== "folder") return [];
    const files = (episodesFolder.children ?? [])
      .filter((c) => c.type === "file" && /^EP-\d{2,}\.md$/i.test(c.name))
      .map((f) => ({ id: f.id, name: f.name }));
    const withNum = files
      .map((f) => {
        const m = f.name.match(/^EP-(\d+)\.md$/i);
        const n = m ? Number.parseInt(m[1], 10) : Number.NaN;
        return { ...f, n };
      })
      .filter((x) => Number.isFinite(x.n));
    withNum.sort((a, b) => b.n - a.n);
    return withNum.map((f) => ({ path: `episodes/${f.name}`, markdown: getMarkdownByPath(`episodes/${f.name}`) ?? "" }));
  };

  const callChatStream = async (
    requestConfig: { baseUrl: string; apiKey: string; modelName: string; params?: any },
    messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
    signal: AbortSignal,
    onDelta?: (delta: string, full: string) => void,
  ) => {
    const response = await fetch(`${requestConfig.baseUrl}/chat/completions`, {
      method: "POST",
      signal,
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${requestConfig.apiKey}`,
      },
      body: JSON.stringify({
        model: requestConfig.modelName,
        messages,
        stream: true,
        ...(requestConfig.params ?? {}),
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`API Error: ${response.status} - ${errText}`);
    }
    if (!response.body) throw new Error("No response body");

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let fullContent = "";
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      buffer += chunk;
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        if (trimmed === "data: [DONE]") continue;
        if (!trimmed.startsWith("data: ")) continue;
        try {
          const jsonStr = trimmed.slice(6);
          const json = JSON.parse(jsonStr);
          const delta = json.choices[0]?.delta?.content || "";
          if (!delta) continue;
          fullContent += delta;
          onDelta?.(delta, fullContent);
        } catch {
          continue;
        }
      }
    }

    return fullContent;
  };

  type AlignerStatus = "PASS" | "FAIL" | "UNKNOWN";

  const ALIGNER_MIN_CHECKS = 1;
  const ALIGNER_MAX_CHECKS = 2;

  const extractAlignerStatus = (raw: string): AlignerStatus => {
    const t = raw.trim();
    if (!t) return "UNKNOWN";

    // Prefer explicit status fields when the aligner follows the requested format.
    const explicitStatus =
      t.match(/检查状态[:：]\s*(PASS|FAIL)/i)?.[1] ??
      t.match(/^\s*(PASS|FAIL)\s*$/im)?.[1];
    if (explicitStatus) {
      return explicitStatus.toUpperCase() as Exclude<AlignerStatus, "UNKNOWN">;
    }

    const hasFail =
      /(^|\W)FAIL(\W|$)/i.test(t) ||
      t.includes("❌") ||
      t.includes("检查未通过") ||
      t.includes("需要修改以下问题") ||
      t.includes("请修改后重新提交检查");
    const hasPass =
      /(^|\W)PASS(\W|$)/i.test(t) ||
      t.includes("✅") ||
      t.includes("检查通过");

    if (hasFail && !hasPass) return "FAIL";
    if (hasPass && !hasFail) return "PASS";
    return "UNKNOWN";
  };

  const isAlignerPassLike = (status: AlignerStatus) => status !== "FAIL";

  const sanitizeAssistantToolOutput = (text: string) => {
    if (!text) return "";

    let sanitized = text;
    const blockTags = ["file_action", "user_question", "todo_action", "agent_action"];

    for (const tag of blockTags) {
      const blockRegex = new RegExp(`<${tag}(\\s+[^>]+)?>([\\s\\S]*?)<\\/${tag}>`, "g");
      sanitized = sanitized.replace(blockRegex, "");
    }

    const selfClosingRegex = /<(?:file_action|todo_action|agent_action)(\s+[^>]+)?\s*\/>/g;
    sanitized = sanitized.replace(selfClosingRegex, "");

    let cutoff = -1;
    for (const tag of blockTags) {
      cutoff = Math.max(cutoff, sanitized.lastIndexOf(`<${tag}`));
    }
    if (cutoff >= 0) {
      sanitized = sanitized.slice(0, cutoff);
    }

    return sanitized.trim();
  };

  const getStoryDocsSnapshot = () => {
    const outline = getMarkdownByPath("outline.md") ?? "";
    const character = getMarkdownByPath("character.md") ?? "";
    const episodeIndex = getMarkdownByPath("episode_index.md") ?? "";
    const eps = listEpisodeMarkdowns().slice(0, 10);
    return { outline, character, episodeIndex, eps };
  };

  const buildAlignerSystemPrompt = () => {
    const aligner = getMarkdownByPath("agent-settings/script-aligner.md")?.trim();
    if (!aligner) return null;
    return [
      aligner,
      "",
      "输出约束：",
      "- 返回必须简洁、结构化，便于解析",
      "- 必须明确给出 PASS 或 FAIL",
      "- 若 FAIL：每条问题给出最小可行修改示例，并标注影响范围与优先级",
      "- 不要输出```代码块，不要输出任何 XML 标签",
    ].join("\n");
  };

  const runFullAlignerCheck = async (
    requestConfig: { baseUrl: string; apiKey: string; modelName: string; params?: any },
    signal: AbortSignal,
  ) => {
    const systemAligner = buildAlignerSystemPrompt();
    if (!systemAligner) return { ok: false as const, message: "Error: 缺少 script-aligner 配置文件。" };

    const { outline, character, episodeIndex, eps } = getStoryDocsSnapshot();
    const payload = [
      "请对 outline.md、character.md、episode_index.md 与最近 10 集 EP 文件做全量一致性检查，输出 PASS/FAIL 与问题清单（含最小可行修改示例、影响范围、优先级）。",
      "",
      "【outline.md】",
      outline.trim() ? outline.trim() : "(空)",
      "",
      "【character.md】",
      character.trim() ? character.trim() : "(空)",
      "",
      "【episode_index.md】",
      episodeIndex.trim() ? episodeIndex.trim() : "(空)",
      "",
      ...eps.flatMap((ep) => ["", `【${ep.path}】`, ep.markdown.trim() ? ep.markdown.trim() : "(空)"]),
    ].join("\n");

    const report = await callChatStream(
      requestConfig,
      [
        { role: "system", content: systemAligner },
        { role: "user", content: payload },
      ],
      signal,
    );
    return { ok: true as const, report: report.trim() };
  };

  const runProgressRecorder = async (
    requestConfig: { baseUrl: string; apiKey: string; modelName: string; params?: any },
    signal: AbortSignal,
  ) => {
    const { outline, character, episodeIndex, eps } = getStoryDocsSnapshot();
    const progress = await runRecorderUpdate(
      requestConfig,
      signal,
      [
        { path: "outline.md", markdown: outline },
        { path: "character.md", markdown: character },
        { path: "episode_index.md", markdown: episodeIndex },
        ...eps.map((e) => ({ path: e.path, markdown: e.markdown })),
      ],
    );
    if (!progress) return { ok: false as const, message: "Error: 缺少 script-recorder 配置文件。" };

    const writeResult = executeFsAction("write", "script.progress.md", progress);
    if (writeResult.startsWith("Error:")) {
      return { ok: false as const, message: `更新失败：${writeResult}` };
    }

    return { ok: true as const, message: "已更新 script.progress.md。" };
  };

  const runRecorderUpdate = async (
    requestConfig: { baseUrl: string; apiKey: string; modelName: string; params?: any },
    signal: AbortSignal,
    changed: Array<{ path: string; markdown: string }>,
  ) => {
    const recorder = getMarkdownByPath("agent-settings/script-recorder.md")?.trim();
    if (!recorder) return null;
    const outline = getMarkdownByPath("outline.md") ?? "";
    const character = getMarkdownByPath("character.md") ?? "";
    const episodeIndex = getMarkdownByPath("episode_index.md") ?? "";
    const prevProgress = getMarkdownByPath("script.progress.md") ?? "";

    const userPayload = [
      "请基于以下项目文档与本次变更，输出 script.progress.md 的完整内容（markdown），不要使用```包裹，不要输出任何 XML 标签。",
      "",
      "【本次变更】",
      ...changed.map((c) => `- ${c.path}`),
      "",
      "【outline.md】",
      outline ? outline : "(空)",
      "",
      "【character.md】",
      character ? character : "(空)",
      "",
      "【episode_index.md】",
      episodeIndex ? episodeIndex : "(空)",
      "",
      "【script.progress.md（旧）】",
      prevProgress ? prevProgress : "(空)",
      "",
      ...changed.flatMap((c) => ["", `【${c.path}（新）】`, c.markdown ? c.markdown : "(空)"]),
    ].join("\n");

    const content = await callChatStream(
      requestConfig,
      [
        { role: "system", content: recorder },
        { role: "user", content: userPayload },
      ],
      signal,
    );
    return content.trim();
  };

  const runDramaCommand = async (
    cmd: DramaCommand,
    requestConfig: { baseUrl: string; apiKey: string; modelName: string; params?: any },
    signal: AbortSignal,
    assistantMsgId: string,
  ) => {
    if (!activeProjectId || !activeConversationId) return;

    const setAssistant = (text: string) => {
      setProjectConversations((prev) => ({
        ...prev,
        [activeProjectId]: (prev[activeProjectId] ?? []).map((c) => {
          if (c.id !== activeConversationId) return c;
          return { ...c, messages: c.messages.map((m) => (m.id === assistantMsgId ? { ...m, content: text } : m)) };
        }),
      }));
    };

    const addQuestion = (q: UserQuestionPayload) => {
      const msg: ConversationMessage = {
        id: uid("m"),
        role: "assistant",
        content: "",
        question: q,
      };
      setProjectConversations((prev) => ({
        ...prev,
        [activeProjectId]: (prev[activeProjectId] ?? []).map((c) => {
          if (c.id !== activeConversationId) return c;
          return { ...c, messages: [...c.messages, msg] };
        }),
      }));
    };

    const mainAgent = getMarkdownByPath("agent-settings/main-agent.md")?.trim();
    const mainAgentCh = getMarkdownByPath("agent-settings/main-agentch.md")?.trim();
    const systemAligner = buildAlignerSystemPrompt();
    if (!mainAgent || !mainAgentCh || !systemAligner) {
      setAssistant("Error: 缺少 agent-settings 配置文件，请新建项目或检查 agent-settings 文件夹。");
      return;
    }

    const outline = getMarkdownByPath("outline.md") ?? "";
    const character = getMarkdownByPath("character.md") ?? "";
    const episodeIndex = getMarkdownByPath("episode_index.md") ?? "";

    const systemMain = [
      mainAgentCh,
      "",
      mainAgent,
      "",
      "输出约束：",
      "- 必须使用中文",
      "- 只输出目标文档的完整 markdown 内容",
      "- 不要输出```代码块，不要输出任何 <file_action> / <todo_action> / <user_question> 标签",
    ].join("\n");

    const generateAndCheck = async (
      targetPath: string,
      buildMainUser: () => string,
      buildAlignerUser: (draft: string) => string,
    ) => {
      let draft = "";
      setAssistant("正在创作初稿…");
      draft = await callChatStream(requestConfig, [{ role: "system", content: systemMain }, { role: "user", content: buildMainUser() }], signal);
      draft = draft.trim();

      for (let i = 1; i <= ALIGNER_MAX_CHECKS; i++) {
        setAssistant(i === 1 ? "正在进行一致性检查…" : `正在进行复检…（第 ${i} 次）`);
        const report = await callChatStream(
          requestConfig,
          [{ role: "system", content: systemAligner }, { role: "user", content: buildAlignerUser(draft) }],
          signal,
        );
        const status = extractAlignerStatus(report);
        if (isAlignerPassLike(status) && i < ALIGNER_MIN_CHECKS) {
          continue;
        }
        if (isAlignerPassLike(status)) {
          const writeResult = executeFsAction("write", targetPath, draft);
          if (writeResult.startsWith("Error:")) {
            setAssistant(`写入失败：${writeResult}`);
            return { ok: false, report, draft };
          }

          const progress = await runRecorderUpdate(requestConfig, signal, [{ path: targetPath, markdown: draft }]);
          if (progress) {
            const progressWrite = executeFsAction("write", "script.progress.md", progress);
            if (progressWrite.startsWith("Error:")) {
              setAssistant(`已写入 ${targetPath}，但更新 script.progress.md 失败：${progressWrite}`);
              return { ok: true, report, draft };
            }
          }

          setAssistant(`已写入 ${targetPath}，并更新 script.progress.md。`);
          return { ok: true, report, draft };
        }

        if (i >= ALIGNER_MAX_CHECKS) {
          const writeResult = executeFsAction("write", targetPath, draft);
          if (writeResult.startsWith("Error:")) {
            setAssistant(`写入失败：${writeResult}\n\n【Aligner建议】\n${report.trim()}`);
            return { ok: false, report, draft };
          }

          const progress = await runRecorderUpdate(requestConfig, signal, [{ path: targetPath, markdown: draft }]);
          if (progress) {
            const progressWrite = executeFsAction("write", "script.progress.md", progress);
            if (progressWrite.startsWith("Error:")) {
              setAssistant(`已写入 ${targetPath}，但更新 script.progress.md 失败：${progressWrite}\n\n【Aligner建议】\n${report.trim()}`);
              return { ok: true, report, draft };
            }
          }

          setAssistant(`第 ${i} 次复检仍未通过，已强制通过并写入 ${targetPath}。\n\n【Aligner建议】\n${report.trim()}`);
          return { ok: true, report, draft };
        }

        setAssistant(`检查未通过，正在修订…（第 ${i} 次）`);
        draft = await callChatStream(
          requestConfig,
          [
            { role: "system", content: systemMain },
            {
              role: "user",
              content: [
                "根据以下 script-aligner 的反馈修订目标文档，并重新输出目标文档完整 markdown 内容（不要输出其他内容）。",
                "",
                "【检查反馈】",
                report.trim(),
                "",
                "【当前草稿】",
                draft.trim(),
              ].join("\n"),
            },
          ],
          signal,
        );
        draft = draft.trim();
      }

      return { ok: false, report: "", draft };
    };

    if (cmd.kind === "outline") {
      const { q1, q2, q3 } = cmd.setup;
      await generateAndCheck(
        "outline.md",
        () =>
          [
            "请基于用户的创作方向回答，先生成剧情简介与故事大纲（outline.md）。",
            "要求：短剧节奏、冲突密集、反转明确；给出世界观/主题、主线矛盾、主要人物关系、前20集节奏节点（含付费点建议如适用）。",
            "",
            "【用户回答】",
            `Q1：${q1.join("、")}`,
            `Q2：${q2}`,
            `Q3：${q3}`,
            "",
            "【outline.md（旧）】",
            outline.trim() ? outline.trim() : "(空)",
          ].join("\n"),
        (draft) =>
          [
            "请检查将要写入的 outline.md 是否符合短剧创作法则与基本逻辑一致性。",
            "",
            "【outline.md（旧）】",
            outline.trim() ? outline.trim() : "(空)",
            "",
            "【outline.md（新草稿）】",
            draft.trim(),
          ].join("\n"),
      );
      return;
    }

    if (cmd.kind === "character") {
      if (!outline.trim()) {
        setAssistant("outline.md 为空。请先完成大纲（生成并写入 outline.md），再运行 /character。");
        return;
      }
      await generateAndCheck(
        "character.md",
        () =>
          [
            "请基于 outline.md 生成 character.md（人物小传+分类）。",
            "要求：主角/反派/关键配角/群像分别成节；每人包含：标签、背景、动机、欲望、弱点、与主角关系、关键转折（可涉及集数）。",
            "",
            "【outline.md】",
            outline.trim(),
            "",
            "【character.md（旧）】",
            character.trim() ? character.trim() : "(空)",
          ].join("\n"),
        (draft) =>
          [
            "请检查将要写入的 character.md 是否符合短剧创作法则与项目一致性。",
            "",
            "【outline.md】",
            outline.trim(),
            "",
            "【character.md（旧）】",
            character.trim() ? character.trim() : "(空)",
            "",
            "【character.md（新草稿）】",
            draft.trim(),
          ].join("\n"),
      );
      return;
    }

    if (cmd.kind === "catalog") {
      if (!outline.trim()) {
        setAssistant("outline.md 为空。请先完成大纲（生成并写入 outline.md），再运行 /catalog。");
        return;
      }
      if (!character.trim()) {
        setAssistant("character.md 为空。请先运行 /character 生成人物小传，再运行 /catalog。");
        return;
      }
      await generateAndCheck(
        "episode_index.md",
        () =>
          [
            "请基于 outline.md 与 character.md 生成 episode_index.md（分集目录/每集框架）。",
            "要求：每集给出：集号、标题、场景数（1-3）、核心冲突、爽点/虐点、反转/钩子、关键人物出场。",
            "注意：第1集必须强钩子；每2-3集小高潮；第20集附近设置付费节点（如适用）。",
            "",
            "【outline.md】",
            outline.trim(),
            "",
            "【character.md】",
            character.trim(),
            "",
            "【episode_index.md（旧）】",
            episodeIndex.trim() ? episodeIndex.trim() : "(空)",
          ].join("\n"),
        (draft) =>
          [
            "请检查将要写入的 episode_index.md 是否符合短剧节奏/爽点分布/人物一致性，并与 outline.md、character.md 对齐。",
            "",
            "【outline.md】",
            outline.trim(),
            "",
            "【character.md】",
            character.trim(),
            "",
            "【episode_index.md（旧）】",
            episodeIndex.trim() ? episodeIndex.trim() : "(空)",
            "",
            "【episode_index.md（新草稿）】",
            draft.trim(),
          ].join("\n"),
      );
      return;
    }

    if (cmd.kind === "write") {
      if (!outline.trim()) {
        setAssistant("outline.md 为空。请先完成大纲（生成并写入 outline.md），再运行 /write [集数]。");
        return;
      }
      if (!character.trim()) {
        setAssistant("character.md 为空。请先运行 /character 生成人物小传，再运行 /write [集数]。");
        return;
      }
      if (!episodeIndex.trim()) {
        setAssistant("episode_index.md 为空。请先运行 /catalog 生成分集目录，再运行 /write [集数]。");
        return;
      }

      const fileName = formatEpisodeFile(cmd.episode);
      const targetPath = `episodes/${fileName}`;
      const existing = getMarkdownByPath(targetPath) ?? "";
      if (existing.trim() && !cmd.force) {
        pendingWriteConfirmRef.current = { episode: cmd.episode };
        setAssistant(`${fileName} 已存在，需要确认是否覆盖。`);
        addQuestion({
          header: "覆盖确认",
          question: `${fileName} 已存在，是否覆盖？`,
          kind: "options",
          options: [
            { label: "覆盖", description: "重新生成并覆盖现有内容" },
            { label: "取消", description: "保持现有内容不变" },
          ],
          multiSelect: false,
        });
        return;
      }

      pendingWriteConfirmRef.current = null;
      const latestEps = listEpisodeMarkdowns().slice(0, 10);
      await generateAndCheck(
        targetPath,
        () =>
          [
            `请根据 episode_index.md 的第 ${cmd.episode} 集框架，创作 ${fileName} 正文。`,
            "要求：1-3个场景；对话极简犀利（单句≤15字）；只写必要动作表情；每场结尾留钩子。",
            "输出格式：剧本正文（markdown），包含：标题、场景分隔、台词与动作。",
            "",
            "【outline.md】",
            outline.trim(),
            "",
            "【character.md】",
            character.trim(),
            "",
            "【episode_index.md】",
            episodeIndex.trim(),
            "",
            existing.trim() ? `【${fileName}（旧）】\n${existing.trim()}\n` : "",
            ...latestEps.flatMap((ep) => ["", `【参考：${ep.path}】`, (ep.markdown ?? "").trim() || "(空)"]),
          ]
            .filter(Boolean)
            .join("\n"),
        (draft) =>
          [
            `请检查将要写入的 ${fileName} 是否符合短剧节奏/人设一致性/集目录对齐，并标注影响范围。`,
            "",
            "【outline.md】",
            outline.trim(),
            "",
            "【character.md】",
            character.trim(),
            "",
            "【episode_index.md】",
            episodeIndex.trim(),
            "",
            `【${fileName}（新草稿）】`,
            draft.trim(),
          ].join("\n"),
      );
      return;
    }

    if (cmd.kind === "checkAll") {
      setAssistant("正在进行全量检查…");
      const result = await runFullAlignerCheck(requestConfig, signal);
      setAssistant(result.ok ? result.report : result.message);
      return;
    }

    if (cmd.kind === "recordNow") {
      setAssistant("正在更新进度记录…");
      const result = await runProgressRecorder(requestConfig, signal);
      setAssistant(result.message);
      return;
    }

    if (cmd.kind === "compress") {
      const convo = projectConversations[activeProjectId]?.find((c) => c.id === activeConversationId)?.messages ?? [];
      const tail = convo.slice(-40).map((m) => `${m.role.toUpperCase()}: ${m.content}`).join("\n\n");
      const system = [
        "你是上下文压缩器，负责把对话与文档状态压缩成可复用的项目记忆。",
        "输出必须是 markdown，不要使用```包裹，不要输出 XML 标签。",
        "必须包含：项目一句话简介、世界观/设定、人物关系、当前进度、未解决问题、下一步建议。",
      ].join("\n");
      const userPayload = [
        "请基于以下对话片段与当前文档，生成 context.summary.md 的完整内容。",
        "",
        "【outline.md】",
        outline.trim() ? outline.trim() : "(空)",
        "",
        "【character.md】",
        character.trim() ? character.trim() : "(空)",
        "",
        "【episode_index.md】",
        episodeIndex.trim() ? episodeIndex.trim() : "(空)",
        "",
        "【对话（最近）】",
        tail ? tail : "(空)",
      ].join("\n");
      setAssistant("正在压缩上下文…");
      const summary = await callChatStream(requestConfig, [{ role: "system", content: system }, { role: "user", content: userPayload }], signal);
      const writeResult = executeFsAction("write", "context.summary.md", summary.trim());
      if (writeResult.startsWith("Error:")) {
        setAssistant(`压缩完成，但写入 context.summary.md 失败：${writeResult}`);
        return;
      }
      setAssistant("已生成 context.summary.md。后续对话将优先使用该摘要以减少上下文长度。");
      return;
    }
  };

  const sendMessage = async (overrideRaw?: string) => {
    if (!activeProjectId) return;
    const raw = overrideRaw ?? draft;
    const trimmed = raw.trim();
    if (!trimmed || !activeConversationId) return;
    if (!overrideRaw) setDraft("");

    // Support both single and double quotes for attributes
    // Put the content-capturing group FIRST to ensure correct matching
    // New regex to be more attribute-agnostic
    const actionRegex = /<file_action(\s+[^>]+)(?:>([\s\S]*?)<\/file_action>|\s*\/?>)/g;
    const immediateResults: string[] = [];
    const immediateActions: { type: FileActionType; path: string; ok: boolean }[] = [];
    let immediateMatch: RegExpExecArray | null = null;
    while ((immediateMatch = actionRegex.exec(raw)) !== null) {
      const attrsStr = immediateMatch[1];
      const body = immediateMatch[2];
      
      const getAttr = (name: string) => {
          const match = attrsStr.match(new RegExp(`${name}=["']([^"']+)["']`));
          return match ? match[1] : undefined;
      };
      
      const type = getAttr("type") as FileActionType | undefined;
      const path = getAttr("path");
      const search = getAttr("search"); // for replace

      if (!type || !path) continue;

      const cleanBody = body ? body.trim() : undefined;
      const result = executeFsAction(type, path, cleanBody, { search });
      immediateResults.push(`[System] Action: ${type} ${path}\nResult: ${result}`);
      immediateActions.push({ type, path, ok: !result.startsWith("Error:") });
    }

    // Replace all matches in the original string with empty string
    const stripped = raw.replace(actionRegex, "").trim();
    const content = stripped;

    // Add system message first if there are actions
    if (immediateActions.length > 0) {
      const resultMsgId = uid("m");
      const resultContent = immediateResults.join("\n\n");
      setProjectConversations((prev) => ({
        ...prev,
        [activeProjectId]: (prev[activeProjectId] ?? []).map((c) => {
          if (c.id !== activeConversationId) return c;
          return {
            ...c,
            messages: [...c.messages, { id: resultMsgId, role: "system", content: resultContent, actions: immediateActions }],
          };
        }),
      }));
    }

    // Only proceed to send message to AI if there is actual content left
    if (!content) return;

    // 1. 添加用户消息到界面
    const userMsgId = uid("m");
    setProjectConversations((prev) => ({
      ...prev,
      [activeProjectId]: (prev[activeProjectId] ?? []).map((c) => {
        if (c.id !== activeConversationId) return c;
        return { ...c, messages: [...c.messages, { id: userMsgId, role: "user", content }] };
      }),
    }));

    const parseAnswer = (text: string) => {
      if (!text.startsWith("【回答】")) return null;
      const q = text.match(/^【回答】([^\n]+)\n/m)?.[1]?.trim();
      if (!q) return null;
      const chosen = text.match(/【选择】([^\n]+)/)?.[1]?.trim();
      const input = text.match(/【输入】([\s\S]+)$/)?.[1]?.trim();
      return { q, chosen, input };
    };

    const answer = parseAnswer(content);
    if (answer?.q === "Q1：剧本方向（选择1-2个）" && answer.chosen) {
      const labels = answer.chosen.split("、").map((s) => s.trim()).filter(Boolean);
      setStartup(() => ({ step: 1, q1: labels }));
      askStartupQ2();
      return;
    }
    if (answer?.q === "Q2：结局类型（选择1个）" && answer.chosen) {
      const choice = answer.chosen.trim();
      setStartup((prev) => ({ step: 2, q1: prev.q1 ?? [], q2: choice }));
      askStartupQ3();
      return;
    }
    if (answer?.q === "Q3：核心爽点（一句话）") {
      const q3 = (answer.input ?? "").trim();
      if (q3) {
        const s = getStartup(activeConversation) ?? { step: 0 };
        const q1 = s.q1 ?? [];
        const q2 = s.q2 ?? "";
        setStartup(() => ({ step: 3, q1, q2, q3 }));
        pendingStartupOutlineRef.current = { q1, q2, q3 };
      }
    }

    // 2. 准备 AI 回复的消息占位
    const assistantMsgId = uid("m");
    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;
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

      const pendingStartup = pendingStartupOutlineRef.current;
      if (pendingStartup) {
        pendingStartupOutlineRef.current = null;
        await runDramaCommand({ kind: "outline", setup: pendingStartup }, requestConfig, controller.signal, assistantMsgId);
        return;
      }

      const pending = pendingWriteConfirmRef.current;
      const isAnswer = content.startsWith("【回答】") && content.includes("【选择】");
      const answerChosen = isAnswer ? content.match(/【选择】([^\n]+)/)?.[1]?.trim() : null;
      const cmdFromAnswer =
        pending && isAnswer && answerChosen === "覆盖" ? ({ kind: "write", episode: pending.episode, force: true } as DramaCommand) : null;
      if (pending && isAnswer && answerChosen === "取消") {
        pendingWriteConfirmRef.current = null;
        setProjectConversations((prev) => ({
          ...prev,
          [activeProjectId]: (prev[activeProjectId] ?? []).map((c) => {
            if (c.id !== activeConversationId) return c;
            return {
              ...c,
              messages: c.messages.map((m) => (m.id === assistantMsgId ? { ...m, content: "已取消覆盖，未修改任何文件。" } : m)),
            };
          }),
        }));
        return;
      }

      const cmd = cmdFromAnswer ?? parseDramaCommand(content);
      if (cmd) {
        await runDramaCommand(cmd, requestConfig, controller.signal, assistantMsgId);
        return;
      }

      // 4. 调用 OpenAI 兼容接口
      const projectRoot = activeProjectId ? findNode(root, activeProjectId)?.node : null;
      const fileTree = projectRoot ? generateFileTreeContext(projectRoot) : "";
      const mainAgentRole = [getMarkdownByPath("agent-settings/main-agentch.md")?.trim(), getMarkdownByPath("agent-settings/main-agent.md")?.trim()]
        .filter(Boolean)
        .join("\n\n");
      const agentRoleBlock = mainAgentRole ? `\n\nAgent Role Prompts (read-only):\n${mainAgentRole}\n` : "";
      const systemPrompt = `You have the capability to read, write, append, and replace content in markdown files.
Current File Structure:
You can manage your own todo list shown at the top of the chat panel.
You can also ask the user a multiple-choice question when you need clarification.
${fileTree}${agentRoleBlock}

To write a file (overwrite):
<file_action type="write" path="folder/filename.md">
CONTENT
CONTENT
</file_action>

To append to a file:
<file_action type="append" path="folder/filename.md">
CONTENT_TO_APPEND
</file_action>

To replace content in a file (can be used to insert):
<file_action type="replace" path="folder/filename.md" search="STRING_TO_FIND">
REPLACEMENT_STRING
</file_action>

To read a file:
<file_action type="read" path="folder/filename.md" />

To ask the user a multiple-choice question:
<user_question header="SHORT_TITLE" question="QUESTION_TEXT" multi="false">
<option label="Option A" description="Short description" />
<option label="Option B" description="Short description" />
</user_question>

To ask the user for text input:
<user_question header="SHORT_TITLE" question="QUESTION_TEXT" type="text" placeholder="PLACEHOLDER" multiline="false">
</user_question>

To manage your todo list:
<todo_action type="set">
- [ ] 1: First task
- [~] 2: In progress task
- [x] 3: Done task
</todo_action>

<todo_action type="complete" id="2" />
<todo_action type="start" id="1" />
<todo_action type="read" />
<todo_action type="clear" />

To call a sub-agent tool:
<agent_action type="aligner" />
<agent_action type="recorder" />

Rules:
1. You CAN read files in 'agent-settings' folder, but CANNOT write to them.
2. You CAN create/write files in the project root and 'episodes' folder.
3. Path is relative to the current project root.
4. When you want to overwrite a file, use 'write'. When you want to add content to the end of a file, use 'append'. When you want to modify a specific part, use 'replace' (the 'search' attribute is required).
5. For <user_question> with options, provide 2-4 options. Use multi="true" only when multiple selections are allowed.
6. Use <agent_action type="aligner" /> to run a full consistency check, and <agent_action type="recorder" /> to update script.progress.md.`;

      // 构造发送给模型的消息列表
      const conversationHistory = projectConversations[activeProjectId]?.find(c => c.id === activeConversationId)?.messages || [];
      const contextSummary = getMarkdownByPath("context.summary.md")?.trim() || "";
      const useSummary = !!contextSummary && conversationHistory.length > 24;
      const historyForPrompt = useSummary ? conversationHistory.slice(-24) : conversationHistory;

      const messagesToSend: Array<{ role: "system" | "user" | "assistant"; content: string }> = [];
      messagesToSend.push({ role: "system", content: systemPrompt });
      if (useSummary) messagesToSend.push({ role: "system", content: `Project Memory (context.summary.md):\n${contextSummary}` });
      for (const m of historyForPrompt) {
        if (m.role === "system" && m.content) {
          messagesToSend.push({ role: "user", content: m.content });
          continue;
        }
        const role = (m.role === "system" ? "user" : m.role) as "user" | "assistant";
        messagesToSend.push({ role, content: m.content });
      }
      if (immediateResults.length > 0) messagesToSend.push({ role: "user", content: immediateResults.join("\n\n") });
      messagesToSend.push({ role: "user", content });

      const response = await fetch(`${requestConfig.baseUrl}/chat/completions`, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${requestConfig.apiKey}`,
        },
        body: JSON.stringify({
          model: requestConfig.modelName,
          messages: messagesToSend,
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
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        buffer += chunk;
        
        const lines = buffer.split("\n");
        // Keep the last line in buffer as it might be incomplete
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          if (trimmed === "data: [DONE]") continue;
          
          if (trimmed.startsWith("data: ")) {
            try {
              const jsonStr = trimmed.slice(6);
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
                        m.id === assistantMsgId ? { ...m, content: sanitizeAssistantToolOutput(fullContent) } : m
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

      const questionRegex = /<user_question(\s+[^>]+)>([\s\S]*?)<\/user_question>/g;
      const todoRegex = /<todo_action(\s+[^>]+)(?:>([\s\S]*?)<\/todo_action>|\s*\/?>)/g;
      const actionRegex = /<file_action(\s+[^>]+)(?:>([\s\S]*?)<\/file_action>|\s*\/?>)/g;
      const agentActionRegex = /<agent_action(\s+[^>]+)(?:>([\s\S]*?)<\/agent_action>|\s*\/?>)/g;
      type ParsedFsAction = { type: FileActionType; path: string; search?: string; body?: string };

      const updateAssistant = (text: string) => {
        setProjectConversations((prev) => ({
          ...prev,
          [activeProjectId]: (prev[activeProjectId] ?? []).map((c) => {
            if (c.id !== activeConversationId) return c;
            return {
              ...c,
              messages: c.messages.map((m) => (m.id === assistantMsgId ? { ...m, content: sanitizeAssistantToolOutput(text) } : m)),
            };
          }),
        }));
      };

      const parseFsActions = (text: string) => {
        const out: ParsedFsAction[] = [];
        actionRegex.lastIndex = 0;
        let match: RegExpExecArray | null = null;
        while ((match = actionRegex.exec(text)) !== null) {
          const attrsStr = match[1];
          const body = match[2];
          const getAttr = (name: string) => {
            const m = attrsStr.match(new RegExp(`${name}=["']([^"']+)["']`));
            return m ? m[1] : undefined;
          };
          const type = getAttr("type") as FileActionType | undefined;
          const path = getAttr("path");
          const search = getAttr("search");
          if (!type || !path) continue;
          out.push({ type, path, search, body: body ? body.trim() : undefined });
        }
        return out;
      };

      const isKeyDocPath = (p: string) => {
        const normalized = p.replace(/\\/g, "/").replace(/^\.\//, "");
        if (normalized === "outline.md") return true;
        if (normalized === "character.md") return true;
        if (normalized === "episode_index.md") return true;
        if (/^episodes\/EP-\d+\.md$/i.test(normalized)) return true;
        return false;
      };

      const simulateApply = (current: string, a: ParsedFsAction) => {
        const body = a.body ?? "";
        if (a.type === "write") return body;
        if (a.type === "append") return current + (current && !current.endsWith("\n") ? "\n" : "") + body;
        if (a.type === "replace") {
          const search = a.search;
          if (!search) return current;
          if (!current.includes(search)) return current;
          return current.replace(search, () => body);
        }
        return current;
      };

      const runAlignerGate = async (candidate: string) => {
        const alignerPrompt = getMarkdownByPath("agent-settings/script-aligner.md")?.trim();
        if (!alignerPrompt) return { status: "PASS" as const, report: "" };
        const parsed = parseFsActions(candidate);
        const writes = parsed.filter((a) => a.type !== "read");
        const keyWrites = writes.filter((a) => isKeyDocPath(a.path));
        if (keyWrites.length === 0) return { status: "PASS" as const, report: "" };

        const draftMap = new Map<string, string>();
        for (const a of writes) {
          const prev = draftMap.has(a.path) ? (draftMap.get(a.path) ?? "") : getMarkdownByPath(a.path) ?? "";
          draftMap.set(a.path, simulateApply(prev, a));
        }

        const outlineDraft = draftMap.get("outline.md") ?? (getMarkdownByPath("outline.md") ?? "");
        const characterDraft = draftMap.get("character.md") ?? (getMarkdownByPath("character.md") ?? "");
        const episodeIndexDraft = draftMap.get("episode_index.md") ?? (getMarkdownByPath("episode_index.md") ?? "");
        const episodeDrafts = Array.from(draftMap.entries())
          .filter(([p]) => /^episodes\/EP-\d+\.md$/i.test(p.replace(/\\/g, "/").replace(/^\.\//, "")))
          .map(([p, md]) => ({ path: p, markdown: md }));

        const payload = [
          "请在写入前对以下文档进行一致性检查，输出 PASS/FAIL 与问题清单（含最小可行修改示例、影响范围、优先级）。",
          "",
          "【outline.md（将写入版本）】",
          outlineDraft.trim() ? outlineDraft.trim() : "(空)",
          "",
          "【character.md（将写入版本）】",
          characterDraft.trim() ? characterDraft.trim() : "(空)",
          "",
          "【episode_index.md（将写入版本）】",
          episodeIndexDraft.trim() ? episodeIndexDraft.trim() : "(空)",
          "",
          ...episodeDrafts.flatMap((e) => ["", `【${e.path}（将写入版本）】`, e.markdown.trim() ? e.markdown.trim() : "(空)"]),
        ].join("\n");

        const systemAligner = [
          alignerPrompt,
          "",
          "输出约束：",
          "- 返回必须简洁、结构化，便于解析",
          "- 必须明确给出 PASS 或 FAIL",
          "- 若 FAIL：每条问题给出最小可行修改示例，并标注影响范围与优先级",
          "- 不要输出```代码块，不要输出任何 XML 标签",
        ].join("\n");

        const report = await callChatStream(
          requestConfig,
          [
            { role: "system", content: systemAligner },
            { role: "user", content: payload },
          ],
          controller.signal,
        );
        const status = extractAlignerStatus(report);
        return { status, report: report.trim() };
      };

      let forcedAlignerReport: string | null = null;
      let finalContent = fullContent;
      for (let i = 1; i <= ALIGNER_MAX_CHECKS; i++) {
        const gated = await runAlignerGate(finalContent);
        if (isAlignerPassLike(gated.status) && i < ALIGNER_MIN_CHECKS) {
          updateAssistant(`检查通过，正在进行复检…（第 ${i + 1} 次）`);
          continue;
        }
        if (isAlignerPassLike(gated.status)) break;
        if (i >= ALIGNER_MAX_CHECKS) {
          forcedAlignerReport = gated.report || `检查未通过，已达到最大复检次数（${ALIGNER_MAX_CHECKS}次）。`;
          updateAssistant(`第 ${i} 次复检仍未通过，已强制通过。\n\n【Aligner建议】\n${forcedAlignerReport}`);
          break;
        }
        updateAssistant(i === 1 ? "检查未通过，正在修订…" : `检查仍未通过，继续修订…（第 ${i} 次）`);
        finalContent = await callChatStream(
          requestConfig,
          [
            ...messagesToSend,
            { role: "assistant", content: finalContent },
            {
              role: "user",
              content: [
                "你刚才输出的写入内容未通过 script-aligner 检查。请根据反馈修订，并重新输出完整回复。",
                "要求：保留原本的展示文本；如需写入文件，继续使用 <file_action>；不要对 agent-settings 做写入。",
                "",
                "【script-aligner 反馈】",
                gated.report,
              ].join("\n"),
            },
          ],
          controller.signal,
          (_d, full) => updateAssistant(full),
        );
      }

      actionRegex.lastIndex = 0;
      questionRegex.lastIndex = 0;
      todoRegex.lastIndex = 0;
      agentActionRegex.lastIndex = 0;

      let match: RegExpExecArray | null = null;
      const results: string[] = [];
      const actions: { type: FileActionType; path: string; ok: boolean }[] = [];
      const questions: UserQuestionPayload[] = [];
      const todoActions: Array<{ type: string; id?: string; body?: string }> = [];
      const agentActions: AgentActionType[] = [];
      
      while ((match = actionRegex.exec(finalContent)) !== null) {
          const attrsStr = match[1];
          const body = match[2];
          
          const getAttr = (name: string) => {
              const match = attrsStr.match(new RegExp(`${name}=["']([^"']+)["']`));
              return match ? match[1] : undefined;
          };
          
          const type = getAttr("type") as FileActionType | undefined;
          const path = getAttr("path");
          const search = getAttr("search"); // for replace

          if (!type || !path) continue;

          // 如果内容存在（写入操作），去除首尾空白，但保留中间格式
          const cleanContent = body ? body.trim() : undefined;
          
          const result = executeFsAction(type, path, cleanContent, { search });
          results.push(`[System] Action: ${type} ${path}\nResult: ${result}`);
          actions.push({ type, path, ok: !result.startsWith("Error:") });
      }

      const okWritePaths = new Set(actions.filter((a) => a.ok && a.type !== "read" && isKeyDocPath(a.path)).map((a) => a.path));
      let qMatch: RegExpExecArray | null = null;
      while ((qMatch = questionRegex.exec(finalContent)) !== null) {
        const attrsStr = qMatch[1];
        const body = qMatch[2] ?? "";

        const getAttr = (name: string) => {
          const match = attrsStr.match(new RegExp(`${name}=["']([^"']+)["']`));
          return match ? match[1] : undefined;
        };

        const header = getAttr("header") ?? getAttr("title");
        const multiRaw = getAttr("multi") ?? getAttr("multiSelect");
        const multiSelect = multiRaw === "true" || multiRaw === "1";
        const typeAttr = (getAttr("type") ?? getAttr("kind") ?? getAttr("answer") ?? "").trim();
        const placeholder = getAttr("placeholder");
        const multilineRaw = getAttr("multiline");
        const multiline = multilineRaw === "true" || multilineRaw === "1";
        let questionText = (getAttr("question") ?? "").trim();

        const optionRegex = /<option(\s+[^>]+)\s*\/?>/g;
        const options: UserQuestionOption[] = [];
        let oMatch: RegExpExecArray | null = null;
        while ((oMatch = optionRegex.exec(body)) !== null) {
          const optAttrs = oMatch[1];
          const label = optAttrs.match(/label=["']([^"']+)["']/)?.[1]?.trim();
          if (!label) continue;
          const description = optAttrs.match(/description=["']([^"']+)["']/)?.[1]?.trim();
          options.push({ label, description });
        }

        if (options.length === 0) {
          const rawOptions = (getAttr("options") ?? "").trim();
          if (rawOptions) {
            rawOptions
              .split("|")
              .map((s) => s.trim())
              .filter(Boolean)
              .forEach((label) => options.push({ label }));
          }
        }

        if (!questionText) {
          const inferred = body.replace(optionRegex, "").trim();
          if (inferred) questionText = inferred;
        }

        if (!questionText) continue;

        const kind: "options" | "text" =
          typeAttr === "text" ? "text" : options.length >= 2 ? "options" : placeholder ? "text" : "text";

        if (kind === "options" && options.length < 2) continue;

        questions.push({
          header,
          question: questionText,
          kind,
          options: kind === "options" ? options : undefined,
          multiSelect: kind === "options" ? multiSelect : undefined,
          placeholder: kind === "text" ? placeholder : undefined,
          multiline: kind === "text" ? multiline : undefined,
        });
      }

      let tMatch: RegExpExecArray | null = null;
      while ((tMatch = todoRegex.exec(finalContent)) !== null) {
        const attrsStr = tMatch[1];
        const body = tMatch[2];
        const getAttr = (name: string) => {
          const match = attrsStr.match(new RegExp(`${name}=["']([^"']+)["']`));
          return match ? match[1] : undefined;
        };
        const type = (getAttr("type") ?? "").trim();
        const id = getAttr("id")?.trim();
        todoActions.push({ type, id, body: body?.trim() });
      }

      let aMatch: RegExpExecArray | null = null;
      while ((aMatch = agentActionRegex.exec(finalContent)) !== null) {
        const attrsStr = aMatch[1];
        const getAttr = (name: string) => {
          const match = attrsStr.match(new RegExp(`${name}=["']([^"']+)["']`));
          return match ? match[1] : undefined;
        };
        const rawType = (getAttr("type") ?? getAttr("agent") ?? "").trim().toLowerCase();
        if (rawType === "aligner" || rawType === "script-aligner") {
          agentActions.push("aligner");
          continue;
        }
        if (rawType === "recorder" || rawType === "script-recorder") {
          agentActions.push("recorder");
        }
      }

      let displayContent = sanitizeAssistantToolOutput(finalContent);
      if (forcedAlignerReport) {
        displayContent = `${displayContent}\n\n【Aligner建议（已强制通过）】\n${forcedAlignerReport}`.trim();
      }

      const parseTodoItems = (raw: string) => {
        const lines = raw.split("\n").map((l) => l.trim()).filter(Boolean);
        const out: AiTodoItem[] = [];
        for (const line of lines) {
          const m = line.match(/^-+\s*\[([ x~])\]\s*(.+)$/i);
          if (!m) continue;
          const mark = m[1];
          const rest = m[2].trim();
          const status: AiTodoStatus = mark.toLowerCase() === "x" ? "completed" : mark === "~" ? "in_progress" : "pending";
          const idMatch = rest.match(/^([^:]{1,40}):\s*(.+)$/);
          const rawId = idMatch?.[1]?.trim();
          const content = (idMatch?.[2] ?? rest).trim();
          if (!content) continue;
          const id =
            rawId && /^[a-zA-Z0-9_-]+$/.test(rawId) ? rawId : `${out.length + 1}`;
          out.push({ id, content, status });
        }
        if (out.length > 0) return out;
        const fallback = raw.split("\n").map((l) => l.trim()).filter(Boolean);
        for (const line of fallback) {
          out.push({ id: `${out.length + 1}`, content: line, status: "pending" });
        }
        return out;
      };

      const applyTodoActions = (current: AiTodoItem[]) => {
        let next = [...current];
        let readRequested = false;
        for (const a of todoActions) {
          const t = a.type;
          if (!t) continue;
          if (t === "set") {
            const items = a.body ? parseTodoItems(a.body) : [];
            next = items;
            continue;
          }
          if (t === "add") {
            const items = a.body ? parseTodoItems(a.body) : [];
            if (items.length > 0) next = [...next, ...items];
            continue;
          }
          if (t === "clear") {
            next = [];
            continue;
          }
          if (t === "read") {
            readRequested = true;
            continue;
          }
          const id = a.id;
          if (!id) continue;
          if (t === "complete") {
            next = next.map((x) => (x.id === id ? { ...x, status: "completed" } : x));
            continue;
          }
          if (t === "start") {
            next = next.map((x) => (x.id === id ? { ...x, status: "in_progress" } : x));
            continue;
          }
          if (t === "pending") {
            next = next.map((x) => (x.id === id ? { ...x, status: "pending" } : x));
            continue;
          }
        }
        return { next, readRequested };
      };

      const explicitRecorderRequested = agentActions.includes("recorder");
      const explicitAlignerRequested = agentActions.includes("aligner");

      if (okWritePaths.size > 0 && !explicitRecorderRequested) {
        const parsedForRecord = parseFsActions(finalContent).filter((a) => a.type !== "read" && okWritePaths.has(a.path));
        const draftMap = new Map<string, string>();
        for (const a of parsedForRecord) {
          const prev = draftMap.has(a.path) ? (draftMap.get(a.path) ?? "") : getMarkdownByPath(a.path) ?? "";
          draftMap.set(a.path, simulateApply(prev, a));
        }
        const changed = Array.from(draftMap.entries()).map(([path, markdown]) => ({ path, markdown }));
        const progress = await runRecorderUpdate(requestConfig, controller.signal, changed);
        if (progress) {
          const progressWrite = executeFsAction("write", "script.progress.md", progress);
          results.push(`[System] Action: write script.progress.md\nResult: ${progressWrite}`);
          actions.push({ type: "write", path: "script.progress.md", ok: !progressWrite.startsWith("Error:") });
        }
      }

      if (explicitAlignerRequested) {
        const alignerResult = await runFullAlignerCheck(requestConfig, controller.signal);
        results.push(
          alignerResult.ok
            ? `[System] Agent: script-aligner\nResult:\n${alignerResult.report}`
            : `[System] Agent: script-aligner\nResult: ${alignerResult.message}`
        );
      }

      if (explicitRecorderRequested) {
        const recorderResult = await runProgressRecorder(requestConfig, controller.signal);
        results.push(`[System] Agent: script-recorder\nResult: ${recorderResult.message}`);
        if (recorderResult.ok) {
          actions.push({ type: "write", path: "script.progress.md", ok: true });
        }
      }

      const resultMsgId = results.length > 0 ? uid("m") : null;
      const resultContent = results.join("\n\n");
      const questionMessages: ConversationMessage[] = questions.map((q) => {
        const headerText = q.header ? `${q.header}\n` : "";
        const multiText = q.kind === "options" ? (q.multiSelect ? "（可多选）" : "（单选）") : "（输入）";
        const optionsText =
          q.kind === "options"
            ? (q.options ?? []).map((o) => `- ${o.label}${o.description ? `：${o.description}` : ""}`).join("\n")
            : "- 请输入你的回答";
        return {
          id: uid("m"),
          role: "assistant",
          content: `【提问】${headerText}${q.question}${multiText}\n【选项】\n${optionsText}`,
          question: q,
        };
      });

      const currentTodos =
        projectConversations[activeProjectId]?.find((c) => c.id === activeConversationId)?.aiTodos ?? [];
      const { next: nextTodos, readRequested } = applyTodoActions(currentTodos);
      const todoReadMessage: ConversationMessage | null = readRequested
        ? {
            id: uid("m"),
            role: "system",
            content:
              nextTodos.length === 0
                ? "[System] Todo List: (empty)"
                : `[System] Todo List:\n${nextTodos
                    .map((t) => `- ${t.status === "completed" ? "[x]" : t.status === "in_progress" ? "[~]" : "[ ]"} ${t.id}: ${t.content}`)
                    .join("\n")}`,
          }
        : null;

      setProjectConversations((prev) => ({
        ...prev,
        [activeProjectId]: (prev[activeProjectId] ?? []).map((c) => {
          if (c.id !== activeConversationId) return c;
          const updated = c.messages.map((m) => (m.id === assistantMsgId ? { ...m, content: displayContent } : m));
          const extras: ConversationMessage[] = [];
          if (results.length > 0 && resultMsgId) {
            extras.push({ id: resultMsgId, role: "system", content: resultContent, actions });
          }
          if (todoReadMessage) extras.push(todoReadMessage);
          extras.push(...questionMessages);
          return { ...c, messages: [...updated, ...extras], aiTodos: nextTodos };
        }),
      }));

    } catch (error: any) {
      if (error?.name === "AbortError") return;
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
      abortControllerRef.current = null;
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
                openFileInTab(c.id);
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
                  setDraft("");
                }}
                className="rounded-md px-1 py-1 text-zinc-500 hover:bg-zinc-800/60 hover:text-zinc-200"
                type="button"
                title="返回 (根目录)"
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
              title="新项目"
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
            <button
              className="rounded p-1 hover:bg-zinc-800/60 hover:text-zinc-300"
              type="button"
              onClick={() => {
                if (activeFileId) closeTab(activeFileId);
              }}
              title="关闭当前标签"
            >
              <X size={14} />
            </button>
          </div>
        </div>

        <div className="flex h-9 shrink-0 items-center overflow-x-auto border-b border-zinc-800 bg-[#121212]">
          {openTabs.length === 0 ? (
            <div className="flex h-full flex-1 items-center px-4 text-xs text-zinc-500">未打开文件</div>
          ) : (
            openTabs.map((id) => {
              const found = findNode(root, id);
              const node = found?.node;
              if (!node || node.type !== "file") return null;
              const isActive = id === activeFileId;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => activateTab(id)}
                  className={cn(
                    "flex h-full items-center gap-2 border-r border-zinc-800 px-4 text-xs",
                    isActive ? "bg-[#0d0d0d] text-zinc-200" : "bg-transparent text-zinc-500 hover:bg-zinc-800/40 hover:text-zinc-300",
                  )}
                >
                  <span className={cn("shrink-0", isActive ? "text-blue-400" : "text-zinc-600")}>{fileIcon(node.name)}</span>
                  <span className="max-w-[160px] truncate">{node.name}</span>
                  <span
                    className="ml-1 inline-flex h-4 w-4 items-center justify-center rounded text-zinc-600 hover:bg-zinc-800/60 hover:text-zinc-300"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      closeTab(id);
                    }}
                    title="关闭"
                  >
                    <X size={12} />
                  </span>
                </button>
              );
            })
          )}
          <div className="h-full flex-1 border-b border-zinc-800" />
        </div>

        <div className="flex-1 overflow-hidden">
          {activeFile?.type === "file" && activeStorageKey ? (
            <div className="flex h-full min-w-0 flex-col">
              <div className="flex-1 min-w-0 overflow-auto p-4">
                <PlainMarkdownEditor
                  key={`${activeStorageKey}-${fileVersions[activeFileId!] || 0}`}
                  storageKey={activeStorageKey}
                  wrapperClassName="max-w-none"
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

        {activeProjectId ? (
          <div className="shrink-0 border-b border-zinc-800 px-3 py-2">
            <div className="flex items-center justify-between">
              <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-600">AI Todo</div>
              <div className="text-[10px] text-zinc-600">{activeConversationTodos.length}</div>
            </div>
            {activeConversationTodos.length === 0 ? (
              <div className="mt-1 text-[11px] text-zinc-600">暂无</div>
            ) : (
              <div className="mt-2 max-h-24 space-y-1 overflow-y-auto pr-1">
                {activeConversationTodos.map((t) => (
                  <div key={t.id} className="flex items-start gap-2 text-[12px] text-zinc-400">
                    <span
                      className={cn(
                        "mt-0.5 shrink-0 text-[11px]",
                        t.status === "completed"
                          ? "text-emerald-400/80"
                          : t.status === "in_progress"
                            ? "text-blue-400/80"
                            : "text-zinc-500",
                      )}
                    >
                      {t.status === "completed" ? "[x]" : t.status === "in_progress" ? "[~]" : "[ ]"}
                    </span>
                    <span className="shrink-0 text-zinc-600">{t.id}</span>
                    <span className={cn("min-w-0 flex-1 truncate", t.status === "completed" ? "text-zinc-500 line-through" : null)}>
                      {t.content}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : null}

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
              请选择 (根目录) 下的一个项目文件夹后开始聊天。
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
            {activeConversation?.messages.map((m) => {
              if (m.question) {
                const answered = !!questionAnswered[m.id];
                const selected = questionSelections[m.id] ?? [];
                const multi = !!m.question.multiSelect;
                const inputValue = questionTextInputs[m.id] ?? "";
                const toggle = (label: string) => {
                  setQuestionSelections((prev) => {
                    const current = new Set(prev[m.id] ?? []);
                    if (current.has(label)) current.delete(label);
                    else current.add(label);
                    return { ...prev, [m.id]: Array.from(current) };
                  });
                };
                const submitOptions = (labels: string[]) => {
                  if (labels.length === 0) return;
                  setQuestionAnswered((prev) => ({ ...prev, [m.id]: true }));
                  setQuestionSelections((prev) => ({ ...prev, [m.id]: labels }));
                  sendMessage(`【回答】${m.question.question}\n【选择】${labels.join("、")}`);
                };
                const submitText = (value: string) => {
                  const v = value.trim();
                  if (!v) return;
                  setQuestionAnswered((prev) => ({ ...prev, [m.id]: true }));
                  setQuestionTextInputs((prev) => ({ ...prev, [m.id]: v }));
                  sendMessage(`【回答】${m.question.question}\n【输入】${v}`);
                };

                return (
                  <div key={m.id} className="mr-auto max-w-[92%] space-y-2 rounded-xl border border-zinc-800/70 bg-[#1f1f1f] p-3 text-[13px] leading-relaxed shadow-sm">
                    <div className="flex items-center justify-between">
                      <div className="text-[11px] font-medium text-zinc-500">{m.question.header || "提问"}</div>
                      <div className="text-[10px] text-zinc-600">
                        {m.question.kind === "text" ? "输入" : multi ? "可多选" : "单选"}
                      </div>
                    </div>
                    <div className="text-zinc-200">{m.question.question}</div>
                    {m.question.kind === "text" ? (
                      <div className="space-y-2">
                        <textarea
                          value={answered ? (questionTextInputs[m.id] ?? "") : inputValue}
                          disabled={answered || isGenerating}
                          placeholder={m.question.placeholder || "请输入…"}
                          rows={m.question.multiline ? 4 : 2}
                          onChange={(e) => setQuestionTextInputs((prev) => ({ ...prev, [m.id]: e.target.value }))}
                          className="w-full resize-none rounded-lg border border-zinc-700 bg-transparent px-3 py-2 text-[12px] text-zinc-200 outline-none placeholder:text-zinc-600 focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/20"
                        />
                        <div className="flex items-center justify-between">
                          <div className="text-[11px] text-zinc-500">{answered ? "已提交" : inputValue.trim() ? "可提交" : "请输入"}</div>
                          <button
                            type="button"
                            disabled={answered || isGenerating || !inputValue.trim()}
                            onClick={() => submitText(inputValue)}
                            className={cn(
                              "rounded-md px-3 py-1.5 text-[12px] font-medium transition-colors",
                              answered || isGenerating || !inputValue.trim() ? "cursor-not-allowed bg-zinc-800 text-zinc-600" : "bg-zinc-100 text-black hover:bg-white",
                            )}
                          >
                            提交
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="flex flex-wrap gap-2">
                          {(m.question.options ?? []).map((opt) => {
                            const isSelected = selected.includes(opt.label);
                            return (
                              <button
                                key={opt.label}
                                type="button"
                                disabled={answered || isGenerating}
                                onClick={() => {
                                  if (multi) toggle(opt.label);
                                  else submitOptions([opt.label]);
                                }}
                                className={cn(
                                  "rounded-lg border px-2.5 py-1.5 text-[12px] transition-colors",
                                  isSelected ? "border-blue-500/60 bg-blue-500/10 text-blue-200" : "border-zinc-700 bg-transparent text-zinc-300 hover:bg-zinc-800/40",
                                  answered ? "opacity-60" : null,
                                )}
                                title={opt.description || opt.label}
                              >
                                {opt.label}
                              </button>
                            );
                          })}
                        </div>
                        {multi ? (
                          <div className="flex items-center justify-between">
                            <div className="text-[11px] text-zinc-500">{answered ? `已提交：${selected.join("、")}` : selected.length > 0 ? `已选：${selected.join("、")}` : "请选择"}</div>
                            <button
                              type="button"
                              disabled={answered || isGenerating || selected.length === 0}
                              onClick={() => submitOptions(selected)}
                              className={cn(
                                "rounded-md px-3 py-1.5 text-[12px] font-medium transition-colors",
                                answered || isGenerating || selected.length === 0 ? "cursor-not-allowed bg-zinc-800 text-zinc-600" : "bg-zinc-100 text-black hover:bg-white",
                              )}
                            >
                              确认
                            </button>
                          </div>
                        ) : answered ? (
                          <div className="text-[11px] text-zinc-500">已提交：{selected.join("、")}</div>
                        ) : null}
                      </>
                    )}
                  </div>
                );
              }
              if (m.role === "system" && m.actions) {
                return (
                  <div key={m.id} className="space-y-1.5 px-1 py-2">
                    {m.actions.map((action, idx) => (
                      <div key={idx} className="flex items-center gap-2 text-[11px] text-zinc-500">
                        {action.type === "read" ? <Search size={12} /> : <Pencil size={12} />}
                        <span>
                          {action.type === "read"
                            ? "已阅读"
                            : action.type === "append"
                              ? "已追加"
                              : action.type === "replace"
                                ? "已替换"
                                : "已写入"}{" "}
                          <span className="font-medium text-zinc-400">{action.path}</span>
                          <span className={cn("ml-2 text-[10px]", action.ok ? "text-emerald-400/70" : "text-rose-400/70")}>
                            {action.ok ? "成功" : "失败"}
                          </span>
                        </span>
                      </div>
                    ))}
                  </div>
                );
              }
              return (
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
              );
            })}

            {isGenerating ? (
              <div className="space-y-1.5 px-1">
                <div className="flex items-center gap-2 text-[11px] text-zinc-500">
                  <div className="h-3 w-3 animate-spin rounded-full border-2 border-zinc-700 border-t-zinc-400" />
                  <span>
                    思考中 <span className="text-zinc-400">...</span>
                  </span>
                </div>
              </div>
            ) : null}
            </div>
          )}
        </div>

        <div className="shrink-0 border-t border-zinc-800 bg-[#1c1c1c] p-4">
          <div className="relative rounded-xl border border-zinc-700 bg-[#252525] shadow-inner transition-all focus-within:border-blue-500/50 focus-within:ring-1 focus-within:ring-blue-500/20">
            <textarea
              placeholder="计划、搜索、构建任何东西..."
              ref={chatInputRef}
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                setChatCaret(e.target.selectionStart ?? e.target.value.length);
                setDismissedCommandToken(null);
              }}
              onSelect={(e) => {
                const el = e.target as HTMLTextAreaElement;
                setChatCaret(el.selectionStart ?? 0);
              }}
              onKeyDown={(e) => {
                if (commandHint) {
                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    setCommandActiveIndex((prev) => Math.min(prev + 1, commandHint.items.length - 1));
                    return;
                  }
                  if (e.key === "ArrowUp") {
                    e.preventDefault();
                    setCommandActiveIndex((prev) => Math.max(prev - 1, 0));
                    return;
                  }
                  if (e.key === "Tab") {
                    e.preventDefault();
                    const item = commandHint.items[commandActiveIndex] ?? commandHint.items[0];
                    if (item) applyCommandHint(item.insert);
                    return;
                  }
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    const item = commandHint.items[commandActiveIndex] ?? commandHint.items[0];
                    if (item) applyCommandHint(item.insert);
                    return;
                  }
                  if (e.key === "Escape") {
                    e.preventDefault();
                    setDismissedCommandToken(commandHint.tokenPrefix);
                    return;
                  }
                }
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
            {commandHint ? (
              <div className="absolute bottom-14 left-3 right-3 z-50 overflow-hidden rounded-lg border border-zinc-800 bg-[#141414] shadow-2xl">
                <div className="max-h-44 overflow-y-auto p-1">
                  {commandHint.items.map((item, idx) => (
                    <button
                      key={item.title}
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        applyCommandHint(item.insert);
                      }}
                      className={cn(
                        "flex w-full items-start justify-between gap-3 rounded-md px-2.5 py-2 text-left text-xs transition-colors",
                        idx === commandActiveIndex ? "bg-zinc-800 text-zinc-200" : "text-zinc-300 hover:bg-zinc-800/60",
                      )}
                    >
                      <span className="shrink-0 font-medium text-zinc-200">{item.title}</span>
                      <span className="min-w-0 flex-1 truncate text-right text-[11px] text-zinc-500">{item.description}</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
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
              {isGenerating ? (
                <button
                  onClick={stopGenerating}
                  className="flex h-8 w-8 items-center justify-center rounded-full bg-rose-500/10 text-rose-300 transition-colors hover:bg-rose-500/15"
                  type="button"
                  title="停止生成"
                >
                  <X size={16} strokeWidth={2.5} />
                </button>
              ) : (
                <button
                  onClick={() => sendMessage()}
                  disabled={!activeProjectId || !draft.trim()}
                  className={cn(
                    "flex h-8 w-8 items-center justify-center rounded-full transition-all",
                    activeProjectId && draft.trim()
                      ? "scale-105 bg-zinc-100 text-black shadow-lg"
                      : "bg-zinc-800 text-zinc-600",
                  )}
                  type="button"
                >
                  <ArrowUp size={16} strokeWidth={3} />
                </button>
              )}
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
                      新项目 <Plus size={12} className="text-zinc-500" />
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
