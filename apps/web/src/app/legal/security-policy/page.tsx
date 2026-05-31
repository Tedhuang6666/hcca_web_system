import PolicyDocumentViewer from "@/components/legal/PolicyDocumentViewer";

export const metadata = {
  title: "安全揭露政策 · HCCA",
  description: "HCCA 安全漏洞回報與負責任揭露指引",
};

export default function SecurityPolicyPage() {
  return <PolicyDocumentViewer kind="security" fallbackTitle="安全揭露政策" />;
}
