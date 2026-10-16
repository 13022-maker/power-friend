import type { Category, Condition, Listing, PaymentMethod, Profile } from "../types";
import { embed } from "../ai/embedding";
import { estimatePrice } from "../ai/pricing";

const DAY = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString();

function profile(
  id: string,
  displayName: string,
  areaId: string,
  bio: string,
  interests: string[],
  verificationLevel: 0 | 1 | 2,
  joinedDaysAgo: number,
  deals: number,
  positiveRate: number,
  validReports = 0,
): Profile {
  return {
    id,
    displayName,
    areaId,
    bio,
    interests,
    verificationLevel,
    joinedAt: ago(joinedDaysAgo),
    deals,
    positiveRate,
    validReports,
    tasteVec: embed(`${interests.join(" ")} ${bio}`),
  };
}

export function seedProfiles(): Profile[] {
  return [
    profile("u_an", "小安", "zhongli", "週末拍底片、偶爾去露營。東西用不到就讓它找新主人。", ["底片相機", "露營", "咖啡", "旅行"], 2, 420, 18, 0.97),
    profile("u_zhe", "阿哲", "gongguan", "研究生，喜歡模型與鋼彈，書很多。", ["鋼彈 模型", "公仔", "漫畫", "小說"], 1, 210, 7, 0.92),
    profile("u_mia", "Mia", "xinyi", "設計師，收藏中古家具與古著。", ["古著", "中古家具", "設計", "燈具"], 2, 680, 31, 0.99),
    profile("u_ken", "老K", "taoyuan", "3C 玩家，常換新機。", ["手機", "筆電", "耳機", "相機"], 1, 95, 3, 0.86),
    profile("u_new", "路人甲", "hsinchu", "剛加入", ["iphone", "switch"], 0, 2, 0, 0),
  ];
}

interface SeedItem {
  id: string;
  seller: string;
  title: string;
  desc: string;
  category: Category;
  condition: Condition;
  base: number;
  priceFactor: number; // 相對 AI 中位數的定價
  area: string;
  daysAgo: number;
  views: number;
  quantity?: number; // 預設 1
  pay?: PaymentMethod[]; // 預設 ["meetup_cash"]
  shippingFee?: number; // 只有含 cod 時有意義
}

const ITEMS: SeedItem[] = [
  { id: "l_fm2", seller: "u_zhe", title: "Nikon FM2 底片相機 銀色機身", desc: "快門各速正常，測光準，附原廠背帶。底片相機入門經典。", category: "camera", condition: "good", base: 14000, priceFactor: 0.95, area: "gongguan", daysAgo: 1, views: 88 },
  { id: "l_tent", seller: "u_mia", title: "Snow Peak 帳篷 4 人", desc: "露營用過 3 次，無破損，營釘齊全，附收納袋。", category: "camping", condition: "like_new", base: 16000, priceFactor: 1.05, area: "xinyi", daysAgo: 3, views: 140 },
  { id: "l_gundam", seller: "u_an", title: "MG 鋼彈 RX-78-2 3.0 已素組", desc: "素組完成，未上色，零件無缺，盒子還在。", category: "figure", condition: "good", base: 2200, priceFactor: 0.9, area: "zhongli", daysAgo: 2, views: 41 },
  { id: "l_airpods", seller: "u_ken", title: "AirPods Pro 2 USB-C", desc: "保固到明年三月，電池健康 98%，耳塞未使用。", category: "electronics", condition: "like_new", base: 7490, priceFactor: 1.0, area: "taoyuan", daysAgo: 0, views: 203, quantity: 2, pay: ["meetup_cash", "mobile_pay"] },
  { id: "l_chair", seller: "u_mia", title: "柚木中古餐椅 一對", desc: "丹麥中古風格，椅面重新上油，穩固不晃。", category: "furniture", condition: "fair", base: 9000, priceFactor: 1.1, area: "xinyi", daysAgo: 6, views: 77 },
  { id: "l_books", seller: "u_zhe", title: "村上春樹小說 8 本合售", desc: "書況良好，部分書頁微泛黃，無畫記。", category: "books", condition: "fair", base: 2800, priceFactor: 0.8, area: "gongguan", daysAgo: 4, views: 35 },
  { id: "l_lamp", seller: "u_an", title: "露營營燈 + 蛋捲桌組合", desc: "營燈可充電，蛋捲桌有使用痕跡，適合新手入門。", category: "camping", condition: "fair", base: 3200, priceFactor: 0.85, area: "zhongli", daysAgo: 5, views: 52 },
  { id: "l_jacket", seller: "u_mia", title: "日本古著 工作外套 M 號", desc: "帆布材質，袖口自然刷舊，無破洞。", category: "fashion", condition: "good", base: 3600, priceFactor: 1.0, area: "xinyi", daysAgo: 2, views: 66, pay: ["meetup_cash", "cod"], shippingFee: 60 },
  { id: "l_x100", seller: "u_ken", title: "Fujifilm X100V 黑色", desc: "快門數約 4,000，附兩顆電池與遮光罩。", category: "camera", condition: "like_new", base: 46000, priceFactor: 1.08, area: "taoyuan", daysAgo: 1, views: 310 },
  { id: "l_switch", seller: "u_new", title: "Switch OLED 主機 便宜賣", desc: "急售，有意者聊聊。", category: "electronics", condition: "good", base: 10480, priceFactor: 0.55, area: "hsinchu", daysAgo: 0, views: 12 },
  { id: "l_figure", seller: "u_zhe", title: "一番賞 A 賞 公仔 未拆", desc: "盒況良好，未拆封，同款有 3 盒，可面交驗貨。", category: "figure", condition: "new", base: 2500, priceFactor: 1.0, area: "gongguan", daysAgo: 7, views: 58, quantity: 3, pay: ["meetup_cash", "cod", "mobile_pay"], shippingFee: 60 },
  { id: "l_film", seller: "u_an", title: "過期底片 Kodak ColorPlus 單捲", desc: "冷藏保存，2025 年到期，適合實驗拍攝。共 5 捲，可單買或多捲合購。", category: "camera", condition: "new", base: 320, priceFactor: 0.8, area: "zhongli", daysAgo: 3, views: 29, quantity: 5, pay: ["meetup_cash", "cod", "bank_transfer"], shippingFee: 0 },
];

export function seedListings(): Listing[] {
  return ITEMS.map((it) => {
    const p = estimatePrice(it.category, it.condition, it.base);
    const price = Math.round((p.mid * it.priceFactor) / 10) * 10;
    return {
      id: it.id,
      sellerId: it.seller,
      title: it.title,
      description: it.desc,
      category: it.category,
      condition: it.condition,
      price,
      aiPriceLow: p.low,
      aiPriceHigh: p.high,
      areaId: it.area,
      status: "active",
      createdAt: ago(it.daysAgo),
      views: it.views,
      embedding: embed(`${it.title} ${it.desc}`),
      quantity: it.quantity ?? 1,
      reservedQty: 0,
      soldQty: 0,
      paymentMethods: it.pay ?? ["meetup_cash"],
      shippingFee: it.pay?.includes("cod") ? (it.shippingFee ?? 0) : 0,
    };
  });
}
