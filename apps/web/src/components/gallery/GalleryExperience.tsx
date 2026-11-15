"use client";

import Link from "next/link";
import { useState, type CSSProperties } from "react";
import { ArrowRight, ArrowUpRight, LayoutGrid, LayoutPanelTop } from "lucide-react";
import ActivityImage from "./ActivityImage";
import { galleryDate, type GalleryPhoto, type PublicActivityAlbum } from "@/lib/public-activity-albums";
import GalleryViewer, { type GalleryItem } from "./GalleryViewer";
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
  const [mode, setMode] = useState<"editorial" | "overview">("editorial");
  const [failedSources, setFailedSources] = useState<string[]>([]);
  const [showAll, setShowAll] = useState(false);
  const [pageSize, setPageSize] = useState(36);
  const [viewer, setViewer] = useState<{ index: number; origin: HTMLElement | null } | null>(() => {
    const index = albums.flatMap(albumItems).findIndex((photo) => photo.id === initialPhoto);
    return index >= 0 ? { index, origin: null } : null;
  });
  const visibleAlbums = albums.filter((album) => (!selected || album.id === selected) && (album.photos.length > 0 || album.keyVisual));
  const items = visibleAlbums.flatMap(albumItems);
  const heroAlbum = visibleAlbums[0];
  const heroCandidates = heroAlbum ? [
    ...heroAlbum.photos.filter((photo) => photo.featured),
    ...heroAlbum.photos.filter((photo) => !photo.featured),
    ...(heroAlbum.keyVisual ? [heroAlbum.keyVisual] : []),
  ] : [];
  const heroPhoto = heroCandidates.find((photo) => !failedSources.includes(photo.src));
  const editorialPhotos = (album: PublicActivityAlbum) => {
    const featured = album.photos.filter((photo) => photo.featured);
    return (featured.length ? featured : album.photos).slice(0, 8);
  };
  const hasMorePhotos = heroAlbum?.photos.some((photo) => photo.id !== heroPhoto?.id
    && !editorialPhotos(heroAlbum).some((featured) => featured.id === photo.id));

  const selectEvent = (id: string) => {
    setSelected(id);
    setViewer(null);
    setShowAll(false);
    setPageSize(36);
    const url = new URL(window.location.href);
    if (id) url.searchParams.set("event", id); else url.searchParams.delete("event");
    window.history.replaceState(null, "", url);
  };

  const openPhoto = (album: PublicActivityAlbum, photo: GalleryPhoto, origin: HTMLElement) => {
    const index = items.findIndex((item) => item.id === photo.id && item.albumId === album.id);
    if (index >= 0) setViewer({ index, origin });
  };

  const photoButton = (album: PublicActivityAlbum, photo: GalleryPhoto, className = "", style?: CSSProperties, eager = false) => (
    <button type="button" className={"archive-photo " + className} style={style}
      aria-label={"放大：" + album.title + "・" + (photo.caption || "活動照片 " + (album.photos.findIndex((item) => item.id === photo.id) + 1))}
      data-gallery-photo={photo.id} onClick={(event) => openPhoto(album, photo, event.currentTarget)}>
      <ActivityImage key={photo.src} photos={[{ ...photo, alt: photo.alt || album.title + "活動照片" }]}
        sizes={eager ? "(max-width: 1240px) 100vw, 1200px" : "(max-width: 767px) 100vw, 600px"}
        preload={eager} onUnavailable={(src) => setFailedSources((current) => current.includes(src) ? current : [...current, src])} />
      <span className="archive-photo-caption">
        <span>{photo.caption || album.title}</span>
        <span>{photo.id === album.keyVisual?.id
          ? photo.photographer ? "主視覺／" + photo.photographer : ""
          : photo.photographer || album.photographer ? "攝影／" + (photo.photographer || album.photographer) : galleryDate(album.date)}</span>
      </span>
    </button>
  );

  return (
    <div className={"gallery-experience" + (detail ? " is-detail" : "")}>
      {!detail && <header className="archive-topline">
        <h1>影像紀事</h1>
        <span className="archive-wordmark">HCCA / IN FRAMES</span>
      </header>}
      {heroAlbum && <header className="archive-masthead">
        <div className={"archive-opening-photo" + (heroPhoto?.id === heroAlbum.keyVisual?.id ? " is-key-visual" : "")}>
          {heroPhoto ? photoButton(heroAlbum, heroPhoto, "", undefined, true)
            : <p className="archive-image-error" role="status">照片暫時無法顯示，請稍後重試。</p>}
        </div>
        <div className="archive-event-heading">
          <div className="archive-title">
            {detail ? <h1>{heroAlbum.title}</h1> : <h2>{heroAlbum.title}</h2>}
            {heroAlbum.summary && <p>{heroAlbum.summary}</p>}
          </div>
          <div className="archive-event-details">
            {heroAlbum.date && <time dateTime={heroAlbum.date}>{galleryDate(heroAlbum.date)}</time>}
            {heroAlbum.photographer && <span>攝影／{heroAlbum.photographer}</span>}
            <Link className="archive-text-link" href={detail ? "/gallery" : "/gallery/" + heroAlbum.id}>
              {detail ? "全部活動" : "完整活動紀錄"}<ArrowUpRight size={17} aria-hidden />
            </Link>
          </div>
        </div>
      </header>}

      {!unavailable && <div className="archive-controls">
        {!detail ? <label className="archive-event-select"><span className="sr-only">選擇活動</span>
          <select value={selected} onChange={(event) => selectEvent(event.target.value)}>
            <option value="">全部活動・共同選輯</option>
            {albums.map((album) => <option key={album.id} value={album.id}>{album.title}</option>)}
          </select>
        </label> : <span>{heroAlbum?.photos.length ?? 0} 張照片</span>}
        <div className="archive-view-switch" role="group" aria-label="展示方式">
          <button type="button" aria-pressed={mode === "editorial"} onClick={() => setMode("editorial")}><LayoutPanelTop size={17} aria-hidden />編輯選輯</button>
          <button type="button" aria-pressed={mode === "overview"} onClick={() => setMode("overview")}><LayoutGrid size={17} aria-hidden />照片總覽</button>
        </div>
      </div>}

      {unavailable && <div className="archive-empty" role="alert"><p>無法載入活動影像</p><button type="button" className="archive-more" onClick={() => window.location.reload()}>重新載入</button></div>}
      {!unavailable && visibleAlbums.length === 0 && <p className="archive-empty">活動紀錄整理中。</p>}
      {mode === "editorial" ? <div className="archive-stories">
        {visibleAlbums.map((album, albumIndex) => {
          const featured = editorialPhotos(album);
          const photos = featured.filter((photo) => album.id !== heroAlbum?.id || photo.id !== heroPhoto?.id).slice(0, 8);
          return (
            <article id={album.id} className={"archive-story layout-" + album.layout + (albumIndex === 0 ? " continues-opening" : "") + (detail ? " is-event-story" : "")} key={album.id}
              aria-labelledby={detail || albumIndex === 0 ? undefined : "archive-" + album.id} aria-label={detail ? album.title + "精選照片" : undefined}>
              {!detail && albumIndex !== 0 && <header className="archive-story-heading">
                <div><h2 id={"archive-" + album.id}>{album.title}</h2>
                  <div className="archive-story-meta">{album.date && <time dateTime={album.date}>{galleryDate(album.date)}</time>}{album.photographer && <span>攝影／{album.photographer}</span>}</div>
                </div>
                {!detail && <Link className="archive-text-link" href={"/gallery/" + album.id}>走進這一天<ArrowUpRight size={18} aria-hidden /></Link>}
              </header>}
              {album.summary && !detail && albumIndex !== 0 && <p className="archive-story-intro">{album.summary}</p>}
              <div className="archive-spread">
                {photos.map((photo, index) => <figure key={photo.id} className={"archive-spread-item position-" + index}>
                  {photoButton(album, photo)}
                </figure>)}
              </div>
              {detail && album.keyVisual && album.keyVisual.id !== heroPhoto?.id && <section className="archive-key-visual" aria-label="活動主視覺">
                <div><h2>活動主視覺</h2>{album.keyVisual.photographer && <p>設計／{album.keyVisual.photographer}</p>}</div>
                {photoButton(album, album.keyVisual)}
              </section>}
              {detail && album.sourceUrl && <a className="archive-source-link" href={album.sourceUrl} target="_blank" rel="noopener noreferrer">原始活動相簿<ArrowUpRight size={16} aria-hidden /><span className="sr-only">（另開分頁）</span></a>}
            </article>
          );
        })}
      </div> : <section className="archive-overview" aria-label="全部影像總覽">
        <p className="archive-overview-count">{items.length} 幅影像</p>
        <div className="archive-contact-sheet">
          {items.slice(0, pageSize).map((photo) => {
            const album = visibleAlbums.find((entry) => entry.id === photo.albumId)!;
            return <div key={photo.albumId + photo.id}>{photoButton(album, photo)}</div>;
          })}
        </div>
        {items.length > pageSize && <button className="archive-more" type="button" onClick={() => setPageSize((size) => size + 36)}>載入更多照片</button>}
      </section>}

      {detail && mode === "editorial" && heroAlbum && hasMorePhotos && <section className="archive-all-photos" aria-label="全部活動照片">
        <button className="archive-all-toggle" type="button" aria-expanded={showAll} aria-controls="archive-all-grid" onClick={() => setShowAll((shown) => !shown)}>
          {showAll ? "收起全部照片" : "瀏覽全部照片"}<span>{heroAlbum.photos.length}</span><ArrowRight size={20} aria-hidden />
        </button>
        {showAll && <div id="archive-all-grid" className="archive-contact-sheet">
          {heroAlbum.photos.slice(0, pageSize).map((photo) => <div key={photo.id}>{photoButton(heroAlbum, photo)}</div>)}
          {heroAlbum.photos.length > pageSize && <button className="archive-more" type="button" onClick={() => setPageSize((size) => size + 36)}>載入更多照片</button>}
        </div>}
      </section>}
      <footer className="archive-endnote"><span>HCCA / IN FRAMES</span><Link href="/contact">照片下架與聯絡</Link></footer>
      {viewer && items[viewer.index] && <GalleryViewer items={items} initialIndex={viewer.index} origin={viewer.origin} onClose={() => setViewer(null)} />}
    </div>
  );
}
