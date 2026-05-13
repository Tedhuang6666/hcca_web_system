import dynamic from "next/dynamic";
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
  return dynamic(importFn as any, {
    ssr: true,
    loading: () => <div className="animate-pulse" />,
  }) as ComponentType<P>;
}
