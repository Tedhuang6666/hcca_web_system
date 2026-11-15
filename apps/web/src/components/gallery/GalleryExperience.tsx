"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { ArrowDown, ArrowUpRight } from "lucide-react";
import ActivityImage from "./ActivityImage";
import { galleryDate, type GalleryPhoto, type PublicActivityAlbum } from "@/lib/public-activity-albums";
import GalleryViewer, { type GalleryItem } from "./GalleryViewer";
import InfinitePhotoWall from "./InfinitePhotoWall";
import { useGalleryMotion } from "./useGalleryMotion";
import "./gallery.css";

function albumItems(album: PublicActivityAlbum): GalleryItem[] {
  return [...(album.keyVisual ? [album.keyVisual] : []), ...album.photos].map((photo) => ({
    ...photo, albumId: album.id, albumTitle: album.title, date: album.date,
    sourceUrl: album.sourceUrl, photographer: photo.photographer || (photo.id === album.keyVisual?.id ? undefined : album.photographer),
    isKeyVisual: photo.id === album.keyVisual?.id,
  }));
}

export default function GalleryExperience({ albums, detail = false, initialEvent = "", initialPhoto = "", unavailable = false }: {
  albums: PublicActivityAlbum[];
  detail?: boolean;
  initialEvent?: string;
  initialPhoto?: string;
  unavailable?: boolean;
}) {
  const [selected, setSelected] = useState(albums.some((album) => album.id === initialEvent) ? initialEvent : "");
  const [failedSources, setFailedSources] = useState<string[]>([]);
  const [pageSize, setPageSize] = useState(36);
  const rootRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const visibleAlbums = useMemo(() => albums.filter((album) => (!selected || album.id === selected)
    && (album.photos.length > 0 || album.keyVisual)), [albums, selected]);
  const items = useMemo(() => visibleAlbums.flatMap(albumItems), [visibleAlbums]);
  const [viewer, setViewer] = useState<{ index: number; origin: HTMLElement | null } | null>(() => {
    const index = items.findIndex((photo) => photo.id === initialPhoto);
    return index >= 0 ? { index, origin: null } : null;
  });
  const heroAlbum = visibleAlbums[0];
  const heroCandidates = heroAlbum ? [
    ...heroAlbum.photos.filter((photo) => photo.featured),
    ...heroAlbum.photos.filter((photo) => !photo.featured),
    ...(heroAlbum.keyVisual ? [heroAlbum.keyVisual] : []),
  ] : [];
  const heroPhoto = heroCandidates.find((photo) => !failedSources.includes(photo.src));
  const orbitPhotos = heroCandidates.filter((photo) => photo.src !== heroPhoto?.src && !failedSources.includes(photo.src)).slice(0, 2);
  useGalleryMotion(rootRef, selected);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || pageSize >= items.length || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) setPageSize((size) => Math.min(size + 36, items.length));
    }, { rootMargin: "600px" });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [items.length, pageSize]);

  const selectEvent = (id: string) => {
    setSelected(id); setViewer(null); setPageSize(36);
    const url = new URL(window.location.href);
    if (id) url.searchParams.set("event", id); else url.searchParams.delete("event");
    url.searchParams.delete("photo");
    window.history.replaceState(null, "", url);
  };
  const openItem = (photo: GalleryItem, origin: HTMLElement) => {
    const index = items.findIndex((item) => item.id === photo.id && item.albumId === photo.albumId);
    if (index >= 0) setViewer({ index, origin });
  };
  const openPhoto = (album: PublicActivityAlbum, photo: GalleryPhoto, origin: HTMLElement) => {
    const item = items.find((item) => item.id === photo.id && item.albumId === album.id);
    if (item) openItem(item, origin);
  };
  const photoButton = (album: PublicActivityAlbum, photo: GalleryPhoto, eager = false, compact = false) => (
    <button type="button" className="archive-photo"
      aria-label={"放大：" + album.title + "・" + (photo.caption || "活動照片 " + (album.photos.findIndex((item) => item.id === photo.id) + 1))}
      data-gallery-photo={photo.id} data-gallery-album={album.id}
      onClick={(event) => openPhoto(album, photo, event.currentTarget)}>
      <span className="archive-photo-media" style={{ aspectRatio: photo.width / photo.height } as CSSProperties}>
        <ActivityImage key={photo.src} photos={[{ ...photo, alt: photo.alt || album.title + "活動照片" }]}
          sizes={eager ? "(max-width: 767px) 100vw, 75vw" : compact ? "(max-width: 767px) 50vw, 25vw" : "(max-width: 767px) 90vw, 55vw"}
          preload={eager} onUnavailable={(src) => setFailedSources((current) => current.includes(src) ? current : [...current, src])} />
      </span>
      <span className="archive-photo-caption"><span>{photo.caption || album.title}</span>
        <span>{photo.id === album.keyVisual?.id
          ? photo.photographer ? "主視覺／" + photo.photographer : ""
          : photo.photographer || album.photographer ? "攝影／" + (photo.photographer || album.photographer) : galleryDate(album.date)}</span>
      </span>
    </button>
  );

  return <div ref={rootRef} className={"gallery-experience" + (detail ? " is-detail" : "")}>
    <header className="archive-topline">
      {detail ? <Link href="/gallery" className="archive-wordmark">HCCA / IN FRAMES<ArrowUpRight size={15} aria-hidden /></Link>
        : <><h1>影像紀事</h1><span className="archive-wordmark">HCCA / IN FRAMES</span></>}
      {!unavailable && items.length > 0 && <a className="archive-wall-link" href="#infinite-wall-title">走進照片牆<ArrowDown size={16} aria-hidden /></a>}
    </header>

    {heroAlbum && <header className="archive-masthead">
      <div className="archive-opening-scene">
        <span className="archive-scene-word" aria-hidden>IN FRAMES.</span>
        <div className={"archive-opening-photo" + (heroPhoto?.id === heroAlbum.keyVisual?.id ? " is-key-visual" : "")}>
          {heroPhoto ? photoButton(heroAlbum, heroPhoto, true)
            : <p className="archive-image-error" role="status">照片暫時無法顯示，請稍後重試。</p>}
        </div>
        {orbitPhotos.map((photo, index) => <div key={photo.id} className={"archive-orbit-photo orbit-" + index}>
          {photoButton(heroAlbum, photo, false, true)}
        </div>)}
        <span className="archive-scene-index" aria-hidden>{String(items.length).padStart(2, "0")} FRAMES / COUNTLESS MEMORIES</span>
      </div>
      <div className="archive-event-heading"><div className="archive-title">
        {detail ? <h1>{heroAlbum.title}</h1> : <h2>{heroAlbum.title}</h2>}
        {heroAlbum.summary && <p>{heroAlbum.summary}</p>}
      </div><div className="archive-event-details">
        {heroAlbum.date && <time dateTime={heroAlbum.date}>{galleryDate(heroAlbum.date)}</time>}
        {heroAlbum.photographer && <span>攝影／{heroAlbum.photographer}</span>}
        <Link className="archive-text-link" href={detail ? "/gallery" : "/gallery/" + heroAlbum.id}>
          {detail ? "全部活動" : "完整活動紀錄"}<ArrowUpRight size={17} aria-hidden />
        </Link>
      </div></div>
    </header>}

    {!unavailable && items.length > 0 && <div className="archive-controls">
      {!detail ? <label className="archive-event-select"><span className="sr-only">選擇活動</span>
        <select value={selected} onChange={(event) => selectEvent(event.target.value)}>
          <option value="">全部活動・共同選輯</option>
          {albums.map((album) => <option key={album.id} value={album.id}>{album.title}</option>)}
        </select>
      </label> : <span>{heroAlbum?.photos.length ?? 0} 張照片</span>}
      <span className="archive-selection-label">SELECTED MOMENTS<ArrowDown size={15} aria-hidden /></span>
    </div>}
    {unavailable && <div className="archive-empty" role="alert"><p>無法載入活動影像</p><button type="button" className="archive-more" onClick={() => window.location.reload()}>重新載入</button></div>}
    {!unavailable && visibleAlbums.length === 0 && <p className="archive-empty">活動紀錄整理中。</p>}

    <div className="archive-stories">{visibleAlbums.map((album, albumIndex) => {
      const featured = album.photos.filter((photo) => photo.featured);
      const photos = (featured.length ? featured : album.photos)
        .filter((photo) => album.id !== heroAlbum?.id || photo.id !== heroPhoto?.id).slice(0, 12);
      return <article id={album.id} key={album.id} className={"archive-story layout-" + album.layout + (albumIndex === 0 ? " continues-opening" : "")}
        aria-label={album.title + "精選照片"}>
        {albumIndex !== 0 && <header className="archive-story-heading"><div><h2>{album.title}</h2>
          <div className="archive-story-meta">{album.date && <time dateTime={album.date}>{galleryDate(album.date)}</time>}{album.photographer && <span>攝影／{album.photographer}</span>}</div>
        </div><Link className="archive-text-link" href={"/gallery/" + album.id}>走進這一天<ArrowUpRight size={18} aria-hidden /></Link></header>}
        <div className="archive-spread">{photos.map((photo, index) => <figure key={photo.id} className={"archive-spread-item position-" + index}>
          {photoButton(album, photo)}
        </figure>)}</div>
        {detail && album.keyVisual && album.keyVisual.id !== heroPhoto?.id && <section className="archive-key-visual" aria-label="活動主視覺">
          <div><h2>活動主視覺</h2>{album.keyVisual.photographer && <p>設計／{album.keyVisual.photographer}</p>}</div>
          {photoButton(album, album.keyVisual)}
        </section>}
        {detail && album.sourceUrl && <a className="archive-source-link" href={album.sourceUrl} target="_blank" rel="noopener noreferrer">原始活動相簿<ArrowUpRight size={16} aria-hidden /><span className="sr-only">（另開分頁）</span></a>}
      </article>;
    })}</div>

    {items.length > 0 && <>
      <InfinitePhotoWall key={selected} items={items} paused={viewer !== null} onOpen={openItem} />
      <section className="archive-all-photos" aria-label="全部活動照片"><header className="archive-contact-heading"><h2>每一個片刻</h2><span>{items.length} 幅影像</span></header>
        <div className="archive-contact-sheet">{items.slice(0, pageSize).map((item) => {
          const album = visibleAlbums.find((entry) => entry.id === item.albumId)!;
          return <div key={item.albumId + ":" + item.id}>{photoButton(album, item, false, true)}</div>;
        })}</div>
        {pageSize < items.length && <div ref={sentinelRef} className="archive-load-more"><button className="archive-more" type="button" onClick={() => setPageSize((size) => size + 36)}>載入更多照片</button></div>}
      </section>
    </>}
    <footer className="archive-endnote"><span>HCCA / IN FRAMES</span><Link href="/contact">照片下架與聯絡</Link></footer>
    {viewer && items[viewer.index] && <GalleryViewer items={items} initialIndex={viewer.index} origin={viewer.origin} onClose={() => setViewer(null)} />}
  </div>;
}
