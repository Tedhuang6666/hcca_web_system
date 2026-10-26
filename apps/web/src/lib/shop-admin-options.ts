import type { ProductVariantGroupOut } from "@/lib/types";

export type SmartOptionDraft = {
  value: string;
  price_delta: number;
  image_url: string | null;
};

export type SmartSourceGroup = ProductVariantGroupOut & {
  source_label: string;
};

export function parseSmartOptionsText(text: string): SmartOptionDraft[] {
  return text
    .split(/\r?\n|,/)
    .map((raw) => raw.trim())
    .filter(Boolean)
    .map((raw) => {
      const match = raw.match(/^(.+?)(?:\s*[:：]\s*|\s+)([+-]?\d+)$/);
      if (!match) return { value: raw, price_delta: 0, image_url: null };
      return {
        value: match[1].trim(),
        price_delta: Number(match[2]) || 0,
        image_url: null,
      };
    })
    .filter((option) => option.value);
}

export function uniqueSmartOptions(options: SmartOptionDraft[]) {
  const seen = new Set<string>();
  return options.filter((option) => {
    const key = option.value.trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
