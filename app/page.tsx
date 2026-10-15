import Link from "next/link";
import { currentUserOrNull } from "@/lib/session";
import { DIM } from "@/lib/ai/embedding";
import { explore } from "@/lib/services";
import { CATEGORIES, AREAS } from "@/lib/catalog";
import { ListingCard } from "@/components/ui";
import type { Category, Profile, SortMode } from "@/lib/types";

const MODES: { id: SortMode; label: string; hint: string }[] = [
  { id: "likely", label: "最可能成交", hint: "品味 × 賣家信任 × 價格合理 × 距離" },
  { id: "taste", label: "品味相近", hint: "依你的收藏與成交紀錄計算契合 %" },
  { id: "nearby", label: "附近", hint: "以捷運站／行政區估算距離" },
];

/** 未登入訪客：不會等於任何賣家 id；零向量 → tasteFit 恆為 50（中性） */
const GUEST: Profile = {
  id: "guest",
  displayName: "訪客",
  areaId: "taipei_main",
  bio: "",
  interests: [],
  verificationLevel: 0,
  joinedAt: new Date(0).toISOString(),
  deals: 0,
  positiveRate: 0,
  validReports: 0,
  tasteVec: new Array<number>(DIM).fill(0),
};

export default async function ExplorePage({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string; cat?: string; q?: string }>;
}) {
  const sp = await searchParams;
  const mode = (MODES.find((m) => m.id === sp.mode)?.id ?? "likely") as SortMode;
  const cat = (sp.cat && Object.hasOwn(CATEGORIES, sp.cat) ? sp.cat : "") as Category | "";
  const q = sp.q ?? "";
  const me = await currentUserOrNull(); // Supabase 模式可未登入瀏覽
  const viewer = me ?? GUEST;
  // 訪客沒有品味向量：契合 % 一律中性（50），「品味相近」改用「最可能成交」排序
  const items = await explore(viewer, { mode: me || mode !== "taste" ? mode : "likely", category: cat, q });

  const href = (p: Record<string, string>) => {
    const s = new URLSearchParams({ mode, ...(cat ? { cat } : {}), ...(q ? { q } : {}), ...p });
    for (const [k, v] of [...s.entries()]) if (!v) s.delete(k);
    return `/?${s.toString()}`;
  };

  return (
    <>
      {me ? (
        <>
          <h1>嗨 {me.displayName}，今天想找什麼？</h1>
          <p className="lead">
            你在 {AREAS[me.areaId]?.label}。卡片上的「契合 %」是依你的品味向量計算，不是廣告排序——這裡沒有付費置頂。
          </p>
        </>
      ) : (
        <>
          <h1>今天想找什麼？</h1>
          <p className="lead">
            依賣家信任、價格合理度排序，沒有付費置頂。<Link href="/login" style={{ textDecoration: "underline" }}>登入</Link>後會依你的品味計算「契合 %」與距離。
          </p>
        </>
      )}

      <form action="/" className="row" style={{ marginBottom: 12 }}>
        <input type="hidden" name="mode" value={mode} />
        {cat && <input type="hidden" name="cat" value={cat} />}
        <input className="input" name="q" defaultValue={q} placeholder="用一句話描述，例如：適合新手的底片相機" style={{ flex: 1, minWidth: 200 }} />
        <button className="btn">語意搜尋</button>
      </form>

      <div className="row" style={{ justifyContent: "space-between", marginBottom: 10 }}>
        <div className="segmented" role="tablist" aria-label="排序方式">
          {MODES.map((m) => (
            <Link key={m.id} href={href({ mode: m.id })} className={m.id === mode ? "on" : ""} title={m.hint}>
              {m.label}
            </Link>
          ))}
        </div>
        <span className="muted">{MODES.find((m) => m.id === mode)?.hint}</span>
      </div>

      <div className="chips" style={{ marginBottom: 16 }}>
        <Link href={href({ cat: "" })} className={`chip ${!cat ? "on" : ""}`}>全部</Link>
        {(Object.keys(CATEGORIES) as Category[]).map((c) => (
          <Link key={c} href={href({ cat: c })} className={`chip ${cat === c ? "on" : ""}`}>
            {CATEGORIES[c].label}
          </Link>
        ))}
      </div>

      {items.length === 0 ? (
        <div className="empty">
          沒有符合的物品。{q && <Link href={href({ q: "" })} style={{ textDecoration: "underline" }}>清除搜尋</Link>}
        </div>
      ) : (
        <div className="grid">
          {items.map((l) => (
            <ListingCard key={l.id} l={l} showFit={!!me} />
          ))}
        </div>
      )}
    </>
  );
}
