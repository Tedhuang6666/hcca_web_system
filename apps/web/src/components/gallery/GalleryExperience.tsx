"use client";

import Link from "next/link";
import { useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { ArrowLeft, ArrowUpRight } from "lucide-react";
import { galleryDate, type GalleryPhoto, type PublicActivityAlbum } from "@/lib/public-activity-albums";
import ActivityImage from "./ActivityImage";
import GalleryViewer, { type GalleryItem } from "./GalleryViewer";
import InfinitePhotoWall from "./InfinitePhotoWall";
import PhotoCaption from "./PhotoCaption";
import { useGalleryMotion } from "./useGalleryMotion";
import "./gallery.css";

function albumItems(album: PublicActivityAlbum): GalleryItem[] {
  const photos = [...(album.keyVisual ? [album.keyVisual] : []), ...album.photos];
  const seen = new Set<string>();
  return photos.filter((photo) => {
    if (seen.has(photo.src)) return false;
    seen.add(photo.src);
    return true;
  }).map((photo) => ({
    ...photo, albumId: album.id, albumTitle: album.title, date: album.date,
    sourceUrl: album.sourceUrl,
    photographer: photo.photographer || (photo.id === album.keyVisual?.id ? undefined : album.photographer),
    isKeyVisual: photo.id === album.keyVisual?.id,
  }));
}

export default function GalleryExperience({ albums, detail = false, initialEvent = "", initialPhoto = "", unavailable = false, filters }: {
  albums: PublicActivityAlbum[];
  detail?: boolean;
  initialEvent?: string;
  initialPhoto?: string;
  unavailable?: boolean;
  /** 額外篩選控制，與活動選單放在同一列。 */
  filters?: ReactNode;
}) {
  const [selected, setSelected] = useState(albums.some((album) => album.id === initialEvent) ? initialEvent : "");
  const [failedSources, setFailedSources] = useState<string[]>([]);
  const [imageRatios, setImageRatios] = useState<Record<string, number>>({});
  const rootRef = useRef<HTMLDivElement>(null);
  const visibleAlbums = useMemo(() => albums.filter((album) => (!selected || album.id === selected)
    && (album.photos.length > 0 || album.keyVisual)), [albums, selected]);
  const items = useMemo(() => visibleAlbums.flatMap(albumItems), [visibleAlbums]);
  const [viewer, setViewer] = useState<{ index: number; origin: HTMLElement | null } | null>(() => {
    const index = items.findIndex((photo) => photo.id === initialPhoto);
    return index >= 0 ? { index, origin: null } : null;
  });
  const album = visibleAlbums[0];
  const openingCandidates = album ? [
    ...(album.keyVisual ? [album.keyVisual] : []),
    ...album.photos.filter((photo) => photo.featured),
    ...album.photos.filter((photo) => !photo.featured),
  ] : [];
  const openingPhoto = openingCandidates.find((photo) => !failedSources.includes(photo.src));
  const orbitPhotos = album?.photos.filter((photo) => photo.src !== openingPhoto?.src
    && !failedSources.includes(photo.src)).slice(0, 2) ?? [];
  useGalleryMotion(rootRef, selected);

  const selectEvent = (id: string) => {
    setSelected(id);
    setViewer(null);
    const url = new URL(window.location.href);
    if (id) url.searchParams.set("event", id); else url.searchParams.delete("event");
    url.searchParams.delete("photo");
    window.history.replaceState(null, "", url);
  };
  const openItem = (photo: GalleryItem, origin: HTMLElement) => {
    const index = items.findIndex((item) => item.id === photo.id && item.albumId === photo.albumId);
    if (index >= 0) setViewer({ index, origin });
  };
  const photoButton = (sourceAlbum: PublicActivityAlbum, photo: GalleryPhoto, eager = false) => {
    const item = items.find((entry) => entry.albumId === sourceAlbum.id && entry.src === photo.src);
    if (!item) return null;
    return <button type="button" className="archive-photo"
      aria-label={"放大：" + sourceAlbum.title + "・" + (photo.caption || photo.alt || "活動照片")}
      data-gallery-photo={item.id} data-gallery-album={sourceAlbum.id}
      onClick={(event) => openItem(item, event.currentTarget)}>
      <span className="archive-photo-media">
        <ActivityImage key={photo.src} photos={[{ ...photo, alt: photo.alt || sourceAlbum.title }]}
          sizes={eager ? "(max-width: 767px) 80vw, 60vw" : "(max-width: 767px) 35vw, 25vw"}
          preload={eager}
          onDimensions={eager ? (width, height) => setImageRatios((current) => current[photo.src] === width / height ? current : { ...current, [photo.src]: width / height }) : undefined}
          onUnavailable={(src) => setFailedSources((current) => current.includes(src) ? current : [...current, src])} />
      </span>
      <PhotoCaption item={item} />
    </button>;
  };
  const openingButton = (photo: GalleryPhoto, eager = false) => album ? photoButton(album, photo, eager) : null;

  return <div ref={rootRef} className={"gallery-experience" + (detail ? " is-detail" : "")}>
    <header className="archive-topline">
      <div className="archive-heading">
        {detail && <Link href="/gallery" className="archive-back"><ArrowLeft size={20} aria-hidden />全部活動</Link>}
        {(!detail || !album) && <h1>影像紀事</h1>}
      </div>
      {!unavailable && items.length > 0 && <div className="archive-controls">
        {!detail && <label className="archive-event-select"><span className="sr-only">選擇活動</span>
          <select value={selected} onChange={(event) => selectEvent(event.target.value)}>
            <option value="">全部活動</option>
            {albums.map((entry) => <option key={entry.id} value={entry.id}>{entry.title}</option>)}
          </select>
        </label>}
        {filters}
        <span>{items.length} 張照片</span>
      </div>}
    </header>
    {!unavailable && album && <header className="archive-masthead">
      <div className="archive-opening-scene" style={{ "--opening-ratio": openingPhoto ? imageRatios[openingPhoto.src] ?? openingPhoto.width / openingPhoto.height : 1 } as CSSProperties}>
        <div className={"archive-opening-photo" + (openingPhoto?.id === album.keyVisual?.id ? " is-key-visual" : "")}>
          {openingPhoto ? openingButton(openingPhoto, true)
            : <p className="archive-image-error" role="status">照片暫時無法顯示，請稍後重試。</p>}
        </div>
        {orbitPhotos.map((photo, index) => <div key={photo.id} className={"archive-orbit-photo orbit-" + index}>
          {openingButton(photo)}
        </div>)}
      </div>
      <div className="archive-event-heading">
        <div className="archive-title">
          {detail ? <h1>{album.title}</h1> : <h2>{album.title}</h2>}
          {album.summary && <p>{album.summary}</p>}
        </div>
        <div className="archive-event-details">
          {album.date && <time dateTime={album.date}>{galleryDate(album.date)}</time>}
          {album.photographer && <span>攝影／{album.photographer}</span>}
          {!detail && <Link href={"/gallery/" + album.id}>完整活動紀錄<ArrowUpRight size={17} aria-hidden /></Link>}
        </div>
      </div>
    </header>}
    {unavailable && <div className="archive-empty" role="alert"><p>無法載入活動影像</p><button type="button" className="archive-more" onClick={() => window.location.reload()}>重新載入</button></div>}
    {!unavailable && items.length === 0 && <p className="archive-empty">活動紀錄整理中。</p>}
    {!unavailable && <div className="archive-stories">{visibleAlbums.map((entry, albumIndex) => {
      const candidates = items.filter((item) => item.albumId === entry.id && !item.isKeyVisual);
      const featured = candidates.filter((photo) => photo.featured);
      const photos = (featured.length ? featured : candidates)
        .filter((photo) => entry.id !== album?.id || photo.id !== openingPhoto?.id).slice(0, 12);
      if (!photos.length) return null;
      return <article id={entry.id} key={entry.id} className={"archive-story layout-" + entry.layout}
        aria-label={entry.title + "精選照片"}>
        {albumIndex !== 0 && <header className="archive-story-heading">
          <div><h2>{entry.title}</h2><div className="archive-story-meta">
            {entry.date && <time dateTime={entry.date}>{galleryDate(entry.date)}</time>}
            {entry.photographer && <span>攝影／{entry.photographer}</span>}
          </div></div>
          <Link className="archive-text-link" href={"/gallery/" + entry.id}>完整活動紀錄<ArrowUpRight size={18} aria-hidden /></Link>
        </header>}
        <div className="archive-spread">{photos.map((photo, index) => <figure key={photo.id} className={"archive-spread-item position-" + index}>
          {photoButton(entry, photo)}
        </figure>)}</div>
      </article>;
    })}</div>}
    {!unavailable && items.length > 0 && <InfinitePhotoWall key={selected} items={items} paused={viewer !== null} onOpen={openItem} />}
    <footer className="archive-endnote">
      {detail && album?.sourceUrl && <a href={album.sourceUrl} target="_blank" rel="noopener noreferrer">原始活動相簿<ArrowUpRight size={16} aria-hidden /><span className="sr-only">（另開分頁）</span></a>}
      <Link href="/contact">照片下架與聯絡</Link>
    </footer>
    {viewer && items[viewer.index] && <GalleryViewer items={items} initialIndex={viewer.index} origin={viewer.origin} onClose={() => setViewer(null)} />}
  </div>;
}
