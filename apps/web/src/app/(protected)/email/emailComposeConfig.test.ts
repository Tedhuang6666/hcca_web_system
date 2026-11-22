import { describe, expect, it } from "vitest";
import {
  buildRecipientVariablesFromRows,
  countAdditionalRecipientRows,
  EMPTY_RECIPIENTS,
} from "./emailComposeConfig";

describe("buildRecipientVariablesFromRows", () => {
  it("keeps account recipients without an email address and only declared fields", () => {
    const result = buildRecipientVariablesFromRows(
      [
        {
          userId: "student-user-id",
          email: "",
          name: "王小明",
          variables: { unpaid_total: "NT$500", ignored: "不要帶入" },
        },
        { email: "family@example.com", name: "家長", variables: { unpaid_total: "NT$200" } },
        { email: "", name: "空白列", variables: {} },
      ],
      [{ key: "unpaid_total", label: "待繳金額", required: false, default_value: "" }],
    );

    expect(result).toEqual([
      {
        user_id: "student-user-id",
        email: null,
        name: "王小明",
        variables: { unpaid_total: "NT$500" },
      },
      {
        user_id: null,
        email: "family@example.com",
        name: "家長",
        variables: { unpaid_total: "NT$200" },
      },
    ]);
  });
});

describe("countAdditionalRecipientRows", () => {
  it("does not count selected accounts or external emails twice", () => {
    expect(
      countAdditionalRecipientRows(
        [
          { userId: "selected-user", email: "", name: "王小明", variables: {} },
          { email: " Parent@Example.com ", name: "家長", variables: {} },
          { email: "other@example.com", name: "訪客", variables: {} },
          { email: "other@example.com", name: "重複訪客", variables: {} },
        ],
        {
          ...EMPTY_RECIPIENTS,
          user_ids: ["selected-user"],
          external_emails: ["parent@example.com"],
        },
      ),
    ).toBe(1);
  });
});
