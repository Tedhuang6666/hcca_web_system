import { NextRequest, NextResponse } from "next/server";

/**
 * 識別中文公文字號格式，例如：
 *   嶺代議字1150000001號   （無「第」、無空格）
 *   嶺代生字第1150000001號
 * 規則：至少含有一個中文字 + 「字」 + 「第」（可選）+ 數字 + 「號」
 */
const SERIAL_RE = /^[一-鿿]+字(?:第)?(\d+)號$/;

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // 只處理一層路徑（/xxx），不匹配 /documents/... 等現有路由
  if (pathname.split("/").length === 2) {
    const segment = decodeURIComponent(pathname.slice(1)); // 去掉前導 /
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
