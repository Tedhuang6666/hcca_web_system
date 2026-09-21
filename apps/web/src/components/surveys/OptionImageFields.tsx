"use client";

import Image from "next/image";
import { Circle, Plus, Square, X } from "lucide-react";
import { uploadUrl } from "@/lib/config";
import { SurveyImageUploadButton } from "@/components/surveys/SurveyImageField";

type OptionImageFieldsProps = {
  options: string[];
  value: string[][];
  onChange: (value: string[][]) => void;
  onOptionsChange?: (options: string[]) => void;
  selectionStyle?: "single" | "multiple" | "ranking";
};

function normaliseImageSets(options: string[], value: string[][]): string[][] {
  return options.map((_, index) => value[index]?.filter(Boolean) ?? []);
}

/** 選項文字與其圖片維持在同一列，避免新增或修改時失去對應關係。 */
export default function OptionImageFields({
  options,
  value,
  onChange,
  onOptionsChange,
  selectionStyle = "single",
}: OptionImageFieldsProps) {
  if (options.length === 0 && !onOptionsChange) return null;

  const imageSets = normaliseImageSets(options, value);
  const isEditable = Boolean(onOptionsChange);
  const Marker = selectionStyle === "multiple" ? Square : Circle;
  const updateImages = (index: number, images: string[]) => {
    onChange(imageSets.map((current, currentIndex) => currentIndex === index ? images : current));
  };
  const updateOption = (index: number, option: string) => {
    onOptionsChange?.(options.map((current, currentIndex) => currentIndex === index ? option : current));
  };
  const removeOption = (index: number) => {
    onOptionsChange?.(options.filter((_, currentIndex) => currentIndex !== index));
    onChange(imageSets.filter((_, currentIndex) => currentIndex !== index));
  };

  return (
    <section aria-label="選項設定" className="space-y-2">
      <div>
        <h4 className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
          選項（至少 2 個）
        </h4>
        <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
          直接修改選項文字；需要圖稿時，在同一列按「加入圖片」。
        </p>
      </div>

      {options.length > 0 && (
        <div className="divide-y rounded-xl" style={{ border: "1px solid var(--border)" }}>
          {options.map((option, index) => {
            const images = imageSets[index];
            return (
              <div key={index} className="space-y-2 p-3" style={{ background: "var(--bg-surface)" }}>
                <div className="flex items-center gap-2">
                  <Marker size={17} aria-hidden="true" style={{ color: "var(--text-muted)" }} />
                  {isEditable ? (
                    <input
                      value={option}
                      onChange={(event) => updateOption(index, event.target.value)}
                      placeholder={`選項 ${index + 1}`}
                      autoFocus={option === "" && index === options.length - 1}
                      className="input min-w-0 flex-1 text-sm"
                      aria-label={`選項 ${index + 1}`}
                    />
                  ) : (
                    <p className="min-w-0 flex-1 break-words text-sm" style={{ color: "var(--text-primary)" }}>
                      {option}
                    </p>
                  )}
                  {isEditable && (
                    <button
                      type="button"
                      onClick={() => removeOption(index)}
                      className="topbar-icon-btn shrink-0"
                      style={{ color: "var(--danger)" }}
                      aria-label={`刪除選項 ${index + 1}`}
                    >
                      <X size={17} aria-hidden="true" />
                    </button>
                  )}
                </div>
                {images.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {images.map((image) => (
                      <div key={image} className="relative h-20 w-20 overflow-hidden rounded-lg" style={{ border: "1px solid var(--border)" }}>
                        <Image
                          src={uploadUrl(image)}
                          alt={`選項 ${index + 1} 的圖稿預覽`}
                          fill
                          unoptimized
                          sizes="80px"
                          className="object-cover"
                        />
                        <button
                          type="button"
                          onClick={() => updateImages(index, images.filter((candidate) => candidate !== image))}
                          className="absolute right-1 top-1 inline-flex h-11 w-11 items-center justify-center rounded-full"
                          style={{ background: "var(--danger)", color: "white" }}
                          aria-label={`移除選項 ${index + 1} 的圖片`}
                        >
                          <X size={16} aria-hidden="true" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <SurveyImageUploadButton
                  label={images.length > 0 ? "再加入圖片" : "加入圖片"}
                  onUploaded={(url) => updateImages(index, [...images, url])}
                />
              </div>
            );
          })}
        </div>
      )}
      {isEditable && (
        <button
          type="button"
          onClick={() => onOptionsChange?.([...options, ""])}
          className="btn btn-ghost inline-flex min-h-11 items-center gap-2 text-sm"
        >
          <Plus size={16} aria-hidden="true" />
          新增選項
        </button>
      )}
    </section>
  );
}
