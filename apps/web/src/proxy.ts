import { NextRequest, NextResponse } from "next/server";

/**
 * 識別中文公文字號格式，例如：
 *   嶺代議字1150000001號   （無「第」、無空格）
 *   嶺代生字第1150000001號
 * 規則：至少含有一個中文字 + 「字」 + 「第」（可選）+ 數字 + 「號」
 */
const SERIAL_RE = /^[一-鿿]+字(?:第)?(\d+)號$/;

function decodePathPart(value: string) {
  let current = value;
  for (let index = 0; index < 2; index += 1) {
    try {
      const decoded = decodeURIComponent(current);
      if (decoded === current) break;
      current = decoded;
    } catch {
      break;
    }
  }
  return current;
}

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const parts = pathname.split("/").filter(Boolean);
  const decodedParts = parts.map(decodePathPart);

  if (decodedParts[0] === "regulations" && decodedParts.length >= 3 && decodedParts[2].startsWith("第")) {
    const url = req.nextUrl.clone();
    url.pathname = `/regulations/${decodedParts[1]}`;
    decodedParts.slice(2).forEach((part, index) => {
      url.searchParams.set(`ref${index}`, part);
    });
    url.searchParams.set("article_ref", decodedParts[2]);
    if (decodedParts[3]) url.searchParams.set("unit_ref", decodedParts[3]);
    return NextResponse.rewrite(url);
  }

  // 只處理一層路徑（/xxx），不匹配 /documents/... 等現有路由
  if (pathname.split("/").length === 2) {
    const segment = decodePathPart(pathname.slice(1)); // 去掉前導 /
    if (SERIAL_RE.test(segment)) {
      const url = req.nextUrl.clone();
      url.pathname = `/documents/${encodeURIComponent(segment)}`;
      return NextResponse.redirect(url);
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    // 排除靜態資源、_next 內部路由、API routes
    "/((?!_next/static|_next/image|favicon.ico|api/).*)",
  ],
};
