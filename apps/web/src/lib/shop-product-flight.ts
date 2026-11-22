export function shouldAnimateProductFlight(reducedMotion: boolean, compactPortrait: boolean) {
  return !reducedMotion && !compactPortrait;
}

export function cleanupAnimatedElement(
  element: HTMLElement,
  animation: Animation,
  fallbackDelay: number,
) {
  let cleanedUp = false;
  const cleanup = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    window.clearTimeout(timer);
    element.remove();
  };

  const timer = window.setTimeout(cleanup, fallbackDelay);
  animation.addEventListener("finish", cleanup, { once: true });
  animation.addEventListener("cancel", cleanup, { once: true });
}
