"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { ArrowRight, ArrowUpRight, Layers3, LayoutPanelTop, RotateCcw } from "lucide-react";
import { uploadUrl } from "@/lib/config";
import { galleryDate, type GalleryPhoto, type PublicActivityAlbum } from "@/lib/public-activity-albums";
import GalleryViewer, { type GalleryItem } from "./GalleryViewer";
import "./gallery.css";

type PhotoStyle = CSSProperties & Record<"--rotation" | "--depth" | "--turn", string>;

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
  const [mode, setMode] = useState<"editorial" | "wall">("editorial");
  const [showAll, setShowAll] = useState(false);
  const [pageSize, setPageSize] = useState(36);
  const [viewer, setViewer] = useState<{ index: number; origin: HTMLElement | null } | null>(() => {
    const index = albums.flatMap(albumItems).findIndex((photo) => photo.id === initialPhoto);
    return index >= 0 ? { index, origin: null } : null;
  });
  const rootRef = useRef<HTMLDivElement>(null);
  const wallRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; left: number; top: number; moved: boolean } | null>(null);
  const visibleAlbums = albums.filter((album) => (!selected || album.id === selected) && (album.photos.length > 0 || album.keyVisual));
  const items = visibleAlbums.flatMap(albumItems);
  const heroAlbum = visibleAlbums[0];
  const heroPhoto = heroAlbum?.keyVisual ?? heroAlbum?.photos.find((photo) => photo.featured) ?? heroAlbum?.photos[0];

  useEffect(() => {
    const root = rootRef.current;
    if (!root || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const elements = [...root.querySelectorAll<HTMLElement>("[data-gallery-parallax]")];
      const offsets = elements.map((element) => Math.max(-14, Math.min(14, (window.innerHeight / 2 - element.getBoundingClientRect().top) * 0.025)));
      elements.forEach((element, index) => element.style.setProperty("--parallax", offsets[index] + "px"));
    };
    const scroll = () => { if (!frame) frame = window.requestAnimationFrame(update); };
    update();
    window.addEventListener("scroll", scroll, { passive: true });
    return () => { window.cancelAnimationFrame(frame); window.removeEventListener("scroll", scroll); };
  }, [selected, mode]);

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
      <Image src={uploadUrl(photo.src)} alt={photo.alt || album.title + "活動照片"}
        width={photo.width} height={photo.height}
        draggable={false}
        sizes={eager ? "(max-width: 767px) 85vw, 48vw" : "(max-width: 767px) 90vw, 50vw"}
        preload={eager} />
      <span className="archive-photo-caption">
        <span>{photo.caption || album.title}</span>
        <span>{photo.id === album.keyVisual?.id
          ? photo.photographer ? "主視覺／" + photo.photographer : ""
          : photo.photographer || album.photographer ? "攝影／" + (photo.photographer || album.photographer) : galleryDate(album.date)}</span>
      </span>
      {(album.date || photo.photographer || (photo.id !== album.keyVisual?.id && album.photographer)) && <span className="archive-photo-hover" aria-hidden="true">
        {galleryDate(album.date)}{photo.id === album.keyVisual?.id
          ? photo.photographer ? " · 主視覺／" + photo.photographer : ""
          : photo.photographer || album.photographer ? " · 攝影／" + (photo.photographer || album.photographer) : ""}
      </span>}
    </button>
  );

  return (
    <div ref={rootRef} className={"gallery-experience" + (mode === "wall" ? " is-wall" : "")}>
      <div className="archive-topline">
        <Link href="/gallery" className="archive-wordmark" aria-label="影像紀事首頁"><strong>HCCA</strong><span>IN FRAMES</span></Link>
        <span>活動成果 · 影像紀事</span>
      </div>
      <header className="archive-masthead">
        <div className="archive-title">
          {detail && heroAlbum ? <h1>{heroAlbum.title}</h1> : <h1><span>那些被留下的</span><span>瞬間。</span></h1>}
          <p>{detail && heroAlbum ? heroAlbum.summary : "活動、人物與故事，以影像記錄我們共同走過的日子。"}</p>
          {detail && heroAlbum?.date && <time dateTime={heroAlbum.date}>{galleryDate(heroAlbum.date)}</time>}
          {detail && <Link className="archive-text-link" href="/gallery">全部活動<ArrowRight size={17} aria-hidden /></Link>}
        </div>
        {heroAlbum && heroPhoto && <div className={"archive-opening-photo" + (heroAlbum.keyVisual ? " is-key-visual" : "")} data-gallery-parallax>
          {photoButton(heroAlbum, heroPhoto, "", undefined, true)}
          {heroAlbum.keyVisual && <span className="archive-artwork-label">活動主視覺</span>}
        </div>}
      </header>

      {!unavailable && <div className="archive-controls">
        {!detail ? <label className="archive-event-select"><span className="sr-only">選擇活動</span>
          <select value={selected} onChange={(event) => selectEvent(event.target.value)}>
            <option value="">全部活動・共同選輯</option>
            {albums.map((album) => <option key={album.id} value={album.id}>{album.title}</option>)}
          </select>
        </label> : <span>{heroAlbum?.photos.length ?? 0} 張照片</span>}
        <div className="archive-view-switch" role="group" aria-label="展示方式">
          <button type="button" aria-pressed={mode === "editorial"} onClick={() => setMode("editorial")}><LayoutPanelTop size={17} aria-hidden />編輯選輯</button>
          <button type="button" aria-pressed={mode === "wall"} onClick={() => setMode("wall")}><Layers3 size={17} aria-hidden />立體攝影牆</button>
        </div>
      </div>}

      {unavailable && <div className="archive-empty" role="alert"><p>無法載入活動影像</p><button type="button" className="archive-more" onClick={() => window.location.reload()}>重新載入</button></div>}
      {!unavailable && visibleAlbums.length === 0 && <p className="archive-empty">活動紀錄整理中。</p>}
      {mode === "editorial" ? <div className="archive-stories">
        {visibleAlbums.map((album, albumIndex) => {
          const featured = album.photos.filter((photo) => photo.featured);
          const photos = featured.filter((photo) => album.id !== heroAlbum?.id || photo.id !== heroPhoto?.id).slice(0, 8);
          return (
            <article id={album.id} className={"archive-story layout-" + album.layout + (detail ? " is-event-story" : "")} key={album.id}
              aria-labelledby={detail ? undefined : "archive-" + album.id} aria-label={detail ? album.title + "精選照片" : undefined}>
              {!detail && <header className="archive-story-heading">
                <div><h2 id={"archive-" + album.id}>{album.title}</h2>
                  <div className="archive-story-meta">{album.date && <time dateTime={album.date}>{galleryDate(album.date)}</time>}{album.photographer && <span>攝影／{album.photographer}</span>}</div>
                </div>
                {!detail && <Link className="archive-text-link" href={"/gallery/" + album.id}>走進這一天<ArrowUpRight size={18} aria-hidden /></Link>}
              </header>}
              {album.summary && !detail && <p className="archive-story-intro">{album.summary}</p>}
              {album.keyVisual && !(albumIndex === 0 && heroAlbum?.keyVisual) && <figure className="archive-key-visual">
                {photoButton(album, album.keyVisual)}<figcaption>活動主視覺</figcaption>
              </figure>}
              <div className="archive-spread">
                {photos.map((photo, index) => <figure key={photo.id} className={"archive-spread-item position-" + index}
                  data-gallery-parallax={index === 1 ? "" : undefined}>
                  {photoButton(album, photo)}
                </figure>)}
              </div>
              {album.sourceUrl && <a className="archive-source-link" href={album.sourceUrl} target="_blank" rel="noopener noreferrer">原始活動相簿<ArrowUpRight size={16} aria-hidden /><span className="sr-only">（另開分頁）</span></a>}
            </article>
          );
        })}
      </div> : <section className="archive-wall" aria-label="立體互動攝影牆">
        <div className="archive-wall-actions"><span>{items.length} 幅影像</span><button type="button" onClick={() => {
          wallRef.current?.scrollTo({ left: 0, top: 0, behavior: "auto" });
          wallRef.current?.style.setProperty("--view-x", "0deg");
          wallRef.current?.style.setProperty("--view-y", "0deg");
        }}><RotateCcw size={16} aria-hidden />重設視角</button></div>
        <div className="archive-wall-viewport" ref={wallRef} tabIndex={0} aria-label="攝影牆，可使用方向鍵捲動"
          onDragStart={(event) => event.preventDefault()}
          onKeyDown={(event) => {
            if (event.target !== event.currentTarget) return;
            const directions: Record<string, [number, number]> = { ArrowLeft: [-100, 0], ArrowRight: [100, 0], ArrowUp: [0, -100], ArrowDown: [0, 100] };
            const direction = directions[event.key];
            if (direction) { event.preventDefault(); event.currentTarget.scrollBy(...direction); }
          }}
          onPointerDown={(event) => {
            if (event.pointerType !== "mouse" || event.button !== 0) return;
            drag.current = { x: event.clientX, y: event.clientY, left: event.currentTarget.scrollLeft, top: event.currentTarget.scrollTop, moved: false };
          }}
          onPointerMove={(event) => {
            if (event.pointerType !== "mouse") return;
            const start = drag.current;
            if (start && event.buttons === 1) {
              const dx = event.clientX - start.x, dy = event.clientY - start.y;
              if (Math.abs(dx) + Math.abs(dy) > 6) {
                start.moved = true;
                event.currentTarget.setPointerCapture(event.pointerId);
                event.currentTarget.scrollLeft = start.left - dx;
                event.currentTarget.scrollTop = start.top - dy;
              }
            } else if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
              const rect = event.currentTarget.getBoundingClientRect();
              event.currentTarget.style.setProperty("--view-y", ((event.clientX - rect.x) / rect.width - 0.5) * 8 + "deg");
              event.currentTarget.style.setProperty("--view-x", ((event.clientY - rect.y) / rect.height - 0.5) * -6 + "deg");
            }
          }}
          onPointerUp={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
          onPointerCancel={() => { drag.current = null; }}
          onClickCapture={(event) => { if (drag.current?.moved) { event.preventDefault(); event.stopPropagation(); } drag.current = null; }}>
          <div className="archive-wall-plane" style={{ minHeight: Math.max(900, Math.ceil(Math.min(items.length, pageSize) / 3) * 360 + 180) }}>
            {items.slice(0, pageSize).map((photo, index) => {
              const album = visibleAlbums.find((entry) => entry.id === photo.albumId)!;
              const style: PhotoStyle = {
                left: 80 + (index % 3) * 380 + (Math.floor(index / 3) % 2) * 90,
                top: 80 + Math.floor(index / 3) * 360 + (index % 3 === 1 ? 100 : 0),
                width: index % 3 === 0 ? 360 : 290,
                "--rotation": [-5, 6, -2, 4][index % 4] + "deg",
                "--turn": [-9, 12, 6, -6][index % 4] + "deg",
                "--depth": [35, -25, 65, 0][index % 4] + "px",
              };
              return <div key={photo.albumId + photo.id} className="archive-wall-photo" style={style}>{photoButton(album, photo)}</div>;
            })}
          </div>
        </div>
        {items.length > pageSize && <button className="archive-more" type="button" onClick={() => setPageSize((size) => size + 36)}>展開更多影像</button>}
      </section>}

      {detail && heroAlbum && <section className="archive-all-photos" aria-label="全部活動照片">
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
