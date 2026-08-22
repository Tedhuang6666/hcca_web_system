#!/usr/bin/env python3
import json
import re
import sys
from pathlib import Path

REPO = Path(__file__).parent.parent
TYPES_TS = REPO / "apps/web/src/lib/types.ts"
COVERAGE_FILE = Path("/tmp/bridge_coverage.json")

if not COVERAGE_FILE.exists():
    print("錯誤：找不到 /tmp/bridge_coverage.json", file=sys.stderr)
    print("請先執行：node scripts/generate-bridge.mjs > /tmp/bridge_coverage.json", file=sys.stderr)
    sys.exit(1)

with open(COVERAGE_FILE) as f:
    coverage = json.load(f)

COVERED = set(coverage["covered"])
MISSING = set(coverage["missing"])
print(f"已覆蓋（api-bridge）：{len(COVERED)} 個", file=sys.stderr)
print(f"仍需手寫：{len(MISSING)} 個", file=sys.stderr)

source = TYPES_TS.read_text(encoding="utf-8")
lines = source.splitlines(keepends=True)
n = len(lines)

BRIDGE_REEXPORT_RE = re.compile(
    r"export type \{\n(?P<names>.*?)\n\} from './api-bridge'\n?", re.DOTALL
)
BRIDGE_IMPORT_RE = re.compile(
    r"(?:^// 手寫型別引用的 api-bridge 型別（內部使用，不重複 export）\n)?"
    r"^import type \{\n(?P<names>.*?)\n\} from './api-bridge'\n?",
    re.DOTALL | re.MULTILINE,
)
BRIDGE_NAME_RE = re.compile(r"^\s*([A-Za-z][A-Za-z0-9_]*)\s*,?\s*$", re.MULTILINE)
GENERATED_HEADER_RE = re.compile(
    r"/\*\*\n \* types\.ts — 型別薄層（部分自動生成）[\s\S]*?^// .*自動生成型別.*\n",
    re.MULTILINE,
)

existing_bridge_reexports: set[str] = set()
for reexport in BRIDGE_REEXPORT_RE.finditer(source):
    existing_bridge_reexports.update(BRIDGE_NAME_RE.findall(reexport.group("names")))

EXPORT_START_RE = re.compile(
    r"^export\s+(?:(?:default|declare)\s+)?(?:type|interface|enum|const|abstract class|class)\s+([A-Za-z][A-Za-z0-9_]*)"
)

def find_definition_end(lines: list[str], start: int) -> int:
    """Return the exclusive end line of a TypeScript definition."""
    i = start
    brace_depth = 0
    found_any_brace = False
    in_string = False
    string_char = None

    while i < len(lines):
        line = lines[i]

        j = 0
        while j < len(line):
            ch = line[j]

            if in_string:
                if ch == '\\':
                    j += 2
                    continue
                if ch == string_char:
                    in_string = False
                j += 1
                continue

            if ch in ('"', "'", '`'):
                in_string = True
                string_char = ch
                j += 1
                continue

            if ch == '{':
                brace_depth += 1
                found_any_brace = True
            elif ch == '}':
                brace_depth -= 1
            j += 1

        i += 1

        if found_any_brace:
            if brace_depth == 0:
                return i
            continue

        stripped = line.rstrip()
        if brace_depth == 0 and (
            stripped.endswith(';') or
            stripped.endswith('>;') or
            stripped.endswith('},')
        ):
            return i

    return i


exports: list[dict] = []
i = 0

while i < n:
    line = lines[i]
    m = EXPORT_START_RE.match(line)
    if m:
        name = m.group(1)
        end = find_definition_end(lines, i)
        exports.append({"name": name, "start": i, "end": end})
        i = end
    else:
        i += 1

print(f"解析到 {len(exports)} 個頂層匯出定義", file=sys.stderr)

covered_exports = [e for e in exports if e["name"] in COVERED]
missing_exports = [e for e in exports if e["name"] in MISSING]
unknown_exports = [e for e in exports if e["name"] not in COVERED and e["name"] not in MISSING]

print(f"  已覆蓋（保留）：{len(covered_exports)}", file=sys.stderr)
print(f"  保留手寫：      {len(missing_exports)}", file=sys.stderr)
print(f"  未分類（保留）：{len(unknown_exports)}", file=sys.stderr)

if unknown_exports:
    for e in unknown_exports:
        print(f"    ? {e['name']}", file=sys.stderr)

# Keep handwritten definitions: OpenAPI types can be broader.
remove_lines: set[int] = set()

HEADER_COMMENT = "/** Generated from api-bridge.ts. */\n"
HEADER = HEADER_COMMENT + "export type {\n"

bridge_reexport_names = existing_bridge_reexports
reexport_lines = ",\n".join(f"  {name}" for name in sorted(bridge_reexport_names))
reexport_block = HEADER + reexport_lines + "\n} from './api-bridge'\n"

kept_lines = [ln for idx, ln in enumerate(lines) if idx not in remove_lines]
kept_source = "".join(kept_lines)
kept_source = BRIDGE_REEXPORT_RE.sub("", kept_source)
kept_source = BRIDGE_IMPORT_RE.sub("", kept_source)
kept_source = GENERATED_HEADER_RE.sub("", kept_source)
kept_source = kept_source.replace(HEADER_COMMENT, "")

kept_source = re.sub(r"\n{4,}", "\n\n\n", kept_source)
kept_source = kept_source.strip("\n")

source_without_comments = re.sub(r"/\*[\s\S]*?\*/|//[^\n]*", "", kept_source)
used_bridge_in_kept = sorted(
    n for n in bridge_reexport_names
    if re.search(r'\b' + re.escape(n) + r'\b', source_without_comments)
)

if used_bridge_in_kept:
    import_stmt = (
        "import type {\n"
        + ",\n".join(f"  {n}" for n in used_bridge_in_kept)
        + ",\n} from './api-bridge'\n"
    )
else:
    import_stmt = ""

new_types_ts = reexport_block + "\n" + import_stmt + ("\n" if import_stmt else "") + kept_source + "\n"

TYPES_TS.write_text(new_types_ts, encoding="utf-8")
byte_count = TYPES_TS.stat().st_size
line_count = new_types_ts.count("\n")
print(f"\n寫入 {TYPES_TS}（{byte_count:,} bytes，~{line_count} 行）", file=sys.stderr)
print(f"  原本 {n} 行 → {line_count} 行（減少 {n - line_count} 行）", file=sys.stderr)
