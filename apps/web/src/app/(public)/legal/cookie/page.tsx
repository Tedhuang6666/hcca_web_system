import PolicyDocumentViewer from "@/components/legal/PolicyDocumentViewer";

export const metadata = {
  title: "Cookie 政策 · HCCA",
  description: "HCCA 竹嶺班聯數位整合系統 Cookie 政策",
};

export default function CookiePage() {
  return <PolicyDocumentViewer kind="cookie" fallbackTitle="Cookie 政策" />;
}
