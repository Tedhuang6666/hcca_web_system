"use client";
/**
 * RichTextarea — Tiptap WYSIWYG 編輯器，輸入/輸出均為 Markdown
 *
 * 支援格式：粗體、斜體、刪除線、底線、行內程式碼、
 *           H1/H2/H3、有序/無序清單、引言、水平線、程式碼區塊
 */
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import Placeholder from "@tiptap/extension-placeholder";
import { Markdown } from "tiptap-markdown";

// ── CSS for editor ──────────────────────────────────────────────────────────
const editorStyles = `
.tiptap-editor .ProseMirror {
  outline: none;
  min-height: 160px;
  padding: 0.625rem 0.75rem;
  font-size: 0.875rem;
  line-height: 1.7;
  color: var(--text-primary);
  background: var(--bg-surface);
}
.tiptap-editor .ProseMirror p { margin: 0 0 0.5em; }
.tiptap-editor .ProseMirror p:last-child { margin-bottom: 0; }
.tiptap-editor .ProseMirror h1 { font-size: 1.25rem; font-weight: 700; margin: 0.75em 0 0.25em; }
.tiptap-editor .ProseMirror h2 { font-size: 1.1rem; font-weight: 600; margin: 0.65em 0 0.2em; }
.tiptap-editor .ProseMirror h3 { font-size: 1rem; font-weight: 600; margin: 0.5em 0 0.15em; }
.tiptap-editor .ProseMirror ul { list-style: disc; padding-left: 1.4em; margin: 0.3em 0; }
.tiptap-editor .ProseMirror ol { list-style: decimal; padding-left: 1.4em; margin: 0.3em 0; }
.tiptap-editor .ProseMirror li { margin: 0.15em 0; }
.tiptap-editor .ProseMirror blockquote {
  border-left: 3px solid var(--border-strong);
  margin: 0.5em 0; padding-left: 1em;
  color: var(--text-muted); font-style: italic;
}
.tiptap-editor .ProseMirror code {
  background: var(--primary-dim); color: #38bdf8;
  padding: 0.1em 0.35em; border-radius: 4px;
  font-size: 0.82em; font-family: ui-monospace, monospace;
}
.tiptap-editor .ProseMirror pre {
  background: var(--bg-elevated); border: 1px solid var(--border);
  border-radius: 8px; padding: 0.75rem; overflow-x: auto; margin: 0.5em 0;
}
.tiptap-editor .ProseMirror pre code {
  background: none; color: var(--text-primary); padding: 0; font-size: 0.8rem;
}
.tiptap-editor .ProseMirror hr {
  border: none; border-top: 1px solid var(--border); margin: 0.75em 0;
}
.tiptap-editor .ProseMirror p.is-editor-empty:first-child::before {
  content: attr(data-placeholder);
  color: var(--text-disabled);
  pointer-events: none;
  float: left;
  height: 0;
}
`;

// ── 工具列按鈕定義 ────────────────────────────────────────────────────────────

import type { Editor } from "@tiptap/react";

type ToolbarBtn = {
  label: string;
  title: string;
  isActive?: (editor: Editor) => boolean;
  action: (editor: Editor) => void;
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
};

const TOOLBAR: (ToolbarBtn | "divider")[] = [
  {
    label: "H1", title: "標題一",
    isActive: e => e.isActive("heading", { level: 1 }) ?? false,
    action: e => e.chain().focus().toggleHeading({ level: 1 }).run(),
  },
  {
    label: "H2", title: "標題二",
    isActive: e => e.isActive("heading", { level: 2 }) ?? false,
    action: e => e.chain().focus().toggleHeading({ level: 2 }).run(),
  },
  {
    label: "H3", title: "標題三",
    isActive: e => e.isActive("heading", { level: 3 }) ?? false,
    action: e => e.chain().focus().toggleHeading({ level: 3 }).run(),
  },
  "divider",
  {
    label: "B", title: "粗體 (Ctrl+B)", bold: true,
    isActive: e => e.isActive("bold") ?? false,
    action: e => e.chain().focus().toggleBold().run(),
  },
  {
    label: "I", title: "斜體 (Ctrl+I)", italic: true,
    isActive: e => e.isActive("italic") ?? false,
    action: e => e.chain().focus().toggleItalic().run(),
  },
  {
    label: "U", title: "底線 (Ctrl+U)",
    isActive: e => e.isActive("underline") ?? false,
    action: e => e.chain().focus().toggleUnderline().run(),
  },
  {
    label: "S̶", title: "刪除線",
    isActive: e => e.isActive("strike") ?? false,
    action: e => e.chain().focus().toggleStrike().run(),
  },
  {
    label: "</>", title: "行內程式碼", code: true,
    isActive: e => e.isActive("code") ?? false,
    action: e => e.chain().focus().toggleCode().run(),
  },
  "divider",
  {
    label: "≡", title: "無序清單",
    isActive: e => e.isActive("bulletList") ?? false,
    action: e => e.chain().focus().toggleBulletList().run(),
  },
  {
    label: "1.", title: "有序清單",
    isActive: e => e.isActive("orderedList") ?? false,
    action: e => e.chain().focus().toggleOrderedList().run(),
  },
  {
    label: "❝", title: "引言",
    isActive: e => e.isActive("blockquote") ?? false,
    action: e => e.chain().focus().toggleBlockquote().run(),
  },
  {
    label: "⌥⌥", title: "程式碼區塊",
    isActive: e => e.isActive("codeBlock") ?? false,
    action: e => e.chain().focus().toggleCodeBlock().run(),
  },
  "divider",
  {
    label: "—", title: "水平分隔線",
    action: e => e.chain().focus().setHorizontalRule().run(),
  },
];

