import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uploadsDir = path.resolve(__dirname, "../../uploads");

function ensureUploadsDir() {
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }
}

export function saveBase64Image(data, prefix = "img") {
  if (!data) return null;
  ensureUploadsDir();

  let base64 = String(data);
  let ext = "png";
  const match = base64.match(/^data:(image\/[a-zA-Z0-9+.-]+);base64,(.*)$/);
  if (match) {
    const mime = match[1];
    base64 = match[2];
    if (mime.includes("jpeg")) ext = "jpg";
    else if (mime.includes("png")) ext = "png";
    else if (mime.includes("webp")) ext = "webp";
  }

  const filename = `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const filePath = path.join(uploadsDir, filename);
  fs.writeFileSync(filePath, Buffer.from(base64, "base64"));
  return `/uploads/${filename}`;
}
