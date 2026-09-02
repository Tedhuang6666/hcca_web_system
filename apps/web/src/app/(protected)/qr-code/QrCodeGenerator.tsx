"use client";

import QRCode from "qrcode";
import NextImage from "next/image";
import {
  Check,
  ChevronDown,
  CircleHelp,
  Link2,
  LockKeyhole,
  Palette,
  QrCode,
  RefreshCcw,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Type,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import AnimatedDownloadButton from "@/components/ui/AnimatedDownloadButton";
import AnimatedFileUpload from "@/components/ui/AnimatedFileUpload";

import { usePermissions } from "@/hooks/usePermissions";
import { BRANDING } from "@/lib/branding";

type ModuleStyle = "dot" | "soft" | "square";
type ErrorCorrection = "L" | "M" | "Q" | "H";

type QrSettings = {
  foreground: string;
  background: string;
  moduleStyle: ModuleStyle;
  errorCorrection: ErrorCorrection;
  size: number;
  margin: number;
  showBadge: boolean;
  badgeText: string;
  logoDataUrl: string;
};

type QrMatrix = {
  modules: {
    size: number;
    data: Uint8Array;
  };
  version: number;
};

const PERMISSION = "qr_code:manage";
const DEFAULT_CONTENT = "https://hcca.example.org/entry";
const TRANSPARENT_BACKGROUND = "transparent";
const DEFAULT_LOGO_PATH = BRANDING.publicEmblemUrl;
const DEFAULT_SETTINGS: QrSettings = {
  foreground: "#24163f",
  background: "#fffdf9",
  moduleStyle: "dot",
  errorCorrection: "H",
  size: 640,
  margin: 4,
  showBadge: false,
  badgeText: "HCCA",
  logoDataUrl: DEFAULT_LOGO_PATH,
};

const MODULE_STYLES: Array<{ key: ModuleStyle; label: string; detail: string }> = [
  { key: "dot", label: "圓點", detail: "接近海報風格" },
  { key: "soft", label: "圓角", detail: "柔和但穩定" },
  { key: "square", label: "方塊", detail: "最高辨識度" },
];

const ERROR_LEVELS: Array<{ key: ErrorCorrection; label: string; detail: string }> = [
  { key: "L", label: "L", detail: "約 7%" },
  { key: "M", label: "M", detail: "約 15%" },
  { key: "Q", label: "Q", detail: "約 25%" },
  { key: "H", label: "H", detail: "約 30%" },
];

function escapeXml(value: string) {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&apos;",
    };
    return entities[character];
  });
}

function validHex(value: string, fallback: string) {
  return /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
}

function validBackground(value: string, fallback: string) {
  return value === TRANSPARENT_BACKGROUND ? value : validHex(value, fallback);
}

function isFinderModule(x: number, y: number, size: number) {
  return (
    (x < 7 && y < 7)
    || (x >= size - 7 && y < 7)
    || (x < 7 && y >= size - 7)
  );
}

function finderPattern(x: number, y: number, foreground: string, background: string) {
  return [
    `<rect x="${x}" y="${y}" width="7" height="7" rx="1.85" fill="${foreground}"/>`,
    `<rect x="${x + 1}" y="${y + 1}" width="5" height="5" rx="1.35" fill="${background}"/>`,
    `<rect x="${x + 2}" y="${y + 2}" width="3" height="3" rx="0.9" fill="${foreground}"/>`,
  ].join("");
}

