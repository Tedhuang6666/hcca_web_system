#!/usr/bin/env python3
"""
scripts/rewrite-types-ts.py
把 types.ts 重寫為「從 api-bridge 再匯出 + 保留手寫定義」的薄層。

執行前提：
  node scripts/generate-bridge.mjs > /tmp/bridge_coverage.json
  python3 scripts/rewrite-types-ts.py
"""

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

# ── 解析 types.ts，找出每個頂層匯出定義的行範圍 ────────────────────────────────

source = TYPES_TS.read_text(encoding="utf-8")
lines = source.splitlines(keepends=True)
n = len(lines)

EXPORT_START_RE = re.compile(
    r"^export\s+(?:(?:default|declare)\s+)?(?:type|interface|enum|const|abstract class|class)\s+([A-Za-z][A-Za-z0-9_]*)"
)

def find_definition_end(lines: list[str], start: int) -> int:
    """
    從 start 行開始，找出型別定義結束的行號（exclusive）。
    策略：
    1. 累積文字，追蹤 {} 深度（處理字串內的括號是難題，用簡化法）
    2. 如果定義完全在一行（如 `export type X = "a" | "b";`）直接返回
    3. 否則讀到 {} 深度回 0 且行尾有 `;` 或 `}` 為止
    """
    i = start
    brace_depth = 0
    angle_depth = 0  # 追蹤泛型 < >
    found_any_brace = False
    in_string = False
    string_char = None

    while i < len(lines):
        line = lines[i]

        # 字元逐一掃描
        j = 0
        while j < len(line):
            ch = line[j]

            # 字串狀態
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

        # 如果是 interface/enum/class（大括號型定義），等深度歸零
        if found_any_brace:
            if brace_depth == 0:
                return i
            continue

        # 沒有大括號的 type alias — 等 `;` 出現在行尾（忽略泛型內的分號）
        stripped = line.rstrip()
        # 只有在深度為 0 時才算「結束」
        # 簡單策略：行末為 `;` 或 `>;` 或 `};`（多行 Pick/Partial 最後一行）
        if brace_depth == 0 and (
            stripped.endswith(';') or
            stripped.endswith('>;') or
            stripped.endswith('>;') or
            stripped.endswith('},')
        ):
            return i

    return i  # 檔案結尾


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

# ── 分類 ──────────────────────────────────────────────────────────────────────

covered_exports = [e for e in exports if e["name"] in COVERED]
missing_exports = [e for e in exports if e["name"] in MISSING]
unknown_exports = [e for e in exports if e["name"] not in COVERED and e["name"] not in MISSING]

print(f"  已覆蓋（移除）：{len(covered_exports)}", file=sys.stderr)
print(f"  保留手寫：      {len(missing_exports)}", file=sys.stderr)
print(f"  未分類（保留）：{len(unknown_exports)}", file=sys.stderr)

if unknown_exports:
    for e in unknown_exports:
        print(f"    ? {e['name']}", file=sys.stderr)

# ── 建立「要移除的行號集合」 ───────────────────────────────────────────────────

remove_lines: set[int] = set()
for e in covered_exports:
    remove_lines.update(range(e["start"], e["end"]))

# ── 建立新 types.ts ───────────────────────────────────────────────────────────

HEADER = """\
/**
 * types.ts — 型別薄層（部分自動生成）
 *
 * 本檔案的主要型別從 api-bridge.ts 再匯出（api-bridge.ts 由 openapi-typescript 自動生成）。
 * 只有無法對應到 OpenAPI schema 的前端特有型別才在此手寫。
 *
 * 更新型別：
 *   ./scripts/update-openapi.sh              # 從 FastAPI 匯出最新 openapi.json
 *   cd apps/web && npm run generate:types     # 重建 api-types.ts
 *   node ../../scripts/generate-bridge.mjs > /tmp/bridge_coverage.json
 *   python3 ../../scripts/rewrite-types-ts.py # 重建本檔
 */

// ── 自動生成型別（從 OpenAPI schema 衍生，do not edit）─────────────────────────
export type {
"""

sorted_covered_names = sorted(COVERED)
reexport_lines = ",\n".join(f"  {name}" for name in sorted_covered_names)
reexport_block = HEADER + reexport_lines + "\n} from './api-bridge'\n"

# 保留非 covered 的行
kept_lines = [ln for idx, ln in enumerate(lines) if idx not in remove_lines]
kept_source = "".join(kept_lines)

# 清掉連續超過兩個空行
kept_source = re.sub(r"\n{4,}", "\n\n\n", kept_source)
kept_source = kept_source.strip("\n")

# ── 找出 kept_source 中引用到 COVERED 型別的名稱（需要 import） ────────────────
# 只需要抓手寫定義中用到的 COVERED 名稱，避免重複宣告
used_covered_in_kept = sorted(
    n for n in COVERED
    if re.search(r'\b' + re.escape(n) + r'\b', kept_source)
)

if used_covered_in_kept:
    import_stmt = (
        "// 手寫型別引用的 api-bridge 型別（內部使用，不重複 export）\n"
        "import type {\n"
        + ",\n".join(f"  {n}" for n in used_covered_in_kept)
        + ",\n} from './api-bridge'\n"
    )
else:
    import_stmt = ""

new_types_ts = reexport_block + "\n" + import_stmt + ("\n" if import_stmt else "") + kept_source + "\n"

# 先備份，萬一有問題
backup = TYPES_TS.with_suffix(".ts.bak")
backup.write_text(source, encoding="utf-8")
print(f"備份原檔 → {backup}", file=sys.stderr)

TYPES_TS.write_text(new_types_ts, encoding="utf-8")
byte_count = TYPES_TS.stat().st_size
line_count = new_types_ts.count("\n")
print(f"\n寫入 {TYPES_TS}（{byte_count:,} bytes，~{line_count} 行）", file=sys.stderr)
print(f"  原本 {n} 行 → {line_count} 行（減少 {n - line_count} 行）", file=sys.stderr)
