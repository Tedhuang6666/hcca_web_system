"use client";

import type { ReactNode } from "react";

type OfficialLine = {
  prefix: string;
  body: string;
  level: number;
};

type AmendmentRow = {
  status: string;
  articleNo: string;
  content: string;
};

type OfficialBlock =
  | { type: "line"; line: string; index: number }
  | { type: "amendment_table"; rows: AmendmentRow[]; index: number };

const LINE_RE = /^(　*)([一二三四五六七八九十百零〇]+、|（[一二三四五六七八九十百零〇]+）|\d+\.|\(\d+\))\s*(.*)$/;
const SMART_LINK_RE =
  /(https?:\/\/[^\s，。；、）)]+|[\u4e00-\u9fffA-Za-z]{1,16}字第\s*[0-9０-９A-Za-z-]+\s*號|「[^」]{2,60}(?:憲章|條例|辦法|規則|章程|細則|要點|準則)」)/g;

function parseLine(line: string): OfficialLine {
  const match = line.match(LINE_RE);
  if (!match) return { prefix: "", body: line, level: 0 };
  const indent = match[1] ?? "";
  const mark = match[2] ?? "";
  const body = match[3] ?? "";
  return {
    prefix: `${indent}${mark}`,
    body,
    level: Math.max(0, Math.floor(indent.length / 2)),
  };
}

function parseAmendmentRow(line: string): AmendmentRow | null {
  const match = line.match(/^(\S+)\s{2,}(.+?)\s{2,}(.+)$/);
  if (!match) return null;
  return {
    status: match[1],
    articleNo: match[2],
    content: match[3],
  };
}

function buildBlocks(lines: string[]): OfficialBlock[] {
  const blocks: OfficialBlock[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const next = lines[index + 1] ?? "";
    const rule = lines[index + 2] ?? "";

    if (
      line.trim() === "修正條文整理："
      && next.includes("異動")
      && next.includes("條號")
      && next.includes("內容")
      && /^─+/.test(rule.trim())
    ) {
      const rows: AmendmentRow[] = [];
      let cursor = index + 3;
      while (cursor < lines.length && lines[cursor].trim()) {
        const row = parseAmendmentRow(lines[cursor]);
        if (!row) break;
        rows.push(row);
        cursor += 1;
      }
      blocks.push({ type: "line", line, index });
      if (rows.length > 0) {
        blocks.push({ type: "amendment_table", rows, index: index + 1 });
        index = cursor - 1;
        continue;
      }
    }

    blocks.push({ type: "line", line, index });
  }

  return blocks;
}

function amendmentStatusStyle(status: string) {
  if (status === "新增") {
    return {
      color: "var(--success)",
      background: "var(--success-dim)",
    };
  }
  if (status === "刪除") {
    return {
      color: "var(--danger)",
      background: "rgba(220,38,38,0.1)",
    };
  }
  return {
    color: "var(--warning)",
    background: "rgba(245,158,11,0.1)",
  };
}

