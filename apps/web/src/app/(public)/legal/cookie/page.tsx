import PolicyDocumentViewer from "@/components/legal/PolicyDocumentViewer";

export const metadata = {
  title: "Cookie 政策 · 新竹高中班聯會數位整合系統",
  description: "新竹高中班聯會數位整合系統 Cookie 政策",
};

export default function CookiePage() {
  return <PolicyDocumentViewer kind="cookie" fallbackTitle="Cookie 政策" />;
}
