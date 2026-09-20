"use client";

import Image from "next/image";
import { ImagePlus, X } from "lucide-react";
import { toast } from "sonner";
import { surveysApi } from "@/lib/api";
import { uploadUrl } from "@/lib/config";
import AnimatedFileUpload from "@/components/ui/AnimatedFileUpload";

type OptionImageFieldsProps = {
  options: string[];
  value: string[][];
  onChange: (value: string[][]) => void;
};

function normaliseImageSets(options: string[], value: string[][]): string[][] {
  return options.map((_, index) => value[index]?.filter(Boolean) ?? []);
}

/** 編輯選項隨附圖稿；圖片陣列與選項索引保持一一對應。 */
export default function OptionImageFields({ options, value, onChange }: OptionImageFieldsProps) {
  if (options.length === 0) return null;

  const imageSets = normaliseImageSets(options, value);
  const updateImages = (index: number, images: string[]) => {
    onChange(imageSets.map((current, currentIndex) => currentIndex === index ? images : current));
  };
  const upload = (file: File, reportProgress: (progress: number) => void) => {
    if (!file.type.startsWith("image/")) throw new Error("請選擇圖片檔案");
    return surveysApi.uploadImage(file, reportProgress);
  };

  return (
    <section className="rounded-xl p-3 space-y-3" style={{ background: "var(--bg-elevated)" }}>
      <div>
        <h4 className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>選項圖片</h4>
        <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
          可為每個選項加入多張圖稿；填答者可點按查看完整圖片。調整選項順序後，請一併確認圖片對應。
        </p>
      </div>

      <div className="space-y-3">
        {options.map((option, index) => {
          const images = imageSets[index];
          return (
            <div key={`${index}-${option}`} className="rounded-lg p-3 space-y-2" style={{ background: "var(--bg-surface)" }}>
              <p className="text-sm font-medium break-words" style={{ color: "var(--text-primary)" }}>
                {option}
              </p>
              {images.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {images.map((image) => (
                    <div key={image} className="relative h-24 w-24 overflow-hidden rounded-lg" style={{ border: "1px solid var(--border)" }}>
                      <Image
                        src={uploadUrl(image)}
                        alt={`選項「${option}」的圖稿預覽`}
                        fill
                        unoptimized
                        sizes="96px"
                        className="object-cover"
                      />
                      <button
                        type="button"
                        onClick={() => updateImages(index, images.filter((candidate) => candidate !== image))}
                        className="absolute right-1 top-1 inline-flex h-11 w-11 items-center justify-center rounded-full"
                        style={{ background: "var(--danger)", color: "white" }}
                        aria-label={`移除「${option}」的圖片`}
                      >
                        <X size={16} aria-hidden="true" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <AnimatedFileUpload
                accept="image/*"
                multiple
                label={`為「${option}」加入圖片`}
                hint="支援拖曳、點擊選取或貼上；上傳後請儲存題目。"
                onUpload={upload}
                onUploaded={(result) => {
                  updateImages(index, [...images, result.url]);
                  toast.success(`已加入「${option}」的圖片`);
                }}
                className="survey-option-image-upload"
              />
            </div>
          );
        })}
      </div>
      <div className="flex items-center gap-1.5 text-xs" style={{ color: "var(--text-muted)" }}>
        <ImagePlus size={14} aria-hidden="true" />
        圖片會保留原始畫質供填答者放大檢視。
      </div>
    </section>
  );
}
