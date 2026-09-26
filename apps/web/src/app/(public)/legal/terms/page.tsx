import PolicyDocumentViewer from "@/components/legal/PolicyDocumentViewer";

export const metadata = {
  title: "服務條款 · HCCA",
  description: "HCCA 竹嶺班聯數位整合系統服務條款",
};

export default function TermsPage() {
  return <PolicyDocumentViewer kind="terms" fallbackTitle="服務條款" />;
}
