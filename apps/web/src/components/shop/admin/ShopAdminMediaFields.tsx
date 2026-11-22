"use client";

import { shopApi } from "@/lib/api";
import ProductThumbnail from "@/components/shop/ProductThumbnail";
import AnimatedFileUpload from "@/components/ui/AnimatedFileUpload";

export function Thumb({ url, size = 44 }: { url: string | null; size?: number }) {
  return <ProductThumbnail url={url} size={size} />;
}

export function ImageField({ value, onChange, onUploadingChange, disabled = false }: {
  value: string | null;
  onChange: (u: string | null) => void;
  onUploadingChange?: (uploading: boolean) => void;
  disabled?: boolean;
}) {
  const upload = async (file: File, reportProgress: (progress: number) => void) => {
    onUploadingChange?.(true);
    try { return await shopApi.uploadImage(file, reportProgress); }
    finally { onUploadingChange?.(false); }
  };
  return (
    <div className="flex items-start gap-3">
      <Thumb url={value} size={48} />
      <div className="min-w-0 flex-1">
        <AnimatedFileUpload
          disabled={disabled}
          accept="image/*"
          label={value ? "拖曳新圖片到這裡" : "拖曳商品圖片到這裡"}
          hint="支援點擊選取或貼上圖片"
          onUpload={upload}
          onUploaded={(result) => onChange(result.url)}
        />
      </div>
      {value && (
        <button disabled={disabled} onClick={() => onChange(null)} className="text-xs" style={{ color: "var(--text-muted)" }}>
          移除
        </button>
      )}
    </div>
  );
}
