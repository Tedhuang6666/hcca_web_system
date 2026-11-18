/** 全站一致的減速曲線；與深淺色切換的擴散動畫相同。 */
export const MOTION_EASE_OUT = "cubic-bezier(0.16, 1, 0.3, 1)";

/** 收合、離場用的加速曲線：離開比進場快，結束時不拖尾。 */
export const MOTION_EASE_IN = "cubic-bezier(0.32, 0, 0.67, 0)";

/** 系統偏好或站內無障礙設定要求減少動態時，空間位移改為直接切換。 */
export function shouldReduceMotion(): boolean {
  if (typeof window === "undefined") return true;
  return document.documentElement.getAttribute("data-a11y-motion") === "true"
    || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** 以 (x, y) 為圓心、覆蓋整個矩形所需的半徑。 */
export function coverRadius(rect: DOMRect, x: number, y: number): number {
  return Math.hypot(
    Math.max(x - rect.left, rect.right - x),
    Math.max(y - rect.top, rect.bottom - y),
  );
}
