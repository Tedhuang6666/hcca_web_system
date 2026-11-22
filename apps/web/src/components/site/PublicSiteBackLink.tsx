"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { usePathname } from "next/navigation";

const PUBLIC_BACK_LABELS: Record<string, string> = {
  "/public": "返回公開資料庫",
  "/public/elections": "返回即時開票",
  "/public/budgets": "返回財務總覽",
  "/news": "返回最新公告",
  "/articles": "返回文章專欄",
  "/petitions/public": "返回公開陳情",
};

/** 這些清單的單篇頁只有一層，返回清單本身。 */
const DETAIL_PARENTS = ["/news", "/articles", "/petitions/public"];

function getPublicBack(pathname: string): { href: string; label: string } | null {
  let parent: string | null = null;
  const detailParent = DETAIL_PARENTS.find((prefix) => new RegExp(`^${prefix}/[^/]+$`).test(pathname));
  if (detailParent) {
    parent = detailParent;
  } else if (pathname.startsWith("/public/")) {
    parent = "/" + pathname.split("/").filter(Boolean).slice(0, -1).join("/");
  }
  if (!parent) return null;
  return { href: parent, label: PUBLIC_BACK_LABELS[parent] ?? "返回上一頁" };
}

export default function PublicSiteBackLink() {
  const pathname = usePathname();
  const back = getPublicBack(pathname);
  if (!back) return null;

  return (
    <div className="mx-auto max-w-6xl px-4 pt-5 sm:px-6">
      <Link href={back.href} className="public-back-link">
        <ArrowLeft size={16} aria-hidden />
        {back.label}
      </Link>
    </div>
  );
}
