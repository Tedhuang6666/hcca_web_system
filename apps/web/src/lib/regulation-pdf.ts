import type { RegulationOut } from "@/lib/types";

const CURRENT_CHARTER_TITLE = "國立新竹高級中學班級聯合自治會組織章程";
const CURRENT_CHARTER_PDF_URL =
  "https://drive.google.com/uc?export=download&id=1GJlHJA81yF4q14Ak0XJZKFPFEt_VYbFi";

type RegulationPdfTarget = Pick<
  RegulationOut,
  "title" | "is_active" | "is_repealed" | "workflow_status" | "published_at"
>;

export function directRegulationPdfUrl(regulation: RegulationPdfTarget): string | null {
  if (
    regulation.title !== CURRENT_CHARTER_TITLE
    || !regulation.is_active
    || regulation.is_repealed
    || regulation.workflow_status !== "published"
    || !regulation.published_at
  ) {
    return null;
  }

  return CURRENT_CHARTER_PDF_URL;
}
