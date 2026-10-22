/** Sanitize srcdoc content and authorize its styles under the parent page's CSP. */
export async function prepareEmailPreviewHtml(html: string): Promise<string> {
  const { default: DOMPurify } = await import("dompurify");
  const nonce = document.querySelector<HTMLScriptElement>("script[nonce]")?.nonce;
  const escapedNonce = nonce?.replaceAll("&", "&amp;").replaceAll('"', "&quot;");
  // DOMParser also checks CSP in detached documents. Add the style nonce before
  // DOMPurify parses, then sanitize the entire result, including these attributes.
  const prepared = escapedNonce
    ? html.replace(/<style(?=[\s/>])[\s\S]*?(?:<\/style\s*>|$)/gi, (style) =>
        style.replace(/^<style/i, `<style nonce="${escapedNonce}"`),
      )
    : html;
  return DOMPurify.sanitize(prepared, {
    WHOLE_DOCUMENT: true,
    ADD_ATTR: ["nonce"],
    FORBID_TAGS: ["base", "embed", "form", "iframe", "meta", "object", "script"],
  });
}
