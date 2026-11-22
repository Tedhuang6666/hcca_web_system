import type { ReactNode } from "react";
import PublicRouteShell from "./PublicRouteShell";
import "./administrative.css";

/** 僅限定查詢與閱讀內容樣式；頁首頁尾、字體及導覽沿用全站。 */
export default function AdministrativeRouteShell({ children }: { children: ReactNode }) {
  return (
    <PublicRouteShell>
      <div className="administrative-content">{children}</div>
    </PublicRouteShell>
  );
}