// ── 主元件 ────────────────────────────────────────────────────────────────────

interface RichTextareaProps {
  value: string;
  onChange: (value: string) => void;
  minRows?: number;
  placeholder?: string;
  className?: string;
}

/** 命令式介面：供外部（例如「插入變數」）在游標處插入文字。 */
export interface RichTextareaHandle {
  insertText: (text: string) => void;
}

const RichTextarea = forwardRef<RichTextareaHandle, RichTextareaProps>(function RichTextarea({
  value,
  onChange,
  minRows = 4,
  placeholder = "",
}, ref) {
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // track whether the next update comes from external prop change
  const externalUpdate = useRef(false);

  const editor = useEditor({
    extensions: [
      // Tiptap v3 StarterKit 已內建 underline，停用以避免 "Duplicate extension names" 警告
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      StarterKit.configure({ underline: false } as any),
      Underline,
      Placeholder.configure({ placeholder }),
      Markdown.configure({ html: false, tightLists: true }),
    ],
    content: value,              // initial content (Markdown)
    // ─── 新增下面這一行 ───
    immediatelyRender: false, 
    // ─────────────────────
    editorProps: {
      attributes: { class: "tiptap-editor" },
    },
    onUpdate({ editor }) {
      if (externalUpdate.current) return;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const md = (editor.storage as any).markdown.getMarkdown() as string;
      onChangeRef.current(md);
    },
  });

  useImperativeHandle(
    ref,
    () => ({
      insertText: (text: string) => {
        if (!editor) return;
        editor.chain().focus().insertContent(text).run();
      },
    }),
    [editor],
  );

  // Sync external value changes into editor (e.g., on load)
  useEffect(() => {
    if (!editor) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const current = (editor.storage as any).markdown.getMarkdown() as string;
    if (value !== current) {
      externalUpdate.current = true;
      editor.commands.setContent(value);
      // reset after microtask so the onUpdate above sees the flag
      Promise.resolve().then(() => { externalUpdate.current = false; });
    }
  }, [editor, value]);

  // inject styles once
  useEffect(() => {
    if (typeof document === "undefined") return;
    const id = "tiptap-rich-textarea-styles";
    if (!document.getElementById(id)) {
      const tag = document.createElement("style");
      tag.id = id;
      tag.textContent = editorStyles;
      document.head.appendChild(tag);
    }
  }, []);

  const minHeight = `${minRows * 1.7 * 14 + 20}px`;

  return (
    <div
      className="rounded-xl overflow-hidden"
      style={{ border: "1px solid var(--border)" }}>

      {/* ── 工具列 ────────────────────────────────────────────────────────── */}
      <div
        className="flex items-center gap-0.5 px-2 py-1.5 flex-wrap"
        style={{ background: "var(--bg-elevated)", borderBottom: "1px solid var(--border)" }}
        role="toolbar"
        aria-label="文字格式工具列"
      >
        {TOOLBAR.map((item, i) => {
          if (item === "divider") {
            return (
              <span key={`div-${i}`} className="w-px h-4 mx-1 flex-shrink-0"
                style={{ background: "var(--border)" }} aria-hidden="true" />
            );
          }
          const active = editor ? (item.isActive?.(editor) ?? false) : false;
          return (
            <button
              key={item.title}
              type="button"
              title={item.title}
              aria-label={item.title}
              aria-pressed={active}
              onMouseDown={(event) => {
                event.preventDefault();
                if (editor) item.action(editor);
              }}
              className="w-7 h-7 rounded flex items-center justify-center text-xs transition-colors"
              style={active
                ? { color: "var(--primary)", background: "var(--primary-dim)" }
                : { color: "var(--text-muted)", background: "transparent" }}
            >
              <span className={[
                item.bold ? "font-bold" : "",
                item.italic ? "italic" : "",
                item.code ? "font-mono" : "",
              ].join(" ")}>
                {item.label}
              </span>
            </button>
          );
        })}
        <span className="ml-auto text-[10px] pr-1 flex-shrink-0" style={{ color: "var(--text-disabled)" }}>
          Markdown
        </span>
      </div>

      {/* ── 編輯區 ───────────────────────────────────────────────────────── */}
      <div style={{ minHeight }} className="tiptap-editor">
        <EditorContent editor={editor} />
      </div>
    </div>
  );
});

export default RichTextarea;
