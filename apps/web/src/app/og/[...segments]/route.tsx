import { BRANDING } from "@/lib/branding";
import { contentCategoryLabel, DOCUMENT_CATEGORY_LABELS, REGULATION_CATEGORY_LABELS } from "@/lib/content-labels";
import {
  renderContentOgImage,
} from "@/lib/content-og-image";
import { fetchPublicDocument, fetchPublicPetition, fetchPublicRegulation } from "@/lib/publicSeoFetch";
import { fetchAnnouncement } from "@/lib/serverFetch";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type OgRouteProps = {
  params: Promise<{ segments: string[] }>;
};

export async function GET(_request: Request, { params }: OgRouteProps) {
  const { segments } = await params;
  const [kind, ...rest] = segments;
  const id = rest.at(-1) ?? "";

  if (kind === "news" || kind === "announcements") {
    const item = await fetchAnnouncement(id);
    return renderContentOgImage({
      title: item?.title ?? "公告",
      category: item?.is_urgent ? "重要公告" : "公告",
      date: item?.published_at ?? item?.created_at,
    });
  }

  if (kind === "regulations") {
    const item = await fetchPublicRegulation(id);
    return renderContentOgImage({
      title: item?.title ?? "法規查詢",
      category: contentCategoryLabel(item?.category, REGULATION_CATEGORY_LABELS, "法規"),
      date: item?.effective_date ?? item?.published_at ?? item?.updated_at,
    });
  }

  if (kind === "documents") {
    const item = await fetchPublicDocument(id);
    return renderContentOgImage({
      title: item?.title ?? "公開公文",
      category: contentCategoryLabel(item?.category, DOCUMENT_CATEGORY_LABELS, "公文"),
      date: item?.issued_at ?? item?.updated_at ?? item?.created_at,
    });
  }

  if (kind === "petitions" && rest[0] === "public") {
    const item = await fetchPublicPetition(id);
    return renderContentOgImage({
      title: item?.title ?? "公開陳情",
      category: item?.type_name || "陳情",
      date: item?.published_at,
    });
  }

  if (kind === "surveys") {
    return renderContentOgImage({
      title: id ? `公開問卷｜${decodeURIComponent(id)}` : "公開問卷",
      category: "問卷",
    });
  }

  if (kind === "live" && rest[0] === "elections") {
    return renderContentOgImage({
      title: "即時選舉開票",
      category: id ? `選舉 ${decodeURIComponent(id)}` : "選舉",
    });
  }

  if (kind === "partner-map") {
    const businessName = id ? decodeURIComponent(id).replace(/[-_]+/g, " ").trim() : "";
    return renderContentOgImage({
      title: businessName ? `${businessName}｜合作商家` : "合作商家地圖",
      category: "校園服務",
    });
  }

  return renderContentOgImage({
    title: "公開資訊",
    category: BRANDING.orgShortName,
  });
}
