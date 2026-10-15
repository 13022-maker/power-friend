import { beforeEach, describe, expect, it } from "vitest";
import { resetDemoStore, demoRepo } from "../lib/data/demo";
import * as svc from "../lib/services";
import sharp from "sharp";
import { MAX_PHOTO_BYTES, parsePhotoDataUrl, photoPathFromUrl, savePhoto, stripPhotoMetadata } from "../lib/storage";

/** 產生帶 EXIF（含 GPS 與相機型號）的真實 JPEG */
async function jpegWithGps(): Promise<Buffer> {
  return sharp({ create: { width: 16, height: 8, channels: 3, background: "#c33" } })
    .jpeg()
    .withExif({
      IFD0: { Make: "LeakyCam", Model: "SecretModel-9000" },
      IFD3: { GPSLatitudeRef: "N", GPSLatitude: "25/1 2/1 0/1", GPSLongitudeRef: "E", GPSLongitude: "121/1 31/1 0/1" },
    })
    .toBuffer();
}

const JPEG_HEAD = [0xff, 0xd8, 0xff, 0xe0];
const src2 = () => Buffer.from([...JPEG_HEAD, 0]);
const dataUrl = (mime: string, bytes: Buffer) => `data:${mime};base64,${bytes.toString("base64")}`;

describe("刪除帳號（demo repo）", () => {
  beforeEach(() => resetDemoStore());

  it("刪除本人所有資料，並把對方因本人出價而保留的物品改回上架", async () => {
    const an = (await demoRepo.getProfile("u_an"))!;
    const zhe = (await demoRepo.getProfile("u_zhe"))!;
    const mia = (await demoRepo.getProfile("u_mia"))!;

    // 小安買阿哲的 FM2（被接受 → 保留中，有對話）
    const o1 = await svc.createOffer(an, "l_fm2", 9000, "FM2 想收來拍底片，9000 可以嗎？");
    const acc = await svc.respondOffer(zhe, o1.ok ? o1.data!.id : "", true);
    const convId = acc.ok ? acc.data!.conversationId! : "";
    await svc.sendMessage(an, convId, "週六中壢站可以嗎");
    expect((await demoRepo.getListing("l_fm2"))!.status).toBe("reserved");

    // Mia 對小安的鋼彈出價（pending）；小安封鎖、檢舉別人
    expect((await svc.createOffer(mia, "l_gundam", 2000, "鋼彈還在嗎？想收")).ok).toBe(true);
    await svc.toggleBlock(an, "u_ken");
    await svc.toggleBlock(mia, "u_an");
    await svc.report(an, "u_new", "疑似詐騙");

    const res = await svc.deleteAccount(an);
    expect(res.ok && res.data!.reactivated).toBe(1);

    expect(await demoRepo.getProfile("u_an")).toBeNull();
    expect((await demoRepo.listListings()).some((l) => l.sellerId === "u_an")).toBe(false);
    expect(await demoRepo.getListing("l_gundam")).toBeNull();
    expect((await demoRepo.listOffers({ buyerId: "u_an" })).length).toBe(0);
    expect((await demoRepo.listOffers({ sellerId: "u_an" })).length).toBe(0);
    expect((await demoRepo.listOffers({ buyerId: "u_mia" })).length).toBe(0); // 對小安物品的出價一併刪除
    expect(await demoRepo.getConversation(convId)).toBeNull();
    expect((await demoRepo.listMessages(convId)).length).toBe(0);
    expect((await demoRepo.listConversations("u_zhe")).length).toBe(0);
    expect((await demoRepo.listBlocks("u_an")).length).toBe(0);
    expect((await demoRepo.listBlocks("u_mia")).length).toBe(0);
    expect((await demoRepo.listReports({ reporterId: "u_an" })).length).toBe(0);

    // 對方的物品回到上架，其他使用者不受影響
    expect((await demoRepo.getListing("l_fm2"))!.status).toBe("active");
    expect(await demoRepo.getProfile("u_zhe")).not.toBeNull();
    expect((await demoRepo.listListings()).some((l) => l.sellerId === "u_mia")).toBe(true);
  });

  it("已成交的物品不會被改回上架", async () => {
    const an = (await demoRepo.getProfile("u_an"))!;
    const zhe = (await demoRepo.getProfile("u_zhe"))!;
    const o = await svc.createOffer(an, "l_fm2", 9000, "FM2 想收來拍底片，9000 可以嗎？");
    const acc = await svc.respondOffer(zhe, o.ok ? o.data!.id : "", true);
    await svc.completeDeal(zhe, acc.ok ? acc.data!.conversationId! : "");
    const res = await svc.deleteAccount(an);
    expect(res.ok && res.data!.reactivated).toBe(0);
    expect((await demoRepo.getListing("l_fm2"))!.status).toBe("sold");
  });
});

