"use client";

import { useCallback, useEffect, useMemo, useState, type CSSProperties, type FormEvent } from "react";
import Link from "next/link";
import {
  ArrowRight,
  Check,
  ArrowUpRight,
  LockKeyhole,
  RotateCcw,
  Sparkles,
} from "lucide-react";
import BrandEmblem from "@/components/brand/BrandEmblem";
import { ApiError, apiErrorMessage, rafflesApi } from "@/lib/api";
import { BRANDING } from "@/lib/branding";
import type { RaffleDrawOut, RaffleEventOut } from "@/lib/types";

import styles from "./raffle.module.css";

const SESSION_KEY = "hcca-raffle-session";
const DEVICE_KEY = "hcca-raffle-device";
const RESULT_HOLD_MS = 10_000;

type Stage = "loading" | "gate" | "ready" | "rolling" | "result";
type CylinderPrize = { id: string; label: string; value?: string | number };

function localId(key: string): string {
  if (typeof window === "undefined") return "server";
  const current = window.localStorage.getItem(key);
  if (current) return current;
  const value = crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  window.localStorage.setItem(key, value);
  return value;
}

function findPrizeIndex(event: RaffleEventOut, draw: RaffleDrawOut): number {
  const index = event.prizes.findIndex((prize) => prize.id === draw.prize_id);
  return index >= 0 ? index : 0;
}

