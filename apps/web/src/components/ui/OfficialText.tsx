"use client";

type OfficialLine = {
  prefix: string;
  body: string;
  level: number;
};

const LINE_RE = /^(　*)([一二三四五六七八九十百零〇]+、|（[一二三四五六七八九十百零〇]+）|\d+\.|\(\d+\))\s*(.*)$/;

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

export function OfficialText({
  value,
  className = "",
}: {
  value: string;
  className?: string;
}) {
  const lines = value.split(/\r?\n/);

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
        .official-text-line.level-1 { margin-left: 0; }
        .official-text-line.level-2 { margin-left: 2em; }
        .official-text-line.level-3 { margin-left: 4em; }
      `}</style>
      {lines.map((line, index) => {
        if (!line.trim()) {
          return <div key={index} className="official-text-line blank" />;
        }
        const parsed = parseLine(line);
        if (!parsed.prefix) {
          return (
            <div key={index} className="official-text-line plain">
              {parsed.body}
            </div>
          );
        }
        return (
          <div key={index} className={`official-text-line level-${parsed.level}`}>
            <span className="official-text-prefix">{parsed.prefix}</span>
            <span className="official-text-body">{parsed.body}</span>
          </div>
        );
      })}
    </div>
  );
}
