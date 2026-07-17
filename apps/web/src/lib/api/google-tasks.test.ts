import { describe, expect, it } from "vitest";

import { googleTasksApi } from "./google-tasks";

describe("googleTasksApi.authorizeUrl", () => {
  it("uses the frontend API proxy when no public API URL is configured", () => {
    expect(googleTasksApi.authorizeUrl()).toBe("/api/user/google-tasks/authorize");
  });
});
