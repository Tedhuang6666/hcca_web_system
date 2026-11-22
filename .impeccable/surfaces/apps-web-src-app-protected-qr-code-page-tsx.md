---
version: 1
slug: "apps-web-src-app-protected-qr-code-page-tsx"
primary_target: "apps/web/src/app/(protected)/qr-code/page.tsx"
related_targets: ["apps/web/src/app/(protected)/qr-code/MarketingToolsWorkspace.tsx","apps/web/src/app/(protected)/qr-code/ShortLinksManager.tsx","apps/web/src/app/(protected)/qr-code/QrCodeGenerator.tsx","apps/web/src/app/(protected)/qr-code/qr-code.css"]
---

Scope: Protected `/qr-code` workspace for short-link management and QR generation on one route. This is an extension of the existing QR tool.

Mode: Operate.

Audience: Student-government staff who prepare campus announcements and event materials. They need a reliable share URL and a ready-to-publish QR without switching tools.

Primary job: Maintain memorable short URLs and turn an active short URL into a QR Code for print or digital sharing.

Primary actions: Create a short URL from a fixed custom path and an HTTP(S) destination; copy, edit, disable, or re-enable entries; choose “製作 QR Code” on an active entry to open the QR tab with that short URL prefilled; customize and download the QR output.

Content hierarchy: Page purpose and peer tabs; short-link creation form; managed-link list with name, active state, short URL, destination, and actions. The QR tab keeps the live preview and its content/settings controls together. Label the short URL and destination as distinct values.

Selected direction: Keep both jobs in one “經營工具” workspace. Short links are the shareable source record; QR generation is the next action on an active record. Use the existing protected app shell and QR tool’s field, panel, button, and feedback patterns rather than introducing a second visual language.

Responsive behavior: Keep the two-column short-link form and inline row actions on wider screens; on narrow screens use a single-column form, full-width tabs, stacked link rows, and a two-column action grid. Keep the QR preview and settings usable in the existing single-column mobile layout.

Constraints: Preserve `qr_code:manage` access, explicit loading/empty/error/success feedback, and active/inactive meaning. A created path stays fixed when editing; inactive links cannot launch QR generation. QR content is generated locally and is not uploaded. Keep the QR generator usable for arbitrary text and URLs as well as selected short links.

Memorable moment: One “製作 QR Code” action carries the exact active public short URL into the QR editor and updates its preview.

Unresolved decisions: None within this extension.
