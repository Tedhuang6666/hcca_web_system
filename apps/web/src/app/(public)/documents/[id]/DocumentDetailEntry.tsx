"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";

import { ApiError, documentsApi, type DocumentWithArchive } from "@/lib/api";
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
  documentId,
  initialDoc,
}: {
  documentId: string;
  initialDoc: DocumentOut | null;
}) {
  const [authenticated, setAuthenticated] = useState(false);
  const [document, setDocument] = useState(initialDoc);
  const [loadingPublicDocument, setLoadingPublicDocument] = useState(!initialDoc);
  const [publicLoadError, setPublicLoadError] = useState<"not_found" | "unavailable" | null>(null);
  const [retryVersion, setRetryVersion] = useState(0);

  useEffect(() => {
    const sync = () => setAuthenticated(Boolean(window.localStorage.getItem("user_id")));
    sync();
    window.addEventListener(AUTH_CACHE_EVENT, sync);
    return () => window.removeEventListener(AUTH_CACHE_EVENT, sync);
  }, []);

  useEffect(() => {
    if (initialDoc || authenticated) return;
    let cancelled = false;
    setLoadingPublicDocument(true);
    setPublicLoadError(null);
    void documentsApi.get(documentId)
      .then((loaded) => {
        if (!cancelled) setDocument(loaded);
      })
      .catch((error) => {
        if (!cancelled) {
          setPublicLoadError(error instanceof ApiError && error.status === 404 ? "not_found" : "unavailable");
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingPublicDocument(false);
      });
    return () => { cancelled = true; };
  }, [authenticated, documentId, initialDoc, retryVersion]);

  if (authenticated) {
    return <AuthenticatedDocumentDetail initialDoc={withArchive(document)} />;
  }

  return (
    <PublicDocumentView
      document={document}
      loading={loadingPublicDocument}
      loadError={publicLoadError}
      onRetry={() => setRetryVersion((version) => version + 1)}
    />
  );
}
