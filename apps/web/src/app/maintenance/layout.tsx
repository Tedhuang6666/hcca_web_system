// The maintenance page must be rendered per request so proxy.ts can provide
// a CSP nonce that also appears on Next.js inline bootstrap scripts.
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function MaintenanceLayout({ children }: { children: React.ReactNode }) {
  return children;
}
