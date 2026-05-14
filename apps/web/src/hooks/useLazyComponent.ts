import dynamic from "next/dynamic";
import { createElement } from "react";
import type { ComponentType } from "react";

/**
 * Hook for lazy-loading components to reduce initial bundle size.
 * Useful for conditional/modal components that aren't always visible.
 *
 * Usage:
 *   const HeavyDialog = useLazyComponent(() => import('@/components/HeavyDialog'));
 *   {isOpen && <HeavyDialog onClose={...} />}
 */
export function useLazyComponent<P extends object>(
  importFn: () => Promise<{ default: ComponentType<P> }>
): ComponentType<P> {
  return dynamic<P>(importFn, {
    ssr: true,
    loading: () => createElement("div", { className: "animate-pulse" }),
  }) as ComponentType<P>;
}
