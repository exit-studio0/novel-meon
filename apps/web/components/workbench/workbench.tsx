"use client";

import { cn } from "@/lib/utils";
import {
  ArrowUp,
  ChevronDown,
  FileCode,
  FileText,
  Folder,
  MessageSquare,
  Plus,
  Search,
  Sparkles,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

type FsNodeType = "folder" | "file";

type FsNode = {
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

function isFolder(node: FsNode): node is FsNode & { children: FsNode[] } {
  return node.type === "folder";
}

function defaultRoot(): FsNode {
  return { id: "root", type: "folder", name: "Root/", children: [] };
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

export default function Workbench() {
  const [root, setRoot] = useState<FsNode>(() => defaultRoot());
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(["root"]));
  const [activeFileId, setActiveFileId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState>(null);
  const [renaming, setRenaming] = useState<{ nodeId: string; value: string } | null>(null);
  const [moveTarget, setMoveTarget] = useState<{ nodeId: string; targetFolderId: string } | null>(null);

  const [conversations, setConversations] = useState<Conversation[]>(() => [
    {
      id: uid("c"),
      title: "对话 1",
      createdAt: Date.now(),
      messages: [
        { id: uid("m"), role: "user", content: "根据附带的文档制作一个展示我们业务的落地页" },
        { id: uid("m"), role: "assistant", content: "我将为您创建一个简约、基于衬线字体的落地页，以匹配您的品牌语调。" },
      ],
    },
  ]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(() => conversations[0]?.id ?? null);
  const [draft, setDraft] = useState("");

  const activeConversation = useMemo(
    () => conversations.find((c) => c.id === activeConversationId) ?? null,
    [conversations, activeConversationId],
  );

  const activeFile = useMemo(() => {
    if (!activeFileId) return null;
    return findNode(root, activeFileId)?.node ?? null;
  }, [root, activeFileId]);

  const foldersForMove = useMemo(() => {
    if (!moveTarget) return [];
    return collectFolderOptions(root, moveTarget.nodeId).filter((f) => !isDescendant(root, moveTarget.nodeId, f.id));
  }, [root, moveTarget]);

  const menuRef = useRef<HTMLDivElement | null>(null);
  const renameInputRef = useRef<HTMLInputElement | null>(null);

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

  const createFolder = (parentId: string) => {
    const id = uid("f");
    const name = "新建文件夹";
    setRoot((prev) => attachNode(prev, parentId, { id, type: "folder", name, children: [] }));
    setExpanded((prev) => new Set(prev).add(parentId));
    setRenaming({ nodeId: id, value: name });
  };

  const deleteNodeById = (id: string) => {
    setRoot((prev) => removeNode(prev, id));
    setExpanded((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    setActiveFileId((prev) => (prev === id ? null : prev));
  };

  const commitRename = (nodeId: string, value: string) => {
    const nextName = value.trim() || "未命名";
    setRoot((prev) => updateNode(prev, nodeId, (n) => ({ ...n, name: nextName })));
    setRenaming(null);
  };

  const startMove = (nodeId: string) => {
    setMoveTarget({ nodeId, targetFolderId: "root" });
  };

  const commitMove = () => {
    if (!moveTarget) return;
    const { nodeId, targetFolderId } = moveTarget;
    if (nodeId === "root") return;
    if (nodeId === targetFolderId) return;
    if (isDescendant(root, nodeId, targetFolderId)) return;

    setRoot((prev) => {
      const { next, detached } = detachNode(prev, nodeId);
      if (!detached) return prev;
      return attachNode(next, targetFolderId, detached);
    });
    setExpanded((prev) => new Set(prev).add(targetFolderId));
    setMoveTarget(null);
  };

  const newConversation = () => {
    const id = uid("c");
    const next: Conversation = {
      id,
      title: `对话 ${conversations.length + 1}`,
      createdAt: Date.now(),
      messages: [{ id: uid("m"), role: "assistant", content: "你好，我能帮你做什么？" }],
    };
    setConversations((prev) => [next, ...prev]);
    setActiveConversationId(id);
  };

  const sendMessage = () => {
    const content = draft.trim();
    if (!content || !activeConversationId) return;
    setDraft("");
    setConversations((prev) =>
      prev.map((c) => {
        if (c.id !== activeConversationId) return c;
        return { ...c, messages: [...c.messages, { id: uid("m"), role: "user", content }] };
      }),
    );
  };

  const renderTree = (node: FsNode, depth: number) => {
    if (node.type !== "folder") return null;
    const isOpen = expanded.has(node.id);
    const isRoot = node.id === "root";

    const row =
      renaming?.nodeId === node.id ? (
        <div
          key={node.id}
          onContextMenu={(e) => {
            e.preventDefault();
            setContextMenu({ x: e.clientX, y: e.clientY, nodeId: node.id });
          }}
          className={cn(
            "flex h-7 select-none items-center gap-2 px-3 text-xs transition-colors",
            "text-zinc-500 hover:bg-zinc-800/50",
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
          onClick={() => toggleExpanded(node.id)}
          onKeyDown={(e) => {
            if (e.key === "ArrowRight" && !isOpen) toggleExpanded(node.id);
            if (e.key === "ArrowLeft" && isOpen) toggleExpanded(node.id);
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            setContextMenu({ x: e.clientX, y: e.clientY, nodeId: node.id });
          }}
          aria-expanded={isOpen}
          className={cn(
            "flex h-7 w-full cursor-pointer select-none items-center gap-2 px-3 text-xs transition-colors",
            "text-zinc-500 hover:bg-zinc-800/50",
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
          if (c.type === "folder") return renderTree(c, depth + 1);
          const isActive = activeFileId === c.id;
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => setActiveFileId(c.id)}
              aria-selected={isActive}
              className={cn(
                "flex h-7 w-full cursor-pointer select-none items-center gap-2 px-3 text-xs transition-colors",
                isActive ? "bg-zinc-800 text-white" : "text-zinc-500 hover:bg-zinc-800/50",
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
          <span className="truncate">项目: {root.name}</span>
          <button
            onClick={() => createFolder("root")}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-medium text-zinc-500 hover:bg-zinc-800/60 hover:text-zinc-200"
            type="button"
          >
            <Plus size={12} />
            新建
          </button>
        </div>
        <div className="flex-1 overflow-y-auto py-1">{renderTree(root, 0)}</div>
      </aside>

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

        <div className="flex-1 overflow-auto p-6 font-mono text-sm leading-relaxed">
          {activeFile?.type === "file" ? (
            <pre className="text-zinc-400">
              <code className="block whitespace-pre-wrap">{activeFile.content ?? "// 暂无内容"}</code>
            </pre>
          ) : (
            <div className="text-sm text-zinc-500">
              <div className="mb-2 text-zinc-400">在左侧创建文件夹并选择文件进行查看。</div>
              <div className="text-xs text-zinc-600">右键文件夹可重命名、删除或移动。</div>
            </div>
          )}
        </div>
      </main>

      <aside className="flex w-[380px] shrink-0 flex-col border-l border-zinc-800 bg-[#1c1c1c]">
        <div className="flex h-9 shrink-0 items-center justify-between border-b border-zinc-800 px-3 text-xs font-medium text-zinc-300">
          <span>聊天</span>
          <button
            onClick={newConversation}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200"
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
                  onClick={() => setActiveConversationId(c.id)}
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
                  思考中 <span className="text-zinc-400">6s</span>
                </span>
              </div>
            </div>
          </div>
        </div>

        <div className="shrink-0 border-t border-zinc-800 bg-[#1c1c1c] p-4">
          <div className="relative overflow-hidden rounded-xl border border-zinc-700 bg-[#252525] shadow-inner transition-all focus-within:border-blue-500/50 focus-within:ring-1 focus-within:ring-blue-500/20">
            <textarea
              placeholder="计划、搜索、构建任何东西..."
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  sendMessage();
                }
              }}
              className="w-full resize-none bg-transparent p-4 pb-12 text-[13px] text-zinc-100 outline-none placeholder:text-zinc-500"
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
                <button
                  className="flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-medium text-zinc-500 hover:text-zinc-300"
                  type="button"
                >
                  Composer 1.5
                  <ChevronDown size={10} />
                </button>
              </div>
              <button
                onClick={sendMessage}
                className={cn(
                  "flex h-8 w-8 items-center justify-center rounded-full transition-all",
                  draft.trim() ? "scale-105 bg-zinc-100 text-black shadow-lg" : "bg-zinc-800 text-zinc-600",
                )}
                type="button"
              >
                <ArrowUp size={16} strokeWidth={3} />
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
          <button
            onClick={() => {
              const found = findNode(root, contextMenu.nodeId);
              if (found) setRenaming({ nodeId: found.node.id, value: found.node.name });
              setContextMenu(null);
            }}
            className="flex w-full items-center justify-between px-3 py-2 text-xs text-zinc-300 hover:bg-zinc-800/60"
            type="button"
          >
            重命名 <span className="text-zinc-500">F2</span>
          </button>
          <button
            onClick={() => {
              if (contextMenu.nodeId !== "root") startMove(contextMenu.nodeId);
              setContextMenu(null);
            }}
            disabled={contextMenu.nodeId === "root"}
            className={cn(
              "flex w-full items-center justify-between px-3 py-2 text-xs",
              contextMenu.nodeId === "root"
                ? "cursor-not-allowed text-zinc-600"
                : "text-zinc-300 hover:bg-zinc-800/60",
            )}
            type="button"
          >
            移动 <span className="text-zinc-500">…</span>
          </button>
          <div className="h-px bg-zinc-800" />
          <button
            onClick={() => {
              if (contextMenu.nodeId !== "root") deleteNodeById(contextMenu.nodeId);
              setContextMenu(null);
            }}
            disabled={contextMenu.nodeId === "root"}
            className={cn(
              "flex w-full items-center justify-between px-3 py-2 text-xs",
              contextMenu.nodeId === "root" ? "cursor-not-allowed text-zinc-600" : "text-rose-300 hover:bg-rose-500/10",
            )}
            type="button"
          >
            删除 <span className="text-zinc-500">Del</span>
          </button>
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

