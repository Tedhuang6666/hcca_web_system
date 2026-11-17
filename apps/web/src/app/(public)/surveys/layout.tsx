import "./survey-motion.css";

import PublicRouteShell from "@/components/site/PublicRouteShell";

export default function PublicSurveysLayout({ children }: { children: React.ReactNode }) {
  return <PublicRouteShell>{children}</PublicRouteShell>;
}
