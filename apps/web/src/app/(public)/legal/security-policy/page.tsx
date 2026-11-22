import PolicyDocumentViewer from "@/components/legal/PolicyDocumentViewer";

export const metadata = {
  title: "安全揭露政策 · 新竹高中班聯會數位整合系統",
  description: "新竹高中班聯會數位整合系統安全漏洞回報與負責任揭露指引",
};

export default function SecurityPolicyPage() {
  return <PolicyDocumentViewer kind="security" fallbackTitle="安全揭露政策" />;
}