export default function RaffleClient() {
  const [stage, setStage] = useState<Stage>("loading");
  const [event, setEvent] = useState<RaffleEventOut | null>(null);
  const [sessionToken, setSessionToken] = useState("");
  const [result, setResult] = useState<RaffleDrawOut | null>(null);
  const [error, setError] = useState("");
  const [winningIndex, setWinningIndex] = useState(0);
  const [accessCode, setAccessCode] = useState("");
  const [nextBusy, setNextBusy] = useState(false);
  const [autoAdvance, setAutoAdvance] = useState(false);

  const restore = useCallback(async () => {
    await rafflesApi.ping().catch(() => undefined);
    const token = window.localStorage.getItem(SESSION_KEY);
    if (!token) {
      setStage("gate");
      return;
    }
    try {
      const restored = await rafflesApi.restore(token);
      setSessionToken(token);
      setEvent(restored.event);
      setResult(restored.existing_draw);
      if (restored.existing_draw) setWinningIndex(findPrizeIndex(restored.event, restored.existing_draw));
      setStage(restored.existing_draw ? "result" : "ready");
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 403) {
        window.localStorage.removeItem(SESSION_KEY);
        setStage("gate");
      } else {
        setError(apiErrorMessage(caught, "目前無法連線，請確認現場網路後再試。"));
        setStage("gate");
      }
    }
  }, []);

  useEffect(() => {
    void restore();
  }, [restore]);

  const submitEntry = async (form: FormEvent<HTMLFormElement>) => {
    form.preventDefault();
    setError("");
    if (!accessCode.trim()) {
      setError("請輸入現場驗證碼。");
      return;
    }
    setStage("loading");
    try {
      const joined = await rafflesApi.join({
        access_code: accessCode.trim(),
        device_id: localId(DEVICE_KEY),
      });
      window.localStorage.setItem(SESSION_KEY, joined.session_token);
      setSessionToken(joined.session_token);
      setEvent(joined.event);
      setResult(joined.existing_draw);
      setStage(joined.existing_draw ? "result" : "ready");
    } catch (caught) {
      setStage("gate");
      setError(apiErrorMessage(caught, "驗證碼不正確，請向工作人員確認。"));
    }
  };

  const runDraw = async () => {
    if (!sessionToken || !event || stage === "rolling") return;
    setError("");
    try {
      const drawn = await rafflesApi.draw(sessionToken, crypto.randomUUID());
      setWinningIndex(findPrizeIndex(event, drawn));
      setStage("rolling");
      await new Promise((resolve) => window.setTimeout(resolve, 3000));
      setResult(drawn);
      setEvent((current) => current && { ...current, draw_count: current.draw_count + 1 });
      setAutoAdvance(true);
      setStage("result");
    } catch (caught) {
      setStage("ready");
      setError(apiErrorMessage(caught, "抽獎沒有完成，請保留畫面並再試一次。"));
    }
  };

  const nextTurn = useCallback(async () => {
    if (!sessionToken || nextBusy) return;
    setNextBusy(true);
    setError("");
    try {
      const next = await rafflesApi.next(sessionToken);
      window.localStorage.setItem(SESSION_KEY, next.session_token);
      setSessionToken(next.session_token);
      setEvent(next.event);
      setResult(null);
      setAutoAdvance(false);
      setStage("ready");
    } catch (caught) {
      setError(apiErrorMessage(caught, "目前無法開始下一輪，請確認抽獎台狀態。"));
    } finally {
      setNextBusy(false);
    }
  }, [nextBusy, sessionToken]);

  useEffect(() => {
    if (stage !== "result" || !autoAdvance) return;
    const timer = window.setTimeout(() => void nextTurn(), RESULT_HOLD_MS);
    return () => window.clearTimeout(timer);
  }, [autoAdvance, nextTurn, stage]);

  const clearLocalSession = () => {
    window.localStorage.removeItem(SESSION_KEY);
    setSessionToken("");
    setEvent(null);
    setResult(null);
    setAccessCode("");
    setError("");
    setAutoAdvance(false);
    setStage("gate");
  };

  const tierNote = useMemo(() => {
    if (!event) return "每台平板驗證一次";
    if (event.status === "paused") return "工作人員暫停中，請稍候再抽";
    return "每位參加者一次機會";
  }, [event]);

  const roulettePrizes = useMemo<CylinderPrize[]>(
    () => event?.prizes.map((prize) => ({ id: prize.id, label: `${prize.tier}賞・${prize.name}`, value: prize.tier })) ?? [],
    [event],
  );

  return (
    <main className={styles.page}>
      <div className={styles.ambient} aria-hidden="true" />
      <header className={styles.header}>
        <Link className={styles.brand} href="/" aria-label={`回到${BRANDING.orgShortName}首頁`}>
          <BrandEmblem size={48} />
          <span className={styles.brandCopy}>
            <strong>HCCA</strong>
            <small>{BRANDING.orgShortName}</small>
          </span>
        </Link>
        <div className={styles.headerRight}>
          <span className={styles.status}><i /> 現場開放中</span>
          <Link className={styles.backLink} href="/">首頁 <ArrowUpRight size={15} /></Link>
        </div>
      </header>

      <section className={styles.shell}>
        <section className={styles.stageCard} aria-live="polite">
          <div className={styles.stageTopline}>
            <span>社博集點抽獎</span>
            <span>竹嶺班聯</span>
          </div>

          {stage === "loading" && <div className={styles.loadingPanel}><div className={styles.loader} /><p>正在確認抽獎台狀態…</p></div>}

          {stage === "gate" && (
            <form className={styles.gate} onSubmit={submitEntry}>
              <BrandEmblem size={76} className={styles.gateEmblem} />
              <p className={styles.formLabel}>ENTER ACCESS CODE</p>
              <h2>準備好了嗎？</h2>
              <p className={styles.formIntro}>請向工作人員索取現場驗證碼。</p>
              <label>
                現場驗證碼
                <input
                  value={accessCode}
                  onChange={(e) => setAccessCode(e.target.value)}
                  placeholder="輸入驗證碼"
                  autoComplete="one-time-code"
                  autoFocus
                />
              </label>
              {error && <p className={styles.error} role="alert">{error}</p>}
              <button className={styles.primaryButton} type="submit">進入抽獎台 <ArrowRight size={17} /></button>
              <p className={styles.helper}><LockKeyhole size={14} /> 驗證成功後不需重新輸入</p>
            </form>
          )}

          {(stage === "ready" || stage === "rolling") && event && (
            <div className={styles.drawPanel}>
              <div className={styles.drawMeta}><span>第 {String(event.draw_count + 1).padStart(2, "0")} 位參加者</span><span>{tierNote}</span></div>
              <div className={styles.drawHeadline}>
                <span>按下按鈕</span>
                <strong>抽出你的獎品</strong>
              </div>
              <div className={`${styles.roulette} ${stage === "rolling" ? styles.rouletteRolling : ""}`}>
                {roulettePrizes.length > 0 && <CylinderRoulette prizes={roulettePrizes} winningIndex={winningIndex} isSpinning={stage === "rolling"} />}
              </div>
              {error && <p className={styles.error} role="alert">{error}</p>}
              <button className={styles.drawButton} type="button" onClick={runDraw} disabled={stage === "rolling" || event.status !== "open"}>
                <span>{stage === "rolling" ? "正在抽選…" : "抽出我的獎品"}</span><Sparkles size={18} />
              </button>
            </div>
          )}

          {stage === "result" && result && event && (
            <div className={styles.resultPanel}>
              <div className={styles.resultTopline}><span><Check size={15} /> 抽獎完成</span><span>NO. {String(result.draw_number).padStart(3, "0")}</span></div>
              <div className={styles.resultEmblem} aria-hidden="true"><BrandEmblem size={82} /></div>
              <p className={styles.resultTier}>{result.prize_tier}賞</p>
              <h2>{result.prize_name}</h2>
              <p className={styles.resultCopy}>請向四周工作人員領取對應獎品</p>
              <div className={styles.resultTicket}><span>領獎序號</span><strong>#{String(result.draw_number).padStart(3, "0")}</strong><span>請向工作人員出示</span></div>
              <div className={styles.nextActions}>
                <button className={styles.nextButton} type="button" onClick={() => void nextTurn()} disabled={nextBusy}>
                  {nextBusy ? "準備下一位…" : "下一位抽獎"} <ArrowRight size={16} />
                </button>
                <p className={styles.countdown}>{autoAdvance ? `${RESULT_HOLD_MS / 1000} 秒後自動回到抽獎台` : "可直接交給下一位參加者"}</p>
              </div>
              <button className={styles.textButton} type="button" onClick={clearLocalSession}><RotateCcw size={14} /> 清除這台平板的驗證紀錄</button>
            </div>
          )}
        </section>
      </section>

      <footer className={styles.footer}><span>有問題？請直接詢問現場工作人員</span><span>{BRANDING.orgShortName} · {BRANDING.acronym}</span></footer>
    </main>
  );
}

