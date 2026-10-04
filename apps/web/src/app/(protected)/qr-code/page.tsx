import type { Metadata } from "next";

import MarketingToolsWorkspace from "./MarketingToolsWorkspace";
import "./qr-code.css";

export const metadata: Metadata = {
  title: "經營工具",
  description: "管理班聯短網址並製作 QR Code。",
};

export default function QrCodePage() {
  return <MarketingToolsWorkspace />;
}
