"use client";

import { Link2, QrCode } from "lucide-react";
import { useState } from "react";

import QrCodeGenerator from "./QrCodeGenerator";
import ShortLinksManager from "./ShortLinksManager";

type ToolTab = "short-links" | "qr-code";

export default function MarketingToolsWorkspace() {
  const [activeTab, setActiveTab] = useState<ToolTab>("short-links");
  const [qrContent, setQrContent] = useState("");

  const openQrCode = (url: string) => {
    setQrContent(url);
    setActiveTab("qr-code");
  };

  return (
    <div className="marketing-tools-workspace">
      <header className="marketing-tools-header">
        <div>
          <h1>經營工具</h1>
          <p>建立好分享的班聯網址，或將它製作成 QR Code。</p>
        </div>
        <div className="marketing-tools-tabs" role="group" aria-label="選擇經營工具">
          <button
            type="button"
            className={activeTab === "short-links" ? "is-active" : ""}
            aria-pressed={activeTab === "short-links"}
            onClick={() => setActiveTab("short-links")}
          >
            <Link2 size={17} aria-hidden="true" />
            短網址
          </button>
          <button
            type="button"
            className={activeTab === "qr-code" ? "is-active" : ""}
            aria-pressed={activeTab === "qr-code"}
            onClick={() => setActiveTab("qr-code")}
          >
            <QrCode size={17} aria-hidden="true" />
            QR Code
          </button>
        </div>
      </header>

      <div hidden={activeTab !== "short-links"}>
        <ShortLinksManager onGenerateQr={openQrCode} />
      </div>
      <div hidden={activeTab !== "qr-code"}>
        <QrCodeGenerator initialContent={qrContent} />
      </div>
    </div>
  );
}
