"use client";
/**
 * GongwenEditor — 公文層級編號智慧文字編輯器
 *
 * 層級結構：
 *   Level 1：一、 二、 三、… （全形中文數字 + 全形頓號）
 *   Level 2：　　（一）　（二）　（三）… （全形括號，縮排 2 個全形空格）
 *   Level 3：　　　　1. 2. 3.… （半形阿拉伯數字 + 半形句點，縮排 4 個全形空格）
 *   Level 4：　　　　　　(1) (2) (3)… （半形括號，縮排 6 個全形空格）
 *
 * 鍵盤行為：
 *   Enter     → 在同層級自動續編下一個編號
 *   Tab       → 縮排至下一層（從 1 開始）
 *   Shift+Tab → 縮排至上一層（從下一個號開始）
 *   Backspace → 若游標在行首編號後方且內容為空，退回上一層
 *   Ctrl+Z    → 復原
 *   Ctrl+Y / Ctrl+Shift+Z → 取消復原
 */

import { useRef, useCallback, useEffect, useMemo, useState } from "react";
import { insertAtCursor, writingSuggestions } from "@/lib/writingAssist";

// ── 中文數字對照 ────────────────────────────────────────────────────────────────

const ZH = [
  "一","二","三","四","五","六","七","八","九","十",
  "十一","十二","十三","十四","十五","十六","十七","十八","十九","二十",
  "二十一","二十二","二十三","二十四","二十五","二十六","二十七","二十八","二十九","三十",
];

function zhNum(n: number): string {
  return ZH[n - 1] ?? String(n);
}

function parseZh(s: string): number {
  const idx = ZH.indexOf(s);
  return idx >= 0 ? idx + 1 : 0;
}

// ── 行解析 ──────────────────────────────────────────────────────────────────────

type ListLevel = 1 | 2 | 3 | 4;

interface LineInfo {
  level: 0 | 1 | 2 | 3 | 4;
  num: number;
  fullPrefix: string;
  bodyStart: number;
}

// Level 2: 2 個全形空格 + （中文數字）
// Level 3: 4 個全形空格 + 數字.
// Level 4: 6 個全形空格 + (數字)
const LEVEL1_RE = /^([一二三四五六七八九十]+、)[ \t　]*/;
const LEVEL2_RE = /^(　{0,4})（([一二三四五六七八九十]+)）[ \t　]*/;
const LEVEL3_RE = /^(　{4})(\d+)\.[ \t　]*/;
const LEVEL4_RE = /^(　{6})\((\d+)\)[ \t　]*/;

function parseLine(line: string): LineInfo {
  let m: RegExpMatchArray | null;

  m = line.match(LEVEL1_RE);
  if (m) {
    return { level: 1, num: parseZh(m[1].replace("、", "")), fullPrefix: m[0], bodyStart: m[0].length };
  }
  // Level 4 must be checked before Level 3 to avoid ambiguity
  m = line.match(LEVEL4_RE);
  if (m) {
    return { level: 4, num: parseInt(m[2]), fullPrefix: m[0], bodyStart: m[0].length };
  }
  m = line.match(LEVEL3_RE);
  if (m) {
    return { level: 3, num: parseInt(m[2]), fullPrefix: m[0], bodyStart: m[0].length };
  }
  m = line.match(LEVEL2_RE);
  if (m) {
    return { level: 2, num: parseZh(m[2]), fullPrefix: m[0], bodyStart: m[0].length };
  }
  return { level: 0, num: 0, fullPrefix: "", bodyStart: 0 };
}

function makePrefix(level: ListLevel, num: number): string {
  switch (level) {
    case 1: return `${zhNum(num)}、 `;
    case 2: return `　　（${zhNum(num)}） `;   // 2 全形空格
    case 3: return `　　　　${num}. `;          // 4 全形空格
    case 4: return `　　　　　　(${num}) `;     // 6 全形空格
  }
}

/**
 * 找出目前行在同一父層下的下一個編號。
 * 遇到空白行或較低層級時停止，避免把另一個段落／父層的編號帶過來。
 */
function nextSiblingNumber(valueBeforeLine: string, level: ListLevel): number {
  const lines = valueBeforeLine.split("\n");
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const info = parseLine(lines[i]);
    if (info.level === level) return info.num > 0 ? info.num + 1 : 1;
    if (info.level === 0 || info.level < level) return 1;
  }
  return 1;
}

