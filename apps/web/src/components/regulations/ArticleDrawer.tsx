"use client";

import { useEffect, useRef, useState } from "react";

import Drawer from "@/components/ui/Drawer";
import SmartTextarea from "@/components/ui/SmartTextarea";
import type { ArticleType, RegulationArticleOut } from "@/lib/types";
import { ARTICLE_TYPE_LABEL, ARTICLE_TYPE_META } from "@/lib/regulationStructure";

export interface ArticleDrawerSaveData {
  article_type: ArticleType;
  title: string;
  subtitle: string;
  content: string;
}

export interface ArticleDrawerProps {
  open: boolean;
  /** 編輯目標；傳 null 則為新增模式。 */
  article: RegulationArticleOut | null;
  onClose: () => void;
  onSave: (data: ArticleDrawerSaveData) => Promise<void> | void;
  /** 是否為新增模式（影響標題與預設值）。 */
  isNew?: boolean;
  /** 預設層級（新增時用）。 */
  defaultType?: ArticleType;
  /** 唯讀（已發布法規 / 已凍結條文）。 */
  readOnly?: boolean;
}

const EDITABLE_TYPES: ArticleType[] = [
  "volume", "chapter", "section", "article", "paragraph", "subparagraph", "item", "special_clause",
];

/**
 * 條文編輯抽屜。桌面從右側滑入、手機從底部 sheet 滑入。
 * 支援 type / title / subtitle / content 編輯，Ctrl/Cmd+Enter 儲存、Esc 關閉。
 */
export function ArticleDrawer({
  open,
  article,
  onClose,
  onSave,
  isNew = false,
  defaultType = "article",
  readOnly = false,
}: ArticleDrawerProps) {
  const [type, setType] = useState<ArticleType>(article?.article_type ?? defaultType);
  const [title, setTitle] = useState(article?.title ?? "");
  const [subtitle, setSubtitle] = useState(article?.subtitle ?? "");
  const [content, setContent] = useState(article?.content ?? "");
  const [saving, setSaving] = useState(false);
  const titleRef = useRef<HTMLInputElement | null>(null);

  // 切換編輯對象時重置表單
  useEffect(() => {
    if (!open) return;
    setType(article?.article_type ?? defaultType);
    setTitle(article?.title ?? "");
    setSubtitle(article?.subtitle ?? "");
    setContent(article?.content ?? "");
    // 等抽屜動畫結束再聚焦避免位移
    const t = window.setTimeout(() => titleRef.current?.focus(), 260);
    return () => window.clearTimeout(t);
  }, [open, article, defaultType]);

  const handleSave = async () => {
    if (readOnly || saving) return;
    setSaving(true);
    try {
      await onSave({ article_type: type, title, subtitle, content });
    } finally {
      setSaving(false);
    }
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      void handleSave();
    }
  };

  const meta = ARTICLE_TYPE_META[type];
  const drawerTitle = isNew ? "新增條文" : "編輯條文";

  return (
    <Drawer
      open={open}
      title={drawerTitle}
      onClose={onClose}
      side="auto"
      width="480px"
      sheetHeight="88vh"
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="btn btn-ghost btn-sm"
          >
            取消
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={readOnly || saving}
            className="btn btn-primary btn-sm"
          >
            {saving ? "儲存中…" : isNew ? "新增" : "儲存"}
          </button>
        </>
      }
    >
      <div className="space-y-4" onKeyDown={onKeyDown}>
        {/* 預覽徽章 */}
        <div className="flex items-center gap-2">
          <span
            className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-semibold"
            style={{
              background: meta.badgeBg,
              color: meta.badgeColor,
              border: `1px solid ${meta.borderColor}`,
            }}
          >
            {ARTICLE_TYPE_LABEL[type]}
          </span>
          <span className="text-xs" style={{ color: "var(--text-muted)" }}>
            {readOnly ? "唯讀模式" : "Ctrl/⌘ + Enter 儲存"}
          </span>
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
            層級
          </label>
          <select
            value={type}
            onChange={(event) => setType(event.target.value as ArticleType)}
            disabled={readOnly}
            className="w-full text-sm px-3 py-2 rounded-lg outline-none"
            style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", color: "var(--text-primary)" }}
          >
            {EDITABLE_TYPES.map((t) => (
              <option key={t} value={t}>
                {ARTICLE_TYPE_LABEL[t]}（{t}）
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
            標題
          </label>
          <input
            ref={titleRef}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="例：第一章 總則、第一條…"
            disabled={readOnly}
            className="w-full text-sm px-3 py-2 rounded-lg outline-none"
            style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", color: "var(--text-primary)" }}
          />
        </div>

        <div>
          <label className="mb-1.5 flex items-center justify-between text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
            <span>副標題（選填）</span>
            <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>顯示在條文編號之後</span>
          </label>
          <input
            value={subtitle}
            onChange={(event) => setSubtitle(event.target.value)}
            placeholder="例：本辦法目的、緊急情形等"
            disabled={readOnly}
            className="w-full text-sm px-3 py-2 rounded-lg outline-none"
            style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", color: "var(--text-primary)" }}
          />
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
            內容
          </label>
          <SmartTextarea
            value={content}
            onChange={setContent}
            rows={12}
            placeholder="條文正文…"
            disabled={readOnly}
            className="w-full text-sm px-3 py-2 rounded-lg outline-none resize-y"
            style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", color: "var(--text-primary)", lineHeight: "1.7" }}
          />
        </div>
      </div>
    </Drawer>
  );
}
