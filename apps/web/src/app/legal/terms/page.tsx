import PolicyDocumentViewer from "@/components/legal/PolicyDocumentViewer";

export const metadata = {
  title: "服務條款 · HCCA",
  description: "HCCA 校園自治整合平台服務條款",
};

export default function TermsPage() {
  return <PolicyDocumentViewer kind="terms_of_service" fallbackTitle="服務條款" />;
}
