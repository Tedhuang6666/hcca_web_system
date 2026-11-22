import type { EmailMessageCreate, EmailRecipientVariableInput } from "@/lib/types";

export type PaymentReminderKind = "orders" | "class_representatives";

export function buildPaymentReminderDraft(
  kind: PaymentReminderKind,
  recipients: EmailRecipientVariableInput[],
): EmailMessageCreate {
  const isOrderReminder = kind === "orders";
  const variableDefinitions = isOrderReminder
    ? [
        { key: "order_details", label: "待繳訂單", required: true, default_value: "" },
        { key: "unpaid_total", label: "待繳金額", required: true, default_value: "" },
        { key: "order_count", label: "訂單數", required: true, default_value: "" },
      ]
    : [
        { key: "class_details", label: "班級與未確認金額", required: true, default_value: "" },
        { key: "unpaid_total", label: "未確認合計", required: true, default_value: "" },
        { key: "class_count", label: "班級數", required: true, default_value: "" },
      ];
  const heading = isOrderReminder ? "商品訂單繳款提醒" : "班級商品款項提醒";
  const body = isOrderReminder
    ? "<p>{{ 姓名 }}同學您好：</p><p>系統目前尚未記錄以下商品訂單已繳款：</p><p>{{ order_details }}</p><p>待繳合計：{{ unpaid_total }}（{{ order_count }} 筆訂單）</p><p>若已完成繳款，請先與班代確認收款紀錄；如紀錄有誤，請聯絡班聯會。</p>"
    : "<p>{{ 姓名 }}班代您好：</p><p>系統目前尚未記錄班聯確認以下班級商品款項：</p><p>{{ class_details }}</p><p>未確認合計：{{ unpaid_total }}（{{ class_count }} 個班級）</p><p>請核對收款紀錄與交款狀態；若款項已交班聯，請確認是否已完成入帳。</p>";

  return {
    action: "draft",
    subject: heading,
    heading,
    preview_text: isOrderReminder
      ? "請核對尚未記錄繳款的商品訂單。"
      : "請核對班聯尚未確認的班級商品款項。",
    accent_color: "#111827",
    background_color: "#eef2f7",
    content_background_color: "#ffffff",
    body_line_height: 1.6,
    paragraph_spacing: 18,
    footer_text: "如已完成繳款，請先與班代或班聯確認系統收款紀錄。",
    show_system_footer: true,
    banner_image_url: "",
    banner_image_alt: "",
    body,
    card_rows: [],
    cta_label: "",
    cta_url: "",
    buttons: [],
    blocks: [],
    recipients: {
      user_ids: recipients.flatMap((recipient) => recipient.user_id ? [recipient.user_id] : []),
      position_ids: [],
      org_ids: [],
      external_emails: [],
      include_all: false,
      include_school: false,
    },
    variable_definitions: variableDefinitions,
    conditional_rules: [],
    default_variables: {},
    recipient_variables: recipients,
    preview_variables: recipients[0]?.variables ?? {},
    preview_recipient: recipients[0] ?? null,
    template_id: null,
    recipient_list_id: null,
    attachment_ids: [],
    track_opens: true,
    track_clicks: true,
  };
}
