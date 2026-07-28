import Image from "next/image";
import { ExternalLink, FileText } from "lucide-react";

export interface PublicFileEmbedItem {
  title: string;
  url: string;
  description?: string;
  mimeType?: string;
}

function isImageFile(file: PublicFileEmbedItem) {
  return file.mimeType?.startsWith("image/") || /\.(?:png|jpe?g|gif|webp|svg)(?:[?#]|$)/i.test(file.url);
}

function isEmbeddableFile(file: PublicFileEmbedItem) {
  return (
    file.mimeType === "application/pdf" ||
    file.mimeType === "text/html" ||
    /\.(?:pdf|html?)(?:[?#]|$)/i.test(file.url)
  );
}

export default function PublicFileEmbed({ file }: { file: PublicFileEmbedItem }) {
  const image = isImageFile(file);
  const embeddable = isEmbeddableFile(file);

  return (
    <article className="overflow-hidden rounded-xl border border-[var(--public-border)] bg-[var(--public-surface)]">
      <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-start sm:justify-between sm:p-5">
        <div className="flex min-w-0 gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-[var(--public-accent-soft)] text-[var(--public-accent)]">
            <FileText size={19} aria-hidden />
          </span>
          <div className="min-w-0">
            <h3 className="font-semibold">{file.title}</h3>
            {file.description && (
              <p className="mt-1 text-sm leading-6 text-[var(--public-secondary)]">{file.description}</p>
            )}
          </div>
        </div>
        <a
          href={file.url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-lg border border-[var(--public-border)] px-3 text-sm font-semibold text-[var(--public-accent)] transition-colors hover:border-[var(--public-accent)] hover:bg-[var(--public-soft)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--public-focus)]"
        >
          開啟檔案
          <ExternalLink size={15} aria-hidden />
        </a>
      </div>

      {image && (
        <div className="border-t border-[var(--public-border)] bg-[var(--public-soft)] p-3 sm:p-4">
          <Image
            src={file.url}
            alt={file.title}
            width={1600}
            height={1000}
            unoptimized
            className="mx-auto max-h-[560px] w-full rounded-lg object-contain"
          />
        </div>
      )}

      {embeddable && !image && (
        <div className="border-t border-[var(--public-border)] bg-[var(--public-soft)] p-2 sm:p-3">
          <iframe
            src={file.url}
            title={`${file.title}預覽`}
            loading="lazy"
            className="h-[min(65vh,620px)] w-full rounded-lg bg-white"
          />
        </div>
      )}
    </article>
  );
}
