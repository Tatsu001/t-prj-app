/* 戦略の入れ物の画面。仕様は 戦略の入れ物/画面の方針.md、見た目は 戦略の入れ物/画面の紙芝居.html（第2版）。
   判定はしない。道具（tools/*.py）が書いた正本を GitHub から読み、運用の入力は入力キュー（data/入力/人の入力/ に1件1ファイル）に置く。
   戦略の編集だけは data/戦略.json と data/記録/改定履歴.json を直接書く（決定92）。画面で計算しない（決定52）。
   中身（戦略の数字）と段の名前はコードに書かない。入れ物・辞書・戦略を読んで組み立てる。
   開発モード: リポジトリの根で python3 -m http.server を動かし app/index.html?local=1 を開く。
     &data=../tools/試験/画面の試料/夜/data/ で試料を読む。&now=2026-11-10T21:00 で時計を固定。書き込みは画面に出すだけ */
"use strict";

/* ================= 土台 ================= */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const num = x => (x === null || x === undefined || x === "" || isNaN(Number(x))) ? "—" : Number(x).toLocaleString("ja-JP", { maximumFractionDigits: 2 });
const N = x => `<span class="num">${num(x)}</span>`;
const CHECK = '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8.5l3.2 3.2L13 5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const H = "国内引け後", A = "国内寄付前", TRIAL = "発注せず記録だけ";
const DOW = ["日", "月", "火", "水", "木", "金", "土"];

const Q = new URLSearchParams(location.search);
const LOCAL = Q.has("local");
const LOCAL_DATA = (Q.get("data") || "../data/").replace(/\/?$/, "/");
const LOCAL_ROOT = "../";
const NOW = Q.get("now");

function store(key, val) { try { if (val === undefined) return JSON.parse(localStorage.getItem(key) || "null"); if (val === null) localStorage.removeItem(key); else localStorage.setItem(key, JSON.stringify(val)); } catch (e) { return null; } }
const CFG_KEY = "iremono.cfg";
function cfg() {
  let c = store(CFG_KEY);
  if (!c) {   // 旧の画面（同じ公開先）が端末に残した設定を引き継ぐ。リポジトリは同じなので、トークンを入れ直さずに済む
    const old = store("si.cfg");
    if (old && old.token && old.owner && old.repo) { c = { repo: `${old.owner}/${old.repo}`, branch: old.branch || "master", token: old.token }; store(CFG_KEY, c); }
  }
  return c || {};
}

/* ---------- 日本時間 ---------- */
function nowDate() { if (!NOW) return new Date(); const d = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(NOW) ? NOW : NOW + "+09:00"); return isNaN(d) ? new Date() : d; }
function jst(d = nowDate()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(d).map(x => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, hm: `${p.hour}:${p.minute}`, iso: `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}+09:00`, hms: `${p.hour}${p.minute}${p.second}` };
}
function md(date) { if (!date) return ""; const [y, m, d] = date.slice(0, 10).split("-").map(Number); const w = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); return `${m}月${d}日（${DOW[w]}）`; }
function mdShort(date) { if (!date) return ""; const [, m, d] = date.slice(0, 10).split("-").map(Number); return `${m}月${d}日`; }
function hm(iso) { return iso ? iso.slice(11, 16).replace(/^0/, "") : ""; }
function addDays(date, k) { const [y, m, d] = date.split("-").map(Number); const t = new Date(Date.UTC(y, m - 1, d + k)); return t.toISOString().slice(0, 10); }
function isBd(date) { const [y, m, d] = date.split("-").map(Number); const w = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); return w !== 0 && w !== 6 && !((S.pre && S.pre.休日) || {})[date]; }
function nextBd(date, k = 1) { let d = date; for (let i = 0; i < k; i++) { d = addDays(d, 1); while (!isBd(d)) d = addDays(d, 1); } return d; }
function prevBd(date) { let d = addDays(date, -1); while (!isBd(d)) d = addDays(d, -1); return d; }
function jpTime(name) { const j = ((S.pre && S.pre.判定点) || []).find(x => x.名前 === name); return (j && j.時刻 || (name === H ? "19:05" : "7:05")).padStart(5, "0"); }

/* ---------- 読み書き（GitHub Contents API／開発モード） ---------- */
class AuthError extends Error {}
class ConflictError extends Error {}
class NetError extends Error {}
const API = "https://api.github.com";
const encPath = p => p.split("/").map(encodeURIComponent).join("/");
function b64ToText(b64) { const bin = atob(b64.replace(/\s/g, "")); const bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i); return new TextDecoder().decode(bytes); }
function textToB64(s) { const bytes = new TextEncoder().encode(s); let bin = ""; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(bin); }
const LOCAL_WRITES = [];   // 開発モードの書き込み（画面に出すだけ）

const Store = {
  headers(raw) { const c = cfg(); return { Authorization: `Bearer ${c.token}`, Accept: raw ? "application/vnd.github.raw" : "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" }; },
  url(path) { const c = cfg(); return `${API}/repos/${c.repo}/contents/${encPath(path)}?ref=${encodeURIComponent(c.branch || "master")}`; },
  localUrl(path) { return path.startsWith("data/") ? LOCAL_DATA + encPath(path.slice(5)) : LOCAL_ROOT + encPath(path); },
  async fetch(url, opt = {}) {
    let r;
    try { r = await fetch(url, Object.assign({ cache: "no-store" }, opt)); } catch (e) { throw new NetError("つながりません"); }
    if (r.status === 401 || r.status === 403) throw new AuthError(String(r.status));
    return r;
  },
  async text(path) {   // ファイルの中身（無ければ null）。sha も返す
    if (LOCAL) {
      const w = LOCAL_WRITES.slice().reverse().find(x => x.path === path); if (w) return { text: w.text, sha: "local" };
      const r = await this.fetch(this.localUrl(path)); if (r.status === 404) return null; if (!r.ok) throw new NetError(String(r.status));
      return { text: await r.text(), sha: "local" };
    }
    const r = await this.fetch(this.url(path), { headers: this.headers(false) });
    if (r.status === 404) return null; if (!r.ok) throw new NetError(String(r.status));
    const j = await r.json();
    if (j.encoding === "base64" && j.content) return { text: b64ToText(j.content), sha: j.sha };
    const r2 = await this.fetch(this.url(path), { headers: this.headers(true) });   // 1MB を超えるファイル
    if (!r2.ok) throw new NetError(String(r2.status));
    return { text: await r2.text(), sha: j.sha };
  },
  async json(path) { const t = await this.text(path); return t ? { data: JSON.parse(t.text), sha: t.sha } : null; },
  async list(path) {   // ディレクトリのファイル名の一覧（無ければ空）
    if (LOCAL) {
      const r = await this.fetch(this.localUrl(path) + "/"); if (!r.ok) return [];
      const html = await r.text(); const names = [...html.matchAll(/href="([^"?#]+)"/g)].map(m => decodeURIComponent(m[1])).filter(n => !n.endsWith("/") && !n.startsWith(".."));
      const extra = LOCAL_WRITES.filter(w => w.path.startsWith(path + "/")).map(w => w.path.slice(path.length + 1));
      return [...new Set([...names, ...extra])].filter(n => !LOCAL_WRITES.some(w => w.deleted && w.path === path + "/" + n)).map(n => ({ name: n, path: path + "/" + n }));
    }
    const r = await this.fetch(this.url(path), { headers: this.headers(false) });
    if (r.status === 404) return []; if (!r.ok) throw new NetError(String(r.status));
    const j = await r.json(); return Array.isArray(j) ? j.filter(x => x.type === "file").map(x => ({ name: x.name, path: x.path })) : [];
  },
  async put(path, text, message, sha) {
    if (LOCAL) { LOCAL_WRITES.push({ path, text, message }); console.log("[開発モード] 書き込み", path, message, text); return { sha: "local" }; }
    const body = { message, content: textToB64(text), branch: cfg().branch || "master" }; if (sha) body.sha = sha;
    const r = await this.fetch(this.url(path).split("?")[0], { method: "PUT", headers: Object.assign(this.headers(false), { "Content-Type": "application/json" }), body: JSON.stringify(body) });
    if (r.status === 409 || r.status === 422) throw new ConflictError(String(r.status));
    if (!r.ok) throw new NetError(String(r.status));
    const j = await r.json(); return { sha: j.content && j.content.sha };
  },
};
const toJSON = o => JSON.stringify(o, null, 1) + "\n";   // 正本と同じ形（インデント1、末尾に改行）

/* ---------- 状態 ---------- */
const S = { pre: null, state: null, logs: {}, queue: [], qlog: [], box: null, dic: null, strat: null, stratSha: null, revs: null, revsSha: null, trades: null, stats: null, logList: null, know: null, error: null, loaded: false, sheet: null };

async function loadCore() {
  S.error = null;
  try {
    const [pre, st] = await Promise.all([Store.json("data/前提.json"), Store.json("data/状態.json")]);
    if (!pre || !st) { S.error = { kind: "missing" }; return; }
    S.pre = pre.data; S.state = st.data;
    const t = jst().date; const days = [t, prevBd(t)]; if (!isBd(t)) days.unshift(prevBd(prevBd(t)));
    const logs = await Promise.all(days.map(d => Store.json(`data/記録/判断ログ/${d}.json`).catch(() => null)));
    S.logs = {}; days.forEach((d, i) => { if (logs[i]) S.logs[d] = logs[i].data; });
    await loadQueue();
    S.loaded = true;
  } catch (e) { S.error = { kind: e instanceof AuthError ? "auth" : e instanceof NetError ? "net" : "other", msg: String(e.message || e) }; }
}
async function loadQueue() {
  const files = await Store.list("data/入力/人の入力");
  const rows = await Promise.all(files.filter(f => f.name.endsWith(".json")).map(f => Store.json(f.path).then(x => x && x.data).catch(() => null)));
  S.queue = rows.filter(Boolean).sort((a, b) => String(a.日時).localeCompare(String(b.日時)));
  const ql = await Store.json("data/記録/入力の取り込み.json").catch(() => null); S.qlog = ql ? ql.data : [];
}
async function loadStrategy(force) {
  if (S.strat && !force) return;
  const [box, dic, st, rv, tr] = await Promise.all([Store.json("data/入れ物.json"), Store.json("data/辞書.json"), Store.json("data/戦略.json"), Store.json("data/記録/改定履歴.json"), Store.json("data/記録/取引.json")]);
  S.box = box.data; S.dic = dic.data; S.strat = st.data; S.stratSha = st.sha; S.revs = rv ? rv.data : []; S.revsSha = rv ? rv.sha : null; S.trades = tr ? tr.data : [];
}
async function loadRecords(force) {
  if (S.trades && S.stats !== null && S.logList && !force) return;
  const [tr, stats, list] = await Promise.all([Store.json("data/記録/取引.json"), Store.json("data/記録/成績.json").catch(() => null), Store.list("data/記録/判断ログ")]);
  S.trades = tr ? tr.data : []; S.stats = stats ? stats.data : false; S.logList = list.map(f => f.name.replace(/\.json$/, "")).filter(n => /^\d{4}-\d{2}-\d{2}$/.test(n)).sort().reverse();
}

/* ---------- 入力キュー（決定91・96） ---------- */
async function enqueue(kind, content) {
  const t = jst(); const id = `I${t.date}-${t.hms}-${String(Math.floor(Math.random() * 90) + 10)}`;
  const row = { id, 日時: t.iso, 種類: kind, 内容: content };
  try { await Store.put(`data/入力/人の入力/${id}.json`, toJSON(row), `画面: ${kind}${content.日付 ? " " + content.日付 : ""}`); }
  catch (e) { toast(e instanceof AuthError ? "書き込めません。トークンの権限を設定で確かめてください" : e instanceof ConflictError ? "同じ名前の入力があります。もう一度押してください" : "書き込めませんでした。電波を確かめて、もう一度押してください", true); throw e; }
  S.queue.push(row);
  toast(LOCAL ? `開発モード: 「${kind}」を書く代わりに表示しました（コンソールに内容）` : `「${kind}」を記録しました。次の定期実行で反映します`);
  return row;
}
const queued = (kind, pred = () => true) => S.queue.filter(r => r.種類 === kind && pred(r.内容 || {}));

/* ---------- 小さな部品 ---------- */
let toastTimer = null;
function toast(msg, err) { const el = $("#toast"); el.innerHTML = `<div class="toast${err ? " err" : ""}">${esc(msg)}</div>`; clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.innerHTML = ""; }, err ? 6000 : 3500); }
function head(title, meta = "", tag = "") { return `<header class="head"><h1>${title}${tag ? `<span class="tag">${esc(tag)}</span>` : ""}</h1>${meta ? `<p class="meta">${meta}</p>` : ""}</header>`; }
function empty(title, sub) { return `<section class="empty"><b>${esc(title)}</b>${sub ? `<p class="meta">${esc(sub)}</p>` : ""}</section>`; }
function alertBox(kind, label, body) { return `<div class="alert ${kind}"><b>${esc(label)}</b><span>${body}</span></div>`; }
function sheet(title, body, opts = {}) {
  S.sheet = opts.key || title;
  $("#layer").innerHTML = `<div class="scrim" data-act="close"></div><section class="sheet${opts.full ? " full" : ""}" role="dialog" aria-modal="true" aria-label="${esc(title.replace(/<[^>]+>/g, ""))}"><div class="grab"></div><div class="sheet-in">
    <div class="sheet-h"><h2>${title}</h2><button class="link quiet" data-act="close">閉じる</button></div>${body}</div></section>`;
  const f = $("#layer [autofocus]"); if (f) setTimeout(() => f.focus(), 50);
}
function closeSheet() { $("#layer").innerHTML = ""; S.sheet = null; }
function busy(btn, on) { if (btn) { btn.disabled = on; btn.classList.toggle("busy", on); } }

