import type { GalleryItem } from "./GalleryViewer";

type CaptionItem = Pick<GalleryItem, "caption" | "albumTitle" | "photographer" | "isKeyVisual">;

export default function PhotoCaption({ item }: { item: CaptionItem }) {
  const credit = item.photographer ? (item.isKeyVisual ? "繪師／" : "攝影／") + item.photographer : "";
  return <span className="archive-photo-caption">
    <span>{item.caption || item.albumTitle}</span>
    {credit && <span className="archive-photo-credit" title={credit}>{credit}</span>}
  </span>;
}
