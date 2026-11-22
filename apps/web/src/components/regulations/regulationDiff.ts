import { diffArrays, diffWordsWithSpace } from "diff";

export type RegulationDiffSegment = {
  type: "add" | "remove" | "equal";
  text: string;
};

export type RegulationDiffRow = {
  type: "add" | "remove" | "equal";
  text: string;
  segments?: RegulationDiffSegment[];
};

function comparisonText(line: string): string {
  return line.replace(/\s/gu, "");
}

function snapshotLines(text: string): string[] {
  if (!text) return [];
  const lines = text.split(/\r?\n/u);
  if (lines.at(-1) === "") lines.pop();
  return lines;
}

function wordSegments(oldLine: string, newLine: string): RegulationDiffSegment[] {
  return diffWordsWithSpace(oldLine, newLine).map((part) => ({
    type: part.added ? "add" : part.removed ? "remove" : "equal",
    text: part.value,
  }));
}

function inlineChangeRows(oldLine: string, newLine: string): RegulationDiffRow[] | null {
  if (!oldLine.trim() || !newLine.trim()) return null;

  const segments = wordSegments(oldLine, newLine);
  const sharedText = segments
    .filter((segment) => segment.type === "equal")
    .map((segment) => comparisonText(segment.text))
    .join("");
  const lineLength = Math.max(comparisonText(oldLine).length, comparisonText(newLine).length, 1);
  if (sharedText.length / lineLength < 0.25) return null;

  return [
    {
      type: "remove",
      text: oldLine,
      segments: segments.filter((segment) => segment.type !== "add"),
    },
    {
      type: "add",
      text: newLine,
      segments: segments.filter((segment) => segment.type !== "remove"),
    },
  ];
}

export function buildRegulationDiffRows(oldText: string, newText: string): RegulationDiffRow[] {
  const oldLines = snapshotLines(oldText);
  const newLines = snapshotLines(newText);
  const changes = diffArrays(oldLines, newLines, {
    comparator: (oldLine, newLine) => comparisonText(oldLine) === comparisonText(newLine),
  });
  const rows: RegulationDiffRow[] = [];
  let removed: string[] = [];
  let added: string[] = [];

  const flushChanges = () => {
    const pairedRows = removed.length > 0 && removed.length === added.length
      ? removed.map((line, index) => inlineChangeRows(line, added[index]))
      : null;

    if (pairedRows?.every((pair): pair is RegulationDiffRow[] => pair !== null)) {
      rows.push(...pairedRows.flat());
    } else {
      rows.push(...removed.map((text) => ({ type: "remove" as const, text })));
      rows.push(...added.map((text) => ({ type: "add" as const, text })));
    }

    removed = [];
    added = [];
  };

  for (const change of changes) {
    if (change.removed) {
      removed.push(...change.value);
      continue;
    }
    if (change.added) {
      added.push(...change.value);
      continue;
    }

    flushChanges();
    rows.push(...change.value.map((text) => ({ type: "equal" as const, text })));
  }

  flushChanges();
  return rows;
}