/* ================= 注文の行（今日・持ち高・記録で共通） ================= */
const isBuy = o => /買/.test(o.取引 || "") || (!o.取引 && o.方向 === "買い");
const term = p => !p ? "" : String(p).replace(/^期間指定\s*/, "");
function priceText(o) {
  if (o.注文種類 === "逆指値") return `逆指値 ${N(o.参照価格)}円${isBuy(o) ? "以上" : "以下"} → ${o.執行 === "指値" && o.価格 != null ? "指値 " + N(o.価格) + "円" : "成行"}`;
  if (o.注文種類 === "指値") return `指値 ${N(o.価格)}円${o.執行条件 && o.執行条件 !== "なし" ? `（${esc(o.執行条件)}）` : ""}`;
  if (o.注文種類 === "成行") return `成行${o.執行条件 && o.執行条件 !== "なし" ? `（${esc(o.執行条件)}）` : ""}`;
  return esc(o.注文種類 || "");
}
function tieText(t) {
  if (!t) return ""; const g = t.守り || {}, k = t.利確 || null;
  return `${esc(t.形 || "")} 守り ${N(g.参照価格)}円${k ? ` ／ 利確 ${N(k.価格)}円` : ""}`;
}
function reasonShort(o) {
  const r = o.理由; if (!r) return ""; if (typeof r === "string") return esc(r.split("。")[0]);
  const first = String(r.根拠 || "").split(/[。;；]/)[0];
  if (r.段 && first.startsWith(r.段)) return esc(first.replace(/^(.+?)[:：]\s*/, "$1："));   // 根拠が段の名前で始まるときは重ねない
  return `${esc(r.段 || "")}${first ? "：" + esc(first) : ""}`;
}
/* 注文一覧の行を、SBI で入れる単位にまとめる。OCO の守りと利確、その取消の2本は1行（データは2行のまま） */
function displayRows(orders, live) {
  const byId = Object.fromEntries((live || []).concat(orders || []).map(o => [o.id, o]));
  const used = new Set(); const rows = [];
  for (const o of orders || []) {
    if (used.has(o.id)) continue;
    if (o.注文 === "取消") {
      const tgt = byId[o.対象の注文id]; const pid = tgt && tgt.OCO;
      const pair = pid && (orders || []).find(x => x !== o && x.注文 === "取消" && x.対象の注文id === pid && !used.has(x.id));
      used.add(o.id); if (pair) used.add(pair.id);
      rows.push({ type: "cancel", ids: pair ? [o.id, pair.id] : [o.id], code: o.銘柄, name: o.銘柄名, target: tgt, pairTarget: pair ? byId[pid] : null, src: pair ? [o, pair] : [o] });
      continue;
    }
    const partner = o.OCO && (orders || []).find(x => x.id === o.OCO && !used.has(x.id));
    if (partner) {
      used.add(o.id); used.add(partner.id);
      const stop = o.種類 === "守り" ? o : partner, take = o.種類 === "守り" ? partner : o;
      rows.push({ type: "oco", ids: [o.id, partner.id], code: o.銘柄, name: o.銘柄名, stop, take, src: [stop, take] });
      continue;
    }
    used.add(o.id); rows.push({ type: "order", ids: [o.id], code: o.銘柄, name: o.銘柄名, o, src: [o] });
  }
  return rows;
}
function groupByCode(rows) { const g = []; for (const r of rows) { let x = g.find(y => y.code === r.code); if (!x) { x = { code: r.code, name: r.name, rows: [] }; g.push(x); } x.rows.push(r); } return g; }
function rowTitle(r) {
  if (r.type === "cancel") { const t = r.target; return `取消　${t ? esc(t.種類) + (r.pairTarget ? "・" + esc(r.pairTarget.種類) + "（OCO）" : "") : "注文 " + esc(r.src[0].対象の注文id)}`; }
  if (r.type === "oco") return `守り・利確 ${N(r.stop.株数)}株`;
  return `${esc(r.o.種類)} ${N(r.o.株数)}株`;
}
function rowLines(r) {   // [1行目の左, 2行目, 3行目]
  if (r.type === "cancel") { const t = r.target; return { kind: "取消", trade: "", term: "", qty: "", l2: t ? `${esc(t.種類)}${r.pairTarget ? "・" + esc(r.pairTarget.種類) + "（OCO）" : ""} ${N(t.株数)}株${t.置いた日 ? " · " + mdShort(t.置いた日) + "に置いたもの" : ""}` : `注文 ${esc(r.src[0].対象の注文id)}`, l3: "" }; }
  if (r.type === "oco") { const s = r.stop, k = r.take; return { kind: "守り・利確", trade: esc(s.取引 || ""), term: esc(term(s.期間)), qty: `${num(s.株数)}株`, l2: `OCO 指値 ${N(k.価格)}円 ／ 逆指値 ${N(s.参照価格)}円${isBuy(s) ? "以上" : "以下"}`, l3: reasonShort(s) }; }
  const o = r.o; return { kind: esc(o.種類 || ""), trade: esc(o.取引 || ""), term: esc(term(o.期間)), qty: `${num(o.株数)}株`, l2: priceText(o), l3: o.紐づく注文 ? tieText(o.紐づく注文) : reasonShort(o) };
}
function provBands(r) {
  const deps = [].concat(...r.src.map(o => o.依存する仮置き || [])); if (!deps.length) return "";
  const open = (S.state && S.state.仮置き) || [];
  return deps.map(d => {
    const code = d.銘柄 || r.code;
    const still = open.some(x => x.項目 === d.項目 && String(x.銘柄) === String(code));
    const q = queued("仮置きの確定", c => c.項目 === d.項目 && String(c.銘柄) === String(code)).length || queued("最終確認", c => (c.確定 || []).some(x => x.項目 === d.項目 && String(x.銘柄) === String(code))).length;
    if (!still && !q) return "";
    return `<div class="prov"><b>仮置き</b><span>${esc(d.項目)} ＝ ${esc(d.仮置きの値)}</span>${q ? '<span class="pending">確定済み</span>' : `<button class="link" data-act="fix" data-item="${esc(d.項目)}" data-code="${esc(code)}">確定</button>`}</div>`;
  }).join("");
}
function orderRowHTML(r, opts = {}) {
  const L = rowLines(r); const ids = esc(r.ids.join(","));
  const mark = opts.mark ? `<span class="pending">${opts.mark}</span>` : '<span class="chev">›</span>';
  return `<div class="ord${r.type === "cancel" ? " cancel" : ""}${opts.moot ? " dim" : ""}" role="button" tabindex="0" data-act="${opts.act || "order"}" data-ids="${ids}">
    <div class="l1"><span class="kind">${L.kind}</span>${L.trade ? `<span>${L.trade}</span>` : ""}${L.term ? `<span class="meta">${L.term}</span>` : ""}${L.qty ? `<span class="qty num">${L.qty}</span>` : '<span class="qty"></span>'}${mark}</div>
    <div class="l2">${L.l2}</div>${L.l3 ? `<div class="l3">${L.l3}</div>` : ""}${opts.moot ? '<div class="l3"><b>今日の約定で建玉がなくなったので置かない</b></div>' : opts.noProv ? "" : provBands(r)}</div>`;
}
function orderListHTML(rows, opts = {}) {
  return groupByCode(rows).map(g => {
    const pos = ((S.state && S.state.建玉) || []).find(p => String(p.銘柄) === String(g.code));
    return `<div class="grp"><div class="grp-h"><b><span class="num">${esc(g.code)}</span> ${esc(g.name || "")}</b>${pos ? `<span class="meta">建玉 ${N(pos.株数)}株</span>` : ""}</div>${g.rows.map(r => orderRowHTML(r, typeof opts === "function" ? opts(r) : opts)).join("")}</div>`;
  }).join("");
}
function findOrders(ids) {
  const all = [].concat(...Object.values(S.logs).map(L => [].concat(...(L.実行 || []).map(x => x.注文一覧 || []))), (S.state && S.state.注文中) || []);
  return ids.map(id => all.slice().reverse().find(o => o.id === id)).filter(Boolean);
}
function orderSheet(ids) {
  const src = findOrders(ids); if (!src.length) return;
  const rows = displayRows(src, (S.state && S.state.注文中) || []); const r = rows[0];
  const kv = (k, v) => v === "" || v == null ? "" : `<div><dt>${esc(k)}</dt><dd>${v}</dd></div>`;
  const blocks = r.src.map(o => {
    if (o.注文 === "取消") { const t = findOrders([o.対象の注文id])[0]; return `<div><p class="sub">取り消す注文</p><div class="panel sunk"><dl class="kv">${kv("注文", t ? `${esc(t.種類)} ${priceText(t)}` : esc(o.対象の注文id))}${t ? kv("株数", N(t.株数) + "株") + kv("置いた日", mdShort(t.置いた日)) : ""}${kv("理由", esc(typeof o.理由 === "string" ? o.理由 : (o.理由 || {}).根拠))}</dl></div></div>`; }
    const t = o.紐づく注文;
    return `<div><p class="sub">${r.type === "oco" ? esc(o.種類) + "（OCO）" : "注文（SBI の入力順）"}</p><div class="panel sunk"><dl class="kv">${kv("取引", esc(o.取引))}${kv("株数", N(o.株数) + "株")}${kv("価格", priceText(o))}${kv("期間", esc(o.期間))}${kv("預り区分", esc(o.預り区分))}
      ${t ? kv("守り", `逆指値 ${N((t.守り || {}).参照価格)}円${isBuy(o) ? "以下" : "以上"}で${(t.守り || {}).価格 ? "指値 " + N(t.守り.価格) + "円" : "成行"}`) + (t.利確 ? kv("利確", `指値 ${N(t.利確.価格)}円`) : "") + kv("守り・利確の期間", esc(term(t.期間))) : ""}</dl></div></div>`;
  }).join("");
  const o = r.src.find(x => x.注文 !== "取消") || r.src[0]; const why = o.理由 || {};
  const reason = typeof why === "string" ? `<p>${esc(why)}</p>` : `<p><b>${esc(why.段 || "")}${why.版 != null ? "　版" + esc(why.版) : ""}</b></p><p>${esc(why.根拠 || "")}</p>${why.合格の理由 ? `<p class="meta">合格の理由: ${esc(why.合格の理由)}</p>` : ""}`;
  const loss = o.想定最大損失;
  const fixed = (loss || o.期限 || (o.崩れの条件 || []).length) ? `<div><p class="sub">決まっていること</p><div class="panel sunk"><dl class="kv">${loss ? kv("損失の上限", `${N(loss.円)}円（資金の${esc(loss["資金比%"])}%）`) : ""}${o.期限 ? kv("期限", md(o.期限)) : ""}</dl>
    ${(o.崩れの条件 || []).length ? `<details class="more"><summary>崩れの条件 ${o.崩れの条件.length}つ</summary><ul>${o.崩れの条件.map(x => `<li>${esc(x)}</li>`).join("")}</ul></details>` : ""}</div></div>` : "";
  const deps = o.依存する仮置き || [];
  const prov = deps.length ? `<div><p class="sub yellow">仮置き</p>${deps.map(d => `<p><b>${esc(d.項目)} ＝ ${esc(d.仮置きの値)}</b></p><p class="meta">${esc(d.根拠 || "")}</p>`).join("")}${provBands(r)}</div>` : "";
  sheet(`<span class="num">${esc(r.code)}</span> ${esc(r.name || "")}　${r.type === "cancel" ? "取消" : r.type === "oco" ? "守り・利確" : esc(o.種類)}`, blocks + `<div><p class="sub">理由</p>${reason}</div>` + fixed + prov, { key: "order" });
}