function buildQrSvg(matrix: QrMatrix, settings: QrSettings, includeRole = false) {
  const foreground = validHex(settings.foreground, DEFAULT_SETTINGS.foreground);
  const background = validBackground(settings.background, DEFAULT_SETTINGS.background);
  const backgroundPaint = background === TRANSPARENT_BACKGROUND ? "none" : background;
  const centerBackdrop = background === TRANSPARENT_BACKGROUND ? "#ffffff" : background;
  const moduleCount = matrix.modules.size;
  const margin = Math.max(2, Math.round(settings.margin));
  const total = moduleCount + margin * 2;
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${settings.size}" height="${settings.size}" viewBox="0 0 ${total} ${total}"${includeRole ? ' role="img" aria-label="QR Code 預覽"' : ""}>`,
  ];
  if (background !== TRANSPARENT_BACKGROUND) {
    parts.push(`<rect width="${total}" height="${total}" fill="${background}"/>`);
  }

  for (let y = 0; y < moduleCount; y += 1) {
    for (let x = 0; x < moduleCount; x += 1) {
      if (!matrix.modules.data[y * moduleCount + x] || isFinderModule(x, y, moduleCount)) continue;
      const px = margin + x;
      const py = margin + y;
      if (settings.moduleStyle === "square") {
        parts.push(`<rect x="${px}" y="${py}" width="1" height="1" fill="${foreground}"/>`);
      } else if (settings.moduleStyle === "soft") {
        parts.push(`<rect x="${px + 0.06}" y="${py + 0.06}" width="0.88" height="0.88" rx="0.24" fill="${foreground}"/>`);
      } else {
        parts.push(`<circle cx="${px + 0.5}" cy="${py + 0.5}" r="0.43" fill="${foreground}"/>`);
      }
    }
  }

  parts.push(finderPattern(margin, margin, foreground, backgroundPaint));
  parts.push(finderPattern(margin + moduleCount - 7, margin, foreground, backgroundPaint));
  parts.push(finderPattern(margin, margin + moduleCount - 7, foreground, backgroundPaint));

  if (settings.showBadge) {
    const badgeText = escapeXml(settings.badgeText.trim().slice(0, 8) || "HCCA");
    const badgeSize = Math.min(7.2, Math.max(5.2, moduleCount * 0.18));
    const badgeX = margin + (moduleCount - badgeSize) / 2;
    const badgeY = margin + (moduleCount - badgeSize) / 2;
    const fontSize = Math.max(1.35, Math.min(2.05, badgeSize * 0.28));
    parts.push(`<rect x="${badgeX - 0.35}" y="${badgeY - 0.35}" width="${badgeSize + 0.7}" height="${badgeSize + 0.7}" rx="1.25" fill="${centerBackdrop}" stroke="${foreground}" stroke-opacity="0.12" stroke-width="0.16"/>`);
    parts.push(`<circle cx="${margin + moduleCount / 2}" cy="${badgeY + badgeSize * 0.31}" r="0.68" fill="${foreground}"/>`);
    parts.push(`<path d="M ${margin + moduleCount / 2 - 0.28} ${badgeY + badgeSize * 0.31} l 0.28 -0.42 0.28 0.42 -0.28 0.42 z" fill="${centerBackdrop}"/>`);
    parts.push(`<text x="${margin + moduleCount / 2}" y="${badgeY + badgeSize * 0.74}" text-anchor="middle" fill="${foreground}" font-family="ui-sans-serif,system-ui,sans-serif" font-size="${fontSize}" font-weight="700" letter-spacing="0.05">${badgeText}</text>`);
  }

  if (settings.logoDataUrl) {
    const logoSize = Math.min(9, Math.max(6.5, moduleCount * 0.22));
    const logoX = margin + (moduleCount - logoSize) / 2;
    const logoY = margin + (moduleCount - logoSize) / 2;
    parts.push(`<rect x="${logoX - 0.65}" y="${logoY - 0.65}" width="${logoSize + 1.3}" height="${logoSize + 1.3}" rx="1.4" fill="${centerBackdrop}"/>`);
    parts.push(`<image href="${escapeXml(settings.logoDataUrl)}" x="${logoX}" y="${logoY}" width="${logoSize}" height="${logoSize}" preserveAspectRatio="xMidYMid meet"/>`);
  }

  parts.push("</svg>");
  return parts.join("");
}

