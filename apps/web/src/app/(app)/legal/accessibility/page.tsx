import PolicyDocumentViewer from "@/components/legal/PolicyDocumentViewer";

export const metadata = {
  title: "無障礙聲明 · HCCA",
  description: "HCCA 校園自治整合平台無障礙聲明",
};

export default function AccessibilityPage() {
  return <PolicyDocumentViewer kind="accessibility" fallbackTitle="無障礙聲明" />;
}
