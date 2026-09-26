import PolicyDocumentViewer from "@/components/legal/PolicyDocumentViewer";

export const metadata = {
  title: "無障礙聲明 · 新竹高中班聯會數位整合系統",
  description: "新竹高中班聯會數位整合系統無障礙聲明",
};

export default function AccessibilityPage() {
  return <PolicyDocumentViewer kind="accessibility" fallbackTitle="無障礙聲明" />;
}
