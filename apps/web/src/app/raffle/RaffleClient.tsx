"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import {
  ArrowRight,
  Check,
  CircleHelp,
  ExternalLink,
  LockKeyhole,
  RotateCcw,
  Sparkles,
} from "lucide-react";
import { SpinRoulette, type Prize } from "react-spin-roulette";

import BrandEmblem from "@/components/brand/BrandEmblem";
import { ApiError, apiErrorMessage, rafflesApi } from "@/lib/api";
import { BRANDING } from "@/lib/branding";
import type { RaffleDrawOut, RaffleEventOut } from "@/lib/types";

import styles from "./raffle.module.css";

const SESSION_KEY = "hcca-raffle-session";
const DEVICE_KEY = "hcca-raffle-device";
const RESULT_HOLD_MS = 10_000;

type Stage = "loading" | "gate" | "ready" | "rolling" | "result";

function localId(key: string): string {
  if (typeof window === "undefined") return "server";
  const current = window.localStorage.getItem(key);
  if (current) return current;
  const value = crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  window.localStorage.setItem(key, value);
  return value;
}

function finiteCount(event: RaffleEventOut | null): number {
  return event?.prizes.reduce((sum, prize) => sum + (prize.remaining_quantity ?? 0), 0) ?? 0;
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
    if (event.reserve_released) return "尾聲模式已開啟，剩餘好獎全部加入抽選";
    return `目前有限獎品剩餘 ${finiteCount(event)} 份`;
  }, [event]);

  const roulettePrizes = useMemo<Prize[]>(
    () => event?.prizes.map((prize) => ({ id: prize.id, label: `${prize.tier}賞・${prize.name}`, value: prize.tier })) ?? [],
    [event],
  );

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <Link className={styles.brand} href="/" aria-label={`回到${BRANDING.orgShortName}首頁`}>
          <BrandEmblem size={42} framed />
          <span className={styles.brandCopy}>
            <strong>{BRANDING.orgShortName}</strong>
            <small>{BRANDING.platformName}</small>
          </span>
        </Link>
        <Link className={styles.backLink} href="/">
          回到首頁 <ExternalLink size={14} />
        </Link>
      </header>

      <section className={styles.shell}>
        <div className={styles.intro}>
          <span className={styles.sectionLabel}>現場服務</span>
          <h1>現場抽獎</h1>
          <p>輸入工作人員提供的驗證碼，抽出今天的獎品。</p>
          <div className={styles.notice}>
            <LockKeyhole size={16} aria-hidden />
            <span>驗證成功後會留在這台平板，不需要重複輸入。</span>
          </div>
        </div>

        <section className={styles.stageCard} aria-live="polite">
          <div className={styles.stageTopline}>
            <span>抽獎台</span>
            <span className={styles.status}><i /> 現場開放中</span>
          </div>

          {stage === "loading" && <div className={styles.loadingPanel}><div className={styles.loader} /><p>正在確認抽獎台狀態…</p></div>}

          {stage === "gate" && (
            <form className={styles.gate} onSubmit={submitEntry}>
              <div className={styles.gateHeading}>
                <span className={styles.iconTile}><LockKeyhole size={18} /></span>
                <div><h2>輸入驗證碼</h2><p>請向現場工作人員索取</p></div>
              </div>
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
              <button className={styles.primaryButton} type="submit">開始抽獎 <ArrowRight size={17} /></button>
              <p className={styles.helper}><CircleHelp size={14} /> 每台平板只需驗證一次</p>
            </form>
          )}

          {(stage === "ready" || stage === "rolling") && event && (
            <div className={styles.drawPanel}>
              <div className={styles.drawMeta}><span>第 {event.draw_count + 1} 位</span><span>{tierNote}</span></div>
              <div className={`${styles.roulette} ${stage === "rolling" ? styles.rouletteRolling : ""}`}>
                {roulettePrizes.length > 0 && <SpinRoulette
                  prizes={roulettePrizes}
                  winningIndex={winningIndex}
                  isSpinning={stage === "rolling"}
                  duration={3000}
                  minSpins={5}
                  prizeSize={142}
                  orientation="horizontal"
                  className={styles.rouletteTrack}
                  prizeClassName={styles.roulettePrize}
                  indicatorClassName={styles.rouletteIndicator}
                  renderPrize={(prize) => <><span className={styles.rouletteTier}>{String(prize.value ?? "")}</span><span>{prize.label.replace(`${String(prize.value ?? "")}賞・`, "")}</span></>}
                  renderIndicator={() => <div className={styles.rouletteIndicator}><span /></div>}
                />}
              </div>
              {error && <p className={styles.error} role="alert">{error}</p>}
              <button className={styles.drawButton} type="button" onClick={runDraw} disabled={stage === "rolling" || event.status !== "open"}>
                <span>{stage === "rolling" ? "正在抽選…" : "抽出我的獎品"}</span><Sparkles size={18} />
              </button>
              <p className={styles.drawFootnote}>結果會由系統鎖定，動畫結束後顯示。</p>
            </div>
          )}

          {stage === "result" && result && event && (
            <div className={styles.resultPanel}>
              <div className={styles.resultEmblem} aria-hidden="true"><BrandEmblem size={58} framed /></div>
              <div className={styles.resultKicker}><Check size={15} /> 抽獎完成・第 {result.draw_number} 位</div>
              <p className={styles.resultTier}>{result.prize_tier}賞</p>
              <h2>{result.prize_name}</h2>
              <p className={styles.resultCopy}>請帶著這個畫面到兌獎桌領取獎品。</p>
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

      <footer className={styles.footer}><span>有問題？請直接詢問現場工作人員</span><span>HCCA 校園自治整合平台</span></footer>
    </main>
  );
}