function AccessDenied() {
  return (
    <main className="qr-tool-page">
      <section className="qr-access-denied" aria-labelledby="qr-access-title">
        <span className="qr-access-icon" aria-hidden="true"><LockKeyhole size={23} /></span>
        <p className="qr-kicker">後台工具</p>
        <h1 id="qr-access-title">沒有 QR Code 工具權限</h1>
        <p>
          這個產生器只開放給被指派 <code>qr_code:manage</code> 的職位。請洽系統管理員加入對應權限組。
        </p>
      </section>
    </main>
  );
}

export default function QrCodeGenerator() {
  const { can } = usePermissions();
  const [hydrated, setHydrated] = useState(false);
  const [content, setContent] = useState(DEFAULT_CONTENT);
  const [settings, setSettings] = useState<QrSettings>(DEFAULT_SETTINGS);
  const [defaultLogoDataUrl, setDefaultLogoDataUrl] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => setHydrated(true), []);
  useEffect(() => {
    let active = true;

    const loadDefaultLogo = async () => {
      try {
        const response = await fetch(DEFAULT_LOGO_PATH);
        if (!response.ok) return;
        const blob = await response.blob();
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
          reader.onerror = () => reject(new Error("預設會徽讀取失敗"));
          reader.readAsDataURL(blob);
        });
        if (!active || !dataUrl) return;
        setDefaultLogoDataUrl(dataUrl);
        setSettings((previous) => previous.logoDataUrl === DEFAULT_LOGO_PATH
          ? { ...previous, logoDataUrl: dataUrl }
          : previous);
      } catch {
        // 保留靜態路徑作為預覽 fallback。
      }
    };

    void loadDefaultLogo();
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    if (!notice) return undefined;
    const timer = window.setTimeout(() => setNotice(""), 2400);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const preview = useMemo(() => {
    const value = content.trim();
    if (!value) return null;
    try {
      const matrix = QRCode.create(value, {
        errorCorrectionLevel: settings.errorCorrection,
      }) as unknown as QrMatrix;
      const svg = buildQrSvg(matrix, settings, true);
      return {
        dataUrl: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
        svg,
        version: matrix.version,
        moduleCount: matrix.modules.size,
      };
    } catch {
      return { error: "內容太長，請縮短文字或改用網址。" };
    }
  }, [content, settings]);

  const updateSetting = <K extends keyof QrSettings>(key: K, value: QrSettings[K]) => {
    setSettings((previous) => ({ ...previous, [key]: value }));
  };

  const handleLogoFiles = async (files: File[]) => {
    const file = files[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setNotice("請選擇圖片格式的會徽");
      return;
    }
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
        reader.onerror = () => reject(new Error("會徽讀取失敗"));
        reader.readAsDataURL(file);
      });
      updateSetting("logoDataUrl", dataUrl);
      setNotice("會徽已加入中央");
    } catch {
      setNotice("會徽讀取失敗，請重新選擇");
    }
  };

  const createPngBlob = async (): Promise<Blob> => {
    if (!preview || "error" in preview) throw new Error("目前沒有可下載的 QR Code");
    return new Promise((resolve, reject) => {
      const image = new window.Image();
      image.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = settings.size;
        canvas.height = settings.size;
        const context = canvas.getContext("2d");
        if (!context) {
          reject(new Error("瀏覽器不支援圖片匯出"));
          return;
        }
        const background = validBackground(settings.background, DEFAULT_SETTINGS.background);
        if (background !== TRANSPARENT_BACKGROUND) {
          context.fillStyle = background;
          context.fillRect(0, 0, canvas.width, canvas.height);
        }
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("PNG 匯出失敗")), "image/png");
      };
      image.onerror = () => reject(new Error("PNG 匯出失敗，請再試一次"));
      image.src = preview.dataUrl;
    });
  };

  const createSvgBlob = async (): Promise<Blob> => {
    if (!preview || "error" in preview) throw new Error("目前沒有可下載的 QR Code");
    return new Blob([preview.svg], { type: "image/svg+xml;charset=utf-8" });
  };

  const copyContent = async () => {
    if (!content.trim()) return;
    try {
      await navigator.clipboard.writeText(content.trim());
      setNotice("內容已複製");
    } catch {
      setNotice("瀏覽器未允許複製，請手動選取內容");
    }
  };

  const reset = () => {
    setContent(DEFAULT_CONTENT);
    setSettings({ ...DEFAULT_SETTINGS, logoDataUrl: defaultLogoDataUrl || DEFAULT_LOGO_PATH });
    setNotice("已恢復預設樣式");
  };

  if (!hydrated) {
    return <main className="qr-tool-page" aria-busy="true"><div className="qr-tool-loading">讀取權限中…</div></main>;
  }
  if (!can(PERMISSION)) return <AccessDenied />;

  const hasPreview = Boolean(preview && !("error" in preview));
  const previewError = preview && "error" in preview ? preview.error : "";
  const isDefaultLogo = settings.logoDataUrl === DEFAULT_LOGO_PATH
    || (defaultLogoDataUrl !== "" && settings.logoDataUrl === defaultLogoDataUrl);

  return (
    <main className="qr-tool-page">
      <div className="qr-tool-shell">
        <header className="qr-tool-header">
          <div>
            <div className="qr-tool-title-row">
              <span className="qr-tool-title-icon" aria-hidden="true"><QrCode size={22} /></span>
              <p className="qr-kicker">後台工具</p>
            </div>
            <h1>做一張值得被分享的 QR Code</h1>
            <p className="qr-tool-lede">把網址或文字調整成適合公告、海報與現場投影的版本，所有設定會即時反映在右側預覽。</p>
          </div>
          <div className="qr-privacy-note"><ShieldCheck size={17} aria-hidden="true" /><span>內容只在本機產生，不會上傳</span></div>
        </header>

        <div className="qr-tool-layout">
          <section className="qr-preview-panel" aria-labelledby="qr-preview-title">
            <div className="qr-panel-heading">
              <div>
                <p className="qr-section-label">即時預覽</p>
                <h2 id="qr-preview-title">掃描看看成品</h2>
              </div>
              {preview && !("error" in preview) && (
                <span className="qr-status-chip"><Check size={14} aria-hidden="true" />可掃描</span>
              )}
            </div>

            <div className={`qr-preview-stage ${settings.background === TRANSPARENT_BACKGROUND ? "is-transparent" : ""}`}>
              {hasPreview && preview && !("error" in preview) ? (
                <NextImage className="qr-preview-image" src={preview.dataUrl} alt="依照目前設定產生的 QR Code 預覽" width={640} height={640} unoptimized />
              ) : (
                <div className="qr-preview-empty" role="status">
                  <QrCode size={48} strokeWidth={1.5} aria-hidden="true" />
                  <strong>{previewError || "輸入內容後開始預覽"}</strong>
                  <span>網址、文字都可以</span>
                </div>
              )}
            </div>

            <div className="qr-preview-meta">
              <span>{preview && !("error" in preview) ? `版本 ${preview.version} · ${preview.moduleCount} × ${preview.moduleCount} 格` : "等待內容"}</span>
              <span>{settings.errorCorrection} 容錯 · {settings.size} px</span>
            </div>

            <div className="qr-preview-actions">
              <AnimatedDownloadButton
                className="qr-button qr-button-primary"
                request={createPngBlob}
                filename="hcca-qr-code.png"
                label="下載 PNG"
                disabled={!hasPreview}
                onComplete={() => setNotice("PNG 已下載")}
                onError={(error) => setNotice(error instanceof Error ? error.message : "PNG 匯出失敗")} />
              <AnimatedDownloadButton
                className="qr-button qr-button-secondary"
                request={createSvgBlob}
                filename="hcca-qr-code.svg"
                label="下載 SVG"
                disabled={!hasPreview}
                onComplete={() => setNotice("SVG 已下載")}
                onError={(error) => setNotice(error instanceof Error ? error.message : "SVG 匯出失敗")} />
            </div>
            <p className="qr-export-note"><CircleHelp size={14} aria-hidden="true" />PNG 適合直接發佈，SVG 適合海報排版與印刷放大。</p>
          </section>

          <section className="qr-settings-panel" aria-labelledby="qr-settings-title">
            <div className="qr-panel-heading">
              <div>
                <p className="qr-section-label">設定</p>
                <h2 id="qr-settings-title">調整你的 QR Code</h2>
              </div>
              <button type="button" className="qr-icon-button" onClick={reset} aria-label="恢復預設設定" title="恢復預設設定">
                <RefreshCcw size={17} aria-hidden="true" />
              </button>
            </div>

            <div className="qr-setting-section">
              <label className="qr-field-label" htmlFor="qr-content"><span><Link2 size={15} aria-hidden="true" />內容</span><small>網址或文字</small></label>
              <textarea
                id="qr-content"
                className="qr-textarea"
                value={content}
                onChange={(event) => setContent(event.target.value)}
                placeholder="貼上網址，或輸入想分享的文字…"
                rows={4}
              />
              <button type="button" className="qr-copy-link" onClick={copyContent} disabled={!content.trim()}>
                {notice === "內容已複製" ? <Check size={14} aria-hidden="true" /> : <Link2 size={14} aria-hidden="true" />} {notice === "內容已複製" ? "已複製內容" : "複製內容"}
              </button>
            </div>

            <div className="qr-setting-section">
              <div className="qr-field-label"><span><Sparkles size={15} aria-hidden="true" />中央會徽</span><small>只在本機處理，不會上傳</small></div>
              <AnimatedFileUpload
                accept="image/png,image/jpeg,image/webp,image/svg+xml"
                maxFiles={1}
                label={settings.logoDataUrl ? "替換中央會徽" : "拖曳會徽到這裡"}
                hint="支援 PNG、JPG、WebP、SVG；會自動置中"
                onFiles={handleLogoFiles}
                onRemove={() => updateSetting("logoDataUrl", "")}
              />
              <p className="qr-logo-note"><Check size={14} aria-hidden="true" />{isDefaultLogo ? "預設已套用班聯會徽，可上傳圖片替換。" : "目前使用自訂會徽，可隨時移除或替換。"}</p>
              {settings.logoDataUrl && <button type="button" className="qr-remove-logo" onClick={() => updateSetting("logoDataUrl", "")}>移除中央會徽</button>}
            </div>

            <div className="qr-setting-section">
              <div className="qr-field-label"><span><Sparkles size={15} aria-hidden="true" />模組風格</span><small>資料點形狀</small></div>
              <div className="qr-option-grid qr-option-grid-three">
                {MODULE_STYLES.map((style) => (
                  <button
                    key={style.key}
                    type="button"
                    className={`qr-option-button ${settings.moduleStyle === style.key ? "is-selected" : ""}`}
                    aria-pressed={settings.moduleStyle === style.key}
                    onClick={() => updateSetting("moduleStyle", style.key)}
                  >
                    <span className={`qr-style-swatch qr-style-swatch-${style.key}`} aria-hidden="true"><i /><i /><i /><i /></span>
                    <strong>{style.label}</strong>
                    <small>{style.detail}</small>
                  </button>
                ))}
              </div>
            </div>

            <div className="qr-setting-section">
              <div className="qr-field-label"><span><Palette size={15} aria-hidden="true" />色彩</span><small>保持深淺對比</small></div>
              <div className="qr-color-grid">
                <label className="qr-color-control"><span>前景</span><div><input type="color" value={validHex(settings.foreground, DEFAULT_SETTINGS.foreground)} onChange={(event) => updateSetting("foreground", event.target.value)} /><input className="qr-color-text" value={settings.foreground} onChange={(event) => updateSetting("foreground", event.target.value)} aria-label="前景色 HEX 色碼" /></div></label>
                <label className="qr-color-control"><span>背景</span><div><input type="color" value={validHex(settings.background, DEFAULT_SETTINGS.background)} onChange={(event) => updateSetting("background", event.target.value)} /><input className="qr-color-text" value={settings.background === TRANSPARENT_BACKGROUND ? "" : settings.background} placeholder={settings.background === TRANSPARENT_BACKGROUND ? "透明背景" : "#fffdf9"} onChange={(event) => updateSetting("background", event.target.value)} aria-label="背景色 HEX 色碼" /><button type="button" className={`qr-transparent-button ${settings.background === TRANSPARENT_BACKGROUND ? "is-selected" : ""}`} aria-pressed={settings.background === TRANSPARENT_BACKGROUND} onClick={() => updateSetting("background", TRANSPARENT_BACKGROUND)} title="PNG 與 SVG 不輸出背景色">透明</button></div></label>
              </div>
            </div>

            <div className="qr-setting-section qr-setting-split">
              <label className="qr-range-control" htmlFor="qr-size"><span><SlidersHorizontal size={15} aria-hidden="true" />輸出尺寸 <b>{settings.size} px</b></span><input id="qr-size" type="range" min="256" max="1024" step="32" value={settings.size} onChange={(event) => updateSetting("size", Number(event.target.value))} /></label>
              <label className="qr-range-control" htmlFor="qr-margin"><span><ChevronDown size={15} aria-hidden="true" />外圍留白 <b>{settings.margin} 格</b></span><input id="qr-margin" type="range" min="2" max="8" step="1" value={settings.margin} onChange={(event) => updateSetting("margin", Number(event.target.value))} /></label>
            </div>

            <div className="qr-setting-section">
              <div className="qr-field-label"><span><ShieldCheck size={15} aria-hidden="true" />容錯等級</span><small>中央標記建議使用 H</small></div>
              <div className="qr-level-row">
                {ERROR_LEVELS.map((level) => (
                  <button key={level.key} type="button" className={`qr-level-button ${settings.errorCorrection === level.key ? "is-selected" : ""}`} aria-pressed={settings.errorCorrection === level.key} onClick={() => updateSetting("errorCorrection", level.key)}><strong>{level.label}</strong><small>{level.detail}</small></button>
                ))}
              </div>
            </div>

            <div className="qr-setting-section qr-badge-section">
              <label className="qr-toggle-row"><span className="qr-toggle-copy"><span className="qr-toggle-icon"><Type size={15} aria-hidden="true" /></span><span><strong>中央標記</strong><small>在 QR Code 中放入識別文字</small></span></span><input type="checkbox" checked={settings.showBadge} onChange={(event) => updateSetting("showBadge", event.target.checked)} /></label>
              {settings.showBadge && <input className="qr-badge-input" value={settings.badgeText} maxLength={8} onChange={(event) => updateSetting("badgeText", event.target.value)} aria-label="中央標記文字" placeholder="HCCA" />}
              {settings.showBadge && settings.errorCorrection !== "H" && <p className="qr-warning"><CircleHelp size={14} aria-hidden="true" />中央標記會遮住少量資料，建議切換至 H 容錯。</p>}
            </div>

            <p className="qr-settings-footnote"><ShieldCheck size={14} aria-hidden="true" />調整後會立即更新預覽；沒有任何內容會離開你的瀏覽器。</p>
          </section>
        </div>

        <div className="qr-tool-toast" aria-live="polite" aria-atomic="true">{notice && notice !== "內容已複製" ? notice : ""}</div>
      </div>
    </main>
  );
}
