import PolicyDocumentViewer from "@/components/legal/PolicyDocumentViewer";

export const metadata = {
  title: "隱私政策 · HCCA",
  description: "HCCA 校園自治整合平台隱私政策",
};

export default function PrivacyPage() {
  return <PolicyDocumentViewer kind="privacy" fallbackTitle="隱私政策" />;
}
