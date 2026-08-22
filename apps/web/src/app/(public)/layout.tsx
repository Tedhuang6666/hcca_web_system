import PublicEnhancements from "@/components/site/PublicEnhancements";
import PublicModuleStatusProvider from "@/contexts/PublicModuleStatusContext";
import { BRANDING } from "@/lib/branding";
import { absoluteUrl, JsonLd } from "@/lib/seo";
import "../public-design-system.css";
import "./public-footer.css";

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  const organizationId = absoluteUrl("/#organization");

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
      <PublicModuleStatusProvider>{children}</PublicModuleStatusProvider>
    </>
  );
}
