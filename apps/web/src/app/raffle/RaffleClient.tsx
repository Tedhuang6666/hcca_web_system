"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowRight, Check, CircleHelp, LockKeyhole, RotateCcw, Sparkles, Ticket } from "lucide-react";
import { SpinRoulette, type Prize } from "react-spin-roulette";

import { ApiError, apiErrorMessage, rafflesApi } from "@/lib/api";
import type { RaffleDrawOut, RaffleEventOut } from "@/lib/types";

import styles from "./raffle.module.css";

const SESSION_KEY = "hcca-raffle-session";
const DEVICE_KEY = "hcca-raffle-device";

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
  const [eventCode, setEventCode] = useState("");
  const [accessCode, setAccessCode] = useState("");

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

  const submitEntry = async (form: React.FormEvent<HTMLFormElement>) => {
    form.preventDefault();
    setError("");
    if (!eventCode.trim() || !accessCode.trim()) {
      setError("請輸入活動碼與現場驗證碼。");
      return;
    }
    setStage("loading");
    try {
      const joined = await rafflesApi.join({
        event_code: eventCode.trim(),
        access_code: accessCode.trim(),
        device_id: localId(DEVICE_KEY),
      });
      window.localStorage.setItem(SESSION_KEY, joined.session_token);
      setSessionToken(joined.session_token);
      setEvent(joined.event);
      setResult(joined.existing_draw);
      if (joined.existing_draw) setWinningIndex(findPrizeIndex(joined.event, joined.existing_draw));
      setStage(joined.existing_draw ? "result" : "ready");
    } catch (caught) {
      setStage("gate");
      setError(apiErrorMessage(caught, "活動碼或驗證碼不正確，請再確認一次。"));
    }
  };

  const runDraw = async () => {
    if (!sessionToken || !event || stage === "rolling") return;
    setError("");
    try {
      // 先向後端鎖定結果，再把結果索引交給動畫元件；前端永遠不決定獎品。
      const drawn = await rafflesApi.draw(sessionToken, crypto.randomUUID());
      setWinningIndex(findPrizeIndex(event, drawn));
      setStage("rolling");
      await new Promise((resolve) => window.setTimeout(resolve, 3000));
      setResult(drawn);
      setEvent((current) => current && { ...current, draw_count: current.draw_count + 1 });
      setStage("result");
    } catch (caught) {
      setStage("ready");
      setError(apiErrorMessage(caught, "抽獎沒有完成，請保留畫面並再試一次。"));
    }
  };

  const clearLocalSession = () => {
    window.localStorage.removeItem(SESSION_KEY);
    setSessionToken("");
    setEvent(null);
    setResult(null);
    setEventCode("");
    setAccessCode("");
    setError("");
    setStage("gate");
  };

  const tierNote = useMemo(() => {
    if (!event) return "現場限定・每台平板只需驗證一次";
    if (event.status === "paused") return "工作人員暫停中，請稍候再抽";
    if (event.reserve_released) return "尾聲模式已開啟，剩餘好獎全部加入抽選";
    return `好獎會分段釋出，目前還有 ${finiteCount(event)} 份有限獎品`;
  }, [event]);

  const roulettePrizes = useMemo<Prize[]>(
    () => event?.prizes.map((prize) => ({ id: prize.id, label: `${prize.tier}賞・${prize.name}`, value: prize.tier })) ?? [],
    [event],
  );

  return (
    <main className={styles.page}>
      <div className={styles.noise} aria-hidden />
      <header className={styles.header}>
        <a className={styles.brand} href="/raffle" aria-label="回到抽獎入口">
          <span className={styles.brandMark}><Ticket size={18} strokeWidth={2.5} /></span>
          <span>HCCA 現場抽獎</span>
        </a>
        <div className={styles.headerStatus}><span /> 現場系統運作中</div>
      </header>

      <section className={styles.shell}>
        <div className={styles.heroCopy}>
          <p className={styles.eyebrow}>LUCKY DRAW / 2026</p>
          <h1>今天的好運，<br /><em>留給你。</em></h1>
          <p className={styles.intro}>輸入現場提供的驗證碼，轉動你的專屬獎品。<br />每台平板驗證一次，抽過就會替你記住結果。</p>
          <div className={styles.trustLine}><LockKeyhole size={14} /> 驗證成功後會留在這台平板，不需重複輸入</div>
        </div>

        <div className={styles.stageCard}>
          <div className={styles.stageTopline}>
            <span>{event?.title ?? "現場獎品抽選"}</span>
            <span className={styles.livePill}><span /> LIVE</span>
          </div>

          {stage === "loading" && <div className={styles.loadingPanel}><div className={styles.loader} /><p>正在確認抽獎台狀態…</p></div>}

          {stage === "gate" && (
            <form className={styles.gate} onSubmit={submitEntry}>
              <div className={styles.gateHeading}><span className={styles.iconTile}><LockKeyhole size={19} /></span><div><h2>先拿到入場資格</h2><p>請向工作人員索取活動碼與驗證碼</p></div></div>
              <label>活動碼<input value={eventCode} onChange={(e) => setEventCode(e.target.value)} placeholder="例如：WELCOME26" autoComplete="off" /></label>
              <label>現場驗證碼<input value={accessCode} onChange={(e) => setAccessCode(e.target.value)} placeholder="輸入 4 位以上驗證碼" autoComplete="one-time-code" /></label>
              {error && <p className={styles.error} role="alert">{error}</p>}
              <button className={styles.primaryButton} type="submit">進入抽獎台 <ArrowRight size={18} /></button>
              <p className={styles.helper}><CircleHelp size={14} /> 驗證只需做一次，之後這台平板會自動記住</p>
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
                  minSpins={4}
                  prizeSize={154}
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
                <span>{stage === "rolling" ? "正在抽選…" : "抽出我的獎品"}</span><Sparkles size={20} />
              </button>
              <p className={styles.drawFootnote}>按下後請不要關閉此頁面，動畫結束就會看到結果</p>
            </div>
          )}

          {stage === "result" && result && event && (
            <div className={styles.resultPanel}>
              <div className={styles.confetti} aria-hidden>{Array.from({ length: 12 }, (_, i) => <i key={i} style={{ "--i": i } as React.CSSProperties} />)}</div>
              <div className={styles.resultKicker}><Check size={15} /> 抽獎完成・第 {result.draw_number} 位</div>
              <p className={styles.resultTier}>{result.prize_tier}賞</p>
              <h2>{result.prize_name}</h2>
              <p className={styles.resultCopy}>恭喜你！請帶著這個畫面到兌獎桌領取獎品。</p>
              <div className={styles.resultTicket}><span>獎品序號</span><strong>#{String(result.draw_number).padStart(3, "0")}</strong><span>請向工作人員出示</span></div>
              <button className={styles.textButton} type="button" onClick={clearLocalSession}><RotateCcw size={14} /> 切換另一場活動</button>
            </div>
          )}
        </div>
      </section>
      <footer className={styles.footer}><span>有問題？請直接詢問現場工作人員</span><span>本頁適合平板與手機使用</span></footer>
    </main>
  );
}
