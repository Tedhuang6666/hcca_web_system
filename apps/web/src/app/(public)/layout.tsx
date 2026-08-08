import PublicEnhancements from "@/components/site/PublicEnhancements";
import "../public-design-system.css";
import "./public-home.css";

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <PublicEnhancements />
      {children}
    </>
  );
}
