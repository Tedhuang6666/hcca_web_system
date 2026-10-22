import { describe, expect, it } from "vitest";

import { prepareEmailPreviewHtml } from "./email-preview";

describe("email preview", () => {
  it("uses the current page nonce for every preview style", async () => {
    const script = document.createElement("script");
    script.nonce = "current-page-nonce";
    document.head.append(script);
    try {
      const html = await prepareEmailPreviewHtml(`<!doctype html><html><head>
        <style nonce="untrusted">p { color: red }</style>
        <style>@media (max-width: 600px) { p { font-size: 18px } }</style>
        </head><body><p>信件預覽</p></body></html>`);
      const preview = new DOMParser().parseFromString(html, "text/html");

      expect([...preview.querySelectorAll("style")].map((style) => style.nonce)).toEqual([
        "current-page-nonce", "current-page-nonce",
      ]);
      expect(preview.querySelector("p")?.textContent).toBe("信件預覽");
    } finally {
      script.remove();
    }
  });

  it("still removes active content and dangerous URLs when granting a style nonce", async () => {
    const script = document.createElement("script");
    script.nonce = "current-page-nonce";
    document.head.append(script);
    try {
      const html = await prepareEmailPreviewHtml(`<html><head>
      <script>alert(1)</script><base href="https://external.example">
      <meta http-equiv="refresh" content="0;url=https://external.example">
      <style>p { color: red }</style></head><body>
      <form><input name="secret"></form><iframe src="https://external.example"></iframe>
      <object data="https://external.example"></object><embed src="https://external.example">
      <p onclick="alert(1)">安全內容</p><a href="javascript:alert(1)">連結</a>
      </body></html>`);
      const preview = new DOMParser().parseFromString(html, "text/html");

      expect(preview.querySelector("script,base,meta,form,iframe,object,embed,[onclick]")).toBeNull();
      expect(preview.querySelector("a")?.getAttribute("href")).toBeNull();
      expect(preview.querySelector("style")?.nonce).toBe("current-page-nonce");
      expect(preview.querySelector("p")?.textContent).toBe("安全內容");
    } finally {
      script.remove();
    }
  });

  it("also sanitizes previews on pages without a nonce", async () => {
    const html = await prepareEmailPreviewHtml("<html><head><style>p{color:red}</style></head><body><p>信件</p></body></html>");
    const preview = new DOMParser().parseFromString(html, "text/html");

    expect(preview.querySelector("style")?.nonce).toBe("");
    expect(preview.querySelector("p")?.textContent).toBe("信件");
  });
});
