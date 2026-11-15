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
  const [photographer, setPhotographer] = useState("");
  const [section, setSection] = useState("");
  const photographers = [...new Set(albums.flatMap((album) => album.photos.map((photo) => photo.photographer || album.photographer || "")).filter(Boolean))];
  const sections = [...new Set(albums.flatMap((album) => album.photos.map((photo) => photo.section || "")).filter(Boolean))];
  const filtered = photographer || section ? albums.map((album) => ({
    ...album, keyVisual: undefined,
    photos: album.photos.filter((photo) => (!photographer || (photo.photographer || album.photographer) === photographer) && (!section || photo.section === section)),
  })).filter((album) => album.photos.length) : albums;
  return <>
    {(photographers.length > 0 || sections.length > 0) && <form className="gallery-collections" aria-label="照片篩選" onSubmit={(event) => event.preventDefault()}>
      {photographers.length > 0 && <label>攝影師<select value={photographer} onChange={(event) => setPhotographer(event.target.value)}>
        <option value="">全部攝影師</option>{photographers.map((name) => <option key={name}>{name}</option>)}
      </select></label>}
      {sections.length > 0 && <label>活動環節<select value={section} onChange={(event) => setSection(event.target.value)}>
        <option value="">全部環節</option>{sections.map((name) => <option key={name}>{name}</option>)}
      </select></label>}
      {(photographer || section) && <button type="button" onClick={() => { setPhotographer(""); setSection(""); }}>清除篩選</button>}
    </form>}
    {filtered.length || (!photographer && !section) ? <GalleryExperience key={photographer + ":" + section} albums={filtered} {...props} /> : <p className="gallery-collections-empty" role="status">沒有符合條件的照片</p>}
  </>;
}
