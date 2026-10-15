import { randomUUID } from "node:crypto";

/** 與 lib/data/index.ts 相同的判斷；不直接 import 該檔，避免 lib/data/supabase.ts ↔ lib/storage.ts 循環相依 */
/** 與 lib/data/index.ts 的 appMode() 判斷一致（這裡不 import 它，避免 supabase.ts ↔ storage.ts 循環相依） */
const isSupabaseConfigured = () => {
  const m = process.env.APP_MODE?.trim().toLowerCase();
  if (m === "demo") return false;
  if (m === "supabase") return true;
  return !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY;
};

/** 上架照片：Supabase 模式存到 Storage bucket `listing-photos/<ownerId>/<random>.jpg`；demo 模式維持 data URL */
export const PHOTO_BUCKET = "listing-photos";
export const MAX_PHOTO_BYTES = 3 * 1024 * 1024;
const ALLOWED = ["image/jpeg", "image/png", "image/webp"] as const;
export type PhotoMime = (typeof ALLOWED)[number];

export type PhotoCheck = { ok: true; mime: PhotoMime; bytes: Buffer } | { ok: false; error: string };

/** 純驗證（不碰網路）：只收 JPEG／PNG／WebP 的 base64 data URL，解碼後 ≤ 3 MB，並比對檔頭 magic bytes */
export function parsePhotoDataUrl(dataUrl: string): PhotoCheck {
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=\s]+)$/.exec(dataUrl);
  if (!m) return { ok: false, error: "照片格式不支援（只接受 JPEG、PNG、WebP）" };
  const mime = m[1] as PhotoMime;
  const b64 = m[2].replace(/\s/g, "");
  // 先用長度估算，避免解碼超大字串
  if (Math.floor((b64.length * 3) / 4) > MAX_PHOTO_BYTES + 3) return { ok: false, error: "照片太大，請壓縮到 3 MB 以下" };
  const bytes = Buffer.from(b64, "base64");
  if (bytes.length === 0) return { ok: false, error: "照片是空的" };
  if (bytes.length > MAX_PHOTO_BYTES) return { ok: false, error: "照片太大，請壓縮到 3 MB 以下" };
  if (!magicMatches(mime, bytes)) return { ok: false, error: "照片內容與格式不符" };
  return { ok: true, mime, bytes };
}

function magicMatches(mime: PhotoMime, b: Buffer): boolean {
  if (mime === "image/jpeg") return b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
  if (mime === "image/png") return b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  return b.length > 12 && b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP";
}

/**
 * 去除 EXIF／GPS／IPTC／XMP 等中繼資料：以 sharp 依 EXIF 方向轉正後重新編碼成 JPEG（sharp 預設不保留 metadata）。
 * 透明背景鋪白；限制像素數防解壓縮炸彈。回傳乾淨的 JPEG bytes。
 */
export async function reencodeJpeg(bytes: Buffer): Promise<Buffer> {
  const { default: sharp } = await import("sharp");
  try {
    return await sharp(bytes, { limitInputPixels: 40_000_000, failOn: "error" })
      .rotate()
      .flatten({ background: "#ffffff" })
      .jpeg({ quality: 80 })
      .toBuffer();
  } catch {
    throw new Error("照片無法讀取，請換一張");
  }
}

/** 驗證 data URL 並去除中繼資料，回傳 JPEG data URL（送 Muse 前、demo 模式儲存都用這個） */
export async function stripPhotoMetadata(dataUrl: string): Promise<string> {
  const check = parsePhotoDataUrl(dataUrl);
  if (!check.ok) throw new Error(check.error);
  const clean = await reencodeJpeg(check.bytes);
  return `data:image/jpeg;base64,${clean.toString("base64")}`;
}

/**
 * 儲存上架照片並回傳可放進 listings.photo_url 的字串。兩種模式都先在伺服器端去除 EXIF／GPS（重新編碼成 JPEG）。
 * - demo 模式：回傳去除中繼資料後的 JPEG data URL（記憶體暫存）。
 * - supabase 模式：以 service role 上傳，回傳 public URL。驗證失敗丟出 Error（訊息可直接顯示給使用者）。
 */
export async function savePhoto(dataUrl: string, ownerId: string): Promise<string> {
  const check = parsePhotoDataUrl(dataUrl);
  if (!check.ok) throw new Error(check.error);
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(ownerId)) throw new Error("無效的使用者 id");
  const clean = await reencodeJpeg(check.bytes);
  if (!isSupabaseConfigured()) return `data:image/jpeg;base64,${clean.toString("base64")}`;
  const { db } = await import("./data/supabase");
  const path = `${ownerId}/${randomUUID()}.jpg`;
  const bucket = db().storage.from(PHOTO_BUCKET);
  const { error } = await bucket.upload(path, clean, { contentType: "image/jpeg", upsert: false, cacheControl: "31536000" });
  if (error) throw new Error(`照片上傳失敗：${error.message}`);
  return bucket.getPublicUrl(path).data.publicUrl;
}

/** 從 public URL 取回 bucket 內路徑（不是本 bucket 的 URL 則回傳 null） */
export function photoPathFromUrl(url: string | undefined): string | null {
  if (!url) return null;
  const marker = `/storage/v1/object/public/${PHOTO_BUCKET}/`;
  const i = url.indexOf(marker);
  return i < 0 ? null : decodeURIComponent(url.slice(i + marker.length).split("?")[0]);
}

/** 刪除某位使用者資料夾下的所有照片（service role）。demo 模式為 no-op。回傳刪除數。 */
export async function removeOwnerPhotos(ownerId: string): Promise<number> {
  if (!isSupabaseConfigured() || !/^[A-Za-z0-9_-]{1,64}$/.test(ownerId)) return 0;
  const { db } = await import("./data/supabase");
  const bucket = db().storage.from(PHOTO_BUCKET);
  let removed = 0;
  for (;;) {
    const { data, error } = await bucket.list(ownerId, { limit: 1000 });
    if (error) throw new Error(`Storage list 失敗：${error.message}`);
    const files = (data ?? []).filter((f) => f.id); // 有 id 才是檔案（沒有 id 的是資料夾佔位）
    if (files.length === 0) return removed;
    const { error: rmErr } = await bucket.remove(files.map((f) => `${ownerId}/${f.name}`));
    if (rmErr) throw new Error(`Storage remove 失敗：${rmErr.message}`);
    removed += files.length;
    if (files.length < 1000) return removed;
  }
}

/** 刪除單一照片（用於刪除單件上架）；非 Storage URL 或 demo 模式則略過 */
export async function removePhotoByUrl(url: string | undefined): Promise<void> {
  const path = photoPathFromUrl(url);
  if (!path || !isSupabaseConfigured()) return;
  const { db } = await import("./data/supabase");
  await db().storage.from(PHOTO_BUCKET).remove([path]);
}
