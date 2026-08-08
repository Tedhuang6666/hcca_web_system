"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";

const MerchantApplicationForm = dynamic(() => import("./MerchantApplicationForm"), {
  ssr: false,
});

export default function DeferredMerchantApplicationForm() {
  const [ready, setReady] = useState(false);
  const sectionRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const section = sectionRef.current;
    if (!section) return;

    if (!("IntersectionObserver" in window)) {
      setReady(true);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        setReady(true);
        observer.disconnect();
      },
      { rootMargin: "0px 0px 320px" },
    );
    observer.observe(section);
    return () => observer.disconnect();
  }, []);

  if (ready) return <MerchantApplicationForm />;

  return (
    <section
      ref={sectionRef}
      aria-labelledby="partner-application-title"
      className="min-h-64 rounded-2xl border border-[var(--public-border)] bg-[var(--public-surface)] p-6 sm:p-8"
    >
      <h2 id="partner-application-title" className="sr-only">
        合作申請
      </h2>
      <div className="flex min-h-48 items-center gap-3 text-sm text-[var(--public-secondary)]" role="status">
        <span
          className="h-4 w-4 shrink-0 rounded-full border-2 border-[var(--public-border)] border-t-[var(--public-accent)]"
          aria-hidden
        />
        正在準備申請表單…
      </div>
    </section>
  );
}