function CylinderRoulette({
  prizes,
  winningIndex,
  isSpinning,
}: {
  prizes: CylinderPrize[];
  winningIndex: number;
  isSpinning: boolean;
}) {
  const faceWidth = 142;
  const angle = 360 / prizes.length;
  const radius = faceWidth / (2 * Math.tan(Math.PI / prizes.length));
  const targetRotation = -(360 * 5 + winningIndex * angle);
  const reelStyle = {
    transform: `rotateY(${isSpinning ? targetRotation : 0}deg)`,
    transition: isSpinning ? "transform 3000ms cubic-bezier(0.12, 0.72, 0.16, 1)" : "none",
    "--cylinder-radius": `${radius}px`,
  } as CSSProperties;

  return (
    <div className={styles.rouletteTrack} role="listbox" aria-label="Prize roulette" aria-busy={isSpinning}>
      <div className={`${styles.cylinderReel} ${isSpinning ? styles.cylinderReelSpinning : ""}`} style={reelStyle}>
        {prizes.map((prize, index) => {
          const value = String(prize.value ?? "");
          return (
            <div
              className={styles.cylinderFace}
              key={prize.id}
              role="option"
              aria-label={prize.label}
              style={{ transform: `rotateY(${index * angle}deg) translateZ(${radius}px)` }}
            >
              <div className={styles.roulettePrize}>
                <span className={styles.rouletteTier}>{value}</span>
                <span>{prize.label.replace(`${value}賞・`, "")}</span>
              </div>
            </div>
          );
        })}
      </div>
      <div className={styles.rouletteIndicator} aria-hidden="true"><span /></div>
    </div>
  );
}
