import PolicyDocumentViewer from "@/components/legal/PolicyDocumentViewer";

export const metadata = {
  title: "Cookie 政策 · HCCA",
  description: "HCCA 校園自治整合平台 Cookie 政策",
};

export default function CookiePage() {
  return <PolicyDocumentViewer kind="cookie" fallbackTitle="Cookie 政策" />;
}
