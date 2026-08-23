"use client";

import {
  CheckCircle2,
  ClipboardPaste,
  File as FileIcon,
  RotateCcw,
  UploadCloud,
  X,
} from "lucide-react";
import Image from "next/image";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties, ChangeEvent, ClipboardEvent } from "react";
import styles from "./InteractionMotion.module.css";

export type UploadProgressReporter = (progress: number) => void;
export type AnimatedUploadStatus = "queued" | "uploading" | "success" | "error";

export type AnimatedUploadHandler<TResult = unknown> = (
  file: File,
  reportProgress: UploadProgressReporter,
) => Promise<TResult>;

export interface AnimatedFileUploadProps<TResult = unknown> {
  accept?: string;
  multiple?: boolean;
  maxFiles?: number;
  disabled?: boolean;
  label?: string;
  hint?: string;
  className?: string;
  onUpload?: AnimatedUploadHandler<TResult>;
  onUploaded?: (result: TResult, file: File) => void | Promise<void>;
  onFiles?: (files: File[]) => void | Promise<void>;
  onRemove?: (file: File) => void;
}

type UploadItem = {
  id: string;
  file: File;
  preview?: string;
  progress: number;
  status: AnimatedUploadStatus;
  error?: string;
  dropPoint?: { x: number; y: number };
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isImage(file: File): boolean {
  return file.type.startsWith("image/");
}

function acceptsFile(file: File, accept?: string): boolean {
  if (!accept?.trim()) return true;
  return accept.split(",").some((token) => {
    const value = token.trim().toLowerCase();
    if (!value) return false;
    if (value.startsWith(".")) return file.name.toLowerCase().endsWith(value);
    if (value.endsWith("/*")) return file.type.startsWith(value.slice(0, -1));
    return file.type.toLowerCase() === value;
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : "上傳失敗，請重試";
}

function makeId(file: File): string {
  const suffix = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);
  return `${file.name}-${file.size}-${file.lastModified}-${suffix}`;
}

function UploadFileRow({
  item,
  onRetry,
  onRemove,
}: {
  item: UploadItem;
  onRetry: () => void;
  onRemove: () => void;
}) {
  const rowRef = useRef<HTMLLIElement>(null);
  const [dropStyle, setDropStyle] = useState<CSSProperties>({});

  useLayoutEffect(() => {
    if (!item.dropPoint || !rowRef.current) return;
    const rect = rowRef.current.getBoundingClientRect();
    setDropStyle({
      "--upload-drop-x": `${item.dropPoint.x - rect.left}px`,
      "--upload-drop-y": `${item.dropPoint.y - rect.top}px`,
    } as CSSProperties);
  }, [item.dropPoint]);

  const statusLabel = item.status === "uploading"
    ? `${Math.round(item.progress * 100)}%`
    : item.status === "success"
      ? "已上傳"
      : item.status === "error"
        ? "失敗"
        : "已加入清單";

  return (
    <li ref={rowRef} className={`${styles.uploadRow} animated-upload__row is-${item.status}`} style={dropStyle}>
      <div className="animated-upload__thumb" aria-hidden="true">
        {item.preview ? (
          <>
            <Image src={item.preview} alt="" fill sizes="2.7rem" unoptimized className="animated-upload__image animated-upload__image--ghost" />
            <Image
              src={item.preview}
              alt=""
              fill
              sizes="2.7rem"
              unoptimized
              className="animated-upload__image animated-upload__image--live"
              style={{ "--upload-progress": item.progress } as CSSProperties}
            />
          </>
        ) : (
          <FileIcon size={18} strokeWidth={1.8} />
        )}
        {item.status === "success" && <CheckCircle2 className="animated-upload__thumb-check" size={16} />}
      </div>

      <div className="animated-upload__details">
        <div className="animated-upload__name" title={item.file.name}>{item.file.name}</div>
        <div className="animated-upload__meta">
          <span>{formatBytes(item.file.size)}</span>
          <span aria-hidden="true">·</span>
          <span>{statusLabel}</span>
          {item.status === "error" && <span className="animated-upload__error">{item.error}</span>}
        </div>
        {(item.status === "uploading" || item.status === "success") && (
          <div className="animated-upload__progress" role="progressbar" aria-valuenow={Math.round(item.progress * 100)} aria-valuemin={0} aria-valuemax={100}>
            <span style={{ transform: `scaleX(${item.progress})` }} />
          </div>
        )}
      </div>

      <div className="animated-upload__actions">
        {item.status === "error" && (
          <button type="button" className="animated-upload__action" onClick={onRetry} aria-label={`重試上傳 ${item.file.name}`}>
            <RotateCcw size={15} aria-hidden="true" />
          </button>
        )}
        <button type="button" className="animated-upload__action" onClick={onRemove} aria-label={`移除 ${item.file.name}`}>
          <X size={15} aria-hidden="true" />
        </button>
      </div>
    </li>
  );
}

export function AnimatedFileUpload<TResult = unknown>({
  accept,
  multiple = false,
  maxFiles,
  disabled = false,
  label = "拖曳檔案到這裡",
  hint = "也可以點擊選擇，或直接貼上圖片",
  className = "",
  onUpload,
  onUploaded,
  onFiles,
  onRemove,
}: AnimatedFileUploadProps<TResult>) {
  const inputRef = useRef<HTMLInputElement>(null);
  const previewsRef = useRef<string[]>([]);
  const [items, setItems] = useState<UploadItem[]>([]);
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => () => {
    previewsRef.current.forEach((preview) => URL.revokeObjectURL(preview));
  }, []);

  const runUpload = useCallback(async (item: UploadItem) => {
    if (!onUpload) return;
    setItems((current) => current.map((candidate) => candidate.id === item.id
      ? { ...candidate, status: "uploading", progress: 0, error: undefined }
      : candidate));
    try {
      const result = await onUpload(item.file, (progress) => {
        const next = Math.max(0, Math.min(1, progress));
        setItems((current) => current.map((candidate) => candidate.id === item.id
          ? { ...candidate, status: "uploading", progress: next }
          : candidate));
      });
      setItems((current) => current.map((candidate) => candidate.id === item.id
        ? { ...candidate, status: "success", progress: 1 }
        : candidate));
      await onUploaded?.(result, item.file);
    } catch (error) {
      setItems((current) => current.map((candidate) => candidate.id === item.id
        ? { ...candidate, status: "error", error: errorMessage(error) }
        : candidate));
    }
  }, [onUpload, onUploaded]);

  const addFiles = useCallback((fileList: FileList | File[], dropPoint?: { x: number; y: number }) => {
    if (disabled) return;
    const accepted = Array.from(fileList)
      .filter((file) => acceptsFile(file, accept))
      .slice(0, multiple ? maxFiles : 1);
    if (!accepted.length) return;
    const nextItems = accepted.map<UploadItem>((file) => {
      const preview = isImage(file) ? URL.createObjectURL(file) : undefined;
      if (preview) previewsRef.current.push(preview);
      return {
        id: makeId(file),
        file,
        preview,
        progress: 0,
        status: onUpload ? "queued" : "queued",
        dropPoint,
      };
    });
    setItems((current) => [...current, ...nextItems]);
    if (onUpload) {
      nextItems.forEach((item) => void runUpload(item));
    } else {
      void onFiles?.(accepted);
    }
  }, [accept, disabled, maxFiles, multiple, onFiles, onUpload, runUpload]);

  const handleInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    if (event.target.files) addFiles(event.target.files);
    event.target.value = "";
  };

  const handlePaste = (event: ClipboardEvent<HTMLDivElement>) => {
    const files = Array.from(event.clipboardData.files).filter((file) => isImage(file));
    if (!files.length) return;
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    addFiles(files, { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
  };

  const removeItem = (item: UploadItem) => {
    setItems((current) => current.filter((candidate) => candidate.id !== item.id));
    onRemove?.(item.file);
  };

  return (
    <div className={`${styles.uploadRoot} animated-upload ${className}`}>
      <div
        className={`${styles.uploadZone} animated-upload__zone${isDragging ? " is-dragging" : ""}${disabled ? " is-disabled" : ""}`}
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-disabled={disabled}
        onClick={() => { if (!disabled) inputRef.current?.click(); }}
        onKeyDown={(event) => {
          if ((event.key === "Enter" || event.key === " ") && !disabled) {
            event.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDragEnter={(event) => { event.preventDefault(); if (!disabled) setIsDragging(true); }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={(event) => {
          if (event.currentTarget === event.target) setIsDragging(false);
        }}
        onDrop={(event) => {
          event.preventDefault();
          setIsDragging(false);
          addFiles(event.dataTransfer.files, { x: event.clientX, y: event.clientY });
        }}
        onPaste={handlePaste}
      >
        <input ref={inputRef} className="sr-only" type="file" accept={accept} multiple={multiple} disabled={disabled} onChange={handleInputChange} />
        <span className="animated-upload__icon"><UploadCloud size={21} strokeWidth={1.8} /></span>
        <span className="animated-upload__copy">
          <strong>{label}</strong>
          <span>{hint}</span>
        </span>
        <span className="animated-upload__choose">選擇檔案</span>
        <ClipboardPaste className="animated-upload__paste" size={16} aria-hidden="true" />
      </div>

      {items.length > 0 && (
        <>
          <p className={styles.uploadReceipt} role="status">已加入 {items.length} 個附件</p>
          <ul className={`${styles.uploadList} animated-upload__list`} aria-live="polite">
            {items.map((item) => (
              <UploadFileRow
                key={item.id}
                item={item}
                onRetry={() => void runUpload(item)}
                onRemove={() => removeItem(item)}
              />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

export default AnimatedFileUpload;
