// 從使用者提供的校商照片產生網頁用檔案；保留原圖，裁切交由介面的 object-fit 處理。
// 執行：node apps/web/scripts/prepare-shop-lookbook.mjs
import sharp from "sharp";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const webRoot = fileURLToPath(new URL("../", import.meta.url));
const sourceRoot = path.resolve(webRoot, "../../校商圖片");
const outputRoot = path.join(webRoot, "public/shop/104");
const collections = [
  {
    id: "cotton", name: "棉踢", dm: "1.png",
    photos: [
      ["彭奕暟/DSC00419.jpg", "白色棉踢正面實穿", "50% 40%"],
      ["彭奕暟/DSC00429.jpg", "白色棉踢背面實穿", "50% 45%"],
      ["彭奕暟/DSC00491.jpg", "白色棉踢背面圖案", "50% 50%"],
      ["Jonnie/IMG_20261023_163134.jpg", "白色棉踢草地實拍", "50% 50%"],
      ["彭奕暟/DSC00536.jpg", "黑色棉踢側面實穿", "50% 35%"],
      ["彭奕暟/DSC00524 (2).jpg", "黑色棉踢正面實穿", "50% 35%"],
      ["彭奕暟/DSC00540 (3).jpg", "黑色棉踢背面實穿", "50% 40%"],
      ["彭奕暟/DSC00553 (6).jpg", "黑色棉踢胸前圖案", "50% 50%"],
    ],
  },
  {
    id: "hoodie", name: "刷毛帽踢", dm: "3.png",
    photos: [
      ["Jonnie/MEITU_20261023_161429235.jpg", "刷毛帽踢正面實穿", "50% 35%"],
      ["Jonnie/IMG_20261023_161449.jpg", "刷毛帽踢雙人實拍", "50% 45%"],
      ["Jonnie/DSCF1155 (2) (1).jpg", "刷毛帽踢背面圖案", "50% 50%"],
      ["Jonnie/DSCF1101.jpg", "刷毛帽踢背面近照", "50% 50%"],
      ["Jonnie/DSCF1103.jpg", "刷毛帽踢胸前印花", "50% 50%"],
      ["Jonnie/DSCF1151.jpg", "刷毛帽踢雙人背面實穿", "50% 40%"],
      ["Jonnie/IMG_20261023_173423.jpg", "刷毛帽踢雙人正面實穿", "50% 35%"],
      ["Jonnie/MEITU_20261023_161349885 (1).jpg", "刷毛帽踢校園實拍", "50% 35%"],
      ["彭奕暟/DSC00455 (6).jpg", "刷毛帽踢戶外實拍", "50% 35%"],
    ],
  },
  {
    id: "windbreaker", name: "風衣外套", dm: "4.png",
    photos: [
      ["彭奕暟/DSC02469 (4).jpg", "風衣外套正面實穿", "50% 35%"],
      ["彭奕暟/DSC02482 (1).jpg", "風衣外套正反面對照", "50% 45%"],
      ["彭奕暟/DSC02514 (1).jpg", "風衣外套雙人實穿", "50% 45%"],
      ["彭奕暟/DSC02490.jpg", "風衣外套正面近照", "50% 35%"],
      ["彭奕暟/DSC02501.jpg", "風衣外套連帽實穿", "50% 35%"],
      ["彭奕暟/DSC02511.jpg", "風衣外套帽款細節", "50% 35%"],
      ["彭奕暟/DSC02532 (1).jpg", "風衣外套背面印花", "50% 50%"],
      ["Jonnie/DSCF1370.jpg", "風衣外套背面近照", "50% 50%"],
      ["Jonnie/DSCF1393.jpg", "風衣外套胸前印花", "50% 50%"],
      ["Jonnie/IMG_20261023_163151.jpg", "風衣外套校園雙人實拍", "50% 45%"],
    ],
  },
];

await mkdir(outputRoot, { recursive: true });
const data = [];
for (const collection of collections) {
  const photos = [];
  for (const [index, [source, alt, position]] of collection.photos.entries()) {
    const id = `${collection.id}-${String(index + 1).padStart(2, "0")}`;
    const input = path.join(sourceRoot, "原圖", source);
    let dimensions;
    for (const width of [480, 1440, 2400]) {
      const result = await sharp(input).autoOrient()
        .resize({ width, withoutEnlargement: true })
        .webp({ quality: width === 480 ? 78 : 84 })
        .toFile(path.join(outputRoot, `${id}-${width}.webp`));
      if (width === 1440) dimensions = { width: result.width, height: result.height };
    }
    photos.push({ id, alt, position, ...dimensions,
      orientation: dimensions.width > dimensions.height ? "landscape" : "portrait" });
  }
  const dmId = `${collection.id}-dm`;
  const dm = await sharp(path.join(sourceRoot, "已設計", collection.dm))
    .resize({ width: 3600, withoutEnlargement: true }).webp({ quality: 90 })
    .toFile(path.join(outputRoot, `${dmId}.webp`));
  data.push({ id: collection.id, name: collection.name, photos,
    dm: { id: dmId, width: dm.width, height: dm.height } });
}
await writeFile(path.join(webRoot, "src/lib/shop-lookbook-data.json"), `${JSON.stringify(data, null, 2)}\n`);
console.log(`已準備 ${data.reduce((sum, c) => sum + c.photos.length, 0)} 張照片與 ${data.length} 張 DM。`);
