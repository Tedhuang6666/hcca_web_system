import { describe, expect, it } from "vitest";
import { buildPaymentReminderDraft } from "./paymentReminderDraft";

describe("buildPaymentReminderDraft", () => {
  it.each([
    ["orders", "商品訂單繳款提醒", "order_details"],
    ["class_representatives", "班級商品款項提醒", "class_details"],
  ] as const)("creates an editable individualized %s draft", (kind, subject, variableKey) => {
    const draft = buildPaymentReminderDraft(kind, [
      {
        user_id: "recipient-user-id",
        name: "王小明",
        variables: { [variableKey]: "高一一班：NT$500", unpaid_total: "NT$500" },
      },
    ]);

    expect(draft.action).toBe("draft");
    expect(draft.subject).toBe(subject);
    expect(draft.recipients?.user_ids).toEqual(["recipient-user-id"]);
    expect(draft.recipient_variables?.[0]).toMatchObject({
      user_id: "recipient-user-id",
      name: "王小明",
      variables: { [variableKey]: "高一一班：NT$500", unpaid_total: "NT$500" },
    });
    expect(draft.preview_recipient?.user_id).toBe("recipient-user-id");
  });
});