function smartLinkHref(token: string) {
  if (/^https?:\/\//.test(token)) return token;
  if (token.includes("字第") && token.includes("號")) {
    return `/documents?keyword=${encodeURIComponent(token.replace(/\s+/g, ""))}`;
  }
  const title = token.replace(/^「|」$/g, "");
  return `/regulations?keyword=${encodeURIComponent(title)}`;
}

export function SmartLinkedText({ text }: { text: string }) {
  const parts: ReactNode[] = [];
  let cursor = 0;
  let key = 0;

  for (const match of text.matchAll(SMART_LINK_RE)) {
    const token = match[0];
    const index = match.index ?? 0;
    if (index > cursor) parts.push(text.slice(cursor, index));
    const href = smartLinkHref(token);
    parts.push(
      <a
        key={`${token}-${key++}`}
        href={href}
        className="official-smart-link"
        target={href.startsWith("http") ? "_blank" : undefined}
        rel={href.startsWith("http") ? "noreferrer" : undefined}
        onClick={(event) => event.stopPropagation()}
      >
        {token}
      </a>,
    );
    cursor = index + token.length;
  }

  if (cursor < text.length) parts.push(text.slice(cursor));
  return <>{parts}</>;
}

export function OfficialText({
  value,
  className = "",
}: {
  value: string;
  className?: string;
}) {
  const lines = value.split(/\r?\n/);
  const blocks = buildBlocks(lines);

  return (
    <div className={`official-text ${className}`}>
      <style>{`
        .official-text {
          min-width: 0;
          max-width: 100%;
          white-space: normal;
          overflow-wrap: anywhere;
          word-break: break-word;
        }
        .official-text-line {
          display: grid;
          grid-template-columns: max-content minmax(0, 1fr);
          column-gap: 0.45em;
          margin: 0.1em 0;
        }
        .official-text-line.plain {
          display: block;
          white-space: pre-wrap;
        }
        .official-text-line.blank {
          display: block;
          height: 1em;
        }
        .official-text-prefix {
          white-space: pre;
        }
        .official-text-body {
          min-width: 0;
          white-space: pre-wrap;
          overflow-wrap: anywhere;
          word-break: break-word;
        }
        .official-smart-link {
          color: var(--primary);
          text-decoration: underline;
          text-decoration-thickness: 1px;
          text-underline-offset: 0.18em;
        }
        .official-smart-link:hover {
          opacity: 0.82;
        }
        .official-text-line.level-1 { margin-left: 0; }
        .official-text-line.level-2 { margin-left: 2em; }
        .official-text-line.level-3 { margin-left: 4em; }
        .official-amendment-table {
          margin: 0.75rem 0 1rem;
        }
        .official-amendment-table table {
          width: 100%;
          table-layout: fixed;
          border-collapse: collapse;
        }
        .official-amendment-table th,
        .official-amendment-table td {
          padding: 0.6rem 0.7rem;
          vertical-align: top;
          border-top: 1px solid var(--border);
          overflow-wrap: anywhere;
          word-break: break-word;
        }
        .official-amendment-table thead th {
          border-top: 0;
          text-align: left;
          font-size: 0.75rem;
          color: var(--text-muted);
        }
        .official-amendment-mobile {
          display: none;
        }
        @media (max-width: 639px) {
          .official-amendment-desktop {
            display: none;
          }
          .official-amendment-mobile {
            display: grid;
            gap: 0.6rem;
          }
          .official-amendment-card {
            border: 1px solid var(--border);
            border-radius: 0.75rem;
            padding: 0.75rem;
            background: var(--bg-elevated);
          }
        }
      `}</style>
      {blocks.map((block) => {
        if (block.type === "amendment_table") {
          return (
            <div key={`amendment-${block.index}`} className="official-amendment-table">
              <div
                className="official-amendment-desktop overflow-hidden rounded-xl"
                style={{ border: "1px solid var(--border)" }}
              >
                <table>
                  <colgroup>
                    <col style={{ width: "5rem" }} />
                    <col style={{ width: "7.5rem" }} />
                    <col />
                  </colgroup>
                  <thead style={{ background: "var(--bg-elevated)" }}>
                    <tr>
                      <th>異動</th>
                      <th>條號</th>
                      <th>內容</th>
                    </tr>
                  </thead>
                  <tbody>
                    {block.rows.map((row, rowIndex) => (
                      <tr key={`${row.status}-${row.articleNo}-${rowIndex}`}>
                        <td>
                          <span
                            className="inline-flex rounded px-1.5 py-0.5 text-[11px]"
                            style={amendmentStatusStyle(row.status)}
                          >
                            {row.status}
                          </span>
                        </td>
                        <td>{row.articleNo}</td>
                        <td className="whitespace-pre-wrap">
                          <SmartLinkedText text={row.content} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="official-amendment-mobile">
                {block.rows.map((row, rowIndex) => (
                  <article key={`${row.status}-${row.articleNo}-${rowIndex}`} className="official-amendment-card">
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <span
                        className="inline-flex rounded px-1.5 py-0.5 text-[11px]"
                        style={amendmentStatusStyle(row.status)}
                      >
                        {row.status}
                      </span>
                      <span className="text-sm font-medium">{row.articleNo}</span>
                    </div>
                    <p className="whitespace-pre-wrap text-sm">
                      <SmartLinkedText text={row.content} />
                    </p>
                  </article>
                ))}
              </div>
            </div>
          );
        }

        const { line, index } = block;
        if (!line.trim()) {
          return <div key={index} className="official-text-line blank" />;
        }
        const parsed = parseLine(line);
        if (!parsed.prefix) {
          return (
            <div key={index} className="official-text-line plain">
              <SmartLinkedText text={parsed.body} />
            </div>
          );
        }
        return (
          <div key={index} className={`official-text-line level-${parsed.level}`}>
            <span className="official-text-prefix">{parsed.prefix}</span>
            <span className="official-text-body">
              <SmartLinkedText text={parsed.body} />
            </span>
          </div>
        );
      })}
    </div>
  );
}
