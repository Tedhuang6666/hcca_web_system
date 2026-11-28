import { describe, expect, it, vi } from "vitest";
import { uploadStagedAttachments, type UploadedStagedAttachment } from "./petitionStagedAttachments";

describe("uploadStagedAttachments", () => {
  it("uploads all selected files and reuses completed uploads on retry", async () => {
    const first = new File(["a"], "說明.pdf");
    const second = new File(["b"], "照片.png");
    const upload = vi.fn()
      .mockResolvedValueOnce({ id: "attachment-1" })
      .mockResolvedValueOnce({ id: "attachment-2" });
    let staged: UploadedStagedAttachment[] = [];
    const recordUploads = (files: UploadedStagedAttachment[]) => { staged = files; };
    const ids = await uploadStagedAttachments("case-1", [first, second], [], upload, recordUploads);
    const retriedIds = await uploadStagedAttachments("case-1", [first, second], staged, upload, recordUploads);

    expect(ids).toEqual(["attachment-1", "attachment-2"]);
    expect(retriedIds).toEqual(ids);
    expect(upload).toHaveBeenCalledTimes(2);
  });

  it("retains earlier uploads when a later file fails", async () => {
    const first = new File(["a"], "說明.pdf");
    const second = new File(["b"], "照片.png");
    const upload = vi.fn()
      .mockResolvedValueOnce({ id: "attachment-1" })
      .mockRejectedValueOnce(new Error("network error"));
    const onUploaded = vi.fn();

    await expect(uploadStagedAttachments("case-1", [first, second], [], upload, onUploaded))
      .rejects.toThrow("network error");

    expect(onUploaded).toHaveBeenCalledWith([{ file: first, id: "attachment-1" }]);
  });
});
