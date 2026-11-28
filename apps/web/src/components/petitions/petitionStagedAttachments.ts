export type UploadedStagedAttachment = { file: File; id: string };

export async function uploadStagedAttachments(
  caseId: string,
  files: File[],
  uploadedFiles: UploadedStagedAttachment[],
  upload: (caseId: string, file: File) => Promise<{ id: string }>,
  onUploaded: (files: UploadedStagedAttachment[]) => void,
): Promise<string[]> {
  let staged = [...uploadedFiles];
  const ids: string[] = [];

  for (const file of files) {
    const existing = staged.find((item) => item.file === file);
    if (existing) {
      ids.push(existing.id);
      continue;
    }

    const attachment = await upload(caseId, file);
    ids.push(attachment.id);
    staged = [...staged, { file, id: attachment.id }];
    onUploaded(staged);
  }

  return ids;
}
