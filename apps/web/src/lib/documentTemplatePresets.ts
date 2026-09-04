import type { DocumentCategory, DocumentTemplateCreate } from "@/lib/types";

export type DocumentTemplatePreset = {
  id: string;
  name: string;
  description: string;
  category: DocumentCategory;
  values: Partial<DocumentTemplateCreate>;
};

/** 常用公文起稿骨架；套用後仍需依實際案件補齊占位符。 */
export const DOCUMENT_TEMPLATE_PRESETS: readonly DocumentTemplatePreset[] = [
  {
    id: "consultation-president-nomination",
    name: "咨｜提名院長同意權",
    description: "兩段式咨文：說明憲法依據、提名事項與隨咨檢送文件。",
    category: "consultation",
    values: {
      category: "consultation",
      subject:
        "茲依據中華民國憲法增修條文第○條第○項規定，提名○○○為第○屆○○院委員並為院長，咨請貴院行使同意權。",
      doc_description:
        "隨咨檢送○○○先生（女士）最高學歷、主要經歷、著作、重要表現及各項證明文件等檔案各1冊。",
      action_required: null,
      handler_unit: "總統",
      recipients: [{ recipient_type: "main", name: "立法院", delivery_method: "none" }],
    },
  },
  {
    id: "letter-assistance-request",
    name: "函｜請求協助或核定",
    description: "適用於向校內組織提出協助、核定或回覆請求。",
    category: "letter",
    values: {
      category: "letter",
      subject: "為辦理○○事項，請惠予協助，請查照。",
      doc_description: "一、依據：○○規定或會議決議。\n二、辦理情形：說明目前進度與需要協助的原因。",
      action_required: "一、請於○○年○○月○○日前回覆。\n二、如有疑義，請洽承辦人。",
    },
  },
  {
    id: "announcement-campus-affair",
    name: "公告｜校園自治事項",
    description: "適用於活動、選務、制度或其他需要公開周知的事項。",
    category: "announcement",
    values: {
      category: "announcement",
      subject: "公告本會辦理○○事項，請查照。",
      basis: "依○○規定及○○會議決議辦理。",
      doc_description: "一、辦理時間：\n二、辦理地點：\n三、參與對象：\n四、注意事項：",
      action_required: null,
    },
  },
  {
    id: "meeting-notice-regular",
    name: "開會通知單｜例行會議",
    description: "預填例行會議所需欄位，建立草稿後再補上時間與出席名單。",
    category: "meeting_notice",
    values: {
      category: "meeting_notice",
      meeting_purpose: "召開○○組織第○屆第○次例行會議。",
      meeting_location: "○○會議室",
      doc_description: "一、主席致詞。\n二、工作報告。\n三、討論提案。\n四、臨時動議。",
      action_required: "請出席人員準時與會。",
    },
  },
  {
    id: "signature-review",
    name: "簽｜案件簽核",
    description: "適用於將背景、依據與擬辦事項送請主管核示。",
    category: "signature",
    values: {
      category: "signature",
      subject: "簽請核示○○事項。",
      doc_description: "一、案由：\n二、依據：\n三、辦理情形：",
      action_required: "一、擬請核示。\n二、奉核後依示辦理。",
    },
  },
];
