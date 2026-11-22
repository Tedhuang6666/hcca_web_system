import { BRANDING } from "@/lib/branding";
import { absoluteUrl } from "@/lib/seo";

export function organizationJsonLd() {
  return {
    "@type": "Organization",
    "@id": absoluteUrl("/#organization"),
    name: BRANDING.orgShortName,
    alternateName: BRANDING.acronym,
    url: absoluteUrl("/"),
    logo: absoluteUrl(BRANDING.publicEmblemUrl),
  };
}

export function breadcrumbJsonLd(items: Array<{ name: string; url: string }>) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: item.url,
    })),
  };
}
