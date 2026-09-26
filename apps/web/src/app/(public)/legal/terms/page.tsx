import PolicyDocumentViewer from "@/components/legal/PolicyDocumentViewer";

export const metadata = {
  title: "服務條款 · 新竹高中班聯會數位整合系統",
  description: "新竹高中班聯會數位整合系統服務條款",
};

export default function TermsPage() {
  return <PolicyDocumentViewer kind="terms" fallbackTitle="服務條款" />;
}
