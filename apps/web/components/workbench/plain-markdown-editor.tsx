"use client";

import { cn } from "@/lib/utils";
import Markdown from "react-markdown";
import { useEffect, useMemo, useState } from "react";
import { useDebouncedCallback } from "use-debounce";

type PlainMarkdownEditorProps = {
  storageKey: string;
  wrapperClassName?: string;
};

export default function PlainMarkdownEditor({ storageKey, wrapperClassName }: PlainMarkdownEditorProps) {
  const keyMarkdown = useMemo(() => `${storageKey}:markdown`, [storageKey]);
  const [value, setValue] = useState("");
  const [mode, setMode] = useState<"edit" | "preview">("edit");

  useEffect(() => {
    const existing = window.localStorage.getItem(keyMarkdown) ?? "";
    setValue(existing);
    
    // 监听 storage 变化，以便在其他地方修改了 localStorage 时同步更新（主要针对 AI 写入）
    const onStorage = (e: StorageEvent) => {
      if (e.key === keyMarkdown && e.newValue !== null) {
        setValue(e.newValue);
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [keyMarkdown]);

  const persist = useDebouncedCallback((next: string) => {
    window.localStorage.setItem(keyMarkdown, next);
  }, 150);

  return (
    <div className={cn("w-full", wrapperClassName)}>
      <div className="mb-3 flex items-center justify-between">
        <div className="text-xs text-zinc-500">Markdown</div>
        <div className="flex items-center gap-2 text-xs">
          <button
            type="button"
            onClick={() => setMode("edit")}
            className={cn(
              "rounded-md px-2 py-1",
              mode === "edit" ? "bg-zinc-800 text-zinc-200" : "text-zinc-500 hover:text-zinc-300",
            )}
          >
            编辑
          </button>
          <button
            type="button"
            onClick={() => setMode("preview")}
            className={cn(
              "rounded-md px-2 py-1",
              mode === "preview" ? "bg-zinc-800 text-zinc-200" : "text-zinc-500 hover:text-zinc-300",
            )}
          >
            预览
          </button>
        </div>
      </div>

      {mode === "edit" ? (
        <textarea
          value={value}
          onChange={(e) => {
            const next = e.target.value;
            setValue(next);
            persist(next);
          }}
          spellCheck={false}
          className="min-h-[500px] w-full resize-none rounded-lg border border-zinc-800 bg-transparent p-4 text-[13px] leading-relaxed text-zinc-100 outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/20"
          placeholder="在这里编辑 Markdown..."
        />
      ) : (
        <div className="min-h-[500px] w-full rounded-lg border border-zinc-800 bg-transparent p-4">
          <div className="prose prose-invert max-w-none">
            <Markdown>{value}</Markdown>
          </div>
        </div>
      )}
    </div>
  );
}

