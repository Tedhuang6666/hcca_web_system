import { readFile } from "node:fs/promises";
import { join } from "node:path";

const OG_FONT_FILENAME = "LXGWWenKaiTC-Regular.ttf";
export const OG_FONT_FAMILY = "LXGW WenKai TC";

const fontPaths = [
  join(process.cwd(), "fonts", OG_FONT_FILENAME),
  join(process.cwd(), "..", "..", "fonts", OG_FONT_FILENAME),
  join(process.cwd(), "..", "..", "..", "fonts", OG_FONT_FILENAME),
  join(process.cwd(), "..", "..", "..", "..", "fonts", OG_FONT_FILENAME),
];

let fontData: Promise<Buffer> | undefined;

async function readOgFont(): Promise<Buffer> {
  for (const path of fontPaths) {
    try {
      return await readFile(path);
    } catch (error) {
      if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") {
        throw error;
      }
    }
  }

  throw new Error(`OG font not found: ${OG_FONT_FILENAME}`);
}

export async function ogFontOptions() {
  const data = await (fontData ??= readOgFont());
  return [{ data, name: OG_FONT_FAMILY, weight: 400 as const, style: "normal" as const }];
}
