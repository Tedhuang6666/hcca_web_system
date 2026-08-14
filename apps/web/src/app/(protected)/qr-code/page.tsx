import type { Metadata } from "next";

import QrCodeGenerator from "./QrCodeGenerator";
import "./qr-code.css";

export const metadata: Metadata = {
  title: "QR Code 產生器",
  description: "建立可調整樣式的校園自治 QR Code。",
};

export default function QrCodePage() {
  return <QrCodeGenerator />;
}
