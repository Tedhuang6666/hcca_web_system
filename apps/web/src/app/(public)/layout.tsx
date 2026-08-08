import PublicEnhancements from "@/components/site/PublicEnhancements";
import { BRANDING } from "@/lib/branding";
import { absoluteUrl, JsonLd } from "@/lib/seo";
import { preload } from "react-dom";
import "../public-design-system.css";
import "./public-footer.css";

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  const organizationId = absoluteUrl("/#organization");
  preload("/brand/hcca-emblem-320.avif", {
    as: "image",
    type: "image/avif",
    fetchPriority: "high",
  });

  return (
    <>
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "Organization",
          "@id": organizationId,
          name: BRANDING.orgName,
          alternateName: [BRANDING.orgShortName, BRANDING.acronym],
          url: absoluteUrl("/"),
          logo: {
            "@type": "ImageObject",
            url: absoluteUrl(BRANDING.publicEmblemUrl),
          },
          description: BRANDING.description,
        }}
      />
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "WebSite",
          name: BRANDING.appName,
          url: absoluteUrl("/"),
          inLanguage: "zh-TW",
          publisher: { "@id": organizationId },
        }}
      />
      <PublicEnhancements />
      {children}
    </>
  );
}
