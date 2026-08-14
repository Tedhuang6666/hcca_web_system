"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";

import type { DocumentWithArchive } from "@/lib/api";
import type { DocumentOut } from "@/lib/types";
import { AUTH_CACHE_EVENT } from "@/lib/auth-cache";

import PublicDocumentView from "./PublicDocumentView";

const AuthenticatedDocumentDetail = dynamic(
  () => import("./DocumentDetailPageClient"),
  { loading: () => null, ssr: false },
);

function withArchive(document: DocumentOut | null): DocumentWithArchive | null {
  return document ? { ...document, archive_at: document.archive_at ?? null } : null;
}

export default function DocumentDetailEntry({
  initialDoc,
}: {
  initialDoc: DocumentOut | null;
}) {
  const [authenticated, setAuthenticated] = useState(false);

  useEffect(() => {
    const sync = () => setAuthenticated(Boolean(window.localStorage.getItem("user_id")));
    sync();
    window.addEventListener(AUTH_CACHE_EVENT, sync);
    return () => window.removeEventListener(AUTH_CACHE_EVENT, sync);
  }, []);

  if (authenticated) {
    return <AuthenticatedDocumentDetail initialDoc={withArchive(initialDoc)} />;
  }

  return <PublicDocumentView document={initialDoc} />;
}
