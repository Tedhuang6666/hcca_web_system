import PolicyDocumentViewer from "@/components/legal/PolicyDocumentViewer";

export const metadata = {
  title: "隱私政策 · 新竹高中班聯會數位整合系統",
  description: "新竹高中班聯會數位整合系統隱私政策",
};

export default function PrivacyPage() {
  return <PolicyDocumentViewer kind="privacy" fallbackTitle="隱私政策" />;
}
