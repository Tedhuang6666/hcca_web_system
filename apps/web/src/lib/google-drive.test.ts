import { describe, expect, it } from "vitest";

import { googleDrivePreviewUrl, isGoogleDriveUrl } from "./google-drive";

const ID = "1AbCdEfGhIjKlMnOp_q-rs";

describe("googleDrivePreviewUrl", () => {
  it("converts Docs, Sheets, Slides and Drive files to preview URLs", () => {
    expect(googleDrivePreviewUrl(`https://docs.google.com/document/d/${ID}/edit?usp=sharing`))
      .toBe(`https://docs.google.com/document/d/${ID}/preview`);
    expect(googleDrivePreviewUrl(`https://docs.google.com/spreadsheets/d/${ID}/edit#gid=0`))
      .toBe(`https://docs.google.com/spreadsheets/d/${ID}/preview`);
    expect(googleDrivePreviewUrl(`https://drive.google.com/file/d/${ID}/view`))
      .toBe(`https://drive.google.com/file/d/${ID}/preview`);
    expect(googleDrivePreviewUrl(`https://drive.google.com/drive/folders/${ID}`))
      .toBe(`https://drive.google.com/embeddedfolderview?id=${ID}#list`);
    expect(googleDrivePreviewUrl(`https://docs.google.com/forms/d/${ID}/viewform`))
      .toBe(`https://docs.google.com/forms/d/${ID}/viewform?embedded=true`);
  });

  it("rejects other hosts, http and unknown paths", () => {
    expect(googleDrivePreviewUrl(`https://evil.example/document/d/${ID}/edit`)).toBeNull();
    expect(googleDrivePreviewUrl(`https://docs.google.com.evil.example/document/d/${ID}`)).toBeNull();
    expect(googleDrivePreviewUrl(`http://docs.google.com/document/d/${ID}/edit`)).toBeNull();
    expect(googleDrivePreviewUrl("https://docs.google.com/document/u/0/")).toBeNull();
    expect(googleDrivePreviewUrl(`https://docs.google.com/document/d/${ID}"onload=x/edit`)).toBeNull();
    expect(googleDrivePreviewUrl("/uploads/file.pdf")).toBeNull();
    expect(googleDrivePreviewUrl(null)).toBeNull();
  });

  it("flags Google links for the collaboration badge", () => {
    expect(isGoogleDriveUrl(`https://drive.google.com/file/d/${ID}/view`)).toBe(true);
    expect(isGoogleDriveUrl("https://example.com")).toBe(false);
  });
});
