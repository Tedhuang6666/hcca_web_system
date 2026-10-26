"""將本機校商網頁圖片打包給圖床，圖片與輸出包均不加入 Git。"""

import hashlib
import json
from pathlib import Path
from zipfile import ZIP_STORED, ZipFile


def main() -> None:
    root = Path(__file__).resolve().parent.parent
    collections = json.loads((root / "apps/web/src/lib/shop-lookbook-data.json").read_text())
    source = root / "apps/web/public/shop/104"
    output = root / "output/shop-lookbook-104"
    filenames: list[str] = []
    for collection in collections:
        filenames.append(f"{collection['dm']['id']}.webp")
        for photo in collection["photos"]:
            filenames.extend(f"{photo['id']}-{width}.webp" for width in (480, 1440, 2400))

    # 先驗所有檔案，缺檔時不產生不完整的上傳包。
    checksums = []
    for filename in filenames:
        data = (source / filename).read_bytes()
        if data[:4] != b"RIFF" or data[8:12] != b"WEBP":
            raise ValueError(f"不是 WebP 圖片：{filename}")
        checksums.append(f"{hashlib.sha256(data).hexdigest()}  {filename}")

    output.mkdir(parents=True, exist_ok=True)
    archive = output / "shop-lookbook-104.zip"
    with ZipFile(archive, "w", compression=ZIP_STORED) as package:
        for filename in filenames:
            package.write(source / filename, arcname=filename)
    with ZipFile(archive) as package:
        if package.testzip() is not None:
            raise ValueError("圖片包 CRC 檢查失敗")
    (output / "sha256sum.txt").write_text("\n".join(checksums) + "\n")
    print(f"已打包並驗證 {len(filenames)} 個 WebP 檔案：{archive.relative_to(root)}")


if __name__ == "__main__":
    main()
