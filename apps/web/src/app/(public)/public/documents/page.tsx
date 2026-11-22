import { permanentRedirect } from "next/navigation";

export default function PublicDocumentsPage() {
  permanentRedirect("/documents");
}
