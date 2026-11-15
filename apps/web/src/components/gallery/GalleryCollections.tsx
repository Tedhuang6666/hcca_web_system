"use client";

import { useState } from "react";
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
  const sections = [...new Set(albums.flatMap((album) => album.photos.map((photo) => photo.section || "")).filter(Boolean))];
  const filtered = section ? albums.map((album) => ({
    ...album, keyVisual: undefined,
    photos: album.photos.filter((photo) => photo.section === section),
  })).filter((album) => album.photos.length) : albums;
  return <>
    {sections.length > 1 && <form className="gallery-collections" aria-label="照片篩選" onSubmit={(event) => event.preventDefault()}>
      {sections.length > 0 && <label>活動環節<select value={section} onChange={(event) => setSection(event.target.value)}>
        <option value="">全部環節</option>{sections.map((name) => <option key={name}>{name}</option>)}
      </select></label>}
      {section && <button type="button" onClick={() => setSection("")}>清除篩選</button>}
    </form>}
    {filtered.length || !section ? <GalleryExperience key={section} albums={filtered} {...props} /> : <p className="gallery-collections-empty" role="status">沒有符合條件的照片</p>}
  </>;
}
