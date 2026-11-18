/** 全站一致的減速曲線；與深淺色切換的擴散動畫相同。 */
export const MOTION_EASE_OUT = "cubic-bezier(0.16, 1, 0.3, 1)";

/** 收合、離場用的加速曲線：離開比進場快，結束時不拖尾。 */
export const MOTION_EASE_IN = "cubic-bezier(0.32, 0, 0.67, 0)";

/** 系統偏好或站內無障礙設定要求減少動態時，空間位移改為直接切換。 */
export function shouldReduceMotion(): boolean {
  if (typeof window === "undefined") return true;
  return document.documentElement.getAttribute("data-a11y-motion") === "true"
    || (typeof window.matchMedia === "function"
      && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
}

/** 以 (x, y) 為圓心、覆蓋整個矩形所需的半徑。 */
export function coverRadius(rect: DOMRect, x: number, y: number): number {
  return Math.hypot(
    Math.max(x - rect.left, rect.right - x),
    Math.max(y - rect.top, rect.bottom - y),
  );
}

type ActionPoint = { x: number; y: number; at: number };
let lastPointer: ActionPoint | null = null;

if (typeof window !== "undefined") {
  // 捕獲階段記下最近一次按下的位置，讓之後打開的對話框能從那裡展開。
  window.addEventListener("pointerdown", (event) => {
    lastPointer = { x: event.clientX, y: event.clientY, at: performance.now() };
  }, { capture: true, passive: true });
}

/**
 * 使用者剛剛操作的位置：近期的指標按下點，否則是目前焦點元素（鍵盤開啟時）的中心。
 * 都沒有時回傳 null，例如對話框是自動跳出的。
 */
export function recentActionPoint(maxAgeMs = 900): { x: number; y: number } | null {
  if (typeof window === "undefined") return null;
  if (lastPointer && performance.now() - lastPointer.at <= maxAgeMs) {
    return { x: lastPointer.x, y: lastPointer.y };
  }
  const focused = document.activeElement;
  if (focused instanceof HTMLElement && focused !== document.body) {
    const rect = focused.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    }
  }
  return null;
}
