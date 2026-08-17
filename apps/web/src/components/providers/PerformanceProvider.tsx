"use client";

import {
  createContext,
  Profiler,
  type ProfilerOnRenderCallback,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
} from "react";
import { createProfilerCallback, getPerformanceMonitor } from "@/lib/performance-monitor";

interface PerformanceContextValue {
  monitor: ReturnType<typeof getPerformanceMonitor>;
  profilerEnabled: boolean;
}

const PerformanceContext = createContext<PerformanceContextValue | null>(null);

interface PerformanceProviderProps {
  children: ReactNode;
  /** 是否啟用 React Profiler（預設只在開發模式啟用） */
  enableProfiler?: boolean;
  /** Profiler 採樣率 0-1（預設 1.0） */
  profilerSampleRate?: number;
  /** 是否在開發模式下輸出效能摘要到 console */
  devLogEnabled?: boolean;
  /** 自定義根元件名稱 */
  rootName?: string;
}

export default function PerformanceProvider({
  children,
  enableProfiler = process.env.NODE_ENV === "development",
  profilerSampleRate = process.env.NODE_ENV === "development" ? 1 : 0.1,
  devLogEnabled = process.env.NODE_ENV === "development",
  rootName = "App",
}: PerformanceProviderProps) {
  const monitor = useMemo(() => getPerformanceMonitor(), []);
  const profilerCallback = useMemo<ProfilerOnRenderCallback>(
    () => createProfilerCallback(rootName),
    [rootName],
  );

  useEffect(() => {
    monitor.setEnabled(true);
    monitor.setSampleRate(profilerSampleRate);

    const handleBeforeUnload = () => monitor.flush({ unload: true });
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [monitor, profilerSampleRate]);

  useEffect(() => {
    if (!devLogEnabled) return;
    const timer = window.setInterval(() => {
      const metrics = monitor.getAllMetrics();
      const slowComponents = metrics.component.filter((item) => item.avgRenderTime > 16);
      if (slowComponents.length > 0) {
        console.group("Slow components (avg > 16ms)");
        console.table(slowComponents);
        console.groupEnd();
      }
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [devLogEnabled, monitor]);

  const value = useMemo(
    () => ({ monitor, profilerEnabled: enableProfiler }),
    [enableProfiler, monitor],
  );

  const content = enableProfiler ? (
    <Profiler id={rootName} onRender={profilerCallback}>
      {children}
    </Profiler>
  ) : (
    children
  );

  return <PerformanceContext.Provider value={value}>{content}</PerformanceContext.Provider>;
}

export function usePerformanceMonitor(): PerformanceContextValue {
  const context = useContext(PerformanceContext);
  if (context) return context;
  return { monitor: getPerformanceMonitor(), profilerEnabled: false };
}
