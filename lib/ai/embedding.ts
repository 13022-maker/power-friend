/**
 * 輕量 embedding：中文字元 bigram ＋ 英文單字雜湊到固定維度，L2 正規化。
 * 原型用途——可離線、可重現；正式版換成多模態 embedding 模型（維度改 512，存 pgvector）。
 */
export const DIM = 256;

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function tokenize(text: string): string[] {
  const t = text.toLowerCase();
  const tokens: string[] = [];
  for (const w of t.match(/[a-z0-9]+/g) ?? []) tokens.push(`w:${w}`);
  const han = t.replace(/[^一-鿿]/g, "");
  for (let i = 0; i < han.length; i++) {
    tokens.push(`c:${han[i]}`);
    if (i + 1 < han.length) tokens.push(`b:${han.slice(i, i + 2)}`);
  }
  return tokens;
}

export function normalize(v: number[]): number[] {
  const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  return n === 0 ? v.slice() : v.map((x) => x / n);
}

export function embed(text: string): number[] {
  const v = new Array<number>(DIM).fill(0);
  for (const tok of tokenize(text)) {
    const h = hash(tok);
    const weight = tok.startsWith("b:") ? 1.5 : 1; // bigram 較有語意
    v[h % DIM] += (h & 1 ? 1 : -1) * weight;
  }
  return normalize(v);
}

export function cosine(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) s += a[i] * b[i];
  return s;
}

/** 品味契合 %：沿用 Duolicious 的 100*(1+cos)/2，再拉開分布方便閱讀 */
export function tasteFit(user: number[], item: number[]): number {
  const c = cosine(user, item);
  const stretched = Math.max(-1, Math.min(1, c * 2.2));
  return Math.round((100 * (1 + stretched)) / 2);
}

/** 成交或收藏後把物品向量混入使用者品味向量（對應 DB trigger 的增量更新） */
export function blendTaste(user: number[], item: number[], weight = 0.2): number[] {
  return normalize(user.map((x, i) => x * (1 - weight) + (item[i] ?? 0) * weight));
}
