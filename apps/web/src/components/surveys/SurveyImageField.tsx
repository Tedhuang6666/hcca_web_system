"use client";

import Image from "next/image";
import { ImagePlus, Loader2, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import type { ChangeEvent } from "react";
import { toast } from "sonner";
import { surveysApi } from "@/lib/api";
import { uploadUrl } from "@/lib/config";

type SurveyImageUploadButtonProps = {
  label: string;
  onUploaded: (url: string) => void;
};

export function SurveyImageUploadButton({ label, onUploaded }: SurveyImageUploadButtonProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<number | null>(null);

  const handleChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("請選擇圖片檔案");
      return;
    }

    setProgress(0);
    try {
      const result = await surveysApi.uploadImage(file, setProgress);
      onUploaded(result.url);
      toast.success("圖片已上傳");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "圖片上傳失敗，請重試");
    } finally {
      setProgress(null);
    }
  };

  const uploading = progress !== null;
  return (
    <>
      <input
        ref={inputRef}
        className="sr-only"
        type="file"
        accept="image/*"
        onChange={handleChange}
      />
      <button
        type="button"
        disabled={uploading}
        onClick={() => inputRef.current?.click()}
        className="btn btn-ghost inline-flex min-h-11 items-center gap-2 text-sm"
        aria-busy={uploading}
      >
        {uploading ? (
          <Loader2 size={16} className="animate-spin" aria-hidden="true" />
        ) : (
          <ImagePlus size={16} aria-hidden="true" />
        )}
        {uploading ? `上傳中 ${Math.round((progress ?? 0) * 100)}%` : label}
      </button>
    </>
  );
}

type SurveyImageFieldProps = {
  label: string;
  value: string;
  onChange: (url: string) => void;
  hint?: string;
};

/** 題目圖片的上傳、預覽與替換操作維持在同一處。 */
export default function SurveyImageField({ label, value, onChange, hint }: SurveyImageFieldProps) {
  return (
    <section className="space-y-2" aria-label={label}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h4 className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>{label}</h4>
          {hint && <p className="mt-0.5 text-xs" style={{ color: "var(--text-muted)" }}>{hint}</p>}
        </div>
        <SurveyImageUploadButton label={value ? "更換圖片" : "上傳圖片"} onUploaded={onChange} />
      </div>

      {value && (
        <div className="space-y-2">
          <div
            className="relative aspect-video max-w-xl overflow-hidden rounded-xl"
            style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}
          >
            <Image
              src={uploadUrl(value)}
              alt={`${label}預覽`}
              fill
              unoptimized
              sizes="(max-width: 640px) 100vw, 576px"
              className="object-contain"
            />
          </div>
          <button
            type="button"
            onClick={() => onChange("")}
            className="btn btn-ghost inline-flex min-h-11 items-center gap-2 text-sm"
            style={{ color: "var(--danger)" }}
          >
            <Trash2 size={16} aria-hidden="true" />
            移除圖片
          </button>
        </div>
      )}
    </section>
  );
}