/* ================= 今日 ================= */
function runOf(date, jp) { const L = S.logs[date]; return L && (L.実行 || []).find(r => r.判定点 === jp); }
function addMin(hhmm, k) { const [h, m] = hhmm.split(":").map(Number); const t = h * 60 + m + k; return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`; }
function lastRunText() { const l = (S.state && S.state.最後の実行) || {}; const v = [l[H], l[A]].filter(Boolean).sort().pop(); return v ? `${md(v)} ${hm(v)}` : "記録なし"; }
function nextRunLabel() {
  const t = jst(); if (!isBd(t.date)) return `${md(nextBd(t.date))} ${jpTime(A).replace(/^0/, "")}`;
  if (t.hm < jpTime(A)) return `今朝 ${jpTime(A).replace(/^0/, "")}`;
  if (t.hm < jpTime(H)) return `今日 ${jpTime(H)}`;
  const nb = nextBd(t.date); return `${nb === addDays(t.date, 1) ? "明日" : md(nb)} ${jpTime(A).replace(/^0/, "")}`;
}
function decideView() {
  if (S.viewOverride) return S.viewOverride;
  const t = jst(), today = t.date;
  if (!isBd(today)) { const d = prevBd(today); const r = runOf(d, H); return r ? { kind: "evening", date: d, run: r, holiday: true } : { kind: "none", title: "今日は休場日です", sub: `次の判定は ${md(nextBd(today))} ${jpTime(A).replace(/^0/, "")} です` }; }
  const rh = runOf(today, H); if (rh) return { kind: "evening", date: today, run: rh };
  if (t.hm < jpTime(A)) { const d = prevBd(today); const r = runOf(d, H); return r ? { kind: "evening", date: d, run: r } : { kind: "none", title: "前の営業日の判定がありません", sub: `朝の判定は ${jpTime(A).replace(/^0/, "")} です` }; }
  if (t.hm >= jpTime(H)) return { kind: "wait", jp: H, late: t.hm >= addMin(jpTime(H), 50) };
  const ra = runOf(today, A); const pd = prevBd(today);
  if (ra) return { kind: "morning", date: today, run: ra, prev: { date: pd, run: runOf(pd, H) } };
  return { kind: "wait", jp: A, late: t.hm >= addMin(jpTime(A), 50) };
}
function acctLine() {
  const a = (S.state && S.state.口座) || {};
  const pr = (l, v, c = "") => `<span class="pr"><span>${l}</span><b class="${c}">${v}</b></span>`;
  const nv = a["新規の可否（合成後）"] || {}; const stop = (a.停止 || {}).停止中;
  const newv = stop ? ["停止", "red"] : nv.買い ? [nv.売り === "可" ? `買い${esc(nv.買い)}・売り${esc(nv.売り)}` : esc(nv.買い), nv.買い === "可" ? "" : "red"] : ["—", ""];
  const st = a.縮小段階; const stc = !st || st === "通常" ? "" : st === "慎重" ? "yellow" : "red";
  const live = ((S.state && S.state.注文中) || []).filter(o => o.状態 === "発注済み").length;
  return `<div class="acct"><p>${pr("新規", newv[0], newv[1])}${pr("縮小段階", esc(st || "—"), stc)}${pr("相場", esc(a.相場の区分 || "—"))}</p>
    <p>${pr("資金", a.現在の資金 != null ? N(a.現在の資金) + "円" : "—")}${pr("建玉", N(((S.state && S.state.建玉) || []).length))}${pr("注文中", N(live))}</p></div>`;
}
function commonAlerts(run) {
  const out = [];
  const a = (S.state && S.state.口座) || {};
  if (a.現金 == null && !queued("入出金").length) out.push(alertBox("y", "資金が未記録", `最初の入金を記録すると、株数が決まります。<a href="#log">記録タブの入出金から入れる</a>`));
  if ((a.停止 || {}).停止中) out.push(alertBox("r", "停止中", `解除するまで新規は出ません。${a.停止.理由 ? "理由: " + esc(a.停止.理由) + "。" : ""}<a href="#log">記録タブで解除</a>`));
  for (const w of (run && run.警告) || []) out.push(alertBox(/整合検査|中身を空/.test(w) ? "r" : "y", "警告", esc(w)));
  const ack = store("iremono.ack") || []; const since = addDays(jst().date, -7);
  for (const f of (S.qlog || []).filter(x => x.結果 === "失敗" && !ack.includes(x.id) && String(x.取り込み日時 || "").slice(0, 10) >= since).slice(-3))
    out.push(alertBox("r", "取り込めず", `${esc(f.種類)}（${mdShort(f.日時)} ${hm(f.日時)}に入力）: ${esc(f.理由)}。入れ直してください。<button class="link" data-act="ack" data-id="${esc(f.id)}">確認した</button>`));
  if (S.queue.length) out.push(alertBox("y", `未取り込み ${S.queue.length}件`, `${esc(nextRunLabel())} に反映します`));
  return out.length ? `<div class="alerts">${out.join("")}</div>` : "";
}
function step(no, title, cls, body = "", right = "", sum = "") {
  return `<li class="step ${cls}"><div class="step-h"><span class="no">${cls === "done" ? CHECK : no}</span><h3>${title}</h3>${right ? `<span class="meta">${right}</span>` : ""}</div>${sum ? `<p class="sum">${sum}</p>` : ""}${body ? `<div class="step-b">${body}</div>` : ""}</li>`;
}
const confirmKey = d => `iremono.confirm.${d}`;   // 注文一覧の確認の結果（置く手順で最終確認として記録するまでの下書き）
function closedToday(fills) {   // 記録した返済の約定で建玉がなくなる建玉の id（今夜のその建玉の注文は置かない）
  const pos = (S.state && S.state.建玉) || []; const sum = {};
  for (const f of fills) { const c = f.内容 || {}; if (c.新規か返済 !== "返済") continue;
    const o = findOrders([c.注文id])[0]; const pid = o && o.建玉id ? o.建玉id : (pos.find(p => String(p.銘柄) === String(c.銘柄) && p.方向 === c.方向) || {}).id;
    if (pid) sum[pid] = (sum[pid] || 0) + Number(c.株数 || 0); }
  return new Set(pos.filter(p => sum[p.id] >= p.株数).map(p => p.id));
}
function rowPosIds(r) { return r.src.map(o => o.建玉id || (o.注文 === "取消" ? (findOrders([o.対象の注文id])[0] || {}).建玉id : null)).filter(Boolean); }
function eveningState(v) {
  const R = v.run, D = v.date, trial = R.執行者 === TRIAL;
  const qConf = queued("最終確認", c => c.日付 === D && c.判定点 === H);
  const conf = R.人の最終確認 && R.人の最終確認.結果 && R.人の最終確認.結果 !== "未" ? R.人の最終確認 : (qConf.length ? Object.assign({ 取り込み待ち: true }, qConf[qConf.length - 1].内容) : null);
  const L = S.logs[D] || {};
  const qFill = queued("約定の確認", c => c.日付 === D); const fills = queued("約定", c => c.日付 === D);
  const fillDone = (L.約定の確認 || []).length ? L.約定の確認[L.約定の確認.length - 1] : (qFill.length ? Object.assign({ 取り込み待ち: true }, qFill[qFill.length - 1].内容) : null);
  const pend = store(confirmKey(D));
  const noop = (L.作業なし || []).length || queued("作業なし", c => c.日付 === D).length;
  const rows = displayRows(R.注文一覧 || [], (S.state && S.state.注文中) || []);
  const cands = ((S.state && S.state.注文中) || []).filter(o => o.状態 === "発注済み" && !o.仮想);
  const closed = closedToday(fills);
  return { R, D, trial, conf, pend, fillDone, fills, rows, cands: displayRows(cands, cands), noop, closed, moot: r => rowPosIds(r).some(id => closed.has(id)) };
}
function eveningHTML(v) {
  const E = eveningState(v); const { R, D, trial, conf, rows } = E;
  const tag = trial ? "試運転" : "";
  let html = head(`${md(D)}<span>引け後</span>`, `判定 ${hm(R.終了)}${v.holiday ? " · 今日は休場日" : ""}${S.viewOverride ? ' · <button class="link quiet" data-act="view-now">今に戻る</button>' : ""}`, tag) + commonAlerts(R) + acctLine();
  if (E.noop && !conf) return html + empty("今日は作業なしと記録しました", "新規は置かれず、守りは期間指定で残ります");
  const hasOrders = rows.length > 0;
  const fillNeed = !trial && E.cands.length > 0, fillDone = !!E.fillDone;
  const confDone = !!conf || (!trial && !!E.pend);
  const placeDone = !!conf;
  const confSum = conf ? `${esc(conf.結果)}${conf.裁量 && (typeof conf.裁量 === "string" ? conf.裁量 : conf.裁量.length) ? " · 裁量あり" : ""}${conf.取り込み待ち ? " · 取り込み待ち" : conf.日時 ? " · " + hm(conf.日時) : ""}${trial ? " · 仮想の発注として記録" : ""}` : E.pend ? `${esc(E.pend.結果)} · まだ記録していません` : "";
  const nMoot = rows.filter(E.moot).length;
  const confBody = `<p class="lead">手順どおりか、仮置きが根拠に合うかを見る</p>${nMoot ? `<p class="meta">今日の約定で建玉がなくなった銘柄の注文（${nMoot}件）は置きません</p>` : ""}${orderListHTML(rows, r => ({ moot: E.moot(r) }))}
      <div class="actions"><button class="btn" data-act="confirm" data-date="${D}">手順どおりで確認</button><button class="link quiet" data-act="changed" data-date="${D}">変えたので理由を書く</button></div>`;
  const steps = [];
  let cur = 0;
  // 手順1 約定を記録する（SBI の約定照会を見てから、今夜の注文に進む）
  if (trial) steps.push(step(1, "約定を記録する", "skip", "", "不要", "道具が日足から仮の約定を付ける"));
  else if (!fillNeed) steps.push(step(1, "約定を記録する", "skip", "", "不要", "約定しうる注文はありません"));
  else if (fillDone) steps.push(step(1, "約定を記録した", "done", "", "", `${num(E.fillDone.件数)}件${E.fillDone.取り込み待ち ? " · 取り込み待ち" : ""}`));
  else { steps.push(step(1, "約定を記録する", "cur", fillBody(E), `${E.cands.length}件`)); cur = 1; }
  // 手順2 注文一覧を確認する
  if (!hasOrders) steps.push(step(2, "注文一覧を確認する", "done", "", "", "注文はありません"));
  else if (confDone) steps.push(step(2, "注文一覧を確認した", "done", "", "", confSum));
  else if (cur === 0) { steps.push(step(2, "注文一覧を確認する", "cur", confBody, `${rows.length}件`)); cur = 2; }
  else steps.push(step(2, "注文一覧を確認する", "next"));
  // 手順3 SBI に置く
  if (trial) steps.push(step(3, "SBI に置く", "skip", "", "不要", "試運転なので置かない"));
  else if (!hasOrders) steps.push(step(3, "SBI に置く", "skip", "", "不要", "置く注文はありません"));
  else if (placeDone) steps.push(step(3, "SBI に置いた", "done", "", "", placedSummary(conf, rows)));
  else if (cur === 0) { steps.push(step(3, "SBI に置く", "cur", placeBody(rows, D, H, E.moot), `${rows.length - nMoot}件`)); cur = 3; }
  else steps.push(step(3, "SBI に置く", "next"));
  const total = trial ? 1 : 3; const done = trial ? (confDone || !hasOrders ? 1 : 0) : [fillDone || !fillNeed, confDone || !hasOrders, placeDone || !hasOrders].filter(Boolean).length;
  const allDone = cur === 0;
  html += `<section>${allDone ? `<p class="done-msg green">${CHECK}<span>${hasOrders || fillNeed ? "今夜の手順は終わりです" : "今夜はすることがありません"}</span></p>` : ""}
    <div class="steps-h"><h2>今夜の手順</h2><span class="meta num">${done} / ${total}</span></div><ol class="steps-l">${steps.join("")}</ol></section>`;
  if (!conf) html += `<div class="foot"><button class="link quiet" data-act="noop" data-date="${D}">今日は作業できない</button></div>`;
  return html;
}
function placedSummary(conf, rows) {
  const p = conf.置いた; let n = rows.length;
  if (Array.isArray(p)) n = rows.filter(r => r.ids.some(id => p.includes(id))).length; else if (p === "なし") n = 0; else if (typeof p === "string" && p !== "全部") { const ids = p.split(","); n = rows.filter(r => r.ids.some(id => ids.includes(id))).length; }
  return `${n}件${conf.取り込み待ち ? " · 取り込み待ち" : conf.日時 ? " · " + hm(conf.日時) : ""}`;
}
function placeLine(r) {
  if (r.type === "cancel") return rowTitle(r) + (r.target ? ` ${N(r.target.株数)}株` : "");
  if (r.type === "oco") return `守り・利確 ${N(r.stop.株数)}株　OCO ${N(r.take.価格)}円 ／ ${N(r.stop.参照価格)}円`;
  return `${esc(r.o.種類)} ${N(r.o.株数)}株　${priceText(r.o)}`;
}
function placeBody(rows, D, jp, moot = () => false) {
  return `<p class="lead">置けなかった注文だけチェックを外す</p><div>${rows.map((r, i) => { const m = moot(r); return `<label class="chk${m ? " dim" : ""}"><input type="checkbox" id="pl${i}" data-ids="${esc(r.ids.join(","))}"${m ? ' data-moot="1"' : " checked"} data-act="place-toggle"><span><b><span class="num">${esc(r.code)}</span> ${esc(r.name || "")}</b><br><span class="q">${placeLine(r)}</span>${m ? '<br><span class="q">今日の約定で建玉がなくなったので置かない</span>' : `
      <span class="reason-in" hidden><span class="seg" role="group" aria-label="置かなかった理由"><button type="button" data-act="seg" data-val="できなかった">できなかった</button><button type="button" data-act="seg" data-val="見送った">見送った</button></span></span>`}</span></label>`; }).join("")}</div>
    <div class="actions"><button class="btn" data-act="placed" data-date="${D}" data-jp="${jp}">${jp === A ? "全部出した" : "全部置いた"}</button></div>`;
}
function fillBody(E) {
  const recorded = id => E.fills.some(f => f.内容.注文id === id);
  return `<p class="lead">SBI で今日の約定を見て、約定した注文を選ぶ</p>${orderListHTML(E.cands, r => ({ act: "fill", noProv: true, mark: r.ids.some(recorded) ? "記録済み" : "" }))}
    <div class="actions"><button class="btn" data-act="fill-done" data-date="${E.D}" data-n="${E.fills.length}">${E.fills.length ? "約定はこれで全部" : "今日は約定なし"}</button></div>`;
}
function morningHTML(v) {
  const R = v.run, D = v.date, trial = R.執行者 === TRIAL;
  let html = head(`${md(D)}<span>寄付前</span>`, `判定 ${hm(R.終了)}`, trial ? "試運転" : "");
  const alerts = [commonAlerts(R)];
  const pv = v.prev && v.prev.run;
  if (pv && (pv.注文一覧 || []).length && (!pv.人の最終確認 || pv.人の最終確認.結果 === "未") && !queued("最終確認", c => c.日付 === v.prev.date && c.判定点 === H).length)
    alerts.push(`<div class="alerts">${alertBox("y", "昨夜の確認がまだ", `${mdShort(v.prev.date)}の注文一覧が確認されていません。<button class="link" data-act="view-prev">開く</button>`)}</div>`);
  html += alerts.join("") + acctLine();
  const rows = displayRows(R.注文一覧 || [], (S.state && S.state.注文中) || []);
  if (!rows.length) return html + empty("変更なし。朝はすることがありません", "夜の注文はそのまま置いておきます");
  const q = queued("最終確認", c => c.日付 === D && c.判定点 === A);
  const conf = R.人の最終確認 && R.人の最終確認.結果 !== "未" ? R.人の最終確認 : (q.length ? Object.assign({ 取り込み待ち: true }, q[q.length - 1].内容) : null);
  if (conf) return html + `<section><p class="done-msg green">${CHECK}<span>朝の手順は終わりです</span></p><ol class="steps-l">${step(1, trial ? "変更を確認した" : "SBI で出した", "done", "", "", placedSummary(conf, rows))}</ol></section>`;
  const body = trial ? `${orderListHTML(rows)}<div class="actions"><button class="btn" data-act="confirm-am" data-date="${D}">手順どおりで確認</button></div>` : `<p class="lead">取消・訂正・寄成を SBI で出す。出せなかった注文だけチェックを外す</p>${orderListHTML(rows)}${placeBody(rows, D, A).replace("置けなかった注文だけチェックを外す", "出せなかった注文だけチェックを外す")}`;
  return html + `<section><div class="steps-h"><h2>朝の手順</h2><span class="meta num">0 / 1</span></div><ol class="steps-l">${step(1, trial ? "変更を確認する" : "SBI で出す", "cur", body, `${rows.length}件`)}</ol></section>`;
}
function todayHTML() {
  const v = decideView();
  if (v.kind === "evening") return eveningHTML(v);
  if (v.kind === "morning") return morningHTML(v);
  let html = head(`${md(jst().date)}`, `最後の判定 ${lastRunText()}`);
  if (v.kind === "wait" && v.late) html += `<div class="alerts">${alertBox("r", "判定なし", `今日の${v.jp === H ? "引け後" : "寄付前"}の定期実行が動いていません。claude.ai の定期実行を確かめてください`)}</div>`;
  html += commonAlerts(null) + acctLine();
  if (v.kind === "wait") return html + (v.late ? empty("今日の手順はまだありません", "判定が出たら、ここに手順が出ます") : empty("今日の判定はまだ動いていません", `${v.jp === H ? jpTime(H) : jpTime(A).replace(/^0/, "")} の定期実行が終わるまでお待ちください（いつもは30分ほど）`));
  return html + empty(v.title, v.sub);
}

/* ================= 持ち高 ================= */
function placed(pos, kind, key) {   // 建玉に置いてある守り・利確の注文の価格（呼値に丸めた実際の値）。無ければ null
  const o = ((S.state && S.state.注文中) || []).find(x => x.建玉id === pos.id && x.種類 === kind && x.状態 === "発注済み");
  return o && o[key] != null ? o[key] : null;
}
const rText = x => x == null ? "—" : `${x >= 0 ? "+" : "−"}${Math.abs(Number(x)).toFixed(1)}R`;
function holdHTML() {
  const s = S.state || {}; const a = s.口座 || {}; const lim = a.上限の残り || {};
  const names = Object.fromEntries((s.監視リスト || []).map(w => [String(w.銘柄), w.銘柄名]).concat((s.建玉 || []).map(p => [String(p.銘柄), p.銘柄名])));
  let html = head("持ち高", s.更新日時 ? `${md(s.更新日時)} ${hm(s.更新日時)} の判定の時点` : "");
  const pos = s.建玉 || [];
  html += `<section class="sec"><div class="sec-h"><h2>建玉 ${pos.length}</h2>${lim.同時保有数の上限 != null ? `<span class="meta">同時 <span class="num">${num(lim.建玉の数)} / ${num(lim.同時保有数の上限)}</span></span>` : ""}</div>`;
  html += pos.length ? `<div class="panel">${pos.map(p => { const d = p.表示 || {}; return `<div class="row"><div class="t"><b><span class="num">${esc(p.銘柄)}</span> ${esc(p.銘柄名 || "")}${p.種別 === "ヘッジ" ? "（ヘッジ）" : ""}</b><span class="r num">${rText(d.含み益のR倍)}</span></div>
      <p class="m">${esc(p.方向 === "売り" ? "売り " : "")}${N(p.株数)}株 · 建値 ${N(p.建値)}円 · 終値 ${N(d.終値)}円</p>
      <p class="m">守り ${N(placed(p, "守り", "参照価格") ?? p.守り)}円${(placed(p, "利確", "価格") ?? p.利確) != null ? ` · 利確 ${N(placed(p, "利確", "価格") ?? p.利確)}円` : ""}</p>
      ${p.期限 ? `<p class="m">期限 ${md(p.期限)}${d.期限までの営業日 != null ? `（あと${N(d.期限までの営業日)}営業日）` : ""}</p>` : ""}
      ${(p.崩れの条件 || []).length ? `<details class="more"><summary>崩れの条件 ${p.崩れの条件.length}つ</summary><ul>${p.崩れの条件.map(x => `<li>${esc(x)}</li>`).join("")}</ul></details>` : ""}</div>`; }).join("")}</div>` : empty("建玉はありません", "");
  html += `</section>`;
  const live = (s.注文中 || []).filter(o => o.状態 === "発注済み");
  const rows = displayRows(live, live);
  html += `<section class="sec"><div class="sec-h"><h2>注文中 ${rows.length}</h2></div>` + (rows.length ? `<div class="panel">${rows.map(r => { const L = rowLines(r); const o = r.src[0]; return `<div class="row" role="button" tabindex="0" data-act="order" data-ids="${esc(r.ids.join(","))}"><div class="t"><b><span class="num">${esc(r.code)}</span> ${esc(r.name || names[String(r.code)] || "")}　${L.kind}</b><span class="r num">${esc(L.qty)}</span></div><p class="m">${L.l2}${o.有効期限日 ? ` · ${mdShort(o.有効期限日)}まで` : ""}${o.仮想 ? " · 仮想" : ""}</p></div>`; }).join("")}</div>` : `<p class="meta">置いてある注文はありません</p>`) + `</section>`;
  if (Object.keys(lim).length) html += `<section class="sec"><div class="sec-h"><h2>上限の残り</h2></div><div class="panel"><dl class="kv">
      ${lim.同時保有数の上限 != null ? `<div><dt>同時に持つ銘柄</dt><dd class="num">${num(lim.建玉の数)} / ${num(lim.同時保有数の上限)}</dd></div>` : ""}
      ${lim["建玉総額の資金比%"] != null ? `<div><dt>建玉総額</dt><dd class="num">${num(lim["建玉総額の資金比%"])}% / ${num(lim["目標の建玉総額%"] != null ? lim["目標の建玉総額%"] : lim["建玉総額の上限%"])}%</dd></div>` : ""}
      ${lim.今日の新規の件数 != null ? `<div><dt>今日の新規</dt><dd class="num">${num(lim.今日の新規の件数)}${lim["1日の最大件数"] != null ? " / " + num(lim["1日の最大件数"]) : ""}件</dd></div>` : ""}</dl></div></section>`;
  const prov = s.仮置き || [];
  if (prov.length) html += `<section class="sec"><div class="sec-h"><h2>仮置き ${prov.length}</h2></div><div class="panel">${prov.map(x => { const q = queued("仮置きの確定", c => c.項目 === x.項目 && String(c.銘柄) === String(x.銘柄)).length; return `<div class="row"><div class="t"><b><span class="num">${esc(x.銘柄)}</span> ${esc(names[String(x.銘柄)] || "")}　${esc(x.項目)} ＝ ${esc(x.値)}</b>${q ? '<span class="r pending">確定済み</span>' : `<button class="link r" data-act="fix" data-item="${esc(x.項目)}" data-code="${esc(x.銘柄)}">確定</button>`}</div><p class="m">${esc(x.根拠 || "")}${x.有効期限 ? ` · ${mdShort(x.有効期限)}まで` : ""}</p></div>`; }).join("")}</div></section>`;
  const pass = s.合格 || [], watch = s.監視リスト || [];
  const passRow = x => `<div class="row"><div class="t"><b><span class="num">${esc(x.銘柄)}</span> ${esc(names[String(x.銘柄)] || "")}</b><span class="r meta" style="font-weight:400">${x.有効期限 ? mdShort(x.有効期限) + "まで" : ""}</span></div></div>`;
  html += `<section class="sec"><div class="sec-h"><h2>合格 ${pass.length}</h2><span class="meta">監視リスト ${watch.length}</span></div>` + (pass.length ? `<div class="panel">${pass.slice(0, 5).map(passRow).join("")}</div>${pass.length > 5 ? `<details class="more"><summary>残り${pass.length - 5}銘柄を見る</summary><div class="panel">${pass.slice(5).map(passRow).join("")}</div></details>` : ""}` : `<p class="meta">合格した銘柄はまだありません</p>`)
    + (watch.length ? `<details class="more"><summary>監視リストを見る</summary><div class="panel">${watch.map(w => `<div class="row"><div class="t"><b><span class="num">${esc(w.銘柄)}</span> ${esc(w.銘柄名 || "")}</b><span class="r meta" style="font-weight:400">${esc(w.リスト || "")}</span></div></div>`).join("")}</div></details>` : "") + `</section>`;
  return html;
}

/* ================= 記録 ================= */
function logHTML() {
  if (!S.trades || !S.logList) return head("記録") + `<p class="meta">読み込んでいます</p>`;
  const st = S.stats; const a = (S.state && S.state.口座) || {};
  let html = head("記録");
  const g = st && st.戦略全体; const acc = st && st.口座全体;
  html += `<section class="sec"><div class="sec-h"><h2>成績</h2>${st ? `<span class="meta">${mdShort(st.更新日時)}の集計</span>` : ""}</div>`;
  if (g && g.件数) html += `<div class="panel"><dl class="grid2"><div><dt>件数</dt><dd class="num">${num(g.件数)}</dd></div><div><dt>勝率</dt><dd class="num">${num(g["勝率%"])}%</dd></div>
      <div><dt>平均利益</dt><dd class="num">${rText(g.平均利益R)}</dd></div><div><dt>平均損失</dt><dd class="num">${rText(g.平均損失R)}</dd></div>
      <div><dt>損益比</dt><dd class="num">${num(g.損益比)}</dd></div><div><dt>期待値</dt><dd class="num">${rText(g.期待値R)}</dd></div>
      <div><dt>最大損失</dt><dd class="num">${rText(g.最大損失R)}</dd></div><div><dt>保有日数</dt><dd class="num">${num(g.平均保有営業日数)}日</dd></div>
      ${acc ? `<div><dt>開始比</dt><dd class="num">${acc["開始比%"] != null ? (acc["開始比%"] >= 0 ? "+" : "") + num(acc["開始比%"]) + "%" : "—"}</dd></div><div><dt>最大の落ち込み</dt><dd class="num">${num(acc["最大ドローダウン%"])}%</dd></div>` : ""}</dl></div>`;
  else html += empty("決済した取引はまだありません", `${((S.strat && S.strat.見直しの中身) || {}).最小件数 || 20}件たまったら見直します`);
  html += `</section>`;
  const tr = (S.trades || []).slice().sort((x, y) => String(lastDate(y)).localeCompare(String(lastDate(x))));
  const trRow = t => { const pos = ((S.state && S.state.建玉) || []).find(p => p.取引id === t.id || p.id === t.id); const ex = (t.手仕舞い || [])[t.手仕舞い.length - 1];
    const right = t.状態 === "決済済み" ? rText(t.R倍数) : pos && pos.表示 ? rText(pos.表示.含み益のR倍) : "";
    const sub = t.状態 === "決済済み" ? `決済 · ${esc(ex ? ex.種類 : "")} · ${mdShort(ex && ex.日付)}` : `${esc(t.状態)}${pos ? " · 含み" : ""} · ${mdShort(((t.建て || [])[0] || {}).日付)}から`;
    return `<div class="row"><div class="t"><b><span class="num">${esc(t.銘柄)}</span> ${esc(t.銘柄名 || "")}</b><span class="r num">${right}</span></div><p class="m">${sub}${t.ルール通り && t.ルール通り.判定 === "いいえ" ? ' · <span class="yellow">裁量</span>' : ""}</p></div>`; };
  html += `<section class="sec"><div class="sec-h"><h2>取引</h2><span class="meta">新しい順</span></div>` + (tr.length ? `<div class="panel">${tr.slice(0, 8).map(trRow).join("")}</div>${tr.length > 8 ? `<details class="more"><summary>前の取引を見る（${tr.length - 8}件）</summary><div class="panel">${tr.slice(8).map(trRow).join("")}</div></details>` : ""}` : `<p class="meta">取引はまだありません</p>`) + `</section>`;
  const dayRow = d => `<div class="row" role="button" tabindex="0" data-act="day" data-date="${d}"><div class="t"><b>${md(d)}</b><span class="r chev">›</span></div></div>`;
  html += `<section class="sec"><div class="sec-h"><h2>判断ログ</h2></div>` + (S.logList.length ? `<div class="panel">${S.logList.slice(0, 7).map(dayRow).join("")}</div>${S.logList.length > 7 ? `<details class="more"><summary>前の日を見る</summary><div class="panel">${S.logList.slice(7, 60).map(dayRow).join("")}</div></details>` : ""}` : `<p class="meta">判断ログはまだありません</p>`) + `</section>`;
  const flows = (a.入出金 || []).slice().reverse();
  html += `<section class="sec"><div class="sec-h"><h2>入出金</h2></div>` + (flows.length ? `<div class="panel">${flows.slice(0, 6).map((f, i) => `<div class="row"><div class="t"><b>${esc(f.種類)}</b><span class="r num">${f.金額 >= 0 ? "" : "−"}${num(Math.abs(f.金額))}円</span></div><p class="m">${mdShort(f.日付)}${i === flows.length - 1 && f.種類 === "入金" ? " · 開始時の資金" : ""}${f.備考 ? " · " + esc(f.備考) : ""}</p></div>`).join("")}</div>` : `<p class="meta">入出金の記録はまだありません。最初の入金が開始時の資金になります</p>`) + `</section>`;
  const stopped = (a.停止 || {}).停止中;
  html += `<section class="sec"><div class="sec-h"><h2>記録する</h2></div><div class="panel"><button class="actrow" data-act="cash">入出金</button><button class="actrow" data-act="balance">SBI の現金残高と突き合わせる</button><button class="actrow" data-act="${stopped ? "resume" : "stop"}">${stopped ? "取引を再開する" : "取引を止める"}</button></div></section>`;
  return html;
}
function lastDate(t) { const xs = [].concat((t.建て || []).map(x => x.日付), (t.手仕舞い || []).map(x => x.日付)).filter(Boolean).sort(); return xs[xs.length - 1] || ""; }
async function daySheet(date) {
  sheet(md(date), `<p class="meta">読み込んでいます</p>`, { key: "day" });
  let L; try { L = (await Store.json(`data/記録/判断ログ/${date}.json`) || {}).data; } catch (e) { L = null; }
  if (!L) { sheet(md(date), `<p class="meta">この日の判断ログを読めませんでした</p>`, { key: "day" }); return; }
  S.logs[date] = S.logs[date] || L;
  const runs = (L.実行 || []).map(r => { const rows = displayRows(r.注文一覧 || [], (r.状態の写し || {}).注文中 || []); const c = r.人の最終確認 || {};
    return `<div><p class="sub">${r.判定点 === H ? "引け後" : "寄付前"}　${hm(r.終了)}${r.執行者 === TRIAL ? " · 試運転" : ""}</p><div class="panel sunk"><dl class="kv"><div><dt>注文</dt><dd>${rows.length}件</dd></div><div><dt>人の最終確認</dt><dd>${esc(c.結果 || "未")}${c.日時 ? " · " + hm(c.日時) : ""}</dd></div>${(c.裁量 || []).map(x => `<div><dt>裁量</dt><dd>${esc(x.内容 || x)}</dd></div>`).join("")}${(r.警告 || []).map(w => `<div><dt>警告</dt><dd>${esc(w)}</dd></div>`).join("")}</dl></div>
      ${rows.length ? `<div style="margin-top:8px">${orderListHTML(rows, { noProv: true })}</div>` : ""}</div>`; }).join("");
  const extra = [(L.作業なし || []).length ? "作業なしの記録あり" : "", (L.約定の確認 || []).length ? `約定の記録 ${num(L.約定の確認[L.約定の確認.length - 1].件数)}件` : ""].filter(Boolean).join(" · ");
  sheet(md(date), (runs || `<p class="meta">この日は判定点の実行がありません</p>`) + (extra ? `<p class="meta">${extra}</p>` : ""), { key: "day" });
}
function cashSheet() {
  const t = jst().date;
  sheet("入出金を記録", `<div class="field"><span class="label">種類</span><div class="seg" role="group" aria-label="種類"><button type="button" data-act="seg" data-val="入金" aria-pressed="true">入金</button><button type="button" data-act="seg" data-val="出金">出金</button></div></div>
    <div class="vrow"><div class="field"><label for="c-date">日付</label><div class="in"><input id="c-date" type="date" value="${t}"></div></div>
    <div class="field"><label for="c-amt">金額</label><div class="in"><input id="c-amt" class="right num" inputmode="numeric" placeholder="0" autofocus><span class="u">円</span></div></div></div>
    <div class="field"><label for="c-note">備考</label><div class="in"><input id="c-note" placeholder="なくてよい"></div></div>
    <p class="meta">最初の入金が開始時の資金になります</p><div class="actions"><button class="btn" data-act="cash-save">記録する</button></div>`, { key: "cash" });
}
function balanceSheet() {
  const a = (S.state && S.state.口座) || {};
  sheet("現金残高を突き合わせる", `<p class="meta">道具の現金は ${N(a.現金)}円です。SBI の現金残高を入れると、差額を調整として記録します（手数料・金利・配当など）</p>
    <div class="vrow"><div class="field"><label for="b-date">日付</label><div class="in"><input id="b-date" type="date" value="${jst().date}"></div></div>
    <div class="field"><label for="b-cash">SBI の現金残高</label><div class="in"><input id="b-cash" class="right num" inputmode="numeric" autofocus><span class="u">円</span></div></div></div>
    <div class="actions"><button class="btn" data-act="balance-save">記録する</button></div>`, { key: "balance" });
}
function stopSheet(resume) {
  if (resume) sheet("取引を再開する", `<p class="meta">解除を記録すると、次の判定から新規が出るようになります</p><div class="actions"><button class="btn" data-act="resume-save">再開する</button></div>`, { key: "resume" });
  else sheet("取引を止める", `<p class="meta">止めると、解除するまで新規は出ません。守りの注文はそのまま残ります</p><div class="field"><label for="s-why">理由</label><textarea id="s-why" class="ta" placeholder="例: 旅行で1週間見られない" autofocus></textarea></div><div class="actions"><button class="btn" data-act="stop-save">止める</button></div>`, { key: "stop" });
}

/* ================= 戦略（読む） ================= */
const SKEY = "#strat/";
function stageDef(name) { return (S.box.段 || []).find(s => s.名前 === name); }
function stageBody(name) { return (S.strat.段 || {})[name] || { 版: 0, 説明: "", 数値: {}, 規則: [], 既定: null }; }
function fmtVal(v) {
  if (v && typeof v === "object" && !Array.isArray(v)) {
    if (typeof v.項目 === "string") return "項目「" + esc(v.項目) + "」" + (v.引数 && Object.keys(v.引数).length ? "(" + Object.entries(v.引数).map(([k, x]) => esc(k) + "=" + esc(x)).join(", ") + ")" : "");
    if (typeof v.数値 === "string") return "数値「" + esc(v.数値) + "」";
    if (typeof v.式 === "string") return '式 <span class="expr">' + esc(v.式) + "</span>";
    if (v.営業日後 !== undefined) return fmtVal(v.営業日後) + "営業日後";
    return Object.entries(v).map(([k, x]) => esc(k) + "=" + fmtVal(x)).join(", ");
  }
  if (Array.isArray(v)) return "［" + v.map(fmtVal).join("、") + "］";
  return esc(v);
}
const condText = c => `${esc(c.項目)}${c.引数 && Object.keys(c.引数).length ? "(" + Object.entries(c.引数).map(([k, x]) => esc(k) + "=" + esc(x)).join(", ") + ")" : ""} <span class="op">${esc(c.比較)}</span> ${c.値 === undefined ? "" : fmtVal(c.値)}`;
function stratHTML() {
  if (!S.strat) return head("戦略") + `<p class="meta">読み込んでいます</p>`;
  const groups = {}; (S.box.段 || []).forEach(s => (groups[s.まとまり] = groups[s.まとまり] || []).push(s));
  const last = (S.revs || []).filter(r => r.対象 === "中身").map(r => r.日付).sort().pop();
  let html = head("戦略", `版${esc(S.strat.版)}${last ? " · 最終改定 " + mdShort(last) : ""}`) + pendingRevAlert();
  html += `<section class="sec">${Object.entries(groups).map(([g, ss]) => `<p class="grp-label">${esc(g)}</p><div class="panel">${ss.map(s => { const b = stageBody(s.名前); return `<a class="stg" href="${SKEY}${encodeURIComponent(s.名前)}"><b>${esc(s.名前)}</b><span class="v">${s.中身あり ? (b.版 ? "版" + esc(b.版) : "中身なし") : "入れ物の規則"}</span><p>${esc(b.説明 || s.問い)}</p></a>`; }).join("")}</div>`).join("")}</section>`;
  html += `<section class="sec"><div class="panel"><a class="numrow" href="#strat-revs"><span>改定履歴</span><span class="val num">${num((S.revs || []).length)}件</span></a><a class="numrow" href="#strat-dict"><span>辞書</span><span class="val num">${num((S.dic.項目 || []).length)}項目</span></a></div></section>`;
  return html;
}
function stageHTML(name) {
  if (!S.strat) return `<p class="meta">読み込んでいます</p>`;
  const s = stageDef(name); if (!s) return `<a class="back" href="#strat">‹ 戦略</a>` + empty("この段は入れ物にありません", "");
  const b = stageBody(name);
  let html = `<a class="back" href="#strat">‹ 戦略</a>` + head(esc(name), `${esc(s.まとまり)} · ${s.中身あり ? (b.版 ? "版" + esc(b.版) : "中身なし（版0）") : "入れ物の規則"} · ${esc((s.判定点 || []).join("・"))}`) + pendingRevAlert() + `<p class="q">${esc(s.問い)}</p>`;
  if (!s.中身あり) return html + `<section class="sec"><div class="sec-h"><h2>入れ物の決めごと</h2></div><div class="rule panel"><ul>${(s.設計上の決めごと || []).map(x => `<li>${esc(x)}</li>`).join("")}</ul></div></section>`;
  if (b.説明) html += `<p class="meta">${esc(b.説明)}</p>`;
  const nums = Object.entries(b.数値 || {});
  html += `<section class="sec"><div class="sec-h"><h2>数値</h2></div>${nums.length ? `<div class="panel">${nums.map(([k, v]) => `<a class="numrow" href="#" data-act="edit-num" data-key="${esc(k)}"><span>${esc(k)}</span><span class="val num">${fmtVal(v)}</span></a>`).join("")}</div>` : `<p class="meta">数値はありません</p>`}</section>`;
  const rules = b.規則 || [];
  html += `<section class="sec"><div class="sec-h"><h2>規則 ${rules.length}</h2><button class="link quiet" data-act="edit-rule" data-i="-1">規則を足す</button></div>${rules.length ? `<div class="rules">${rules.map((r, i) => `<div class="rule panel"><div class="rn"><b>${esc(r.名前)}</b><button class="link quiet" data-act="edit-rule" data-i="${i}">直す</button></div>${r.対象 ? `<p class="tg">${Object.values(r.対象).map(x => esc(Array.isArray(x) ? x.join("・") : x)).join(" · ")}</p>` : ""}
      <p class="lbl">条件（すべて満たす）</p><ul>${(r.条件 || []).map(c => `<li>${condText(c)}</li>`).join("") || "<li>常に</li>"}</ul>
      <p class="lbl">出力</p><ul>${Object.entries(r.出力 || {}).map(([k, v]) => `<li>${esc(k)} ＝ ${fmtVal(v)}</li>`).join("")}</ul></div>`).join("")}</div>` : `<p class="meta">規則はありません。入れ物の既定で動きます</p>`}</section>`;
  html += `<section class="sec"><div class="sec-h"><h2>既定</h2><button class="link quiet" data-act="edit-default">直す</button></div><div class="rule panel"><p class="tg">どの規則にも当たらないとき</p>${b.既定 ? `<ul>${Object.entries(b.既定).map(([k, v]) => `<li>${esc(k)} ＝ ${fmtVal(v)}</li>`).join("")}</ul>` : `<p class="meta">入れ物の「中身なしの既定」: ${fmtVal(s.中身なしの既定)}</p>`}</div></section>`;
  return html;
}
function revsHTML() {
  if (!S.revs) return `<p class="meta">読み込んでいます</p>`;
  const rows = S.revs.slice().reverse();
  return `<a class="back" href="#strat">‹ 戦略</a>` + head("改定履歴", `${rows.length}件 · 新しい順`) + (rows.length ? `<div class="panel">${rows.map(r => `<div class="row"><div class="t"><b>${esc(r.段か項目)}</b><span class="r meta" style="font-weight:400">${mdShort(r.日付)}</span></div><p class="m">${esc(r.対象)} · ${esc(r.変更)}${r.版 != null ? " · 版" + esc(r.版) : ""} · ${esc(r.誰が || "")}</p><p class="m">${esc(r.変更前)} → ${esc(r.変更後)}</p><p class="m">${esc(r.理由)}</p></div>`).join("")}</div>` : empty("改定履歴はまだありません", ""));
}
function dictHTML() {
  if (!S.dic) return `<p class="meta">読み込んでいます</p>`;
  const q = (S.dictQuery || "").trim();
  const items = (S.dic.項目 || []).filter(x => !q || x.名前.includes(q) || (x.区分 || "").includes(q) || (x.使ってよい段 || []).some(s => s.includes(q)));
  const groups = {}; items.forEach(x => (groups[x.区分] = groups[x.区分] || []).push(x));
  return `<a class="back" href="#strat">‹ 戦略</a>` + head("辞書", `${num((S.dic.項目 || []).length)}項目 · 版${esc(S.dic.版)}。項目の追加は対話セッションで行う`) +
    `<div class="in search"><input id="dict-q" type="search" placeholder="項目名や段の名前で探す" value="${esc(q)}" data-act="dict-q"></div>` +
    Object.entries(groups).map(([g, xs]) => `<p class="grp-label">${esc(g)}</p><div class="panel">${xs.map(x => `<details class="row more" style="padding-block:6px"><summary style="text-decoration:none;color:var(--fg)"><b>${esc(x.名前)}</b>${(x.引数 || []).length ? `<span class="meta">　引数 ${esc(x.引数.join("・"))}</span>` : ""}</summary>
      <p class="m">${esc(x.作り方)} · ${esc(x.確定の仕方)} · ${esc(x.使える向き)}${x.取得可否 ? " · " + esc(x.取得可否) : ""}</p><p class="m">${esc(x.手順 || "")}</p><p class="m">使ってよい段: ${esc((x.使ってよい段 || []).join("、"))}</p></details>`).join("")}</div>`).join("") || empty("当てはまる項目はありません", "");
}

/* ================= 戦略（形の検査。tools/check.py の写し。画面の方針 7章と同じ順） ================= */
const ENTRY_OUTPUTS = ["監視リスト", "合否", "仕掛けの候補", "追加の株数"];   // 入る方向の出力（入れ物の規則7）
const AVOID_CMP = ["いいえ", "未満", "以下", "等しくない", "含まない"];
const PHASES = ["建てる前", "建てた後"];
function cmpWords() { return ((((S.box || {}).中身の書き方 || {}).比較 || {}).比較) || ["以上", "以下", "超", "未満", "等しい", "等しくない", "いずれか", "含まない", "はい", "いいえ"]; }
function checkExpr(e) { const s = String(e).replace(/\{[^{}]+\}/g, "0"); return /^[0-9.\s+\-*/()]*$/.test(s) && !s.includes("**") && !s.includes("//"); }
function exprRefs(e) { return [...String(e).matchAll(/\{([^{}]+)\}/g)].map(m => { const ref = m[1]; if (ref.startsWith("数値:")) return [ref, null]; const mm = ref.match(/^(.+?)\((.*)\)$/); return mm ? [mm[1], Object.fromEntries(mm[2].split(",").filter(x => x.includes("=")).map(x => x.split("=").map(y => y.trim())))] : [ref, {}]; }); }
function validateStrategy(strat) {
  const probs = []; const P = m => { if (!probs.includes(m)) probs.push(m); }; const items = Object.fromEntries((S.dic.項目 || []).map(x => [x.名前, x])); const stages = Object.fromEntries((S.box.段 || []).map(s => [s.名前, s]));
  const rng = (S.pre || {}).注文の下書きの欄に書ける値の範囲 || {}; const timeVals = ((rng.条件の種類 || {}).時刻条件の値) || ["翌日の寄付", "翌日の引け"];
  const CMP = cmpWords();
  const allowedIn = name => new Set(Object.values(items).filter(it => (it.使ってよい段 || []).includes(name)).map(it => it.名前));
  for (const [name, body] of Object.entries(strat.段 || {})) {
    const s = stages[name]; if (!s) { P(`段「${name}」が入れ物にない`); continue; }
    if (!s.中身あり) P(`段「${name}」は規則の段で中身を持てない`);
    const allowed = allowedIn(name); const numbers = new Set(Object.keys(body.数値 || {})); const outs = new Set((s.出力の欄 || []).map(o => o.欄)); const rules = body.規則 || [];
    const where0 = name;
    function checkArgs(itn, given, where) { const it = items[itn]; for (const a of Object.keys(given || {})) if (!(it.引数 || []).includes(a)) P(`${where0} ${where}: 項目「${itn}」に引数「${a}」はない`); for (const a of it.引数 || []) if (!given || !(a in given)) P(`${where0} ${where}: 項目「${itn}」の引数「${a}」が渡されていない`); }
    function checkValue(v, where, enters) {
      if (v && typeof v === "object" && !Array.isArray(v)) {
        if ("項目" in v) { if (!items[v.項目]) P(`${where0} ${where}: 項目「${v.項目}」が辞書にない`); else if (!allowed.has(v.項目)) P(`${where0} ${where}: 項目「${v.項目}」はこの段で使えない`); else { checkArgs(v.項目, v.引数, where); if (enters && items[v.項目].使える向き === "避ける・出る") P(`${where0} ${where}: 「避ける・出る」専用の項目「${v.項目}」を入る理由に使っている（規則7）`); } }
        else if ("数値" in v) { if (!numbers.has(v.数値)) P(`${where0} ${where}: 数値キー「${v.数値}」がこの段の数値にない`); }
        else if ("式" in v) { if (!checkExpr(v.式)) P(`${where0} ${where}: 式に許されない文字がある`); for (const [nm, args] of exprRefs(v.式)) { if (nm.startsWith("数値:")) { if (!numbers.has(nm.slice(3))) P(`${where0} ${where}: 式の数値キー「${nm.slice(3)}」がない`); } else if (!items[nm]) P(`${where0} ${where}: 式の項目「${nm}」が辞書にない`); else if (!allowed.has(nm)) P(`${where0} ${where}: 式の項目「${nm}」はこの段で使えない`); else { checkArgs(nm, args, where + " の式"); if (enters && items[nm].使える向き === "避ける・出る") P(`${where0} ${where}: 式に「避ける・出る」専用の項目「${nm}」を入る理由に使っている（規則7）`); } } }
        else if ("営業日後" in v) checkValue(v.営業日後, where + ".営業日後", enters);
        else for (const [k, x] of Object.entries(v)) checkValue(x, where + "." + k, enters);
      } else if (Array.isArray(v)) v.forEach((x, i) => checkValue(x, `${where}[${i}]`, enters));
    }
    function checkLiteral(k, v, rn) {
      const spec = (s.出力の欄 || []).find(o => o.欄 === k); if (!spec) return;
      if (Array.isArray(spec.取りうる値) && (v === null || typeof v !== "object") && v !== null && v !== undefined && !spec.取りうる値.includes(v)) P(`${where0} 規則${rn}: 欄「${k}」の値「${v}」は取りうる値（${spec.取りうる値.join("、")}）にない`);
      if (k === "ロット係数" && typeof v === "number" && !(v > 0 && v <= 1)) P(`${where0} 規則${rn}: ロット係数 ${v} は0より大きく1以下でない`);
      if (k === "ヘッジ目標" && typeof v === "number" && !(v >= 0 && v <= 100)) P(`${where0} 規則${rn}: ヘッジ目標 ${v} は0以上100以下でない`);
      if (v && typeof v === "object" && !Array.isArray(v) && /^手仕舞い/.test(k)) { if (v.全部か一部 === "一部" && !v.株数) P(`${where0} 規則${rn}: 一部の手仕舞いには株数が要る`); if (v.時刻 && !timeVals.includes(v.時刻)) P(`${where0} 規則${rn}: 時刻「${v.時刻}」は ${timeVals.join("／")} のどれか`); }
      if (v && typeof v === "object" && !Array.isArray(v) && k === "仕掛けの候補") { if (v.条件の種類 && !["価格条件", "時刻条件"].includes(v.条件の種類)) P(`${where0} 規則${rn}: 仕掛けの候補の条件の種類は 価格条件 か 時刻条件`); if (v.時刻 && !timeVals.includes(v.時刻)) P(`${where0} 規則${rn}: 仕掛けの候補の時刻は ${timeVals.join("／")} のどれか`); }
    }
    if ((body.版 || 0) === 0 && (rules.length || body.既定)) P(`${name}: 版が0なのに規則か既定がある`);
    const rn0 = new Set();
    for (const r of rules) {
      const rn = r.名前 || ""; if (!rn) P(`${name}: 名前のない規則がある`); if (rn0.has(rn)) P(`${name}: 規則の名前が重複「${rn}」`); rn0.add(rn);
      const out = r.出力 || {}; const enters = Object.keys(out).some(k => ENTRY_OUTPUTS.includes(k) && ![null, 0, "不合格"].includes(out[k]) && !(Array.isArray(out[k]) && !out[k].length));
      for (const [k, v] of Object.entries(r.対象 || {})) { const vals = Array.isArray(v) ? v : [v];
        if (k === "方向") vals.forEach(x => { if (!["買い", "売り"].includes(x)) P(`${name} 規則${rn}: 対象の方向は買いか売り`); });
        else if (k === "局面") vals.forEach(x => { if (!PHASES.includes(x)) P(`${name} 規則${rn}: 対象の局面は建てる前か建てた後`); });
        else if (k === "型の名前") {} else if (!items[k]) P(`${name} 規則${rn}: 対象の項目「${k}」が辞書にない`); else if (!allowed.has(k)) P(`${name} 規則${rn}: 対象の項目「${k}」はこの段で使えない`); }
      for (const c of r.条件 || []) {
        if (!items[c.項目]) { P(`${name} 規則${rn}: 項目「${c.項目 || "（未選択）"}」が辞書にない`); continue; }
        if (!allowed.has(c.項目)) P(`${name} 規則${rn}: 項目「${c.項目}」はこの段で使えない`);
        if (!CMP.includes(c.比較)) P(`${name} 規則${rn}: 比較「${c.比較}」が決まった語でない`);
        if (!["はい", "いいえ"].includes(c.比較) && !("値" in c)) P(`${name} 規則${rn}: 比較「${c.比較}」には値が要る`);
        if (["いずれか", "含まない"].includes(c.比較) && "値" in c && !Array.isArray(c.値) && !(c.値 && typeof c.値 === "object")) P(`${name} 規則${rn}: 「${c.比較}」の値は一覧にする`);
        checkArgs(c.項目, c.引数, `規則${rn}`);
        if (enters && items[c.項目].使える向き === "避ける・出る" && !AVOID_CMP.includes(c.比較)) P(`${name} 規則${rn}: 「避ける・出る」専用の項目「${c.項目}」を入る理由に使っている（規則7）。足切りなら いいえ／未満／以下／等しくない／含まない で書く`);
        checkValue(c.値, `規則${rn} の値`, enters);
      }
      for (const [k, v] of Object.entries(out)) { if (!outs.has(k)) P(`${name} 規則${rn}: 出力の欄「${k}」が入れ物にない`); checkValue(v, `規則${rn} の出力${k}`, enters); checkLiteral(k, v, rn); }
    }
    for (const [k, v] of Object.entries(body.既定 || {})) { if (!outs.has(k)) P(`${name} 既定: 出力の欄「${k}」が入れ物にない`); checkValue(v, `既定の${k}`, false); checkLiteral(k, v, "既定"); }
  }
  return probs;
}

/* ================= 戦略（編集。決定92: 1回の保存で1段の1か所、理由必須、版と改定履歴は自動） ================= */
const clone = o => o === undefined ? undefined : JSON.parse(JSON.stringify(o));
const DRAFT_KEY = "iremono.draft";
const P_ = s => esc(JSON.stringify(s));
function getAt(o, path) { return path.reduce((x, k) => (x == null ? undefined : x[k]), o); }
function setAt(o, path, v) {
  let x = o; for (let i = 0; i < path.length - 1; i++) { if (x[path[i]] == null || typeof x[path[i]] !== "object") x[path[i]] = typeof path[i + 1] === "number" ? [] : {}; x = x[path[i]]; }
  const k = path[path.length - 1]; if (v === undefined) { if (Array.isArray(x)) x.splice(k, 1); else delete x[k]; } else x[k] = v;
}
function parseNum(s) { const t = String(s).trim().replace(/,/g, ""); return t !== "" && !isNaN(Number(t)) ? Number(t) : s; }
function edCtx() {
  const stage = S.edit.stage; const b = stageBody(stage);
  const allowed = (S.dic.項目 || []).filter(x => (x.使ってよい段 || []).includes(stage));
  const numbers = Object.keys((S.edit.mode === "num" ? Object.assign({}, b.数値) : b.数値) || {});
  return { stage, allowed, numbers, items: Object.fromEntries((S.dic.項目 || []).map(x => [x.名前, x])) };
}
const KIND_LIST = { 条件: ["数値", "文字", "数値キー", "項目", "式", "営業日後", "一覧"], 選択: ["選択", "出さない"], 数値: ["数値", "式", "項目", "数値キー", "出さない"], 数値か条件: ["数値", "式", "項目", "数値キー", "出さない"], 日付: ["営業日後", "項目", "文字", "出さない"], 文章: ["文章", "出さない"], 下書き: ["欄", "出さない"], 表: ["一覧", "出さない"], 汎用: ["文字", "数値", "数値キー", "項目", "式", "営業日後", "欄", "一覧"] };
function kindOf(v, spec) {
  if (v === undefined || v === null) return spec.種類 === "条件" || spec.種類 === "汎用" ? "文字" : "出さない";
  if (typeof v === "number") return "数値";
  if (typeof v === "string") return spec.種類 === "選択" ? "選択" : spec.種類 === "文章" ? "文章" : "文字";
  if (Array.isArray(v)) return "一覧";
  if ("項目" in v) return "項目"; if ("数値" in v) return "数値キー"; if ("式" in v) return "式"; if ("営業日後" in v) return "営業日後";
  return "欄";
}
function defaultFor(kind, spec, ctx) {
  return ({ 数値: 0, 文字: "", 選択: Array.isArray(spec.取りうる値) ? spec.取りうる値[0] : "", 文章: "", 数値キー: { 数値: ctx.numbers[0] || "" }, 項目: { 項目: "" }, 式: { 式: "" }, 営業日後: { 営業日後: 1 }, 欄: {}, 一覧: [] })[kind];
}
function itemSelect(path, cur, ctx, act) {
  const groups = {}; ctx.allowed.forEach(x => (groups[x.区分] = groups[x.区分] || []).push(x));
  return `<div class="in"><select data-act="${act}" data-path="${P_(path)}" aria-label="項目"><option value="">項目を選ぶ</option>${Object.entries(groups).map(([g, xs]) => `<optgroup label="${esc(g)}">${xs.map(x => `<option${x.名前 === cur ? " selected" : ""}>${esc(x.名前)}</option>`).join("")}</optgroup>`).join("")}${cur && !ctx.allowed.some(x => x.名前 === cur) ? `<option selected>${esc(cur)}</option>` : ""}</select></div>`;
}
function argInputs(path, itemName, args, ctx) {
  const it = ctx.items[itemName]; if (!it || !(it.引数 || []).length) return "";
  return `<div class="vrow">${it.引数.map(a => `<div class="in"><span class="u">${esc(a)}</span><input class="right num" value="${esc((args || {})[a] ?? "")}" data-act="varg" data-path="${P_(path)}" data-arg="${esc(a)}" aria-label="引数 ${esc(a)}"></div>`).join("")}</div>`;
}
function valueEditor(path, v, spec, ctx) {
  const kinds = KIND_LIST[spec.種類] || KIND_LIST.汎用; const k = kindOf(v, spec);
  const sel = kinds.length > 1 ? `<div class="in"><select data-act="vkind" data-path="${P_(path)}" data-spec="${esc(spec.種類 || "汎用")}" aria-label="値の種類">${kinds.map(x => `<option${x === k ? " selected" : ""}>${x}</option>`).join("")}</select></div>` : "";
  let inner = "";
  if (k === "数値") inner = `<div class="in"><input class="right num" inputmode="decimal" value="${esc(v)}" data-act="vset" data-type="num" data-path="${P_(path)}" aria-label="数値"></div>`;
  else if (k === "文字") inner = `<div class="in"><input value="${esc(v ?? "")}" data-act="vset" data-type="str" data-path="${P_(path)}" aria-label="文字"></div>`;
  else if (k === "選択") inner = `<div class="in"><select data-act="vset" data-type="str" data-path="${P_(path)}" aria-label="選択">${(spec.取りうる値 || []).map(x => `<option${x === v ? " selected" : ""}>${esc(x)}</option>`).join("")}</select></div>`;
  else if (k === "文章") inner = `<textarea class="ta" data-act="vset" data-type="str" data-path="${P_(path)}" aria-label="文章">${esc(v)}</textarea>`;
  else if (k === "数値キー") inner = `<div class="in"><select data-act="vset" data-type="numkey" data-path="${P_(path)}" aria-label="数値キー">${ctx.numbers.map(x => `<option${x === v.数値 ? " selected" : ""}>${esc(x)}</option>`).join("")}${v.数値 && !ctx.numbers.includes(v.数値) ? `<option selected>${esc(v.数値)}</option>` : ""}</select></div>`;
  else if (k === "項目") inner = itemSelect(path, v.項目, ctx, "vitem") + argInputs(path, v.項目, v.引数, ctx);
  else if (k === "式") inner = `<textarea class="ta expr" data-act="vset" data-type="expr" data-path="${P_(path)}" aria-label="式">${esc(v.式)}</textarea>
      <div class="chips">${ctx.numbers.map(x => `<button type="button" data-act="vins" data-path="${P_(path)}" data-text="${esc("{数値:" + x + "}")}">{数値:${esc(x)}}</button>`).join("")}</div>
      <div class="in"><select data-act="vinsitem" data-path="${P_(path)}" aria-label="式に項目を入れる"><option value="">式に項目を入れる</option>${ctx.allowed.map(x => `<option>${esc(x.名前)}</option>`).join("")}</select></div>`;
  else if (k === "営業日後") inner = `<div class="in"><input class="right num" inputmode="numeric" value="${esc(typeof v.営業日後 === "object" ? "" : v.営業日後)}" data-act="vset" data-type="bdays" data-path="${P_(path)}" aria-label="営業日"><span class="u">営業日後</span></div>`;
  else if (k === "欄") inner = Object.entries(v).map(([kk, x]) => `<div class="cond"><div class="cond-h"><b>${esc(kk)}</b><button type="button" class="link quiet" data-act="vdel" data-path="${P_(path.concat([kk]))}">消す</button></div>${valueEditor(path.concat([kk]), x, { 種類: "汎用" }, ctx)}</div>`).join("")
      + `<div class="vrow"><div class="in"><input id="nk-${esc(path.join("-"))}" placeholder="欄の名前" aria-label="足す欄の名前"></div><button type="button" class="link" data-act="vaddkey" data-path="${P_(path)}">欄を足す</button></div>`;
  else if (k === "一覧") inner = v.map((x, i) => `<div class="cond"><div class="cond-h"><b>${i + 1}</b><button type="button" class="link quiet" data-act="vdel" data-path="${P_(path.concat([i]))}">消す</button></div>${valueEditor(path.concat([i]), x, { 種類: "汎用" }, ctx)}</div>`).join("")
      + `<button type="button" class="link" data-act="vadditem" data-path="${P_(path)}">行を足す</button>`;
  const oneLine = ["数値", "文字", "選択", "数値キー", "営業日後"].includes(k);
  return oneLine && sel ? `<div class="vrow">${sel}${inner}</div>` : `<div class="kvs">${sel}${inner}</div>`;
}
function cleanRule(r) {
  const x = clone(r);
  if (x.対象) { for (const k of Object.keys(x.対象)) if (x.対象[k] === "" || x.対象[k] == null) delete x.対象[k]; if (!Object.keys(x.対象).length) delete x.対象; }
  x.条件 = (x.条件 || []).map(c => { const y = Object.assign({}, c); if (y.引数 && !Object.keys(y.引数).length) delete y.引数; if (["はい", "いいえ"].includes(y.比較)) delete y.値; return y; });
  x.出力 = x.出力 || {};
  return x;
}
function applyEdit(strat, E) {
  const body = strat.段[E.stage] = strat.段[E.stage] || { 版: 0, 説明: "", 数値: {}, 規則: [], 既定: null };
  body.規則 = body.規則 || []; body.数値 = body.数値 || {};
  if (E.mode === "num") body.数値[E.key] = E.cur;
  else if (E.mode === "rule") { if (E.del) body.規則.splice(E.index, 1); else if (E.index < 0) body.規則.push(cleanRule(E.cur)); else body.規則[E.index] = cleanRule(E.cur); }
  else body.既定 = E.cur && Object.keys(E.cur).length ? clone(E.cur) : null;
  body.版 = (body.版 || 0) + 1; return body.版;
}
function editChanged(E) { return E.del || JSON.stringify(E.mode === "rule" ? cleanRule(E.cur) : E.cur) !== JSON.stringify(E.mode === "rule" && E.before ? cleanRule(E.before) : E.before); }
function editProblems() { const next = clone(S.strat); applyEdit(next, S.edit); return validateStrategy(next).filter(p => p.startsWith(S.edit.stage)); }
function closedSince(stage) {
  const last = (S.revs || []).filter(r => r.対象 === "中身" && r.段か項目 === stage).map(r => r.日付).sort().pop() || "";
  return (S.trades || []).filter(t => t.状態 === "決済済み" && lastDate(t) > last).length;
}
function checksHTML() {
  const E = S.edit; const probs = editProblems(); const ver = (stageBody(E.stage).版 || 0) + 1;
  const min = (S.strat.見直しの中身 || {}).最小件数; const n = closedSince(E.stage);
  const notes = [];
  if (probs.length) notes.push(`<div class="problems">${probs.map(p => `<p>${esc(p.replace(E.stage + " ", ""))}</p>`).join("")}</div>`);
  else if (editChanged(E)) notes.push(`<div class="check"><b class="green">${CHECK}</b><span>形の検査に通りました。${esc(E.stage)}は版${ver - 1}から版${ver}になります</span></div>`);
  if (min && n < min) notes.push(`<div class="check"><b class="yellow">注意</b><span>この段を前に改定してから決済した取引は${n}件です（最小${min}件）。改定の規則では、最小件数まで変えません。理由に書けば保存できます</span></div>`);
  const ok = !probs.length && editChanged(E) && (E.reason || "").trim();
  const label = !editChanged(E) ? "変えると保存できます" : probs.length ? "直すと保存できます" : !(E.reason || "").trim() ? "理由を書くと保存できます" : E.del ? `消して版${ver}にする` : `保存して版${ver}にする`;
  return `<div id="ed-foot" class="kvs"><div class="kvs">${notes.join("")}</div><div class="actions"><button class="btn" data-act="esave"${ok ? "" : " disabled"}>${label}</button>${E.mode === "rule" && E.index >= 0 ? `<button class="link quiet" data-act="edel">${E.del ? "消すのをやめる" : "この規則を消す"}</button>` : ""}<button class="link quiet" data-act="ecancel">やめる</button></div></div>`;
}
function refreshChecks() { const el = $("#ed-foot"); if (el) el.outerHTML = checksHTML(); }
function renderEdit() {
  const E = S.edit; if (!E) return; const ctx = edCtx();
  const reason = `<div class="field"><label for="ed-why">変える理由</label><textarea id="ed-why" class="ta" data-act="ereason" placeholder="改定履歴に残ります">${esc(E.reason || "")}</textarea></div>`;
  if (E.mode === "num") {
    const isNum = typeof E.before === "number"; const show = Array.isArray(E.cur) ? E.cur.join("、") : E.cur;
    sheet(esc(E.key), `<div class="diff"><div class="was"><span>変更前</span><b class="num">${fmtVal(E.before)}</b></div><div><span>変更後</span><b class="num">${fmtVal(E.cur)}</b></div></div>
      <div class="field"><label for="ed-num">新しい値</label><div class="in"><input id="ed-num" class="${isNum ? "right num" : ""}" ${isNum ? 'inputmode="decimal"' : ""} value="${esc(show)}" data-act="enum" data-arr="${Array.isArray(E.before) ? 1 : 0}" autofocus></div>${Array.isArray(E.before) ? '<span class="hint">「、」で区切って並べる</span>' : ""}</div>` + reason + checksHTML(), { key: "edit" });
    return;
  }
  if (E.mode === "default") {
    sheet(`既定を直す　${esc(E.stage)}`, `<p class="meta">どの規則にも当たらないときの出力。規則が当たっても、その規則が出していない欄はここで埋まります（理由を除く）</p>` + outputsEditor(["既定"], E.cur || {}, ctx) + reason + checksHTML(), { key: "edit", full: true });
    return;
  }
  const r = E.cur; const t = r.対象 || {};
  const extraT = Object.entries(t).filter(([k]) => !["方向", "局面"].includes(k));
  const body = (E.del ? `<div class="alerts">${alertBox("r", "消します", `規則「${esc(r.名前)}」を消します。理由を書いて保存してください`)}</div>` : "") +
    `<div class="field"><label for="ed-name">名前</label><div class="in"><input id="ed-name" value="${esc(r.名前 || "")}" data-act="vset" data-type="str" data-path='["名前"]' placeholder="短い札（段の中で重ならない）"></div></div>
    <div class="vrow"><div class="field"><label for="ed-ph">局面</label><div class="in"><select id="ed-ph" data-act="tgt" data-key="局面">${["", ...PHASES].map(x => `<option value="${x}"${(t.局面 || "") === x ? " selected" : ""}>${x || "指定なし"}</option>`).join("")}</select></div></div>
    <div class="field"><label for="ed-dir">方向</label><div class="in"><select id="ed-dir" data-act="tgt" data-key="方向">${["", "買い", "売り"].map(x => `<option value="${x}"${(t.方向 || "") === x ? " selected" : ""}>${x || "指定なし"}</option>`).join("")}</select></div></div></div>
    ${extraT.length ? `<p class="meta">ほかの対象: ${extraT.map(([k, v]) => esc(k) + "＝" + fmtVal(v)).join("、")}（そのまま残します）</p>` : ""}
    <div><p class="sub">条件（すべて満たす）</p>${(r.条件 || []).map((c, i) => condEditor(c, i, ctx)).join("")}<button type="button" class="link quiet" data-act="cadd">条件を足す</button></div>
    <div><p class="sub">出力</p>${outputsEditor(["出力"], r.出力 || {}, ctx)}</div>` + reason + checksHTML();
  sheet(`${E.index < 0 ? "規則を足す" : "規則を直す"}　${esc(E.stage)}`, body, { key: "edit", full: true });
}
function condEditor(c, i, ctx) {
  const cmp = cmpWords(); const noVal = ["はい", "いいえ"].includes(c.比較);
  return `<div class="cond"><div class="cond-h"><b>条件${i + 1}</b><button type="button" class="link quiet" data-act="cdel" data-i="${i}">消す</button></div>
    ${itemSelect(["条件", i], c.項目, ctx, "citem")}${argInputs(["条件", i], c.項目, c.引数, ctx)}
    <div class="in"><select data-act="ccmp" data-i="${i}" aria-label="比較">${cmp.map(x => `<option${x === c.比較 ? " selected" : ""}>${esc(x)}</option>`).join("")}</select></div>
    ${noVal ? "" : valueEditor(["条件", i, "値"], c.値, { 種類: "条件" }, ctx)}</div>`;
}
function outputsEditor(path, outs, ctx) {
  const specs = (stageDef(ctx.stage).出力の欄 || []);
  const present = specs.filter(sp => sp.欄 in outs); const rest = specs.filter(sp => !(sp.欄 in outs));
  const unknown = Object.keys(outs).filter(k => !specs.some(sp => sp.欄 === k));
  return present.map(sp => `<div class="field" style="margin-bottom:12px"><span class="label">${esc(sp.欄)}</span>${typeof sp.取りうる値 === "string" && sp.取りうる値 ? `<span class="hint">${esc(sp.取りうる値)}</span>` : ""}${valueEditor(path.concat([sp.欄]), outs[sp.欄], sp, ctx)}</div>`).join("")
    + unknown.map(k => `<div class="field"><span class="label red">${esc(k)}（入れ物にない欄）</span><button type="button" class="link quiet" data-act="vdel" data-path="${P_(path.concat([k]))}">消す</button></div>`).join("")
    + (rest.length ? `<div class="in"><select data-act="oadd" data-path="${P_(path)}" aria-label="出力の欄を足す"><option value="">出力の欄を足す</option>${rest.map(sp => `<option>${esc(sp.欄)}</option>`).join("")}</select></div>` : "");
}
function editTarget(E) { return `${E.stage}|${E.mode}|${E.mode === "num" ? E.key : E.mode === "rule" ? E.index : ""}`; }
function openEdit(E) {
  const d = store(DRAFT_KEY);
  if (d && editTarget(d) === editTarget(E) && JSON.stringify(d.before) === JSON.stringify(E.before)) { S.edit = d; toast("前の下書きを開きました"); }
  else S.edit = E;
  renderEdit();
}
function edSet(path, v) { if (S.edit.mode === "default") { if (path[0] === "既定") { if (path.length === 1) S.edit.cur = v; else { S.edit.cur = S.edit.cur || {}; setAt(S.edit.cur, path.slice(1), v); } } } else setAt(S.edit.cur, path, v); store(DRAFT_KEY, S.edit); }
function edGet(path) { return S.edit.mode === "default" ? (path[0] === "既定" ? getAt(S.edit.cur || {}, path.slice(1)) : undefined) : getAt(S.edit.cur, path); }
function revRow(E, ver) {
  const sum = v => v === undefined ? "なし" : JSON.stringify(v);
  const what = E.mode === "num" ? "数値変更" : E.mode === "rule" ? (E.del ? "削除" : E.index < 0 ? "追加" : "条件変更") : "条件変更";
  const label = E.mode === "num" ? `数値「${E.key}」 ` : E.mode === "rule" ? `規則「${(E.before || E.cur).名前}」 ` : "既定 ";
  return { 日付: jst().date, 対象: "中身", 段か項目: E.stage, 変更: what, 変更前: label + (E.mode === "rule" && E.index < 0 ? "なし" : sum(E.before)), 変更後: label + (E.del ? "なし" : sum(E.mode === "rule" ? cleanRule(E.cur) : E.cur)), 理由: E.reason.trim(), 版: ver, 件数: (S.trades || []).filter(t => t.状態 === "決済済み").length, 誰が: "人" };
}
async function saveEdit(btn) {
  const E = S.edit; if (!E || !(E.reason || "").trim()) return;
  busy(btn, true);
  try {
    const fresh = await Store.json("data/戦略.json");
    if (fresh.sha !== S.stratSha) { S.strat = fresh.data; S.stratSha = fresh.sha; toast("戦略が他で更新されていました。読み直したので、確かめてからもう一度保存してください", true); renderEdit(); return; }
    const next = clone(fresh.data); const ver = applyEdit(next, E); next.更新日 = jst().date;
    const probs = validateStrategy(next); if (probs.length) { toast("形の検査に通りません。赤字の所を直してください", true); refreshChecks(); return; }
    const r1 = await Store.put("data/戦略.json", toJSON(next), `画面: 戦略 ${E.stage} 版${ver}`, fresh.sha);
    S.strat = next; S.stratSha = r1.sha;
    S.pendingRev = revRow(E, ver); store("iremono.pendingRev", S.pendingRev);
    await writeRev();
    store(DRAFT_KEY, null); S.edit = null; closeSheet();
    toast(LOCAL ? `開発モード: ${E.stage} を版${ver}として保存する代わりに表示しました` : `保存しました。${E.stage}は版${ver}になりました。次の定期実行から使われます`);
    render();
  } catch (e) {
    if (e instanceof ConflictError) { await loadStrategy(true); toast("戦略が他で更新されていました。読み直したので、確かめてからもう一度保存してください", true); renderEdit(); }
    else toast(e instanceof AuthError ? "書き込めません。トークンの権限を設定で確かめてください" : "保存できませんでした。電波を確かめて、もう一度押してください", true);
  } finally { busy(btn, false); }
}
async function writeRev() {
  const row = S.pendingRev || store("iremono.pendingRev"); if (!row) return;
  try {
    const fr = await Store.json("data/記録/改定履歴.json"); const list = fr ? fr.data : []; list.push(row);
    const r = await Store.put("data/記録/改定履歴.json", toJSON(list), `画面: 改定履歴 ${row.段か項目} 版${row.版}`, fr && fr.sha);
    S.revs = list; S.revsSha = r.sha; S.pendingRev = null; store("iremono.pendingRev", null);
  } catch (e) { S.pendingRev = row; toast("戦略は保存しましたが、改定履歴の1行を書けませんでした。戦略タブの先頭から書き直してください", true); }
}
function pendingRevAlert() { const row = S.pendingRev || store("iremono.pendingRev"); return row ? `<div class="alerts">${alertBox("r", "履歴が未記録", `${esc(row.段か項目)}（版${esc(row.版)}）の改定履歴の1行を書けていません。<button class="link" data-act="rev-retry">もう一度書く</button>`)}</div>` : ""; }

/* ================= 知識 ================= */
async function loadKnow() {
  if (S.know) return;
  const [refs, basics, docs] = await Promise.all([Store.list("references"), Store.list("docs/basics"), Store.list("docs")]);
  const mdOnly = xs => xs.filter(x => x.name.endsWith(".md") && x.name !== "STYLE.md");
  S.know = [["知見のまとめ", mdOnly(refs)], ["基礎", mdOnly(basics)], ["IPO", mdOnly(docs)]];
}
const knowName = n => n.replace(/\.md$/, "").replace(/_知見まとめ/, "").replace(/^\d+_/, "").replace(/_/g, " ");
function knowHTML() {
  if (!S.know) return head("知識") + `<p class="meta">読み込んでいます</p>`;
  return head("知識") + S.know.filter(([, xs]) => xs.length).map(([h, xs]) => `<section class="sec"><div class="sec-h"><h2>${esc(h)}</h2></div><div class="panel">${xs.map(x => `<a class="numrow" href="#know/${encodeURIComponent(x.path)}"><span>${esc(knowName(x.name))}</span><span class="val"></span></a>`).join("")}</div></section>`).join("") || empty("知識のファイルがありません", "");
}
function mdInline(s) {
  return esc(s).replace(/`([^`]+)`/g, "<code>$1</code>").replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>').replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
}
function mdRender(src) {   // 知識タブ用の小さな Markdown 表示（見出し・段落・箇条書き・番号・表・引用・コード）。外部のライブラリは使わない
  const lines = src.replace(/\r/g, "").split("\n"); const out = []; let i = 0;
  while (i < lines.length) {
    const l = lines[i];
    if (/^```/.test(l)) { const buf = []; i++; while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]); i++; out.push(`<pre class="pre">${esc(buf.join("\n"))}</pre>`); continue; }
    const h = l.match(/^(#{1,4})\s+(.*)$/); if (h) { out.push(`<h${h[1].length}>${mdInline(h[2])}</h${h[1].length}>`); i++; continue; }
    if (/^\s*\|/.test(l) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
      const row = s => s.trim().replace(/^\||\|$/g, "").split("|").map(c => c.trim());
      const hd = row(l); i += 2; const body = []; while (i < lines.length && /^\s*\|/.test(lines[i])) body.push(row(lines[i++]));
      out.push(`<div class="tbl"><table><thead><tr>${hd.map(c => `<th>${mdInline(c)}</th>`).join("")}</tr></thead><tbody>${body.map(r => `<tr>${r.map(c => `<td>${mdInline(c)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`); continue;
    }
    if (/^\s*[-*]\s+/.test(l)) { const buf = []; while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) buf.push(lines[i++].replace(/^\s*[-*]\s+/, "")); out.push(`<ul>${buf.map(x => `<li>${mdInline(x)}</li>`).join("")}</ul>`); continue; }
    if (/^\s*\d+[.)]\s+/.test(l)) { const buf = []; while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) buf.push(lines[i++].replace(/^\s*\d+[.)]\s+/, "")); out.push(`<ol>${buf.map(x => `<li>${mdInline(x)}</li>`).join("")}</ol>`); continue; }
    if (/^>\s?/.test(l)) { const buf = []; while (i < lines.length && /^>\s?/.test(lines[i])) buf.push(lines[i++].replace(/^>\s?/, "")); out.push(`<blockquote>${mdInline(buf.join(" "))}</blockquote>`); continue; }
    if (!l.trim() || /^(-{3,}|\*{3,})$/.test(l.trim())) { i++; continue; }
    const buf = []; while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|```|\s*[-*]\s+|\s*\d+[.)]\s+|>|\s*\|)/.test(lines[i])) buf.push(lines[i++]);
    if (!buf.length) { out.push(`<p>${mdInline(l)}</p>`); i++; } else out.push(`<p>${mdInline(buf.join(""))}</p>`);
  }
  return `<div class="md">${out.join("")}</div>`;
}
async function knowPageHTML(path) {
  const t = await Store.text(path).catch(() => null);
  return `<a class="back" href="#know">‹ 知識</a>` + (t ? mdRender(t.text) : empty("このファイルを読めませんでした", path));
}

/* ================= 設定 ================= */
function confHTML() {
  const c = cfg(); const first = !LOCAL && !c.token;
  const ex = S.pre && S.pre.執行者 ? S.pre.執行者.今の値 : "";
  return head("設定", first ? "最初にリポジトリとトークンを入れます" : "") +
    (LOCAL ? `<div class="alerts">${alertBox("y", "開発モード", `${esc(LOCAL_DATA)} を読みます。書き込みは画面に出すだけです`)}</div>` : "") +
    `<div class="field"><label for="cf-repo">リポジトリ</label><div class="in"><input id="cf-repo" value="${esc(c.repo || "")}" placeholder="持ち主/名前" autocapitalize="off" autocomplete="off" spellcheck="false"></div></div>
    <div class="field"><label for="cf-br">ブランチ</label><div class="in"><input id="cf-br" value="${esc(c.branch || "master")}" autocapitalize="off" autocomplete="off" spellcheck="false"></div></div>
    <div class="field"><label for="cf-tk">トークン</label><div class="in"><input id="cf-tk" type="password" value="${esc(c.token || "")}" autocomplete="off" spellcheck="false"><button type="button" class="link quiet" data-act="tok-show" style="min-height:40px">表示</button></div><span class="hint">この端末のブラウザにだけ保存します。このリポジトリだけ、Contents の読み書き。期限は最長1年</span></div>
    ${S.connMsg ? `<div class="panel"><div class="check" style="padding-block:12px"><b class="${S.connMsg.ok ? "green" : "red"}">${S.connMsg.ok ? CHECK : "×"}</b><span>${esc(S.connMsg.text)}</span></div></div>` : ""}
    ${ex ? `<div class="panel"><dl class="kv"><div><dt>執行者</dt><dd>${esc(ex)}${ex === TRIAL ? "（試運転）" : ""}</dd></div></dl></div><p class="meta">執行者を変えるときは、対話セッションで前提を直します</p>` : ""}
    <div class="actions"><button class="btn" data-act="conf-save">保存して読み直す</button>${c.token ? '<button class="link quiet" data-act="conf-test">接続を確かめる</button>' : ""}</div>`;
}
async function testConn() {
  try { const st = await Store.json("data/状態.json"); S.connMsg = st ? { ok: true, text: `読めました。状態は ${st.data.更新日時 ? md(st.data.更新日時) + " " + hm(st.data.更新日時) : "まだ空"} の更新です` } : { ok: false, text: "data/状態.json が見つかりません。リポジトリとブランチを確かめてください" }; }
  catch (e) { S.connMsg = { ok: false, text: e instanceof AuthError ? "読めません。トークンが切れているか、このリポジトリの権限がありません" : "つながりません。電波を確かめてください" }; }
  return S.connMsg.ok;
}

/* ================= 画面の切り替え ================= */
const TABS = [["今日", "today"], ["持ち高", "hold"], ["戦略", "strat"], ["記録", "log"], ["知識", "know"], ["設定", "conf"]];
function routeOf() { const h = decodeURIComponent(location.hash.slice(1) || "today"); const [tab, ...rest] = h.split("/"); const base = tab.replace(/-.*$/, ""); return { tab: TABS.some(x => x[1] === base) ? base : "today", page: tab, arg: rest.join("/") }; }
function todayTodo() {
  try { const v = decideView(); if (v.kind === "evening") { const E = eveningState(v); return (!E.conf && E.rows.length) || (!E.trial && E.cands.length && !E.fillDone); }
    if (v.kind === "morning") { const R = v.run; return (R.注文一覧 || []).length && (!R.人の最終確認 || R.人の最終確認.結果 === "未") && !queued("最終確認", c => c.日付 === v.date && c.判定点 === A).length; } } catch (e) {}
  return false;
}
let renderSeq = 0;
function toCurrentStep() { requestAnimationFrame(() => { const el = $(".step.cur") || $(".done-msg"); if (el) window.scrollTo({ top: Math.max(0, el.getBoundingClientRect().top + window.scrollY - 16), behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" }); }); }
async function render() {
  const seq = ++renderSeq; const r = routeOf(); const view = $("#view");
  const dot = r.tab !== "today" && S.loaded && todayTodo();
  $("#tabs").innerHTML = TABS.map(([l, h]) => `<a href="#${h}"${h === r.tab ? ' aria-current="page"' : ""}>${l}${h === "today" && dot ? '<span class="dot" aria-label="やることがあります"></span>' : ""}</a>`).join("");
  if (r.tab === "conf") { view.innerHTML = confHTML(); return; }
  if (!LOCAL && !cfg().token) { location.hash = "#conf"; return; }
  if (S.error) {
    const e = S.error;
    view.innerHTML = head(md(jst().date)) + `<div class="alerts">${e.kind === "auth" ? alertBox("r", "読めません", `トークンが切れているか、権限が足りません。<a href="#conf">設定で入れ直す</a>`) : e.kind === "missing" ? alertBox("r", "データなし", `data/状態.json が見つかりません。<a href="#conf">リポジトリとブランチを確かめる</a>`) : alertBox("r", "つながりません", `電波を確かめて、<button class="link" data-act="reload">読み直す</button>`)}</div>`;
    return;
  }
  if (!S.loaded) { view.innerHTML = `<p class="meta">読み込んでいます</p>`; return; }
  try {
    if (r.tab === "today") view.innerHTML = todayHTML();
    else if (r.tab === "hold") view.innerHTML = holdHTML();
    else if (r.tab === "log") { view.innerHTML = logHTML(); if (!S.trades || !S.logList || S.stats === null) { await Promise.all([loadRecords(), loadStrategy()]); if (seq === renderSeq) view.innerHTML = logHTML(); } }
    else if (r.tab === "strat") {
      const html = () => r.page === "strat-revs" ? revsHTML() : r.page === "strat-dict" ? dictHTML() : r.arg ? stageHTML(r.arg) : stratHTML();
      view.innerHTML = html(); if (!S.strat) { await loadStrategy(); if (seq === renderSeq) view.innerHTML = html(); }
    }
    else if (r.tab === "know") {
      if (r.arg) { view.innerHTML = `<a class="back" href="#know">‹ 知識</a><p class="meta">読み込んでいます</p>`; const h = await knowPageHTML(r.arg); if (seq === renderSeq) view.innerHTML = h; }
      else { view.innerHTML = knowHTML(); if (!S.know) { await loadKnow(); if (seq === renderSeq) view.innerHTML = knowHTML(); } }
    }
  } catch (e) {
    if (e instanceof AuthError) { S.error = { kind: "auth" }; return render(); }
    view.innerHTML = head("読めませんでした") + `<div class="alerts">${alertBox("r", "読めません", `${esc(e.message || e)}。<button class="link" data-act="reload">読み直す</button>`)}</div>`;
    console.error(e);
  }
}

/* ================= 操作 ================= */
function fixSheet(item, code) {
  const x = ((S.state && S.state.仮置き) || []).find(v => v.項目 === item && String(v.銘柄) === String(code));
  const dep = x || [].concat(...findOrders([].concat(...Object.values(S.logs).map(L => [].concat(...(L.実行 || []).map(r => (r.注文一覧 || []).map(o => o.id)))))).map(o => (o.依存する仮置き || []).map(d => Object.assign({ 銘柄: o.銘柄 }, d)))).find(d => d.項目 === item && String(d.銘柄) === String(code)) || {};
  const val = x ? x.値 : dep.仮置きの値;
  sheet(`仮置きを確定　<span class="num">${esc(code)}</span>`, `<p><b>${esc(item)} ＝ ${esc(val)}</b></p><p class="meta">${esc((x && x.根拠) || dep.根拠 || "")}${x && x.日付 ? `（AI の読み取り ${mdShort(x.日付)}）` : ""}</p>
    <div class="vrow"><div class="field"><label for="fx-val">値</label><div class="in"><input id="fx-val" value="${esc(val ?? "")}"></div></div><div class="field"><label for="fx-exp">有効期限</label><div class="in"><input id="fx-exp" type="date" value="${esc((x && x.有効期限) || "")}"></div></div></div>
    <p class="meta">根拠に合っていれば、そのまま確定します。違えば値を直して確定します</p>
    <div class="actions"><button class="btn" data-act="fix-save" data-item="${esc(item)}" data-code="${esc(code)}">確定する</button></div>`, { key: "fix" });
}
function fillSheet(ids) {
  const src = findOrders(ids); const r = displayRows(src, src)[0]; if (!r) return;
  const one = r.type === "oco" ? null : r.o;
  const priceOf = o => o ? (o.注文種類 === "逆指値" ? o.参照価格 : o.価格) : "";
  S.fill = { r, pick: one ? one.id : null };
  sheet(`約定を記録　<span class="num">${esc(r.code)}</span> ${esc(r.name || "")}`, `<p class="meta">${rowTitle(r)} · ${rowLines(r).l2}</p>
    ${r.type === "oco" ? `<div class="field"><span class="label">どちらが約定したか</span><div class="seg" role="group" aria-label="約定した注文"><button type="button" data-act="fill-pick" data-id="${esc(r.take.id)}" data-price="${esc(r.take.価格)}">利確 ${num(r.take.価格)}円</button><button type="button" data-act="fill-pick" data-id="${esc(r.stop.id)}" data-price="${esc(r.stop.参照価格)}">守り ${num(r.stop.参照価格)}円</button></div></div>` : ""}
    <div class="vrow"><div class="field"><label for="fl-px">価格</label><div class="in"><input id="fl-px" class="right num" inputmode="decimal" value="${esc(priceOf(one) ?? "")}"><span class="u">円</span></div></div>
    <div class="field"><label for="fl-n">株数</label><div class="in"><input id="fl-n" class="right num" inputmode="numeric" value="${esc((one || r.stop).株数)}"><span class="u">株</span></div></div></div>
    <div class="field"><label for="fl-fee">手数料</label><div class="in"><input id="fl-fee" class="right num" inputmode="numeric" value="0"><span class="u">円</span></div></div>
    <div id="fl-note" class="alerts"></div>
    <div class="actions"><button class="btn" data-act="fill-save"${one ? "" : " disabled"}>約定を記録する</button><p class="meta" style="text-align:center">建玉と現金には次の定期実行で反映します</p></div>`, { key: "fill" });
  fillNote();
}
function fillNote() {   // 返済の約定で建玉がなくなるなら、今夜の一覧にあるその銘柄の注文は置かずに済むと知らせる
  const el = document.getElementById("fl-note"); if (!el || !S.fill || !S.fill.pick) return;
  const o = findOrders([S.fill.pick])[0]; const pos = o && ((S.state && S.state.建玉) || []).find(p => p.id === o.建玉id);
  const n = parseNum(document.getElementById("fl-n").value); const v = decideView();
  const tonight = pos && v.run ? (v.run.注文一覧 || []).filter(x => x.建玉id === pos.id && x.注文 !== "取消") : [];
  el.innerHTML = o && o.種類 !== "新規" && pos && typeof n === "number" && n >= pos.株数 && tonight.length ? alertBox("y", "今夜は置かない", `この約定で ${esc(pos.銘柄)} の建玉はなくなります。今夜の一覧にある ${esc(pos.銘柄)} の注文（${tonight.length}件）は置かずに済みます`) : "";
}
function textSheet(title, label, act, ph, data = "") {
  sheet(title, `<div class="field"><label for="tx">${esc(label)}</label><textarea id="tx" class="ta" placeholder="${esc(ph)}" autofocus></textarea></div><div class="actions"><button class="btn" data-act="${act}" ${data}>記録する</button></div>`, { key: act });
}
const ds = el => el.dataset;   // data-* を読む
async function onClick(ev) {
  const el = ev.target.closest("[data-act]"); if (!el) return;
  const act = el.dataset.act; if (el.tagName === "SELECT" || (el.tagName === "INPUT" && el.type !== "button") || el.tagName === "TEXTAREA") return;
  if (el.tagName === "A" && el.getAttribute("href") === "#") ev.preventDefault();
  const v = decideView();
  try {
    switch (act) {
      case "close": if (S.edit) { store(DRAFT_KEY, S.edit); S.edit = null; } closeSheet(); break;
      case "reload": S.loaded = false; render(); await loadCore(); render(); break;
      case "order": orderSheet(ds(el).ids.split(",")); break;
      case "fix": fixSheet(ds(el).item, ds(el).code); break;
      case "fix-save": busy(el, true); await enqueue("仮置きの確定", { 項目: ds(el).item, 銘柄: ds(el).code, 値: $("#fx-val").value.trim(), 有効期限: $("#fx-exp").value || null }); closeSheet(); render(); break;
      case "confirm": {
        const d = ds(el).date; const trial = v.run && v.run.執行者 === TRIAL;
        if (trial) { busy(el, true); await enqueue("最終確認", { 日付: d, 判定点: H, 結果: "手順どおり", 裁量: "", 置いた: "全部", 確定: [] }); }
        else store(confirmKey(d), { 結果: "手順どおり", 裁量: "" });
        render(); toCurrentStep(); break;
      }
      case "changed": textSheet("変えた理由", "何を、なぜ変えたか", "changed-save", "例: 1002 は決算が近いので見送る", `data-date="${esc(ds(el).date)}"`); break;
      case "changed-save": {
        const why = $("#tx").value.trim(); if (!why) { toast("理由を書いてください", true); break; }
        const d = ds(el).date; const trial = v.run && v.run.執行者 === TRIAL;
        if (trial) { busy(el, true); await enqueue("最終確認", { 日付: d, 判定点: H, 結果: "変えた", 裁量: why, 置いた: "全部", 確定: [] }); }
        else store(confirmKey(d), { 結果: "変えた", 裁量: why });
        closeSheet(); render(); toCurrentStep(); break;
      }
      case "seg": { $$("button", el.parentElement).forEach(b => b.setAttribute("aria-pressed", b === el ? "true" : "false")); break; }
      case "placed": {
        const d = ds(el).date, jp = ds(el).jp; const boxes = $$('input[data-act="place-toggle"]');
        const on = boxes.filter(b => b.checked).flatMap(b => b.dataset.ids.split(","));
        const offs = boxes.filter(b => !b.checked && !b.dataset.moot);   // 今日の約定で不要になった注文は、置かなくても手順どおり
        if (offs.some(b => !b.closest("label").querySelector('[aria-pressed="true"]'))) { toast("置かなかった注文の理由（できなかった／見送った）を選んでください", true); break; }
        const why = offs.map(b => { const lab = b.closest("label"); return `${lab.querySelector("b").textContent}: ${lab.querySelector('[aria-pressed="true"]').dataset.val}`; });
        const p1 = jp === H ? (store(confirmKey(d)) || { 結果: "手順どおり", 裁量: "" }) : { 結果: offs.length ? "変えた" : "手順どおり", 裁量: "" };
        const 裁量 = [p1.裁量, ...why].filter(Boolean).join("。");
        busy(el, true);
        const all = boxes.every(b => b.checked);
        await enqueue("最終確認", { 日付: d, 判定点: jp, 結果: offs.length && p1.結果 === "手順どおり" ? "変えた" : p1.結果, 裁量, 置いた: all ? "全部" : on.length ? on : "なし", 確定: [] });
        store(confirmKey(d), null); render(); toCurrentStep(); break;
      }
      case "confirm-am": busy(el, true); await enqueue("最終確認", { 日付: ds(el).date, 判定点: A, 結果: "手順どおり", 裁量: "", 置いた: "全部", 確定: [] }); render(); break;
      case "fill": fillSheet(ds(el).ids.split(",")); break;
      case "fill-pick": { $$("button", el.parentElement).forEach(b => b.setAttribute("aria-pressed", b === el ? "true" : "false")); S.fill.pick = ds(el).id; $("#fl-px").value = ds(el).price; $('[data-act="fill-save"]').disabled = false; fillNote(); break; }
      case "fill-save": {
        const o = findOrders([S.fill.pick])[0]; const px = parseNum($("#fl-px").value), n = parseNum($("#fl-n").value), fee = parseNum($("#fl-fee").value || "0");
        if (typeof px !== "number" || typeof n !== "number" || n <= 0) { toast("価格と株数を数字で入れてください", true); break; }
        const kind = o.種類 === "新規" ? null : o.種類 === "手仕舞い" ? ((o.理由 && o.理由.段) || "手仕舞い") : o.種類;
        busy(el, true);
        await enqueue("約定", { 日付: v.date || jst().date, 銘柄: String(o.銘柄), 方向: o.方向 || (isBuy(o) ? "買い" : "売り"), 新規か返済: o.種類 === "新規" ? "新規" : "返済", 価格: px, 株数: n, 注文id: o.id, 種類: kind, 手数料: typeof fee === "number" ? fee : 0 });
        closeSheet(); render(); break;
      }
      case "fill-done": busy(el, true); await enqueue("約定の確認", { 日付: ds(el).date, 件数: Number(ds(el).n || 0) }); render(); toCurrentStep(); break;
      case "noop": sheet("今日は作業できない", `<p class="meta">何もしないで大丈夫です。新規は置かれず、守りは期間指定で残ります。作業しなかったことだけ記録します</p><div class="actions"><button class="btn" data-act="noop-save" data-date="${esc(ds(el).date)}">作業なしを記録する</button></div>`, { key: "noop" }); break;
      case "noop-save": busy(el, true); await enqueue("作業なし", { 日付: ds(el).date }); closeSheet(); render(); break;
      case "view-prev": S.viewOverride = { kind: "evening", date: v.prev.date, run: v.prev.run }; render(); break;
      case "view-now": S.viewOverride = null; render(); break;
      case "ack": { const a = store("iremono.ack") || []; a.push(ds(el).id); store("iremono.ack", a.slice(-50)); render(); break; }
      case "day": daySheet(ds(el).date); break;
      case "cash": cashSheet(); break;
      case "cash-save": {
        const kind = ($('#layer [aria-pressed="true"]') || {}).dataset ? $('#layer [aria-pressed="true"]').dataset.val : "入金"; const amt = parseNum($("#c-amt").value);
        if (typeof amt !== "number" || amt <= 0) { toast("金額を数字で入れてください", true); break; }
        busy(el, true); await enqueue("入出金", { 日付: $("#c-date").value, 金額: kind === "出金" ? -amt : amt, 種類: kind, 備考: $("#c-note").value.trim() }); closeSheet(); render(); break;
      }
      case "balance": balanceSheet(); break;
      case "balance-save": { const c = parseNum($("#b-cash").value); if (typeof c !== "number") { toast("現金残高を数字で入れてください", true); break; } busy(el, true); await enqueue("残高", { 日付: $("#b-date").value, 現金: c }); closeSheet(); render(); break; }
      case "stop": stopSheet(false); break;
      case "resume": stopSheet(true); break;
      case "stop-save": { const why = $("#s-why").value.trim(); if (!why) { toast("理由を書いてください", true); break; } busy(el, true); await enqueue("停止", { 理由: why }); closeSheet(); render(); break; }
      case "resume-save": busy(el, true); await enqueue("解除", {}); closeSheet(); render(); break;
      case "edit-num": { const st = routeOf().arg; const b = stageBody(st); openEdit({ stage: st, mode: "num", key: ds(el).key, before: clone(b.数値[ds(el).key]), cur: clone(b.数値[ds(el).key]), reason: "" }); break; }
      case "edit-rule": { const st = routeOf().arg; const b = stageBody(st); const i = Number(ds(el).i); const rule = i >= 0 ? b.規則[i] : null;
        openEdit({ stage: st, mode: "rule", index: i, before: rule ? clone(rule) : null, cur: rule ? clone(rule) : { 名前: "", 対象: {}, 条件: [], 出力: {} }, reason: "" }); break; }
      case "edit-default": { const st = routeOf().arg; const b = stageBody(st); openEdit({ stage: st, mode: "default", before: clone(b.既定) ?? null, cur: clone(b.既定) || {}, reason: "" }); break; }
      case "cadd": S.edit.cur.条件 = S.edit.cur.条件 || []; S.edit.cur.条件.push({ 項目: "", 比較: "以上", 値: 0 }); store(DRAFT_KEY, S.edit); renderEdit(); break;
      case "cdel": S.edit.cur.条件.splice(Number(ds(el).i), 1); store(DRAFT_KEY, S.edit); renderEdit(); break;
      case "vdel": edSet(JSON.parse(ds(el).path), undefined); renderEdit(); break;
      case "vaddkey": { const path = JSON.parse(ds(el).path); const inp = document.getElementById("nk-" + path.join("-")); const k = inp && inp.value.trim(); if (!k) { toast("欄の名前を入れてください", true); break; } edSet(path.concat([k]), ""); renderEdit(); break; }
      case "vadditem": { const path = JSON.parse(ds(el).path); const arr = (edGet(path) || []).slice(); arr.push(""); edSet(path, arr); renderEdit(); break; }
      case "vins": insertExpr(ds(el).path, ds(el).text); break;
      case "edel": S.edit.del = !S.edit.del; store(DRAFT_KEY, S.edit); renderEdit(); break;
      case "ecancel": store(DRAFT_KEY, null); S.edit = null; closeSheet(); break;
      case "esave": await saveEdit(el); break;
      case "rev-retry": await writeRev(); render(); break;
      case "tok-show": { const i = $("#cf-tk"); i.type = i.type === "password" ? "text" : "password"; el.textContent = i.type === "password" ? "表示" : "隠す"; break; }
      case "conf-save": {
        const repo = $("#cf-repo").value.trim().replace(/^https:\/\/github\.com\//, "").replace(/\.git$/, ""), branch = $("#cf-br").value.trim() || "master", token = $("#cf-tk").value.trim();
        if (!LOCAL && !/^[\w.-]+\/[\w.-]+$/.test(repo)) { toast("リポジトリは「持ち主/名前」の形で入れてください", true); break; }
        if (!LOCAL && !token) { toast("トークンを入れてください", true); break; }
        store(CFG_KEY, { repo, branch, token }); busy(el, true);
        const ok = LOCAL || await testConn(); busy(el, false);
        if (ok) { S.loaded = false; S.strat = null; S.trades = null; S.logList = null; S.stats = null; S.know = null; await loadCore(); location.hash = "#today"; }
        render(); break;
      }
      case "conf-test": busy(el, true); await testConn(); render(); break;
    }
  } catch (e) { busy(el, false); if (!(e instanceof AuthError || e instanceof ConflictError || e instanceof NetError)) { console.error(e); toast("うまく動きませんでした: " + (e.message || e), true); } }
}
function insertExpr(pathJson, text) {
  const ta = $(`textarea[data-path='${pathJson.replace(/'/g, "&#39;")}']`) || $$("textarea[data-type='expr']").find(t => t.dataset.path === JSON.stringify(JSON.parse(pathJson)));
  if (!ta) return; const s = ta.selectionStart ?? ta.value.length, e = ta.selectionEnd ?? ta.value.length;
  ta.value = ta.value.slice(0, s) + text + ta.value.slice(e); ta.focus(); ta.selectionStart = ta.selectionEnd = s + text.length;
  edSet(JSON.parse(ta.dataset.path), { 式: ta.value }); refreshChecks();
}
function onInput(ev) {
  const el = ev.target; const act = el.dataset && el.dataset.act; if (!act) return;
  const isChange = ev.type === "change";
  switch (act) {
    case "place-toggle": if (!isChange) return; { const lab = el.closest("label"); const ri = lab.querySelector(".reason-in"); if (ri) ri.hidden = el.checked; const boxes = $$('input[data-act="place-toggle"]').filter(b => !b.dataset.moot || b.checked); const n = boxes.filter(b => b.checked).length; const btn = $('[data-act="placed"]'); if (btn) btn.textContent = n === boxes.length ? (ds(btn).jp === A ? "全部出した" : "全部置いた") : n === 0 ? (ds(btn).jp === A ? "出さなかった" : "置かなかった") : `${n}件${ds(btn).jp === A ? "出した" : "置いた"}`; } break;
    case "dict-q": if (isChange) return; S.dictQuery = el.value; { const pos = el.selectionStart; $("#view").innerHTML = dictHTML(); const i = $("#dict-q"); i.focus(); i.selectionStart = i.selectionEnd = pos; } break;
    case "enum": if (isChange) return; S.edit.cur = ds(el).arr === "1" ? el.value.split(/[、,]/).map(s => parseNum(s.trim())).filter(s => s !== "") : parseNum(el.value); store(DRAFT_KEY, S.edit); { const b = $("#layer .diff div:not(.was) b"); if (b) b.innerHTML = fmtVal(S.edit.cur); } refreshChecks(); break;
    case "ereason": if (isChange) return; S.edit.reason = el.value; store(DRAFT_KEY, S.edit); refreshChecks(); break;
    case "vset": {
      if (isChange && el.tagName !== "SELECT") return; if (!isChange && el.tagName === "SELECT") return;
      const path = JSON.parse(ds(el).path); const t = ds(el).type; const val = el.value;
      edSet(path, t === "num" ? parseNum(val) : t === "numkey" ? { 数値: val } : t === "expr" ? { 式: val } : t === "bdays" ? { 営業日後: parseNum(val) } : val);
      refreshChecks(); break;
    }
    case "vkind": if (!isChange) return; { const path = JSON.parse(ds(el).path); const spec = ds(el).spec === "汎用" || ds(el).spec === "条件" ? { 種類: ds(el).spec } : (stageDef(S.edit.stage).出力の欄 || []).find(s => s.欄 === path[path.length - 1]) || { 種類: ds(el).spec }; edSet(path, el.value === "出さない" ? undefined : defaultFor(el.value, spec, edCtx())); renderEdit(); } break;
    case "vitem": if (!isChange) return; { const path = JSON.parse(ds(el).path); const it = edCtx().items[el.value]; edSet(path, it && (it.引数 || []).length ? { 項目: el.value, 引数: Object.fromEntries(it.引数.map(a => [a, ""])) } : { 項目: el.value }); renderEdit(); } break;
    case "citem": if (!isChange) return; { const i = JSON.parse(ds(el).path)[1]; const c = S.edit.cur.条件[i]; const it = edCtx().items[el.value]; c.項目 = el.value; if (it && (it.引数 || []).length) c.引数 = Object.fromEntries(it.引数.map(a => [a, (c.引数 || {})[a] ?? ""])); else delete c.引数; store(DRAFT_KEY, S.edit); renderEdit(); } break;
    case "ccmp": if (!isChange) return; { const c = S.edit.cur.条件[Number(ds(el).i)]; c.比較 = el.value; if (["はい", "いいえ"].includes(el.value)) delete c.値; else if (["いずれか", "含まない"].includes(el.value) && !Array.isArray(c.値)) c.値 = []; else if (c.値 === undefined || Array.isArray(c.値)) c.値 = 0; store(DRAFT_KEY, S.edit); renderEdit(); } break;
    case "varg": if (isChange) return; edSet(JSON.parse(ds(el).path).concat(["引数", ds(el).arg]), parseNum(el.value)); refreshChecks(); break;
    case "tgt": if (!isChange) return; S.edit.cur.対象 = S.edit.cur.対象 || {}; if (el.value) S.edit.cur.対象[ds(el).key] = el.value; else delete S.edit.cur.対象[ds(el).key]; store(DRAFT_KEY, S.edit); refreshChecks(); break;
    case "oadd": if (!isChange || !el.value) return; { const path = JSON.parse(ds(el).path); const sp = (stageDef(S.edit.stage).出力の欄 || []).find(s => s.欄 === el.value); const k = (KIND_LIST[sp.種類] || KIND_LIST.汎用).find(x => x !== "出さない"); edSet(path.concat([el.value]), defaultFor(k, sp, edCtx())); renderEdit(); } break;
    case "vinsitem": if (!isChange || !el.value) return; { const it = edCtx().items[el.value]; const txt = "{" + el.value + ((it && (it.引数 || []).length) ? "(" + it.引数.map(a => a + "=").join(",") + ")" : "") + "}"; insertExpr(ds(el).path, txt); el.value = ""; } break;
  }
}

/* ================= 起動 ================= */
document.addEventListener("click", onClick);
document.addEventListener("keydown", ev => { if ((ev.key === "Enter" || ev.key === " ") && ev.target.matches('[role="button"][data-act]')) { ev.preventDefault(); ev.target.click(); } if (ev.key === "Escape" && $("#layer").innerHTML) { if (S.edit) { store(DRAFT_KEY, S.edit); S.edit = null; } closeSheet(); } });
document.addEventListener("input", onInput);
document.addEventListener("change", onInput);
window.addEventListener("hashchange", () => { closeSheet(); S.viewOverride = null; render(); window.scrollTo(0, 0); });
let lastLoad = 0;
document.addEventListener("visibilitychange", async () => { if (document.visibilityState === "visible" && Date.now() - lastLoad > 60000 && (LOCAL || cfg().token) && !S.edit) { lastLoad = Date.now(); await loadCore(); render(); } });
(async function boot() {
  render();
  if (!LOCAL && !cfg().token) return;
  lastLoad = Date.now(); await loadCore(); render();
})();