function cursorInBody(pos: number, lineStart: number, info: LineInfo, contentLength: number): number {
  return Math.max(0, Math.min(contentLength, pos - lineStart - info.bodyStart));
}

// ── 元件 ────────────────────────────────────────────────────────────────────────

interface Props {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  minRows?: number;
  className?: string;
  onBlur?: () => void;
}

export default function GongwenEditor({ value, onChange, placeholder, minRows = 5, className, onBlur }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [focused, setFocused] = useState(false);
  const [cursor, setCursor] = useState(0);
  const suggestions = useMemo(() => writingSuggestions(value, cursor), [cursor, value]);

  // ── 歷史紀錄（Undo/Redo）─────────────────────────────────────────────────────
  const historyRef = useRef<string[]>([value]);
  const historyIdxRef = useRef(0);
  const skipHistoryPushRef = useRef(false);

  // 當 value 從外部重置時（例如載入資料），同步歷史
  useEffect(() => {
    const hist = historyRef.current;
    if (hist[historyIdxRef.current] !== value && !skipHistoryPushRef.current) {
      // 外部重置：清空歷史，以新值為起點
      historyRef.current = [value];
      historyIdxRef.current = 0;
    }
    skipHistoryPushRef.current = false;
  }, [value]);

  const pushHistory = useCallback((val: string) => {
    const hist = historyRef.current;
    const idx = historyIdxRef.current;
    const newHist = hist.slice(0, idx + 1);
    newHist.push(val);
    if (newHist.length > 200) newHist.shift();
    historyRef.current = newHist;
    historyIdxRef.current = newHist.length - 1;
  }, []);

  /** 更新值並推入歷史 */
  const updateValue = useCallback((newVal: string) => {
    pushHistory(newVal);
    skipHistoryPushRef.current = true;
    onChange(newVal);
  }, [onChange, pushHistory]);

  const replaceCurrentLine = useCallback((newVal: string, newPos: number) => {
    if (newVal === value) return;
    updateValue(newVal);
    setTimeout(() => {
      if (!ref.current) return;
      ref.current.selectionStart = ref.current.selectionEnd = newPos;
      setCursor(newPos);
    }, 0);
  }, [updateValue, value]);

  /** 取得游標所在行的行號與該行字串 */
  function getCursorLineInfo(ta: HTMLTextAreaElement) {
    const pos = ta.selectionStart;
    const before = ta.value.slice(0, pos);
    const lineStart = before.lastIndexOf("\n") + 1;
    const lineEnd = ta.value.indexOf("\n", pos);
    const lineEndActual = lineEnd === -1 ? ta.value.length : lineEnd;
    const lineText = ta.value.slice(lineStart, lineEndActual);
    return { pos, lineStart, lineEnd: lineEndActual, lineText };
  }

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const ta = e.currentTarget;

    // ── Ctrl+Z（復原） ────────────────────────────────────────────────────────
    if (e.ctrlKey && e.key === "z" && !e.shiftKey) {
      e.preventDefault();
      const idx = historyIdxRef.current;
      if (idx > 0) {
        historyIdxRef.current = idx - 1;
        skipHistoryPushRef.current = true;
        onChange(historyRef.current[idx - 1]);
      }
      return;
    }

    // ── Ctrl+Y / Ctrl+Shift+Z（取消復原） ────────────────────────────────────
    if ((e.ctrlKey && e.key === "y") || (e.ctrlKey && e.shiftKey && e.key === "z")) {
      e.preventDefault();
      const idx = historyIdxRef.current;
      const hist = historyRef.current;
      if (idx < hist.length - 1) {
        historyIdxRef.current = idx + 1;
        skipHistoryPushRef.current = true;
        onChange(hist[idx + 1]);
      }
      return;
    }

    // ── Enter ────────────────────────────────────────────────────────────────
    if (e.key === "Enter" && !e.shiftKey) {
      const { pos, lineStart, lineEnd, lineText } = getCursorLineInfo(ta);
      const info = parseLine(lineText);
      if (info.level === 0) return;

      e.preventDefault();
      const contentOnLine = lineText.slice(info.bodyStart);

      if (!contentOnLine.trim()) {
        const newVal =
          ta.value.slice(0, lineStart) +
          "\n" +
          ta.value.slice(lineEnd);
        updateValue(newVal);
        setTimeout(() => {
          if (ref.current) {
            ref.current.selectionStart = ref.current.selectionEnd = lineStart + 1;
          }
        }, 0);
        return;
      }

      const currentPrefix = makePrefix(info.level, info.num);
      const cursorInContent = cursorInBody(pos, lineStart, info, contentOnLine.length);
      const currentLine = currentPrefix + contentOnLine;
      const currentCursor = lineStart + currentPrefix.length + cursorInContent;
      const nextPrefix = makePrefix(info.level, info.num + 1);
      const newVal =
        ta.value.slice(0, lineStart) +
        currentLine.slice(0, currentCursor - lineStart) +
        "\n" +
        nextPrefix +
        currentLine.slice(currentCursor - lineStart) +
        ta.value.slice(lineEnd);
      updateValue(newVal);
      setTimeout(() => {
        if (ref.current) {
          const nextPos = currentCursor + 1 + nextPrefix.length;
          ref.current.selectionStart = ref.current.selectionEnd = nextPos;
          setCursor(nextPos);
        }
      }, 0);
      return;
    }

    // ── Tab（縮排） ───────────────────────────────────────────────────────────
    if (e.key === "Tab" && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      const { lineStart, lineText } = getCursorLineInfo(ta);
      const info = parseLine(lineText);

      if (!e.shiftKey) {
        if (info.level === 4) return;
        const nextLevel = (info.level === 0 ? 1 : info.level + 1) as ListLevel;
        const content = info.level === 0 ? lineText.trimStart() : lineText.slice(info.bodyStart);
        const contentStart = info.level === 0 ? lineText.length - content.length : info.bodyStart;
        const newPrefix = makePrefix(nextLevel, nextSiblingNumber(ta.value.slice(0, lineStart), nextLevel));
        const newLine = newPrefix + content;
        const newVal = ta.value.slice(0, lineStart) + newLine + ta.value.slice(lineStart + lineText.length);
        const newPos = lineStart + newPrefix.length + cursorInBody(
          ta.selectionStart,
          lineStart,
          { ...info, bodyStart: contentStart },
          content.length,
        );
        replaceCurrentLine(newVal, newPos);
      } else {
        if (info.level <= 1) return;
        const prevLevel = (info.level - 1) as ListLevel;
        const newPrefix = makePrefix(prevLevel, nextSiblingNumber(ta.value.slice(0, lineStart), prevLevel));
        const content = lineText.slice(info.bodyStart);
        const newLine = newPrefix + content;
        const newVal = ta.value.slice(0, lineStart) + newLine + ta.value.slice(lineStart + lineText.length);
        const newPos = lineStart + newPrefix.length + cursorInBody(
          ta.selectionStart,
          lineStart,
          info,
          content.length,
        );
        replaceCurrentLine(newVal, newPos);
      }
      return;
    }
  }, [onChange, replaceCurrentLine, updateValue]);

  const minH = `${minRows * 1.8 * 14}px`;
  const applySuggestion = (text: string) => {
    const ta = ref.current;
    const start = ta?.selectionStart ?? value.length;
    const end = ta?.selectionEnd ?? start;
    const next = insertAtCursor(value, text, start, end);
    updateValue(next);
    setTimeout(() => {
      const nextPos = start + text.length;
      if (ref.current) ref.current.selectionStart = ref.current.selectionEnd = nextPos;
      setCursor(nextPos);
    }, 0);
  };

  return (
    <div className="relative">
      {/* 工具列 */}
      <div
        className="flex items-center gap-1 px-2 py-1.5 rounded-t-xl flex-wrap"
        style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", borderBottom: "none" }}
      >
        {[
          { label: "一、", title: "套用第一層編號（一、）", action: () => insertLevel(1) },
          { label: "（一）", title: "套用第二層編號（（一））", action: () => insertLevel(2) },
          { label: "1.", title: "套用第三層編號（1.）", action: () => insertLevel(3) },
          { label: "(1)", title: "套用第四層編號（(1)）", action: () => insertLevel(4) },
        ].map(({ label, title, action }) => (
          <button
            key={label}
            type="button"
            title={title}
            onMouseDown={(e) => { e.preventDefault(); action(); }}
            className="px-2.5 py-1 rounded text-xs font-medium cursor-pointer transition-colors"
            style={{ color: "var(--text-secondary)", border: "1px solid var(--border)", background: "var(--bg-surface)" }}
          >
            {label}
          </button>
        ))}
        {/* 復原/取消復原 */}
        <div className="flex gap-0.5 ml-1">
          <button
            type="button"
            title="復原 (Ctrl+Z)"
            onMouseDown={(e) => {
              e.preventDefault();
              const idx = historyIdxRef.current;
              if (idx > 0) {
                historyIdxRef.current = idx - 1;
                skipHistoryPushRef.current = true;
                onChange(historyRef.current[idx - 1]);
              }
            }}
            className="px-2 py-1 rounded text-xs cursor-pointer transition-colors"
            style={{ color: "var(--text-muted)", border: "1px solid var(--border)", background: "var(--bg-surface)" }}
          >↩</button>
          <button
            type="button"
            title="取消復原 (Ctrl+Y)"
            onMouseDown={(e) => {
              e.preventDefault();
              const idx = historyIdxRef.current;
              const hist = historyRef.current;
              if (idx < hist.length - 1) {
                historyIdxRef.current = idx + 1;
                skipHistoryPushRef.current = true;
                onChange(hist[idx + 1]);
              }
            }}
            className="px-2 py-1 rounded text-xs cursor-pointer transition-colors"
            style={{ color: "var(--text-muted)", border: "1px solid var(--border)", background: "var(--bg-surface)" }}
          >↪</button>
        </div>
        <span
          className="text-[10px] ml-1"
          style={{ color: "var(--text-muted)" }}
        >
          Enter 續編 ／ Tab 降級 ／ Shift+Tab 升級 ／ Ctrl+Z 復原
        </span>
      </div>
      <textarea
        ref={ref}
        value={value}
        onChange={(e) => {
          pushHistory(e.target.value);
          skipHistoryPushRef.current = true;
          onChange(e.target.value);
          setCursor(e.target.selectionStart);
        }}
        onKeyDown={handleKeyDown}
        onKeyUp={() => setCursor(ref.current?.selectionStart ?? value.length)}
        onClick={() => setCursor(ref.current?.selectionStart ?? value.length)}
        onFocus={(e) => {
          setFocused(true);
          setCursor(e.currentTarget.selectionStart);
        }}
        onBlur={() => {
          window.setTimeout(() => setFocused(false), 120);
          onBlur?.();
        }}
        placeholder={placeholder}
        rows={minRows}
        wrap="soft"
        spellCheck={false}
        className={`w-full rounded-b-xl text-sm p-3 outline-none resize-y ${className ?? ""}`}
        style={{
          background: "var(--bg-surface)",
          border: "1px solid var(--border)",
          color: "var(--text-primary)",
          minHeight: minH,
          lineHeight: "2",
          fontFamily: "inherit",
          fontSize: "1rem",
          letterSpacing: 0,
          whiteSpace: "pre-wrap",
          overflowWrap: "anywhere",
          wordBreak: "break-word",
          overflowX: "hidden",
          tabSize: 2,
        }}
      />
      {focused && suggestions.length > 0 && (
        <div
          className="absolute z-20 mt-1 hidden w-full overflow-hidden rounded-lg shadow-lg md:block"
          style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}
        >
          <div className="flex max-h-48 flex-col overflow-y-auto p-1">
            {suggestions.map((item, index) => (
              <button
                key={`${item.group}-${item.label}-${index}`}
                type="button"
                onMouseDown={(event) => {
                  event.preventDefault();
                  applySuggestion(item.value);
                }}
                className="flex items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-xs hover:opacity-80"
              >
                <span className="min-w-0 truncate" style={{ color: "var(--text-primary)" }}>
                  {item.value}
                </span>
                <span className="flex-shrink-0" style={{ color: "var(--text-muted)" }}>
                  {item.group}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );

  function insertLevel(level: 1 | 2 | 3 | 4) {
    const ta = ref.current;
    if (!ta) return;
    const { pos, lineStart, lineText } = getCursorLineInfo(ta);
    const currentInfo = parseLine(lineText);
    const content = currentInfo.level === 0 ? lineText.trimStart() : lineText.slice(currentInfo.bodyStart);
    const contentStart = currentInfo.level === 0
      ? lineText.length - content.length
      : currentInfo.bodyStart;
    const num = currentInfo.level === level && currentInfo.num > 0
      ? currentInfo.num
      : nextSiblingNumber(ta.value.slice(0, lineStart), level);
    const prefix = makePrefix(level, num);
    const newLine = prefix + content;
    const newVal = ta.value.slice(0, lineStart) + newLine + ta.value.slice(lineStart + lineText.length);
    const newPos = lineStart + prefix.length + cursorInBody(
      pos,
      lineStart,
      { ...currentInfo, bodyStart: contentStart },
      content.length,
    );
    replaceCurrentLine(newVal, newPos);
  }
}
