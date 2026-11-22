"use client";

import { useEffect, useRef, useState } from "react";
import GalleryExperience from "./GalleryExperience";
import type { PublicActivityAlbum } from "@/lib/public-activity-albums";
import "./gallery-collections.css";

type Props = {
  albums: PublicActivityAlbum[];
  initialEvent?: string;
  initialPhoto?: string;
  detail?: boolean;
  unavailable?: boolean;
};

export default function GalleryCollections({ albums, ...props }: Props) {
  const [section, setSection] = useState("");
  const selectRef = useRef<HTMLSelectElement>(null);
  const restoreFocus = useRef(false);
  const sections = [...new Set(albums.flatMap((album) => album.photos.map((photo) => photo.section || "")).filter(Boolean))];
  const filtered = section ? albums.map((album) => ({
    ...album, keyVisual: undefined,
    photos: album.photos.filter((photo) => photo.section === section),
  })).filter((album) => album.photos.length) : albums;

  // 換環節會重新掛載相簿，把焦點還給下拉選單，鍵盤操作才不會中斷。
  useEffect(() => {
    if (!restoreFocus.current) return;
    restoreFocus.current = false;
    selectRef.current?.focus();
  }, [section]);

  const changeSection = (value: string) => {
    restoreFocus.current = true;
    setSection(value);
  };

  const filters = sections.length > 1 ? <div className="gallery-section-filter" role="group" aria-label="照片篩選">
    <label className="archive-event-select"><span className="sr-only">活動環節</span>
      <select ref={selectRef} value={section} onChange={(event) => changeSection(event.target.value)}>
        <option value="">全部環節</option>{sections.map((name) => <option key={name}>{name}</option>)}
      </select>
    </label>
    {section && <button type="button" onClick={() => changeSection("")}>清除篩選</button>}
  </div> : null;

  return filtered.length || !section
    ? <GalleryExperience key={section} albums={filtered} filters={filters} {...props} />
    : <>{filters}<p className="gallery-collections-empty" role="status">沒有符合條件的照片</p></>;
}
