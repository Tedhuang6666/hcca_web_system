import type { PublicSpecialAgreementContent, PublicSpecialAgreementStep } from "./types";

export const DEFAULT_SPECIAL_AGREEMENT_CONTENT: PublicSpecialAgreementContent = {
  intro_md: "如果你想和學生自治組織一起提供更好的校園服務，這裡整理了從提出構想到公開合作資訊的完整路徑。",
  info_md: `## 適合洽談的合作

可依合作對象與學生需求討論不同形式，例如：

- 學生消費優惠或服務方案
- 校園活動、講座與公共議題合作
- 提供學生自治組織使用的場地、資源或專業支持
- 其他有助於校園公共參與與學生生活的合作內容

## 洽談前請準備

為了讓第一次聯絡就能聚焦，建議先整理以下資訊：

- 合作單位與聯絡窗口
- 希望合作的對象、期間與適用範圍
- 優惠或服務的具體內容、使用限制與兌換方式
- 希望班聯會協助的事項，以及可提供的宣傳素材

## 公開與執行原則

特約資訊會以學生容易理解、可以實際使用為原則整理。正式發布前，雙方會再次確認：

1. 文字是否與實際方案一致
2. 期限、適用對象與使用條件是否清楚
3. 聯絡方式與後續異動由誰負責更新

> 若方案內容、期限或使用方式有變動，請儘早通知班聯會，以便同步更新公開資訊。`,
  process: [
    { id: "proposal", title: "提出合作構想", description: "先說明合作對象、希望提供的內容，以及對學生的幫助。" },
    { id: "conversation", title: "初步洽談", description: "雙方確認需求、合作範圍、期間與聯絡窗口。" },
    { id: "confirmation", title: "確認合作內容", description: "整理優惠或服務細節，確認公開文字與執行方式。" },
    { id: "publication", title: "發布特約資訊", description: "完成確認後，將合作內容放上公開平台，方便學生查詢。" },
  ],
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function readStep(value: unknown, index: number): PublicSpecialAgreementStep | null {
  if (!isRecord(value)) return null;
  const title = typeof value.title === "string" ? value.title.trim() : "";
  const description = typeof value.description === "string" ? value.description.trim() : "";
  if (!title || !description) return null;
  const id = typeof value.id === "string" && value.id.trim() ? value.id.trim() : `step-${index + 1}`;
  return { id, title, description };
}

export function readSpecialAgreementContent(value: unknown): PublicSpecialAgreementContent {
  if (!isRecord(value)) return DEFAULT_SPECIAL_AGREEMENT_CONTENT;

  const process = Array.isArray(value.process)
    ? value.process.flatMap((step, index) => {
        const parsed = readStep(step, index);
        return parsed ? [parsed] : [];
      })
    : DEFAULT_SPECIAL_AGREEMENT_CONTENT.process;

  return {
    intro_md:
      typeof value.intro_md === "string" && value.intro_md.trim()
        ? value.intro_md
        : DEFAULT_SPECIAL_AGREEMENT_CONTENT.intro_md,
    info_md:
      typeof value.info_md === "string" && value.info_md.trim()
        ? value.info_md
        : DEFAULT_SPECIAL_AGREEMENT_CONTENT.info_md,
    process,
  };
}
