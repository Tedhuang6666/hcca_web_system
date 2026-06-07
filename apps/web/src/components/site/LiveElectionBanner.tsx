"use client";

import Link from "next/link";
import { ArrowRight, Radio } from "lucide-react";

import { liveLeader, useLiveElection } from "./useLiveElection";

/**
 * 站台級「正在發生」橫幅：有進行中的開票時，於公開站每一頁頂端常駐，
 * 顯示大概狀況（開票進度、領先組合、總票數），點擊進入即時開票詳情頁。
 */
export default function LiveElectionBanner() {
  const active = useLiveElection();
  if (!active) return null;

  const { summary } = active;
  const leader = liveLeader(summary);
  const progress = summary?.progress_percentage;
  const isLive = active.status === "live";

  return (
    <Link
      href={`/live/elections/${encodeURIComponent(active.summary?.slug ?? active.id)}`}
      className="public-live-strip group"
      aria-label={`即時開票：${active.title}，點擊查看詳情`}
    >
      <span className="public-live-strip-status">
        <span className="public-live-strip-dot" data-live={isLive} aria-hidden />
        {isLive ? "即時開票中" : "開票暫停"}
      </span>
      <span className="public-live-strip-title">{active.title}</span>
      {summary ? (
        <span className="public-live-strip-meta">
          {typeof progress === "number" && (
            <span className="public-live-strip-chip">已開 {Math.round(progress)}%</span>
          )}
          {leader && (
            <span className="public-live-strip-chip">
              領先 {leader.name} {Math.round(leader.percentage)}%
            </span>
          )}
          <span className="public-live-strip-chip">
            {summary.total_votes.toLocaleString("zh-TW")} 票
          </span>
        </span>
      ) : (
        <span className="public-live-strip-meta">
          <span className="public-live-strip-chip">載入即時摘要…</span>
        </span>
      )}
      <span className="public-live-strip-cta">
        看詳情
        <ArrowRight size={15} className="transition-transform group-hover:translate-x-0.5" aria-hidden />
      </span>
      <Radio size={16} className="public-live-strip-radio" aria-hidden />
    </Link>
  );
}
