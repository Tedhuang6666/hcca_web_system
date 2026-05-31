export type WritingSuggestion = {
  label: string;
  value: string;
  group: string;
};

const COMMON_PHRASES: WritingSuggestion[] = [
  { group: "公文常用語", label: "請查照", value: "請查照。" },
  { group: "公文常用語", label: "請鑒核", value: "請　鑒核。" },
  { group: "公文常用語", label: "請惠予協助", value: "請惠予協助辦理。" },
  { group: "公文常用語", label: "依據", value: "依據" },
  { group: "公文常用語", label: "說明如下", value: "說明如下：" },
  { group: "公文常用語", label: "辦法如下", value: "辦法如下：" },
  { group: "法規用語", label: "自公布日施行", value: "本法規自公布日施行。" },
  { group: "法規用語", label: "修正條文", value: "修正條文" },
  { group: "法規用語", label: "經班聯會通過", value: "經班聯會通過後公布施行。" },
  { group: "會議用語", label: "照案通過", value: "照案通過。" },
  { group: "會議用語", label: "修正後通過", value: "修正後通過。" },
  { group: "會議用語", label: "交付審查", value: "交付相關委員會審查。" },
];

const TRIGGER_PATTERNS: Array<{ test: RegExp; suggestions: WritingSuggestion[] }> = [
  {
    test: /依據|依照|字第|辦理$/,
    suggestions: [
      { group: "引用", label: "依據來文字號", value: "依據○○字第○○○○號函辦理。" },
      { group: "引用", label: "依照法規", value: "依照「○○辦法」第○條規定辦理。" },
    ],
  },
  {
    test: /公布|法規|條例|辦法$/,
    suggestions: [
      { group: "法規", label: "公布法規", value: "茲公布「○○辦法」，自公布日施行。" },
      { group: "法規", label: "修正發布", value: "茲修正發布「○○辦法」第○條條文。" },
    ],
  },
  {
    test: /會議|開會|議程$/,
    suggestions: [
      { group: "會議", label: "開會通知", value: "檢送本次會議議程，請準時出席。" },
      { group: "會議", label: "議事日程", value: "一、報告事項\n二、討論事項\n三、臨時動議" },
    ],
  },
];

export function currentToken(text: string, cursor = text.length) {
  const before = text.slice(0, cursor);
  const match = before.match(/([「\u4e00-\u9fffA-Za-z0-9第字號_-]{1,24})$/);
  return match?.[1] ?? "";
}

export function writingSuggestions(text: string, cursor = text.length): WritingSuggestion[] {
  const token = currentToken(text, cursor);
  const normalized = token.trim().toLowerCase();
  const matched = COMMON_PHRASES.filter(item =>
    item.label.toLowerCase().includes(normalized) || item.value.toLowerCase().includes(normalized),
  );
  const contextual = TRIGGER_PATTERNS
    .filter(item => item.test.test(token) || item.test.test(text.slice(Math.max(0, cursor - 16), cursor)))
    .flatMap(item => item.suggestions);
  return [...contextual, ...matched].slice(0, 8);
}

export function insertAtCursor(text: string, insert: string, start: number, end = start) {
  return `${text.slice(0, start)}${insert}${text.slice(end)}`;
}
