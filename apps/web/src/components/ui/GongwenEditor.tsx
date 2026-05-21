"use client";
/**
 * GongwenEditor — 公文層級編號智慧文字編輯器
 *
 * 層級結構：
 *   Level 1：一、二、三… （全形中文數字 + 全形頓號）
 *   Level 2：（一）（二）（三）… （全形括號，縮排 2 個全形空格）
 *   Level 3：1. 2. 3.… （半形阿拉伯數字 + 半形句點，縮排 4 個全形空格）
 *   Level 4：(1) (2) (3)… （半形括號，縮排 6 個全形空格）
 *
 * 鍵盤行為：
 *   Enter     → 在同層級自動續編下一個編號
 *   Tab       → 縮排至下一層（從 1 開始）
 *   Shift+Tab → 縮排至上一層（從下一個號開始）
 *   Backspace → 若游標在行首編號後方且內容為空，退回上一層
 *   Ctrl+Z    → 復原
 *   Ctrl+Y / Ctrl+Shift+Z → 取消復原
 */

import { useRef, useCallback, useEffect } from "react";

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

interface LineInfo {
  level: 0 | 1 | 2 | 3 | 4;
  num: number;
  fullPrefix: string;
  bodyStart: number;
}

// Level 2: 2 個全形空格 + （中文數字）
// Level 3: 4 個全形空格 + 數字.
// Level 4: 6 個全形空格 + (數字)
const LEVEL1_RE = /^([一二三四五六七八九十]+、)/;
const LEVEL2_RE = /^(　{0,4})（([一二三四五六七八九十]+)）(\s?)/;
const LEVEL3_RE = /^(　{4})(\d+)\.(\s?)/;
const LEVEL4_RE = /^(　{6})\((\d+)\)(\s?)/;

function parseLine(line: string): LineInfo {
  let m: RegExpMatchArray | null;

  m = line.match(LEVEL1_RE);
  if (m) {
    return { level: 1, num: parseZh(m[1].replace("、", "")), fullPrefix: m[1], bodyStart: m[1].length };
  }
  // Level 4 must be checked before Level 3 to avoid ambiguity
  m = line.match(LEVEL4_RE);
  if (m) {
    const prefix = `${m[1]}(${m[2]})`;
    const space = m[3] ?? "";
    return { level: 4, num: parseInt(m[2]), fullPrefix: prefix + space, bodyStart: prefix.length + space.length };
  }
  m = line.match(LEVEL3_RE);
  if (m) {
    const prefix = `${m[1]}${m[2]}.`;
    const space = m[3] ?? "";
    return { level: 3, num: parseInt(m[2]), fullPrefix: prefix + space, bodyStart: prefix.length + space.length };
  }
  m = line.match(LEVEL2_RE);
  if (m) {
    const indent = m[1];
    const prefix = `${indent}（${m[2]}）`;
    const space = m[3] ?? "";
    return { level: 2, num: parseZh(m[2]), fullPrefix: prefix + space, bodyStart: prefix.length + space.length };
  }
  return { level: 0, num: 0, fullPrefix: "", bodyStart: 0 };
}

function makePrefix(level: 1 | 2 | 3 | 4, num: number): string {
  switch (level) {
    case 1: return `${zhNum(num)}、`;
    case 2: return `　　（${zhNum(num)}）`;   // 2 全形空格
    case 3: return `　　　　${num}.`;          // 4 全形空格
    case 4: return `　　　　　　(${num})`;     // 6 全形空格
  }
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

      const nextPrefix = makePrefix(info.level, info.num + 1);
      const insert = "\n" + nextPrefix;
      const newVal = ta.value.slice(0, pos) + insert + ta.value.slice(pos);
      updateValue(newVal);
      setTimeout(() => {
        if (ref.current) {
          ref.current.selectionStart = ref.current.selectionEnd = pos + insert.length;
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
        const nextLevel = Math.min(4, (info.level === 0 ? 1 : info.level) + 1) as 1 | 2 | 3 | 4;
        const newPrefix = makePrefix(nextLevel, 1);
        const content = lineText.slice(info.bodyStart);
        const newLine = newPrefix + (content ? " " + content : "");
        const newVal = ta.value.slice(0, lineStart) + newLine + ta.value.slice(lineStart + lineText.length);
        updateValue(newVal);
        setTimeout(() => {
          if (ref.current) {
            const newPos = lineStart + newPrefix.length + (content ? 1 : 0);
            ref.current.selectionStart = ref.current.selectionEnd = newPos;
          }
        }, 0);
      } else {
        if (info.level <= 1) return;
        const prevLevel = (info.level - 1) as 1 | 2 | 3 | 4;
        const linesBefore = ta.value.slice(0, lineStart).split("\n");
        let prevNum = 0;
        for (let i = linesBefore.length - 1; i >= 0; i--) {
          const p = parseLine(linesBefore[i]);
          if (p.level === prevLevel) { prevNum = p.num; break; }
        }
        const newPrefix = makePrefix(prevLevel, prevNum + 1);
        const content = lineText.slice(info.bodyStart);
        const newLine = newPrefix + (content ? " " + content : "");
        const newVal = ta.value.slice(0, lineStart) + newLine + ta.value.slice(lineStart + lineText.length);
        updateValue(newVal);
        setTimeout(() => {
          if (ref.current) {
            const newPos = lineStart + newPrefix.length + (content ? 1 : 0);
            ref.current.selectionStart = ref.current.selectionEnd = newPos;
          }
        }, 0);
      }
      return;
    }
  }, [onChange, updateValue]);

  const minH = `${minRows * 1.8 * 14}px`;

  return (
    <div>
      {/* 工具列 */}
      <div
        className="flex items-center gap-1 px-2 py-1.5 rounded-t-xl flex-wrap"
        style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", borderBottom: "none" }}
      >
        {[
          { label: "一、", title: "插入第一層編號（一、）", action: () => insertLevel(1) },
          { label: "（一）", title: "插入第二層編號（（一））", action: () => insertLevel(2) },
          { label: "1.", title: "插入第三層編號（1.）", action: () => insertLevel(3) },
          { label: "(1)", title: "插入第四層編號（(1)）", action: () => insertLevel(4) },
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
                setTimeout(() => ref.current?.focus(), 0);
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
                setTimeout(() => ref.current?.focus(), 0);
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
        }}
        onKeyDown={handleKeyDown}
        onBlur={onBlur}
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
    </div>
  );

  function insertLevel(level: 1 | 2 | 3 | 4) {
    const ta = ref.current;
    if (!ta) return;
    const { pos, lineStart, lineText } = getCursorLineInfo(ta);
    const linesBefore = ta.value.slice(0, lineStart).split("\n");
    let lastNum = 0;
    for (let i = linesBefore.length - 1; i >= 0; i--) {
      const p = parseLine(linesBefore[i]);
      if (p.level === level) { lastNum = p.num; break; }
    }
    const currentInfo = parseLine(lineText);
    if (currentInfo.level === level) lastNum = currentInfo.num;
    const prefix = makePrefix(level, lastNum + 1) + " ";
    const insertAt = lineText.trim() === "" ? lineStart : pos;
    const newVal = ta.value.slice(0, insertAt) + prefix + ta.value.slice(insertAt);
    updateValue(newVal);
    setTimeout(() => {
      if (ref.current) {
        ref.current.selectionStart = ref.current.selectionEnd = insertAt + prefix.length;
        ref.current.focus();
      }
    }, 0);
  }
}