describe("上架照片驗證", () => {
  it("demo 模式 savePhoto 回傳去除 EXIF／GPS 後的 JPEG data URL", async () => {
    const src = await jpegWithGps();
    expect((await sharp(src).metadata()).exif).toBeDefined(); // 確認測試素材真的有 EXIF
    expect(src.includes(Buffer.from("SecretModel-9000"))).toBe(true);

    const out = await savePhoto(dataUrl("image/jpeg", src), "u_an");
    expect(out.startsWith("data:image/jpeg;base64,")).toBe(true);
    const clean = Buffer.from(out.split(",")[1], "base64");
    const meta = await sharp(clean).metadata();
    expect(meta.exif).toBeUndefined();
    expect(meta.width).toBe(16);
    expect(clean.includes(Buffer.from("SecretModel-9000"))).toBe(false);
    expect(clean.includes(Buffer.from("LeakyCam"))).toBe(false);
  });

  it("stripPhotoMetadata：PNG 也轉成乾淨 JPEG；壞檔丟出可顯示的錯誤", async () => {
    const png = await sharp({ create: { width: 4, height: 4, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
    const out = await stripPhotoMetadata(dataUrl("image/png", png));
    expect(out.startsWith("data:image/jpeg;base64,")).toBe(true);
    await expect(savePhoto(dataUrl("image/jpeg", Buffer.from([...JPEG_HEAD, 1, 2, 3])), "u_an")).rejects.toThrow("照片無法讀取");
    await expect(savePhoto(dataUrl("image/jpeg", src2()), "../x")).rejects.toThrow("無效的使用者 id");
  });

  it("接受 JPEG／PNG／WebP", () => {
    expect(parsePhotoDataUrl(dataUrl("image/jpeg", Buffer.from([...JPEG_HEAD, 0]))).ok).toBe(true);
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
    expect(parsePhotoDataUrl(dataUrl("image/png", png)).ok).toBe(true);
    const webp = Buffer.concat([Buffer.from("RIFF"), Buffer.from([0, 0, 0, 0]), Buffer.from("WEBPVP8 ")]);
    expect(parsePhotoDataUrl(dataUrl("image/webp", webp)).ok).toBe(true);
  });

  it("拒絕非圖片、SVG、非 base64 與內容不符的 data URL", () => {
    expect(parsePhotoDataUrl("data:text/html;base64,PHNjcmlwdD4=").ok).toBe(false);
    expect(parsePhotoDataUrl("data:image/svg+xml;base64,PHN2Zz4=").ok).toBe(false);
    expect(parsePhotoDataUrl("data:image/jpeg,raw").ok).toBe(false);
    expect(parsePhotoDataUrl("https://evil.example/x.jpg").ok).toBe(false);
    expect(parsePhotoDataUrl(dataUrl("image/jpeg", Buffer.from("<html>not a jpeg</html>"))).ok).toBe(false);
  });

  it("拒絕超過 3 MB 的照片", () => {
    const big = Buffer.alloc(MAX_PHOTO_BYTES + 1);
    big.set(JPEG_HEAD);
    const r = parsePhotoDataUrl(dataUrl("image/jpeg", big));
    expect(r.ok).toBe(false);
    const ok = Buffer.alloc(MAX_PHOTO_BYTES);
    ok.set(JPEG_HEAD);
    expect(parsePhotoDataUrl(dataUrl("image/jpeg", ok)).ok).toBe(true);
  });

  it("從 public URL 取回 Storage 路徑", () => {
    expect(photoPathFromUrl("https://x.supabase.co/storage/v1/object/public/listing-photos/u1/a.jpg")).toBe("u1/a.jpg");
    expect(photoPathFromUrl("data:image/jpeg;base64,AAAA")).toBeNull();
  });
});
