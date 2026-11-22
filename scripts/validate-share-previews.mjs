const DEFAULT_URL = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000/";

const PLATFORM_REQUIREMENTS = {
  Facebook: ["og:type", "og:title", "og:description", "og:url", "og:site_name", "og:image"],
  LINE: ["og:title", "og:description", "og:image"],
  X: ["twitter:card", "twitter:title", "twitter:description", "twitter:image"],
};

function urlsFromArgs() {
  const values = [];
  const args = process.argv.slice(2);

  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--url" && args[index + 1]) {
      values.push(args[index + 1]);
      index += 1;
    }
  }

  if (values.length > 0) return values;
  if (process.env.SHARE_PREVIEW_URLS) {
    return process.env.SHARE_PREVIEW_URLS.split(/[\s,]+/).filter(Boolean);
  }
  return [DEFAULT_URL];
}

function decodeHtml(value) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function metadataFromHtml(html) {
  const metadata = new Map();
  const tags = html.match(/<meta\b[^>]*>/gi) || [];

  for (const tag of tags) {
    const attributes = {};
    const attributePattern = /([:\w-]+)\s*=\s*(["'])(.*?)\2/gi;
    for (const match of tag.matchAll(attributePattern)) {
      attributes[match[1].toLowerCase()] = decodeHtml(match[3]);
    }

    const key = attributes.property || attributes.name;
    if (key && attributes.content) metadata.set(key.toLowerCase(), attributes.content);
  }

  return metadata;
}

function pngDimensions(buffer) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (buffer.length < 24 || !buffer.subarray(0, 8).equals(signature)) return null;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

async function fetchImage(imageUrl) {
  const response = await fetch(imageUrl, {
    headers: { "user-agent": "HCCA-share-preview-validator/1.0" },
  });
  if (!response.ok) throw new Error(`圖片回應 ${response.status}`);

  const buffer = Buffer.from(await response.arrayBuffer());
  const dimensions = pngDimensions(buffer);
  if (!dimensions) throw new Error("OG 圖不是有效 PNG");
  if (dimensions.width !== 1200 || dimensions.height !== 630) {
    throw new Error(`OG 圖尺寸為 ${dimensions.width}×${dimensions.height}，預期 1200×630`);
  }
  if (!response.headers.get("content-type")?.toLowerCase().includes("image/png")) {
    throw new Error("OG 圖 Content-Type 不是 image/png");
  }
}

function imageUrlForValidation(imageUrl, pageUrl) {
  const resolvedUrl = new URL(imageUrl, pageUrl);
  const localBase = process.env.SHARE_PREVIEW_IMAGE_BASE_URL?.trim();
  if (!localBase) return resolvedUrl;

  return new URL(`${resolvedUrl.pathname}${resolvedUrl.search}`, new URL(localBase));
}

function normalizedMetadataImageUrl(imageUrl, pageUrl) {
  const url = new URL(imageUrl, pageUrl);
  // Next.js appends this content hash to its generated metadata-image route.
  if (url.pathname === "/opengraph-image" && /^[a-f0-9]{16}$/i.test(url.search.slice(1))) {
    url.search = "";
  }
  return url.href;
}

async function validateUrl(pageUrl) {
  const response = await fetch(pageUrl, {
    headers: { "user-agent": "HCCA-share-preview-validator/1.0" },
  });
  if (!response.ok) throw new Error(`頁面回應 ${response.status}`);

  const html = await response.text();
  const metadata = metadataFromHtml(html);
  const failures = [];

  for (const [platform, requiredKeys] of Object.entries(PLATFORM_REQUIREMENTS)) {
    const missing = requiredKeys.filter((key) => !metadata.get(key));
    if (missing.length > 0) failures.push(`${platform} 缺少 ${missing.join(", ")}`);
  }

  if (metadata.get("twitter:card") !== "summary_large_image") {
    failures.push('X 的 twitter:card 必須為 "summary_large_image"');
  }

  const imageUrl = metadata.get("og:image");
  const twitterImageUrl = metadata.get("twitter:image");
  if (
    imageUrl &&
    twitterImageUrl &&
    normalizedMetadataImageUrl(twitterImageUrl, pageUrl) !==
      normalizedMetadataImageUrl(imageUrl, pageUrl)
  ) {
    failures.push("og:image 與 twitter:image 指向不同圖片");
  }

  const validationImageUrl = imageUrl && imageUrlForValidation(imageUrl, pageUrl);
  if (validationImageUrl) await fetchImage(validationImageUrl);
  if (metadata.get("og:image:width") && metadata.get("og:image:width") !== "1200") {
    failures.push("og:image:width 必須為 1200");
  }
  if (metadata.get("og:image:height") && metadata.get("og:image:height") !== "630") {
    failures.push("og:image:height 必須為 630");
  }

  if (failures.length > 0) throw new Error(failures.join("；"));
  return {
    title: metadata.get("og:title"),
    image: validationImageUrl?.href,
  };
}

const urls = urlsFromArgs();
let failed = false;

for (const pageUrl of urls) {
  try {
    const result = await validateUrl(pageUrl);
    console.log(`✅ ${pageUrl} — Facebook／LINE／X metadata OK，${result.title}`);
    console.log(`   image: ${result.image}`);
  } catch (error) {
    failed = true;
    console.error(`❌ ${pageUrl} — ${error instanceof Error ? error.message : String(error)}`);
  }
}

if (failed) process.exitCode = 1;
