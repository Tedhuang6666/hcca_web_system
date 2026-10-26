"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUpRight, ChevronLeft, ChevronRight, Expand, X } from "lucide-react";
import { lookbookAssetUrl, lookbookPhotoUrl, shopLookbook, type LookbookPhoto } from "@/lib/shop-lookbook";
import styles from "./ShopLookbook.module.css";

function Photo({ photo, large = false }: { photo: LookbookPhoto; large?: boolean }) {
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  if (failed) return <span className={styles.imageError}>照片暫時無法顯示，請稍後重新開啟。</span>;
  return (
    <>
      {/* 已離線產生對應尺寸，避免手機下載原始攝影大檔。 */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
      src={lookbookPhotoUrl(photo.id, large ? 2400 : 1440)}
      srcSet={large ? undefined : `${lookbookPhotoUrl(photo.id, 480)} 480w, ${lookbookPhotoUrl(photo.id)} 1440w`}
      sizes={large ? undefined : "(max-width: 639px) 100vw, (max-width: 1199px) 50vw, 560px"}
      width={photo.width}
      height={photo.height}
      alt={photo.alt}
      style={{ objectPosition: photo.position }}
      loading={large ? "eager" : "lazy"}
      decoding="async"
      onLoad={() => setLoaded(true)}
      onError={() => setFailed(true)}
      />
      {large && !loaded && <span className={styles.imageLoading} role="status">正在載入照片…</span>}
    </>
  );
}

export default function ShopLookbook() {
  const [collectionId, setCollectionId] = useState(shopLookbook[0].id);
  const [expanded, setExpanded] = useState(false);
  const [viewer, setViewer] = useState<{ index: number } | "dm" | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const collection = shopLookbook.find((item) => item.id === collectionId) ?? shopLookbook[0];
  const portrait = collection.photos.find((photo) => photo.orientation === "portrait")!;
  const featured = [portrait, ...collection.photos.filter((photo) => photo.orientation === "landscape").slice(0, 2)];
  const remaining = collection.photos.filter((photo) => !featured.includes(photo));
  const activePhoto = viewer && viewer !== "dm" ? collection.photos[viewer.index] : null;
  const viewerOpen = viewer !== null;

  useEffect(() => {
    if (!viewerOpen) return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.showModal();
    closeRef.current?.focus();
    return () => {
      dialog.close();
      document.body.style.overflow = previousOverflow;
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
  }, [viewerOpen]);

  const move = (delta: number) => setViewer((current) => current && current !== "dm"
    ? { index: (current.index + delta + collection.photos.length) % collection.photos.length }
    : current);

  const renderPhoto = (photo: LookbookPhoto) => (
    <button key={photo.id} type="button" className={styles.photo}
      data-orientation={photo.orientation}
      onClick={() => setViewer({ index: collection.photos.indexOf(photo) })}
      aria-label={`放大${photo.alt}`}>
      <Photo photo={photo} />
      <span className={styles.photoCaption}><span>{photo.alt}</span><Expand size={16} aria-hidden="true" /></span>
    </button>
  );

  return (
    <section className={styles.lookbook} aria-labelledby="shop-lookbook-title">
      <div className={styles.heading}>
        <div>
          <h3 id="shop-lookbook-title">把校園，穿進日常。</h3>
          <p>校慶服飾實拍 · 正面、背面與每一處細節</p>
        </div>
        <a href="#shop-product-selection" className={styles.shopLink}>前往選購 <ArrowDown size={16} aria-hidden="true" /></a>
      </div>
      <div className={styles.toolbar}>
        <div className={styles.collections} role="group" aria-label="選擇實拍款式">
          {shopLookbook.map((item) => <button type="button" key={item.id}
            aria-pressed={collection.id === item.id}
            onClick={() => { setCollectionId(item.id); setExpanded(false); }}>
            {item.name}
          </button>)}
        </div>
        <button type="button" className={styles.dmLink} onClick={() => setViewer("dm")}>
          查看原版 DM <ArrowUpRight size={16} aria-hidden="true" />
        </button>
      </div>
      <div className={styles.featured} key={collection.id}>{featured.map(renderPhoto)}</div>
      <div id="shop-lookbook-more" className={styles.morePhotos} hidden={!expanded}>
        {expanded && remaining.map(renderPhoto)}
      </div>
      <div className={styles.footer}>
        <p>{collection.name} <span>· {collection.photos.length} 張實拍</span></p>
        <button type="button" aria-expanded={expanded} aria-controls="shop-lookbook-more"
          onClick={() => setExpanded(!expanded)}>
          {expanded ? "收起照片" : `展開全部 ${collection.photos.length} 張`} <ChevronRight size={16} aria-hidden="true" />
        </button>
      </div>
      <dialog ref={dialogRef} className={styles.viewer} aria-label={`${collection.name}${viewer === "dm" ? "原版 DM" : "照片檢視"}`}
        onCancel={() => setViewer(null)} onClose={() => setViewer(null)}
        onClick={(event) => { if (event.target === event.currentTarget) setViewer(null); }}
        onKeyDown={(event) => {
          if (event.key === "Tab") {
            const controls = event.currentTarget.querySelectorAll<HTMLElement>(
              "button:not([disabled]), [tabindex='0']",
            );
            const first = controls[0];
            const last = controls[controls.length - 1];
            if (event.shiftKey && document.activeElement === first) {
              event.preventDefault();
              last?.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
              event.preventDefault();
              first?.focus();
            }
          }
          if (viewer === "dm") return;
          if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
            event.preventDefault();
            move(event.key === "ArrowRight" ? 1 : -1);
          }
        }}>
        <div className={styles.viewerHeader}>
          <p>{collection.name}<span>{viewer === "dm" ? "原版 DM · 可橫向捲動查看" : "照片檢視"}</span></p>
          <button type="button" ref={closeRef} onClick={() => setViewer(null)} aria-label="關閉照片檢視"><X size={22} aria-hidden="true" /></button>
        </div>
        {viewer === "dm" ? (
          <div className={styles.dmScroll} tabIndex={0} role="region" aria-label="DM 完整構圖，可橫向捲動">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={lookbookAssetUrl(`${collection.dm.id}.webp`)} width={collection.dm.width} height={collection.dm.height} alt={`${collection.name}原版 DM，商品價格與訂購資訊以選購區為準`} />
          </div>
        ) : activePhoto ? (
          <>
            <div className={styles.viewerImage}><Photo key={activePhoto.id} photo={activePhoto} large /></div>
            <div className={styles.viewerFooter}>
              <button type="button" onClick={() => move(-1)} aria-label="上一張照片"><ChevronLeft size={22} aria-hidden="true" /></button>
              <p aria-live="polite">{activePhoto.alt}<span>{viewer ? viewer.index + 1 : 1} / {collection.photos.length}</span></p>
              <button type="button" onClick={() => move(1)} aria-label="下一張照片"><ChevronRight size={22} aria-hidden="true" /></button>
            </div>
          </>
        ) : null}
      </dialog>
    </section>
  );
}
