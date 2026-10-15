import Link from "next/link";
import { repo } from "@/lib/data";
import { currentUser } from "@/lib/session";
import { computeTrust } from "@/lib/trust";
import { AREAS, formatNTD } from "@/lib/catalog";
import { resetDemo } from "@/app/actions";
import { Thumb } from "@/components/ui";

export default async function MePage() {
  const me = await currentUser();
  const r = repo();
  const t = computeTrust(me);
  const listings = (await r.listListings()).filter((l) => l.sellerId === me.id);

  return (
    <>
      <h1>{me.displayName}</h1>
      <p className="lead">
        {AREAS[me.areaId]?.label}・興趣：{me.interests.join("、")}
      </p>

      <div className="panel stack">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <strong>信任分數 {t.total} / 100</strong>
          <span className="badge trust-hi">{t.tier}・每日可開聊 {t.dailyChatLimit} 次</span>
        </div>
        <div className="trust-meter" aria-hidden>
          <span style={{ width: `${t.total}%` }} />
        </div>
        <table className="breakdown">
          <tbody>
            {t.items.map((i) => (
              <tr key={i.label}>
                <td>
                  {i.label}
                  <div className="muted">{i.hint}</div>
                </td>
                <td style={{ color: i.points < 0 ? "var(--danger)" : undefined }}>{i.points > 0 ? `+${i.points}` : i.points}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted" style={{ margin: 0 }}>分數來源公開：不能用錢買，只能靠驗證與好的交易紀錄累積。</p>
      </div>

      <h2>我的上架（{listings.length}）</h2>
      {listings.length === 0 ? (
        <div className="empty">
          還沒上架。<Link href="/sell" style={{ textDecoration: "underline" }}>拍照上架第一件</Link>
        </div>
      ) : (
        <div className="list">
          {listings.map((l) => (
            <Link className="item" key={l.id} href={`/listing/${l.id}`}>
              <div className="mini"><Thumb category={l.category} photo={l.photo} /></div>
              <div className="grow">
                <strong>{l.title}</strong>
                <div className="muted">
                  <span className="price">{formatNTD(l.price)}</span>・{l.status === "active" ? "上架中" : "已保留"}・{l.views} 人看過
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}

      <h2>個人資料與隱私</h2>
      <div className="panel stack">
        <div className="row">
          <a className="btn ghost small" href="/api/me/export" download>
            匯出我的資料（JSON）
          </a>
          <span className="muted">依個資法提供完整副本；刪除帳號需 email 確認（第一階段開放）。</span>
        </div>
        {r.mode === "demo" && (
          <form action={resetDemo} className="row">
            <button className="btn ghost small">重設示範資料</button>
            <span className="muted">清除你在 demo 模式中新增的上架、出價與聊天。</span>
          </form>
        )}
      </div>
    </>
  );
}
