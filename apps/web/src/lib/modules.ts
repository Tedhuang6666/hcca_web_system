// 模組 metadata 已集中於 route-manifest.ts；本檔保留既有 import 介面。
import { MODULE_MANIFEST } from "./route-manifest";

export type ModuleId = keyof typeof MODULE_MANIFEST;
export type FeModuleSpec = (typeof MODULE_MANIFEST)[ModuleId];
export const FE_MODULES: Record<ModuleId, FeModuleSpec> = MODULE_MANIFEST;

const ROUTE_INDEX: Array<[string, ModuleId]> = Object.entries(FE_MODULES)
  .flatMap(([id, spec]) => spec.routePrefixes.map((prefix) => [prefix, id as ModuleId] as [string, ModuleId]))
  .sort((a, b) => b[0].length - a[0].length);

export function moduleForPath(pathname: string): ModuleId | null {
  for (const [prefix, id] of ROUTE_INDEX) {
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) return id;
  }
  return null;
}

export const NAV_ID_TO_MODULE: Record<string, ModuleId> = Object.entries(FE_MODULES).reduce(
  (result, [id, spec]) => {
    for (const navId of spec.navIds) result[navId] = id as ModuleId;
    return result;
  },
  {} as Record<string, ModuleId>,
);
