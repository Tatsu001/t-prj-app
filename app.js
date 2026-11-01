/* 売買ノート。data/ の JSON を GitHub から読み書きする1枚のアプリ。スマホ前提。
   仕組みは問いの番号・戦略名・行の数と中身・材料の名前を知らない。問いは属性（対象・結果）で探し、行は配列を並べるだけ。 */
(function () {
  'use strict';
  const E = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const yen = (v) => (v == null || v === '' ? '' : Number(v).toLocaleString('ja-JP'));
  const todayISO = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
  const WD = '日月火水木金土';
  const dShort = (s) => (s ? String(s).slice(5).replace('-', '/') : '');
  const FILES = ['前提', '問い', '原則', '取引', '候補', '改定履歴', '口座', '材料'];
  const OPTIONAL = { '口座': [] };
  const KEY = 'si.cfg';
  const app = document.getElementById('app');
  const DOCS = [
    ['基礎', [['docs/00_株取引の基礎.md', '株取引の基礎'], ['docs/basics/01_資金管理と期待値.md', '資金管理と期待値'], ['docs/basics/02_チャートの基礎.md', 'チャートの基礎'], ['docs/basics/03_需給の読み方.md', '需給の読み方'], ['docs/basics/04_決算と業績の基礎.md', '決算と業績の基礎'], ['docs/basics/05_相場心理と行動のクセ.md', '相場心理と行動のクセ'], ['docs/basics/06_地合いと指数・イベント暦.md', '地合いと指数・イベント暦'], ['docs/basics/07_兼業の注文実務.md', '兼業の注文実務']]],
    ['IPO', [['docs/01_IPOの全体像.md', 'IPOの全体像'], ['docs/02_公開価格の決まり方.md', '公開価格の決まり方'], ['docs/03_初値の決まり方.md', '初値の決まり方'], ['docs/04_機関投資家とVCの動き.md', '機関投資家とVCの動き'], ['docs/05_初値後の値動き.md', '初値後の値動き'], ['docs/06_情報源の読み方.md', '情報源の読み方']]],
    ['用語', [['docs/07_用語集.md', '用語集']]],
    ['知見者', [['references/テスタ氏X投稿_株式投資の知見まとめ_2016-2026.md', 'テスタ（X投稿 2016–2026）'], ['references/ミネルヴィニ_成長株投資法_知見まとめ.md', 'ミネルヴィニ『成長株投資法』'], ['references/ミネルヴィニ_株式トレード基本と原則_知見まとめ.md', 'ミネルヴィニ『株式トレード 基本と原則』'], ['references/ティアー_バフェットとソロス_知見まとめ.md', 'ティアー『バフェットとソロス 勝利の投資学』']]],
    ['ノートの設計', [['設計案_判定方式.md', '完成像（判定方式）'], ['rules/00_前提.md', '前提（兼業・現物・小資金）'], ['rules/04_テスタ知見との対応表.md', 'テスタ知見との対応表']]],
  ];
  const DOC_LIST = DOCS.flatMap(([, l]) => l);
  const docTitle = (p) => (DOC_LIST.find(([x]) => x === p) || [])[1] || p;

  // ---------- 設定と保存先 ----------
  let cfg = { owner: 'Tatsu001', repo: 'secondary-investment', branch: 'master', token: '' };
  try { Object.assign(cfg, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (e) { }
  const isLocal = () => location.protocol === 'http:' && /^(localhost|127\.0\.0\.1)/.test(location.host) && !cfg.token;
  let data = {}, shas = {}, edit = null, msg = null, loaded = false;
  const cache = { text: {}, commits: null };

  const b64enc = (s) => { const u = new TextEncoder().encode(s); let b = ''; for (let i = 0; i < u.length; i += 0x8000) b += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(b); };
  const b64dec = (b) => new TextDecoder().decode(Uint8Array.from(atob(b.replace(/\n/g, '')), (c) => c.charCodeAt(0)));
  const ghUrl = (path) => `https://api.github.com/repos/${cfg.owner}/${cfg.repo}/contents/${path.split('/').map(encodeURIComponent).join('/')}`;
  const ghHeaders = () => ({ Authorization: 'Bearer ' + cfg.token, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' });
  async function ghRaw(path) {
    const r = await fetch(ghUrl(path) + '?ref=' + encodeURIComponent(cfg.branch), { headers: ghHeaders(), cache: 'no-store' });
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`${path} を読めません（${r.status}）`);
    return r.json();
  }
  async function ghGet(name) {
    const j = await ghRaw('data/' + name + '.json');
    if (!j) { if (name in OPTIONAL) { delete shas[name]; return OPTIONAL[name]; } throw new Error(`${name}.json がありません`); }
    shas[name] = j.sha;
    return JSON.parse(b64dec(j.content));
  }
  async function ghPut(name, obj, message) {
    const body = { message, content: b64enc(JSON.stringify(obj, null, 1) + '\n'), branch: cfg.branch };
    if (shas[name]) body.sha = shas[name];
    const r = await fetch(ghUrl('data/' + name + '.json'), { method: 'PUT', headers: Object.assign({ 'Content-Type': 'application/json' }, ghHeaders()), body: JSON.stringify(body) });
    if (r.status === 409 || r.status === 422) { data[name] = await ghGet(name); throw new Error(`${name} は他で更新されていたので読み直した。もう一度保存する`); }
    if (!r.ok) throw new Error(`保存に失敗（${r.status}）`);
    const j = await r.json(); shas[name] = j.content.sha; cache.commits = null;
  }
  async function loadAll() {
    if (isLocal()) {
      for (const n of FILES) { const r = await fetch('../data/' + n + '.json', { cache: 'no-store' }); data[n] = r.ok ? await r.json() : (OPTIONAL[n] || []); }
    } else {
      if (!cfg.token) throw new Error('settings');
      for (const n of FILES) data[n] = await ghGet(n);
    }
    loaded = true;
  }
  async function save(name, message) {
    if (isLocal()) { msg = { ng: true, text: 'ローカル表示では保存できない。設定でGitHubにつなぐ' }; return false; }
    try { await ghPut(name, data[name], message); msg = { text: '保存した：' + message }; return true; }
    catch (e) { msg = { ng: true, text: e.message }; return false; }
  }
  async function readText(path) {
    if (cache.text[path] != null) return cache.text[path];
    let t;
    if (isLocal()) { const r = await fetch('../' + path, { cache: 'no-store' }); if (!r.ok) throw new Error(path + ' を読めません'); t = await r.text(); }
    else { const j = await ghRaw(path); if (!j) throw new Error(path + ' がありません'); t = b64dec(j.content); }
    cache.text[path] = t; return t;
  }
  async function commits() {
    if (isLocal()) return [];
    if (cache.commits) return cache.commits;
    const r = await fetch(`https://api.github.com/repos/${cfg.owner}/${cfg.repo}/commits?sha=${encodeURIComponent(cfg.branch)}&path=data&per_page=30`, { headers: ghHeaders(), cache: 'no-store' });
    if (!r.ok) return [];
    const j = await r.json();
    cache.commits = j.map((c) => ({ date: c.commit.author.date, who: c.commit.author.name, text: c.commit.message.split('\n')[0] }));
    return cache.commits;
  }

  // ---------- 共通部品 ----------
  const route = () => (location.hash || '#today').slice(1).split('/').map((x) => { try { return decodeURIComponent(x); } catch (e) { return x; } });
  const TABS = [['today', '今日'], ['trades', '取引'], ['rules', 'ルール'], ['docs', '知識']];
  const tabOf = (r) => ({ today: 'today', trades: 'trades', trade: 'trades', cand: 'trades', rules: 'rules', rule: 'rules', materials: 'rules', docs: 'docs', changes: 'today', settings: 'today' }[r] || 'today');
  const shell = (body) => { const cur = tabOf(route()[0]); return body + '<nav class="tabs">' + TABS.map(([k, n]) => `<a href="#${k}" class="${cur === k ? 'on' : ''}">${n}</a>`).join('') + '</nav>'; };
  const pill = (st) => `<span class="pill ${['採用', '保有中', '一部利確', 'ウォッチ中', '判断できる', '可', '○'].includes(st) ? 'pill-ok' : ['不採用', '見送り', '取消', '不可', '×', '停止'].includes(st) ? 'pill-ng' : ['注文中', '確認待ち', '提案', '未', '新規停止'].includes(st) ? 'pill-warn' : st === '型が出た' ? 'pill-acc' : ''}">${E(st)}</span>`;
  const mark = (v) => (v === '○' ? '<span class="pill pill-ok">○</span>' : v === '×' ? '<span class="pill pill-ng">×</span>' : '<span class="pill">未</span>');
  const who = (j) => (j ? `<span class="pill who">${E(j)}</span>` : '');
  const sh = (t, sub) => `<h2 class="sh">${E(t)}${sub ? `<small>${E(sub)}</small>` : ''}</h2>`;
  const card = (title, body, sub) => `<section class="scr"><h4>${title}${sub ? `<small>${E(sub)}</small>` : ''}</h4>${body}</section>`;
  const facts = (rows) => `<dl class="facts">${rows.filter(([, v]) => v != null && v !== '').map(([k, v]) => `<div><dt>${E(k)}</dt><dd>${v}</dd></div>`).join('')}</dl>`;
  const fld = (label, name, value, o = {}) => {
    const v = value == null ? '' : value;
    let inp;
    if (o.type === 'select') inp = `<select name="${name}">${o.options.map((x) => `<option value="${E(x)}" ${String(x) === String(v) ? 'selected' : ''}>${E(x || '—')}</option>`).join('')}</select>`;
    else if (o.type === 'textarea') inp = `<textarea name="${name}" ${o.rows ? `rows="${o.rows}"` : ''}>${E(v)}</textarea>`;
    else inp = `<input name="${name}" type="${o.type || 'text'}" value="${E(v)}" ${o.type === 'number' ? 'inputmode="decimal"' : ''} ${o.step ? `step="${o.step}"` : ''} ${o.ph ? `placeholder="${E(o.ph)}"` : ''}>`;
    return `<label class="f ${o.span ? 'span' : ''}"><span>${E(label)}${o.note ? `<small>${E(o.note)}</small>` : ''}</span>${inp}</label>`;
  };
  const lines = (t) => String(t || '').split('\n').map((s) => s.trim()).filter(Boolean);
  const text = (a) => (Array.isArray(a) ? a.join('\n') : a || '');
  const numOrNull = (v) => (v === '' || v == null ? null : isNaN(Number(v)) ? v : Number(v));
  const fd = (form) => { const o = {}; new FormData(form).forEach((v, k) => { if (k in o) { o[k] = [].concat(o[k], v); } else o[k] = v; }); return o; };
  const cp = (v) => `<button type="button" class="cp" data-copy="${E(v)}">${yen(v)}</button>`;
  const stock = (t) => `<b>${E(t['銘柄名'])}</b><span class="code">${E(t['コード'])}</span>`;
  const linkify = (s) => E(s).replace(/docs\/(basics\/)?(\d\d)/g, (m, b, n) => { const hit = DOC_LIST.find(([p]) => p.startsWith(`docs/${b || ''}${n}_`)); return hit ? `<a href="#docs/${hit[0]}">${m}</a>` : m; });
  const keyLabel = (k) => k.replace(/_件$/, '（件）').replace(/_pct$/, '（%）').replace(/_億$/, '（億円）').replace(/_営業日$/, '（営業日）').replace(/_日$/, '（日）').replace(/_R$/, '（R）').replace(/_月$/, '（月）');
  const UNIT = [['_pct', '%'], ['_億', '億円'], ['_営業日', '営業日'], ['_日', '日'], ['_R', 'R'], ['_月', 'か月'], ['_件', '件']];
  const numText = (k, v) => { const u = UNIT.find(([x]) => k.endsWith(x)); return `<b>${E(u ? k.slice(0, -u[0].length) : k)}</b> ${E(v)}${u && !isNaN(Number(v)) ? E(u[1]) : ''}`; };
  // 文の {キー} に数値欄の値を入れる
  const fill = (t, s) => String(t || '').replace(/\{([^{}]+)\}/g, (m, k) => { const v = ((s && s['数値欄']) || {})[k]; return v == null || v === '' ? '—' : String(v); });
  const fmtNum = (v) => (v == null ? '—' : Number.isInteger(Number(v)) ? String(Number(v)) : String(v));

  // ---------- 問い（属性で探す） ----------
  const QS = () => data['問い'] || [];
  const qWhere = (f) => QS().filter(f);
  const qOne = (f) => qWhere(f)[0] || null;
  const Q = (n) => QS().find((q) => q.num === Number(n));
  const qGate = () => qOne((q) => q['対象'] === '銘柄' && q['結果'] === '段階を進める');
  const qEntry = () => qOne((q) => q['対象'] === '銘柄' && q['結果'] === '注文を作る');
  const qScreen = () => qOne((q) => q['対象'] === '銘柄' && q['結果'] === '候補に入れる');
  const qSell = () => qWhere((q) => q['対象'] === '建玉' && q['結果'] === '売り注文');
  const qGates = () => qWhere((q) => q['対象'] === '口座' && q['結果'] === '新規可否');
  const perTradeQs = () => qWhere((q) => q['対象'] === '建玉' || ['注文を作る', '可否'].includes(q['結果']));
  const adoptedText = (q) => q['戦略'].filter((s) => s['状態'] === '採用').map((s) => (s['区分'] === '共通' ? '' : s['区分'] + '：') + s.name).join(' ／ ') || '—';
  const slist = (q) => q['戦略'].filter((s) => s['状態'] !== '不採用').map((s) => s.name);
  // 材料
  const MAT = () => data['材料'] || [];
  const matItem = (k) => MAT().find((m) => m.key === k);
  const isPick = (k) => ((matItem(k) || {})['種類'] === '選択');
  const ALLOWED = { '銘柄': ['銘柄', '建玉', '暦', '指数'], '建玉': ['建玉', '銘柄', '暦', '指数', '口座'], '口座': ['口座', '指数', '暦', '銘柄'], '戦略': ['戦略'], '人': [] };
  const matNums = (obj) => MAT().filter((m) => m['種類'] !== '資料' && (ALLOWED[obj] || []).includes(m['対象']));
  const matDocs = () => MAT().filter((m) => m['種類'] === '資料');
  const scopeItems = () => MAT().filter((m) => m['種類'] === '選択' && m['対象'] === '銘柄');
  // 暦と口座
  const cal = () => Calc.makeCal((data['前提'] || {})['休日']);
  const prevBd = (today) => { const c = cal(); return c.workday(new Date(today + 'T00:00:00Z'), -1).toISOString().slice(0, 10); };
  const acct = (today) => Calc.latestAccount(data['口座'], today);
  const isStale = (today) => { const a = acct(today); return !a || a['日付'] < prevBd(today); };
  // 候補の段階と行
  const gateFor = (c) => Calc.gateFor(QS(), c);
  const candStage = (c) => Calc.candStage(c, gateFor(c));
  const candRowsOf = (c) => { const q = qGate(); if (!q) return { q: null, s: null, rows: [] }; const s = Calc.adoptedFor(q, c['区分']); return { q, s, rows: Calc.rowsFor(s, Calc.candAttrs(c)) }; };
  const cstate = (t) => Calc.state(t);
  const condText = (r, s) => { const c = r['条件']; if (!c) return '常に'; if (c['判定'] === '計算') { const m = matItem(c['項目']) || {}; const v = fill(Array.isArray(c['値']) ? c['値'].join('・') : String(c['値']), s); return `${c['項目']} が ${v}${m['種類'] === '選択' ? '' : (m['単位'] || '') + c['比較']}`; } return fill(c['文'], s) + (c['見るもの'] && c['見るもの'].length ? `<small class="see">${E(c['見るもの'].join('・'))}</small>` : ''); };
  const scopeText = (r) => ((r['時点'] || []).length ? ['時点 ' + r['時点'].join('・')] : []).concat((r['適用範囲'] || []).map((a) => `${a['項目']} ${(Array.isArray(a['値']) ? a['値'] : [a['値']]).join('・')}`)).join('、');

  // ---------- 今日 ----------
  const SCENES = [['pre', '寄付前'], ['noon', '昼'], ['post', '引け後'], ['week', '週末'], ['month', '月初']];
  function pickScene() { const d = new Date(), h = d.getHours() + d.getMinutes() / 60, w = d.getDay(); if (w === 0 || w === 6) return 'week'; if (h < 9) return 'pre'; if (h < 15.5) return 'noon'; return 'post'; }
  function viewToday() {
    const today = todayISO(), d = new Date(today + 'T00:00:00');
    const want = route()[1];
    const scene = SCENES.some(([k]) => k === want) ? want : pickScene();
    const seg = `<div class="seg">${SCENES.map(([k, n]) => `<a href="#today/${k}" class="${k === scene ? 'on' : ''}">${n}</a>`).join('')}</div>`;
    const month = d.getDate() <= 3 && scene !== 'month' && scene !== 'week' ? `<div class="rows"><a class="row" href="#today/month"><div class="r1"><b>月初の見直し</b></div><div class="r2">集計と提案を見て、戦略の状態を決める</div><span class="chev">›</span></a></div>` : '';
    const a = acct(today), stale = isStale(today);
    const warn = stale ? `<div class="msg">引け後の作業が未実行${a ? `（最終 ${E(dShort(a['日付']))}）` : '（記録なし）'}。注文一覧は古い</div>` : '';
    const body = { pre: scenePre, noon: sceneNoon, post: scenePost, week: sceneWeek, month: sceneMonth }[scene](a, stale, today);
    return shell(`<h1>${d.getMonth() + 1}月${d.getDate()}日（${WD[d.getDay()]}）</h1><p class="foot" id="last-update"></p>${seg}${warn}${month}${body}
<p class="foot"><a href="#changes">更新の記録</a>　<a href="#settings">設定</a></p>`);
  }
  // 新規買いの可否：口座の記録（引け後にAIが書いたもの）を映す。関門の行は問いの合成に従って良し悪しを色分け
  function verdict(a, full) {
    if (!a) return `<section class="verdict ng"><div class="v-main">新規買い 未判定</div><div class="v-why">引け後の作業がまだ</div></section>`;
    const ok = a['新規可否'] === '可';
    const gq = qGates(); const gates = (a['判定'] || []).filter((j) => gq.some((q) => q.num === j['問い']));
    const bad = (j) => { const q = gq.find((x) => x.num === j['問い']); return q && (q['合成'] === 'どれか' ? j['結果'] === '○' : j['結果'] === '×'); };
    return `<section class="verdict ${ok ? 'ok' : 'ng'}"><div class="v-main">新規買い ${E(a['新規可否'] || '未判定')}</div>${ok || !a['理由'] ? '' : `<div class="v-why">${E(a['理由'])}</div>`}
${full ? `<dl class="gates">${gates.map((j) => `<div class="${bad(j) ? 'bad' : ''}"><dt>${E(j['条件'])}</dt><dd>${E(j['根拠'] || j['結果'])}</dd></div>`).join('')}${a['ロット'] != null && a['ロット'] !== 1 ? `<div class="bad"><dt>ロット</dt><dd>${Math.round(a['ロット'] * 100)}%</dd></div>` : ''}${a['停止解除日'] ? `<div class="bad"><dt>新規停止</dt><dd>${E(dShort(a['停止解除日']))}まで</dd></div>` : ''}</dl><p class="v-cash">${a['1R額'] ? `1R ${yen(a['1R額'])}円　` : ''}記録 ${E(dShort(a['日付']))} ${E(a['時点'] || '')}</p>` : ''}</section>`;
  }
  const orderCard = (o, off) => `<article class="ord ${off ? 'off' : ''}"><header><b>${E(o['銘柄名'] || '')}</b><span class="code">${E(o['コード'] || '')}</span><span class="tag ${/売|変更/.test(o['種類'] || '') ? 'hold' : ''}">${E(o['種類'] || '')}</span></header>
<div class="line"><span class="nw">${o['価格'] != null ? cp(o['価格']) + '円 × ' : ''}${o['株数'] != null ? cp(o['株数']) + '株' : ''}</span></div>${o['メモ'] ? `<div class="line sub">${E(o['メモ'])}</div>` : ''}</article>`;
  const orderCards = (a, stale) => (a && a['注文'] && a['注文'].length ? a['注文'].map((o) => orderCard(o, stale)).join('') : '<p class="empty">注文なし</p>');
  function holdCards(full) {
    const held = data['取引'].filter((t) => ['保有中', '一部利確'].includes(cstate(t)));
    if (!held.length) return '<p class="empty">なし</p>';
    const sq = qSell();
    return held.map((t) => {
      const s = cstate(t), rem = Calc.remQty(t);
      const rules = perTradeQs().filter((q) => Calc.ruleOf(t, q.num)).map((q) => `<a href="#rule/${q.num}/${encodeURIComponent(Calc.ruleOf(t, q.num))}">${E(Calc.ruleOf(t, q.num))}</a>`).join('・');
      const js = sq.flatMap((q) => { const st = Calc.byName(q, Calc.ruleOf(t, q.num)) || Calc.adoptedFor(q, t['区分']); return Calc.condRows(st, Calc.candAttrs(t)).map((r) => ({ q, r, j: Calc.latest(t['判定'], q.num, r['名前']) })); });
      return `<article class="hold"><header><div>${stock(t)}<span class="sub">${E(t['区分'])}${rules ? '・' + rules : ''}</span></div>${pill(s)}</header>
<dl><div><dt>約定 ${E(dShort(t['約定日']))}</dt><dd>${yen(t['約定価格'])}円</dd></div><div><dt>損切り</dt><dd>${yen(t['損切り価格'])}円</dd></div><div><dt>残株数</dt><dd>${rem}株</dd></div><div><dt>期限</dt><dd>${t['期限日'] ? E(dShort(t['期限日'])) : '—'}</dd></div></dl>
${full ? `${t['次の行動'] ? `<p class="ai">次の行動　${E(t['次の行動'])}</p>` : ''}<h4>売る条件<small>当たった行の行動を取る</small></h4><div class="jrows">${js.map(({ r, j }) => `<div class="jrow"><span>${E(r['名前'])}</span>${mark(j ? j['結果'] : '未')}${who((r['条件'] || {})['判定'])}${j && j['根拠'] ? `<p>${E(j['根拠'])}</p>` : ''}</div>`).join('') || '<p class="empty">行なし</p>'}</div>` : ''}</article>`;
    }).join('');
  }
  function candRows(list) {
    if (!list.length) return '<p class="empty">なし</p>';
    return `<div class="rows">${list.map((c) => { const i = data['候補'].indexOf(c), st = candStage(c), { q, rows } = candRowsOf(c);
      const rs = q ? Calc.results(c['判定'], q.num, rows.filter((r) => r['条件']).map((r) => r['名前'])) : [];
      const nb = rs.filter((x) => x === '未').length;
      const r2 = st === '仮判定中' ? 'AIが仮判定中' : st === '確認待ち' ? `仮判定 ${rs.map((x) => (x === '未' ? '・' : x)).join('')}${nb ? `　未 ${nb}` : ''}` : st === 'ウォッチ中' ? `${((Calc.adoptedFor(qEntry() || { '戦略': [] }, c['区分']) || {}).name) || '型'} を待つ` : st === '型が出た' ? `型が出た ${dShort(c['型が出た日'])} → 注文中` : (c['絞り込み'] && c['絞り込み'] !== '可') ? c['絞り込み'] : `仮判定 ${rs.map((x) => (x === '未' ? '・' : x)).join('')}`;
      return `<a class="row" href="#cand/${i}"><div class="r1">${stock(c)}${pill(st)}</div><div class="r2">${E(c['区分'])}　${E(dShort(c['日付']))}　${E(r2)}</div><span class="chev">›</span></a>`; }).join('')}</div>`;
  }
  // 人の行で未のもの（今日の「答えること」に出す）
  function humanRows() {
    const out = [];
    const gq = qGate();
    (data['候補'] || []).forEach((c, i) => { const st = candStage(c); if (!['仮判定中', '確認待ち'].includes(st) || !gq) return; const { rows } = candRowsOf(c); rows.forEach((r) => { const cnd = r['条件']; if (cnd && cnd['判定'] === '人') { const j = Calc.latest(c['判定'], gq.num, r['名前']); if (!j || j['結果'] === '未') out.push({ kind: 'cand', i, q: gq.num, name: r['名前'], label: `候補 ${c['銘柄名']}`, text: fill(cnd['文'], candRowsOf(c).s) }); } }); });
    const sq = qSell();
    (data['取引'] || []).forEach((t, i) => { if (!['保有中', '一部利確'].includes(cstate(t))) return; sq.forEach((q) => { const st = Calc.byName(q, Calc.ruleOf(t, q.num)) || Calc.adoptedFor(q, t['区分']); Calc.condRows(st, Calc.candAttrs(t)).forEach((r) => { if (r['条件']['判定'] === '人') { const j = Calc.latest(t['判定'], q.num, r['名前']); if (!j || j['結果'] === '未') out.push({ kind: 'trade', i, q: q.num, name: r['名前'], label: `保有 ${t['銘柄名']}`, text: fill(r['条件']['文'], st) }); } }); }); });
    return out;
  }
  const humanAsk = (h) => `<li>${E(h.label)}：${E(h.text)}<span class="btns inline"><button class="b small" data-act="judge-${h.kind}" data-i="${h.i}" data-q="${h.q}" data-name="${E(h.name)}" data-v="○">○</button><button class="b small quiet" data-act="judge-${h.kind}" data-i="${h.i}" data-q="${h.q}" data-name="${E(h.name)}" data-v="×">×</button></span></li>`;
  function scenePre(a, stale) {
    const held = data['取引'].filter((t) => ['保有中', '一部利確'].includes(cstate(t)));
    return `<section>${sh('SBIに出す注文', a ? `${dShort(a['日付'])} の引け後に決めたもの` : '')}${orderCards(a, stale)}</section>
<section>${sh('保有中の損切り', '置いてあれば何もしない')}${held.length ? `<div class="rows">${held.map((t) => `<div class="row"><div class="r1">${stock(t)}</div><div class="r2">逆指値売り ${yen(t['損切り価格'])}円 × ${Calc.remQty(t)}株</div></div>`).join('')}</div>` : '<p class="empty">なし</p>'}</section>
${verdict(a, false)}`;
  }
  function sceneNoon(a) {
    const go = data['取引'].filter((t) => cstate(t) === '注文中');
    return `<section>${sh('約定したか', '約定していたら、逆指値売りを置いてAIに伝える')}${go.length ? `<div class="rows">${go.map((t) => `<div class="row"><div class="r1">${stock(t)}</div><div class="r2">${yen(t['発注価格'])}円 × ${t['株数'] || 0}株　→ 約定したら 逆指値売り ${yen(t['損切り価格'])}円</div></div>`).join('')}</div>` : '<p class="empty">今日は何もしない</p>'}</section>`;
  }
  function scenePost(a, stale) {
    const wait = data['候補'].filter((c) => candStage(c) === '確認待ち');
    const names = (l) => l.map((x) => x['銘柄名']).join('、');
    const ordering = data['取引'].filter((t) => cstate(t) === '注文中'), held = data['取引'].filter((t) => ['保有中', '一部利確'].includes(cstate(t)));
    const items = [];
    if (ordering.length) items.push(`<li>約定したか：${E(names(ordering))}（約定日・価格・株数）</li>`);
    if (held.length) items.push(`<li>売れたか、一覧と違う注文を出したか：${E(names(held))}</li>`);
    humanRows().forEach((h) => items.push(humanAsk(h)));
    return `<section>${sh('AIに答えること')}${items.length ? `<ol class="ask">${items.join('')}</ol>` : '<p class="empty">なし</p>'}</section>
<section>${sh('明日の注文')}${verdict(a, true)}${orderCards(a, stale)}</section>
<section>${sh(`保有中 ${held.length}`)}${holdCards(true)}</section>
<section>${sh(`確認待ちの候補 ${wait.length}`, '根拠を読んで「確認した」を付ける')}${candRows(wait)}</section>`;
  }
  function sceneWeek(a, stale, today) {
    const C = data['候補'], week = new Date(new Date(today).getTime() - 6 * 86400000).toISOString().slice(0, 10);
    const wait = C.filter((c) => candStage(c) === '確認待ち'), watch = C.filter((c) => candStage(c) === 'ウォッチ中');
    const added = C.filter((c) => c['日付'] >= week && c['絞り込み'] === '可'), dropped = C.filter((c) => c['日付'] >= week && c['絞り込み'] && c['絞り込み'] !== '可');
    const ipo = added.filter((c) => c['区分'] === 'IPO').length;
    const closed = data['取引'].filter((t) => cstate(t) === '決済済み' && Calc.closeDate(t) >= week);
    const qs1 = qScreen();
    return `<section>${sh(`確認待ち ${wait.length}`, '根拠を読んで「確認した」を付ける')}${candRows(wait)}</section>
<section>${sh(`ウォッチ中 ${watch.length}`, '型が出るのを待つ。スクリーナーから外れたら見送り')}${candRows(watch)}</section>
<section>${sh('今週の決済')}${closed.length ? `<div class="rows">${closed.map((t) => tradeRow(t)).join('')}</div>` : '<p class="empty">なし</p>'}</section>
<section>${sh('今週のスクリーニング')}<div class="rows"><div class="row"><div class="r1"><b>候補に入った ${added.length}</b></div><div class="r2">IPO ${ipo}・通常 ${added.length - ipo}${dropped.length ? `　外れて見送り ${dropped.length}` : ''}</div></div>${qs1 ? `<a class="row" href="#rule/${qs1.num}"><div class="r1"><b>条件</b></div><div class="r2">${qs1.num} ${E(qs1.name)}</div><span class="chev">›</span></a>` : ''}</div></section>`;
  }
  // 提案：改定履歴の「提案」のうち、同じ問い・戦略でその後に決定（提案以外）が無いもの
  function pendingProposals() {
    const h = data['改定履歴'] || [];
    return h.map((x, i) => ({ x, i })).filter(({ x, i }) => x['変更'] === '提案' && !h.slice(i + 1).some((y) => y['問い'] === x['問い'] && y['戦略'] === x['戦略'] && y['変更'] !== '提案'));
  }
  function sceneMonth(a, stale, today) {
    const pre = data['前提'], ym = today.slice(0, 7);
    const closed = data['取引'].filter((t) => cstate(t) === '決済済み' && (Calc.closeDate(t) || '').startsWith(ym));
    const wins = closed.filter((t) => Calc.pl(t) >= 0).length;
    const rs = closed.map(Calc.rValue);
    const avgR = rs.length ? (rs.reduce((x, y) => x + y, 0) / rs.length).toFixed(2) : '—';
    const sm = Calc.summary(data, today);
    const cash = Calc.materials(data, today).cash;
    const tbl = (q) => `<h3>${E(q.name)}</h3><div class="rows">${(sm[q.num] || []).filter((x) => x.state !== '不採用').map((x) => `<a class="row" href="#rule/${q.num}/${encodeURIComponent(x.name)}"><div class="r1"><b>${E(x.name)}</b>${pill(x.state)}</div><div class="r2">${x.n}件${x.n ? `　勝率 ${x.winPct}%　平均R ${x.rAvg}` : ''}${x.agreementPct != null ? `　一致率 ${x.agreementPct}%` : ''}</div><span class="chev">›</span></a>`).join('')}</div>`;
    const props = pendingProposals();
    return `<section>${sh('月初資金')}<dl class="facts"><div><dt>月初資金（1Rの基準）</dt><dd>${yen(pre['月初資金'])}円</dd></div><div><dt>いまの資金</dt><dd>${yen(cash)}円</dd></div></dl>
${pre['月初資金'] !== cash ? `<div class="btns"><button class="b" data-act="set-monthly" data-v="${cash}">月初資金をいまの資金にする</button></div>` : ''}</section>
<section>${sh(`AIの提案 ${props.length}`, '読んで、戦略のページで決める。決めるまで何も変わらない')}${props.length ? `<div class="rows">${props.map(({ x }) => { const q = Q(x['問い']); return `<a class="row" href="#rule/${E(x['問い'])}/${encodeURIComponent(x['戦略'])}"><div class="r1"><b>${q ? E(q.num + ' ' + q.name) : E(x['問い'])}　${E(x['戦略'])}</b>${pill('提案')}</div><div class="r2">${E(x['変更後'])}${x['理由'] ? `　${E(x['理由'])}` : ''}${x['件数'] ? `　${x['件数']}件` : ''}</div><span class="chev">›</span></a>`; }).join('')}</div>` : '<p class="empty">なし</p>'}</section>
<section>${sh(`${Number(ym.slice(5))}月の決済 ${closed.length}件`, closed.length ? `勝率 ${Math.round(wins / closed.length * 100)}%　平均R ${avgR}` : '')}${closed.length ? `<div class="rows">${closed.map((t) => tradeRow(t)).join('')}</div>` : '<p class="empty">なし</p>'}</section>
<section>${sh('戦略ごとの成績', '全期間。行を開くと採用を入れ替えられる')}${qWhere((q) => q['結果'] === '注文を作る' || q['結果'] === '売り注文').map(tbl).join('')}</section>
<section>${sh('見直しの前に')}<div class="rows"><a class="row" href="#rules"><div class="r1"><b>原則を読む</b></div><div class="r2">今月、反した場面がなかったか</div><span class="chev">›</span></a></div></section>`;
  }
  function changesHtml(list, n) {
    if (!list.length) return `<p class="empty">${isLocal() ? 'ローカル表示では見られない' : 'なし'}</p>`;
    let last = '';
    return `<div class="rows">${list.slice(0, n || list.length).map((c) => { const d = new Date(c.date), day = `${d.getMonth() + 1}/${d.getDate()}`, head = day !== last ? `<div class="row dh"><div class="r1"><b>${day}（${WD[d.getDay()]}）</b></div></div>` : ''; last = day;
      return head + `<div class="row"><div class="r1">${E(c.text)}</div><div class="r2">${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}　${E(c.who === 'Claude' ? 'AI' : c.who)}</div></div>`; }).join('')}</div>`;
  }
  const viewChanges = () => shell(`<h1>更新の記録</h1><section><div id="changes-box"><p class="empty">読み込み中</p></div></section>`);

  // ---------- 取引 ----------
  function tradeRow(t) {
    const i = data['取引'].indexOf(t), s = cstate(t), p = Calc.pl(t), r = Calc.rValue(t);
    let r2;
    if (s === '注文中') r2 = `${yen(t['発注価格'])}円 × ${t['株数'] || 0}株　損切り ${yen(t['損切り価格'])}円`;
    else if (s === '保有中' || s === '一部利確') r2 = `約定 ${dShort(t['約定日'])} ${yen(t['約定価格'])}円 × ${Calc.remQty(t)}株　損切り ${yen(t['損切り価格'])}円${t['期限日'] ? `　期限 ${dShort(t['期限日'])}` : ''}`;
    else if (s === '決済済み') r2 = `${dShort(Calc.closeDate(t))} 決済　${p >= 0 ? '+' : ''}${yen(p)}円　${r >= 0 ? '+' : ''}${r.toFixed(2)}R${t['売った理由'] ? `　${t['売った理由']}` : ''}`;
    else r2 = `${E(dShort(t['記録日']))}`;
    const entry = qEntry(); const type = entry ? Calc.ruleOf(t, entry.num) : '';
    return `<a class="row" href="#trade/${i}"><div class="r1">${stock(t)}${pill(s)}</div><div class="r2">${E(t['区分'])}${type ? '・' + E(type) : ''}　${r2}</div><span class="chev">›</span></a>`;
  }
  function viewTrades() {
    const T = data['取引'];
    const by = (f) => T.filter((t) => f(cstate(t)));
    const waitingT = by((s) => s === '注文中'), held = by((s) => s === '保有中' || s === '一部利確'), closed = by((s) => s === '決済済み').sort((a, b) => (Calc.closeDate(a) < Calc.closeDate(b) ? 1 : -1)), other = by((s) => s === '取消' || s === '');
    const cands = data['候補'];
    const ORDER = ['型が出た', 'ウォッチ中', '確認待ち', '仮判定中'];
    const live = cands.filter((c) => ORDER.includes(candStage(c))).sort((a, b) => ORDER.indexOf(candStage(a)) - ORDER.indexOf(candStage(b))), dropped = cands.filter((c) => candStage(c) === '見送り');
    const sec = (title, list, add) => `<section><div class="bar">${sh(title)}${add ? `<a class="b" href="${add}">追加</a>` : ''}</div>${list.length ? `<div class="rows">${list.map(tradeRow).join('')}</div>` : '<p class="empty">なし</p>'}</section>`;
    return shell(`<h1>取引</h1>${sec(`注文中 ${waitingT.length}`, waitingT, '#trade/new')}${sec(`保有中 ${held.length}`, held)}
<section><div class="bar">${sh(`候補銘柄 ${live.length}`)}<a class="b" href="#cand/new">追加</a></div>${candRows(live)}${dropped.length ? `<details class="fold"><summary>見送り ${dropped.length}</summary>${candRows(dropped)}</details>` : ''}</section>
${sec(`決済済み ${closed.length}`, closed)}${other.length ? sec('取消', other) : ''}`);
  }
  const blankTrade = () => ({ id: Math.max(0, ...data['取引'].map((t) => t.id)) + 1, 'コード': '', '銘柄名': '', '区分': '通常', '市場区分': null, '業種': null, '使うルール': {}, '記録日': todayISO(), '基準価格': null, '損切り価格': null, '発注価格': null, '株数': null, '約定日': null, '約定価格': null, '約定株数': null, '期限日': null, 'イベント日': null, 'イベント種別': null, '売り': [], '状態': '', '判定': [], '次の行動': '', '売った理由': null, 'その後': null, '遵守': {}, 'メモ': '' });
  function viewTrade(key) {
    const i = key === 'new' ? -1 : Number(key);
    const t = i >= 0 ? data['取引'][i] : blankTrade();
    if (!t) return viewTrades();
    if (i >= 0 && !(edit && edit.type === 'trade' && edit.idx === i)) return tradeRead(i, t);
    return tradeForm(i, t);
  }
  // 判定の行（候補・建玉で同じ見せ方）。人の行で未のものは直接○×を押せる
  function judgeRows(rec, q, strat, actKind, idx) {
    if (!q || !strat) return '<p class="empty">採用の戦略が無い</p>';
    const rows = Calc.rowsFor(strat, Calc.candAttrs(rec));
    const js = (rec['判定'] || []).filter((j) => j && j['問い'] === q.num);
    return `<div class="c4">${rows.map((r) => {
      const c = r['条件'];
      if (!c) return `<div class="c4r"><div class="c4h"><span>${E(r['名前'])}</span>${who('行動')}</div><p class="muted">${E(fill(r['行動'], strat))}</p></div>`;
      const j = Calc.latest(js, q.num, r['名前']);
      const ai = js.filter((x) => x['条件'] === r['名前'] && x['判定者'] === 'AI').slice(-1)[0];
      const overridden = j && j['判定者'] === '人' && ai && ai !== j && ai['結果'] !== j['結果'];
      const ask = c['判定'] === '人' && (!j || j['結果'] === '未') ? `<span class="btns inline"><button class="b small" data-act="judge-${actKind}" data-i="${idx}" data-q="${q.num}" data-name="${E(r['名前'])}" data-v="○">○</button><button class="b small quiet" data-act="judge-${actKind}" data-i="${idx}" data-q="${q.num}" data-name="${E(r['名前'])}" data-v="×">×</button></span>` : '';
      return `<div class="c4r"><div class="c4h"><span>${E(r['名前'])}${scopeText(r) ? `<span class="pill">${E(scopeText(r))}</span>` : ''}</span>${mark(j ? j['結果'] : '未')}${who(j ? j['判定者'] : c['判定'])}</div><p>${j && j['根拠'] ? E(j['根拠']) : `<span class="empty">${E(c['判定'] === '計算' ? condText(r, strat).replace(/<[^>]+>/g, '') : fill(c['文'], strat))}</span>`}</p>${overridden ? `<p class="ai">AIは ${E(ai['結果'])}${ai['根拠'] ? '：' + E(ai['根拠']) : ''}</p>` : ''}${r['行動'] && j && j['結果'] === '○' ? `<p class="ai">→ ${E(fill(r['行動'], strat))}</p>` : ''}${ask}</div>`;
    }).join('')}</div>`;
  }
  function tradeRead(i, t) {
    const s = cstate(t), holding = s === '保有中' || s === '一部利確';
    const p = Calc.pl(t), r = Calc.rValue(t);
    const rules = perTradeQs().filter((q) => Calc.ruleOf(t, q.num)).map((q) => `<a href="#rule/${q.num}/${encodeURIComponent(Calc.ruleOf(t, q.num))}">${E(Calc.ruleOf(t, q.num))}</a>`).join('・');
    const sells = (t['売り'] || []).map((x, k) => `<div><dt>${k + 1}回目 ${E(dShort(x['日付']))}</dt><dd>${yen(x['価格'])}円 × ${x['株数']}株</dd></div>`).join('');
    const eq = qEntry(); const es = eq ? (Calc.byName(eq, Calc.ruleOf(t, eq.num)) || Calc.adoptedFor(eq, t['区分'])) : null;
    const sellCards = qSell().map((q) => { const st = Calc.byName(q, Calc.ruleOf(t, q.num)) || Calc.adoptedFor(q, t['区分']); return card(`${E(q.name)}<small>${E(st ? st.name : '')}</small>`, judgeRows(t, q, st, 'trade', i)); }).join('');
    return shell(`<h1>${E(t['銘柄名'] || '取引')} ${pill(s)}</h1>
${card('銘柄', `<p>${E(t['コード'])} ${E(t['銘柄名'])}　${E(t['区分'])}${t['市場区分'] ? '・' + E(t['市場区分']) : ''}${t['業種'] ? '・' + E(t['業種']) : ''}</p>`)}
${card('使うルール', `<p>${rules || '—'}</p>`)}
${card('発注', facts([['基準価格', yen(t['基準価格']) + '円'], ['損切り価格', yen(t['損切り価格']) + '円'], ['発注価格', yen(t['発注価格']) + '円'], ['株数', (t['株数'] || 0) + '株']]), `型が出た日 ${dShort(t['記録日'])}`)}
${t['約定日'] ? card('約定', facts([['約定日', E(dShort(t['約定日']))], ['約定価格', yen(t['約定価格']) + '円'], ['約定株数', t['約定株数'] + '株']])) : card('約定', '<p class="empty">まだ</p>')}
${holding || t['期限日'] || t['イベント日'] ? card('期限', facts([['期限日', t['期限日'] ? E(dShort(t['期限日'])) : '—'], ['イベント', t['イベント日'] ? `${E(t['イベント種別'] || '')} ${E(dShort(t['イベント日']))}` : null]])) : ''}
${holding || s === '決済済み' ? card('売り', sells ? `<dl class="facts">${sells}</dl>` : '<p class="empty">まだ</p>', s === '決済済み' ? `損益 ${p >= 0 ? '+' : ''}${yen(p)}円　${r >= 0 ? '+' : ''}${r.toFixed(2)}R${t['売った理由'] ? `　${t['売った理由']}` : ''}` : '') : ''}
${eq ? card(`型の判定<small>${E(es ? es.name : '')}</small>`, judgeRows(t, eq, es, 'trade', i)) : ''}
${holding ? sellCards : ''}
${t['次の行動'] || t['メモ'] ? card('次の行動とメモ', `${t['次の行動'] ? `<p>${E(t['次の行動'])}</p>` : ''}${t['メモ'] ? `<p class="memo">${E(t['メモ'])}</p>` : ''}`) : ''}
${t['その後'] ? card('その後', `<p>${E(dShort(t['その後']['日付']))} ${yen(t['その後']['終値'])}円（${t['その後']['変化率_pct'] >= 0 ? '+' : ''}${E(t['その後']['変化率_pct'])}%）</p>`) : ''}
<div class="btns"><button class="b quiet" data-act="edit-trade" data-i="${i}">直す</button><a class="b quiet" href="#trades">戻る</a></div>`);
  }
  function tradeForm(i, t) {
    const s = i >= 0 ? cstate(t) : '', holding = s === '保有中' || s === '一部利確';
    const grp = (title, open, body, sum) => `<details class="grp" ${open ? 'open' : ''}><summary>${title}${sum ? `<span class="sum">${E(sum)}</span>` : ''}</summary><div class="form cols">${body}</div></details>`;
    const sell = (k) => { const x = (t['売り'] || [])[k] || {}; return `<div class="span"><div class="f"><span>${k + 1}回目</span></div><div class="form three">${fld('日付', `s${k}d`, x['日付'], { type: 'date' })}${fld('価格', `s${k}p`, x['価格'], { type: 'number' })}${fld('株数', `s${k}q`, x['株数'], { type: 'number' })}</div></div>`; };
    const calcBox = edit && edit.calc ? `<div class="calc ${edit.calc.qty ? '' : 'ng'}">発注価格 ${yen(edit.calc.entry)}円、損切り幅 ${edit.calc.widthPct}%、1R ${yen(edit.calc.oneR)}円 → <b>${edit.calc.qty}株</b>（投入 ${yen(edit.calc.amount)}円、損切りで −${yen(edit.calc.risk)}円）${edit.calc.reasons.length ? '　' + edit.calc.reasons.join('、') : ''}</div>` : '';
    const rules = perTradeQs().map((q) => fld(q.name, 'rule:' + q.num, Calc.ruleOf(t, q.num), { type: 'select', options: [''].concat(slist(q)) })).join('');
    const ruleSum = perTradeQs().map((q) => Calc.ruleOf(t, q.num)).filter(Boolean).join('・');
    const a = acct(todayISO());
    const evSel = `<label class="f span"><span>イベント</span><select name="イベント種別">${[['', '—'], ['決算', '決算発表'], ['解除', 'ロックアップ解除'], ['権利', '権利付き最終日']].map(([v, l]) => `<option value="${v}" ${(t['イベント種別'] || '') === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>`;
    return shell(`<h1>${i >= 0 ? E(t['銘柄名'] || '取引') : '取引を追加'}${s ? ' ' + pill(s) : ''}</h1>
<form id="f-trade" data-i="${i}">
${grp('銘柄', !s, fld('コード', 'コード', t['コード']) + fld('銘柄名', '銘柄名', t['銘柄名']) + fld('区分', '区分', t['区分'], { type: 'select', options: ['通常', 'IPO'] }) + fld('市場区分', '市場区分', t['市場区分'], { type: 'select', options: ['', 'プライム', 'スタンダード', 'グロース'] }) + fld('業種（33業種）', '業種', t['業種'], { type: 'select', options: [''].concat(((matItem('業種（33業種）') || {})['選択肢']) || []) }), s ? `${t['コード']} ${t['銘柄名']}　${t['区分']}` : '')}
${grp('使うルール', !s, rules, s ? ruleSum : '')}
${grp('発注', !s || s === '注文中', fld('型が出た日', '記録日', t['記録日'], { type: 'date' }) + fld('基準価格', '基準価格', t['基準価格'], { type: 'number' }) + fld('損切り価格', '損切り価格', t['損切り価格'], { type: 'number' }) + fld('発注価格', '発注価格', t['発注価格'], { type: 'number', note: '出し方は発注方法のルール' }) + fld('株数', '株数', t['株数'], { type: 'number' }) + `<div class="btns span"><button class="b" data-act="calc-trade" type="button">株数を計算</button><small class="note">${a && a['1R額'] ? `1R ${yen(a['1R額'])}円（${dShort(a['日付'])} の口座の記録）` : '口座の記録に1R額が無い（引け後の作業で入る）'}</small></div>${calcBox ? `<div class="span">${calcBox}</div>` : ''}` + (s === '注文中' || s === '取消' ? `<label class="chk span"><input type="checkbox" name="取消" ${t['状態'] === '取消' ? 'checked' : ''}> この注文を取消にする</label>` : ''), s && s !== '注文中' ? `${dShort(t['記録日'])}　${yen(t['発注価格'])}円 × ${t['株数']}株　損切り ${yen(t['損切り価格'])}円` : '')}
${grp('約定', s === '注文中', fld('約定日', '約定日', t['約定日'], { type: 'date' }) + fld('約定価格', '約定価格', t['約定価格'], { type: 'number' }) + fld('約定株数', '約定株数', t['約定株数'], { type: 'number' }), holding || s === '決済済み' ? `${dShort(t['約定日'])}　${yen(t['約定価格'])}円 × ${t['約定株数']}株` : '')}
${grp('期限', holding, fld('期限日', '期限日', t['期限日'], { type: 'date', note: 'AIが保有期限のルールから書く' }) + fld('イベント日', 'イベント日', t['イベント日'], { type: 'date' }) + evSel, holding ? `${t['期限日'] ? dShort(t['期限日']) : ''}${t['イベント日'] ? `　${t['イベント種別'] || ''} ${dShort(t['イベント日'])}` : ''}` : '')}
${grp('売り', holding, sell(0) + sell(1) + fld('売った理由', '売った理由', t['売った理由'], { span: true, ph: '当たった行の名前' }))}
${grp('次の行動とメモ', holding || s === '決済済み', `<label class="f span"><span>次の行動</span><input name="次の行動" value="${E(t['次の行動'])}"></label>` + `<label class="f span"><span>メモ</span><textarea name="メモ" rows="2">${E(t['メモ'])}</textarea></label>`)}
<input type="hidden" name="id" value="${t.id}">
<div class="btns"><button class="b primary" data-act="save-trade">保存</button>${i >= 0 ? '<button class="b quiet" data-act="cancel" type="button">取消</button><button class="b quiet danger" data-act="del-trade" type="button">削除</button>' : '<a class="b quiet" href="#trades">戻る</a>'}</div></form>`);
  }
  const blankCand = () => ({ '日付': todayISO(), 'コード': '', '銘柄名': '', '区分': '通常', '市場区分': null, '業種': null, '戦略': null, '上場日': null, '売買代金_億': null, '時価総額_億': null, '終値': null, '絞り込み': '', '判定の戦略': null, '判定': [], '確認': null, '型が出た日': null, 'その後': null, 'メモ': '' });
  function viewCand(key) {
    const i = key === 'new' ? -1 : Number(key);
    const c = i >= 0 ? data['候補'][i] : blankCand();
    if (!c) return viewTrades();
    if (i >= 0 && !(edit && edit.type === 'cand' && edit.idx === i)) return candRead(i, c);
    return candForm(i, c);
  }
  const screenResult = (c) => { const q = qScreen(); return `${c['絞り込み'] === '可' ? `<a href="#rule/${q ? q.num : ''}/${encodeURIComponent(c['戦略'] || '')}">${E(c['戦略'] || (q ? q.name : ''))}</a> を通過` : `<span class="pill pill-ng">外れた</span> ${E(c['絞り込み'] || '')}`}`; };
  function candRead(i, c) {
    const st = candStage(c), { q, s, rows } = candRowsOf(c);
    const names = rows.filter((r) => r['条件']).map((r) => r['名前']);
    const allOk = q && names.length && Calc.results(c['判定'], q.num, names).every((x) => x === '○');
    const trade = c['型が出た日'] ? data['取引'].find((t) => t['コード'] === c['コード']) : null;
    return shell(`<h1>${E(c['銘柄名'] || '候補銘柄')} ${pill(st)}</h1>
${card('銘柄', `<p>${E(c['コード'])} ${E(c['銘柄名'])}　${E(c['区分'])}${c['市場区分'] ? '・' + E(c['市場区分']) : ''}${c['業種'] ? '・' + E(c['業種']) : ''}${c['上場日'] ? `　上場 ${E(dShort(c['上場日']))}` : ''}</p>`)}
${card('スクリーニングの結果', `<p>${screenResult(c)}</p>` + facts([['売買代金（10日平均）', c['売買代金_億'] != null ? E(c['売買代金_億']) + '億円' : null], ['時価総額', c['時価総額_億'] != null ? E(c['時価総額_億']) + '億円' : null], ['終値（通った時）', yen(c['終値']) ? yen(c['終値']) + '円' : null], ['その他', c['メモ'] ? E(c['メモ']) : null]]), dShort(c['日付']))}
${card(`${E(q ? q.name : '判定')}<small>${E(s ? s.name : '')}。AIの仮判定を人が確かめる</small>`, judgeRows(c, q, s, 'cand', i) + (c['確認'] ? `<p class="okline">根拠を読んで確認した　${E(dShort(c['確認']))}</p>` : allOk ? `<div class="btns"><button class="b primary" data-act="confirm-cand" data-i="${i}">根拠を読んで確認した</button></div>` : ''))}
${c['型が出た日'] ? `<p class="ai">型が出た ${E(dShort(c['型が出た日']))}${trade ? `　<a href="#trade/${data['取引'].indexOf(trade)}">取引 ${E(cstate(trade))}</a>` : ''}</p>` : ''}
${c['その後'] ? card('その後', `<p>${E(dShort(c['その後']['日付']))} ${yen(c['その後']['終値'])}円（${c['その後']['変化率_pct'] >= 0 ? '+' : ''}${E(c['その後']['変化率_pct'])}%）</p>`) : ''}
<div class="btns"><button class="b quiet" data-act="edit-cand" data-i="${i}">直す</button><a class="b quiet" href="#trades">戻る</a></div>`);
  }
  function candForm(i, c) {
    const isNew = i < 0;
    const { q, s, rows } = candRowsOf(c);
    const crows = rows.filter((r) => r['条件']);
    const grp = (title, open, body, sum) => `<details class="grp" ${open ? 'open' : ''}><summary>${title}${sum ? `<span class="sum">${E(sum)}</span>` : ''}</summary><div class="form cols">${body}</div></details>`;
    const cond = crows.map((r, k) => { const j = q ? Calc.latest(c['判定'], q.num, r['名前']) : null; return `<div class="span cond4"><div class="f"><span>${E(r['名前'])}${who((r['条件'] || {})['判定'])}</span><div class="picks">${[['○', '○'], ['×', '×'], ['', '未']].map(([v, lab]) => `<label class="chk"><input type="radio" name="j${k}" value="${v}" ${((j && j['結果'] !== '未' ? j['結果'] : '') || '') === v ? 'checked' : ''}> ${lab}</label>`).join('')}</div></div><label class="f"><span>根拠</span><textarea name="g${k}" rows="2">${E(j ? j['根拠'] : '')}</textarea></label></div>`; }).join('');
    const trade = c['型が出た日'] ? data['取引'].find((t) => t['コード'] === c['コード']) : null;
    const typed = c['型が出た日'] ? `<p class="ai">型が出た ${E(dShort(c['型が出た日']))}${trade ? `　<a href="#trade/${data['取引'].indexOf(trade)}">取引 ${E(cstate(trade))}</a>` : ''}</p>` : '';
    return shell(`<h1>${!isNew ? E(c['銘柄名'] || '候補銘柄') + ' ' + pill(candStage(c)) : '候補銘柄を追加'}</h1>
<form id="f-cand" data-i="${i}">
${grp('銘柄', isNew, fld('候補に入った日', '日付', c['日付'], { type: 'date' }) + fld('コード', 'コード', c['コード']) + fld('銘柄名', '銘柄名', c['銘柄名']) + fld('区分', '区分', c['区分'], { type: 'select', options: ['通常', 'IPO'] }) + fld('市場区分', '市場区分', c['市場区分'], { type: 'select', options: ['', 'プライム', 'スタンダード', 'グロース'] }) + fld('業種（33業種）', '業種', c['業種'], { type: 'select', options: [''].concat(((matItem('業種（33業種）') || {})['選択肢']) || []) }) + fld('上場日（IPO）', '上場日', c['上場日'], { type: 'date' }), isNew ? '' : `${c['コード']} ${c['銘柄名']}　${c['区分']}`)}
${grp('スクリーニング', isNew, fld('売買代金（億円・10日平均）', '売買代金_億', c['売買代金_億'], { type: 'number', step: '0.1' }) + fld('時価総額（億円）', '時価総額_億', c['時価総額_億'], { type: 'number' }) + fld('終値', '終値', c['終値'], { type: 'number' }) + fld('絞り込み', '絞り込み', c['絞り込み'], { ph: '可 か 不可：理由。空欄は可' }), isNew ? '' : `${dShort(c['日付'])}　${c['絞り込み'] || '—'}`)}
${grp(`${E(q ? q.name : '判定')}<small>${E(s ? s.name : '')}。直すと「人」の判定として残る</small>`, true, (cond || '<p class="empty span">採用の戦略に条件の行が無い</p>') + `<label class="chk span"><input type="checkbox" name="確認" ${c['確認'] ? 'checked' : ''}> 根拠を読んで確認した${c['確認'] ? `　${E(dShort(c['確認']))}` : ''}</label>`)}
<input type="hidden" name="型が出た日" value="${E(c['型が出た日'] || '')}">${typed}
<label class="f"><span>メモ</span><textarea name="メモ" rows="2">${E(c['メモ'])}</textarea></label>
<div class="btns"><button class="b primary" data-act="save-cand">保存</button>${i >= 0 ? '<button class="b quiet" data-act="cancel" type="button">取消</button><button class="b quiet danger" data-act="del-cand" type="button">削除</button>' : '<a class="b quiet" href="#trades">戻る</a>'}</div></form>`);
  }

  // ---------- ルール ----------
  function viewRules() {
    const pr = data['原則'], pre = data['前提'];
    const list = QS().map((q) => `<a class="row" href="#rule/${q.num}"><div class="r1"><span class="n">${q.num}</span><b>${E(q.name)}</b></div><div class="r2">${E(adoptedText(q))}</div><span class="chev">›</span></a>`).join('');
    const pEdit = edit && edit.type === 'principle';
    const principles = pr.map((p, i) => pEdit && edit.idx === i ? principleForm(p, i)
      : `<div class="principle"><span class="n">${p.id}</span><div><b>${E(p.title)}</b>${E(p.text)}<div class="src">${E(p['出典'])}</div>${pEdit ? `<div class="btns"><button class="b quiet" data-act="edit-principle" data-i="${i}">編集</button></div>` : ''}</div></div>`).join('');
    const kd = pre['区分の定義'] || {};
    const kdText = Object.entries(kd).filter(([k]) => k !== '既定').map(([k, c]) => `${k}＝${c['項目']}が${fmtNum(c['値'])}${(matItem(c['項目']) || {})['単位'] || ''}${c['比較']}`).join('、') + (kd['既定'] ? `、それ以外は${kd['既定']}` : '');
    const evText = (pre['イベント暦'] || []).map((e) => (typeof e === 'string' ? e : `${e['日付']} ${e['名前'] || ''}`.trim())).join('\n');
    const preForm = edit && edit.type === 'premise' ? `<form id="f-premise" class="form cols">${fld('初期資金（円）', '初期資金', pre['初期資金'], { type: 'number' })}${fld('月初資金（円）', '月初資金', pre['月初資金'], { type: 'number' })}${fld('停止残高（円）', '停止残高', pre['停止残高'], { type: 'number' })}${fld('単元（株）', '単元', pre['単元'], { type: 'number' })}${fld('証券会社', '証券会社', pre['証券会社'])}<label class="f span"><span>イベント暦（1行1件：日付 名前。FOMC・日銀会合・米雇用統計など。年1回入れる）</span><textarea name="イベント暦" rows="6">${E(evText)}</textarea></label><label class="f span"><span>東証の休業日（1行1日）</span><textarea name="休日" rows="6">${E(pre['休日'].join('\n'))}</textarea></label><div class="btns span"><button class="b primary" data-act="save-premise">保存</button><button class="b quiet" data-act="cancel" type="button">取消</button></div></form>`
      : `<dl class="facts"><div><dt>初期資金</dt><dd>${yen(pre['初期資金'])}円</dd></div><div><dt>月初資金（1Rの基準）</dt><dd>${yen(pre['月初資金'])}円</dd></div><div><dt>停止残高</dt><dd>${yen(pre['停止残高'])}円</dd></div><div><dt>単元</dt><dd>${pre['単元']}株</dd></div><div><dt>証券会社</dt><dd>${E(pre['証券会社'])}</dd></div><div><dt>休業日</dt><dd>${pre['休日'].length}日</dd></div><div><dt>区分の定義</dt><dd>${E(kdText || '—')}</dd></div><div><dt>イベント暦</dt><dd>${(pre['イベント暦'] || []).length}件</dd></div></dl><div class="btns"><button class="b quiet" data-act="edit-premise">編集</button></div>`;
    const hist = data['改定履歴'].slice().reverse();
    return shell(`<h1>ルール</h1>
<section>${sh('13項目', '採用している戦略')}<div class="rows">${list}</div></section>
<section><div class="bar"><h2>原則</h2>${pEdit ? '<button class="b quiet" data-act="cancel">閉じる</button>' : '<button class="b quiet" data-act="edit-principles">編集</button>'}</div>${principles}</section>
<section><h2>前提</h2>${preForm}</section>
<section><div class="rows"><a class="row" href="#materials"><div class="r1"><b>材料の一覧</b></div><div class="r2">条件に使える数字と、AIが読む資料。道具が出せるものだけ</div><span class="chev">›</span></a></div></section>
<section><details class="fold"><summary>ルールの改定 ${hist.length}</summary>${hist.length ? `<div class="rows">${hist.map(histRow).join('')}</div>` : '<p class="empty">なし</p>'}</details></section>`);
  }
  function histRow(h) {
    let chg = E(h['変更']);
    if (h['変更'] === '数値変更') { try { const a = JSON.parse(h['変更前'] || '{}'), b = JSON.parse(h['変更後'] || '{}'); const diff = Object.keys(Object.assign({}, a, b)).filter((k) => a[k] !== b[k]).map((k) => `${keyLabel(k)} ${a[k] == null ? '—' : a[k]} → ${b[k] == null ? '—' : b[k]}`); if (diff.length) chg = E(diff.join('、')); } catch (e) { chg = E(`${h['変更前']} → ${h['変更後']}`); } }
    else if (h['変更'] === '提案') chg = E(h['変更後']);
    else if (h['変更前'] && h['変更後']) chg = E(`${h['変更前']} → ${h['変更後']}`);
    const q = Q(h['問い']);
    const kind = chg !== E(h['変更']) || h['変更'] === '提案' ? pill(h['変更']) + ' ' : '';
    return `<div class="row"><div class="r1"><b>${q ? E(q.num + ' ' + q.name) : E(h['問い'])}${h['戦略'] && h['戦略'] !== h['問い'] ? '　' + E(h['戦略']) : ''}</b></div><div class="r2">${E(dShort(h['日付']))}　${kind}${chg}${h['理由'] ? `　${E(h['理由'])}` : ''}${h['件数'] ? `　${h['件数']}件` : ''}</div></div>`;
  }
  const principleForm = (p, i) => `<form id="f-principle" class="form" data-i="${i}">${fld('番号', 'id', p.id, { type: 'number' })}${fld('見出し', 'title', p.title)}${fld('本文', 'text', p.text, { type: 'textarea', rows: 2 })}${fld('出典', '出典', p['出典'])}<div class="btns"><button class="b primary" data-act="save-principle">保存</button><button class="b quiet" data-act="cancel" type="button">取消</button><button class="b quiet danger" data-act="del-principle" type="button">削除</button></div></form>`;
  const COMP_SUB = { '全部': '全部○で結果', 'どれか': '1行でも当たればその行の行動' };
  const STATE_DESC = { '採用': 'いま使っている', '代替案': '月次の見直しで採用と比べる控え。2つまで', '不採用': '記録として残す' };
  const adoptRows = (q) => {
    const ad = q['戦略'].filter((s) => s['状態'] === '採用');
    const kinds = ad.some((s) => s['区分'] !== '共通') ? ['IPO', '通常'] : ['共通'];
    return kinds.map((k) => { const s = Calc.adoptedFor(q, k === '共通' ? undefined : k); const borrowed = s && k !== '共通' && s['区分'] !== k && s['区分'] !== '共通';
      return `<div class="arow"><span class="ak">${E(k)}</span>${s ? `<b>${E(s.name)}</b>${borrowed ? `<span class="pill pill-warn">${E(s['区分'])}の採用を流用</span>` : ''}` : '<span class="pill pill-ng">なし</span>'}</div>`; }).join('');
  };
  function viewRule(num) {
    const q = Q(num); if (!q) return viewRules();
    const sel = `<select class="qsel">${QS().map((x) => `<option value="${x.num}" ${x.num === q.num ? 'selected' : ''}>${x.num} ${E(x.name)}</option>`).join('')}</select>`;
    const def = q['定義'] || {};
    const ev = q['評価'] || {};
    const defs = `<details class="fold"><summary>この項目で決めること</summary><dl class="def"><dt>決めること</dt><dd>${E(def['決めること'])}</dd><dt>決めないこと</dt><dd>${E(def['決めないこと'])}</dd><dt>選び方</dt><dd>${E(def['選び方'])}</dd><dt>対象・時点・合成</dt><dd>${E(q['対象'])}${(q['段階'] || []).length ? `（${E(q['段階'].join('・'))}）` : ''}　${E((q['時点'] || []).join('・'))}　${E(q['合成'])}：${E(COMP_SUB[q['合成']] || '')}　→ ${E(q['結果'])}</dd><dt>人の確認点</dt><dd>${E(q['人の確認点'])}</dd><dt>評価（月次）</dt><dd>${E((ev['見る数字'] || []).join('・'))}。${E(ev['変える目安'] || '')}</dd></dl></details>`;
    const editing = (i) => edit && edit.type === 'strategy' && edit.q === q.num && edit.idx === i;
    const sm = Calc.summary(data, todayISO())[q.num] || [];
    const cardOf = (s, i, state) => editing(i) ? strategyForm(q, s, i) : state === '採用' ? strategyCard(q, s, i, sm)
      : `<details class="fold strat-fold" id="s-${E(s.name)}"><summary>${E(s.name)}${s['区分'] !== '共通' ? ` <span class="pill">${E(s['区分'])}</span>` : ''}<span class="sum">${E(fill(s['一言で'], s))}</span></summary>${strategyCard(q, s, i, sm)}</details>`;
    const section = (state) => {
      const g = q['戦略'].map((s, i) => [s, i]).filter(([s]) => s['状態'] === state);
      if (!g.length && state === '不採用') return '';
      const addBtn = state === '代替案' ? (editing(-1) ? strategyForm(q, blankStrategy(q), -1) : `<div class="btns"><button class="b" data-act="edit-strategy" data-q="${q.num}" data-i="-1">戦略を追加</button></div>`) : '';
      return `<section><h2 class="sh">${E(state)}<small>${E(STATE_DESC[state])}</small></h2>${state === '採用' ? `<div class="adoptbox">${adoptRows(q)}</div>` : ''}${g.length ? g.map(([s, i]) => cardOf(s, i, state)).join('') : '<p class="empty">なし</p>'}${addBtn}</section>`;
    };
    return shell(`<h1 class="qh">${sel}</h1><p class="lead">${E(q.question)}</p>${defs}${section('採用')}${section('代替案')}${section('不採用')}`);
  }
  const blankStrategy = (q) => ({ name: '', '状態': '代替案', '改定日': todayISO(), '区分': '共通', '一言で': '', '行': [], 'しないこと': [], '出典': '', '数値欄': Object.fromEntries((q['数値欄のキー'] || []).map((k) => [k, null])) });
  function rowsTable(q, s) {
    const rows = s['行'] || [];
    if (!rows.length) return '<p class="empty">行なし</p>';
    return `<table class="rt"><thead><tr><th>名前</th><th>条件</th><th>行動</th></tr></thead><tbody>${rows.map((r) => `<tr><td>${E(r['名前'])}${scopeText(r) ? `<br><span class="pill">${E(scopeText(r))}</span>` : ''}</td><td>${who((r['条件'] || {})['判定'] || 'なし')} ${r['条件'] ? condText(r, s) : ''}</td><td>${E(fill(r['行動'], s))}</td></tr>`).join('')}</tbody></table>`;
  }
  function strategyCard(q, s, i, sm) {
    const nums = Object.entries(s['数値欄'] || {}).filter(([k, v]) => v != null && v !== '').map(([k, v]) => `<span>${numText(k, v)}</span>`).join('');
    const st = s['状態'], a = (act, label, cls) => `<button class="b ${cls || ''}" data-act="${act}" data-q="${q.num}" data-i="${i}">${label}</button>`;
    const acts = [a('edit-strategy', '編集', 'quiet')];
    if (st === '代替案') acts.push(a('adopt', '採用にする'), a('retire', '不採用にする', 'quiet'));
    if (st === '不採用') acts.push(a('restore', '代替案に戻す'));
    const m = (sm || []).find((x) => x.name === s.name) || {};
    const perf = m.n || m.agreementPct != null || m.candidates_month ? `<h4>成績<small>記録から</small></h4><div class="k">${m.n ? `<span><b>件数</b> ${m.n}</span><span><b>勝率</b> ${m.winPct}%</span><span><b>平均R</b> ${m.rAvg}</span>` : ''}${m.compliancePct != null ? `<span><b>遵守率</b> ${m.compliancePct}%</span>` : ''}${m.agreementPct != null ? `<span><b>一致率</b> ${m.agreementPct}%</span>` : ''}${m.candidates_month ? `<span><b>候補（月）</b> ${m.candidates_month}</span>` : ''}</div>` : '';
    const props = pendingProposals().filter(({ x }) => String(x['問い']) === String(q.num) && x['戦略'] === s.name);
    const prop = props.length ? `<div class="prop">${pill('提案')} ${E(props[props.length - 1].x['変更後'])}${props[props.length - 1].x['理由'] ? `　${E(props[props.length - 1].x['理由'])}` : ''}</div>` : '';
    return `<article class="strat ${st === '不採用' ? 'off' : ''}" id="s-${E(s.name)}"><header><h3>${E(s.name)}</h3>${s['区分'] !== '共通' ? `<span class="pill">${E(s['区分'])}</span>` : ''}</header>
<p class="one">${E(fill(s['一言で'], s))}</p>${prop}
<h4>行<small>${E(COMP_SUB[q['合成']] || '')}</small></h4>${rowsTable(q, s)}${nums ? `<div class="k">${nums}</div>` : ''}
<h4>しないこと</h4>${(s['しないこと'] || []).length ? `<ul class="ng">${(s['しないこと'] || []).map((x) => `<li>${E(fill(x, s))}</li>`).join('')}</ul>` : '<p class="empty">なし</p>'}
${perf}<p class="rev">${s['出典'] ? `出典　${linkify(s['出典'])}　` : ''}改定 ${E(s['改定日'])}</p>
<div class="btns">${acts.join('')}</div></article>`;
  }
  // ---- 行の編集 ----
  const CMPS = ['以上', '以下', '未満', '超'];
  function readRowsForm(f) {
    const out = [];
    for (let k = 0; f.querySelector(`[name="r${k}_名前"]`); k++) {
      const g = (n) => { const el = f.querySelector(`[name="r${k}_${n}"]`); return el ? el.value : ''; };
      const checks = (n) => Array.from(f.querySelectorAll(`input[name="r${k}_${n}"]:checked`)).map((x) => x.value);
      const judge = g('判定');
      const when = checks('時点');
      const r = { '名前': g('名前').trim(), '適用範囲': null, '時点': when.length ? when : null, '条件': null, '行動': g('行動').trim() || null };
      const si = g('適用項目');
      if (si) r['適用範囲'] = [{ '項目': si, '比較': 'いずれか', '値': checks('適用値') }];
      if (judge === '計算') { const item = g('項目'); r['条件'] = isPick(item) ? { '判定': '計算', '項目': item, '比較': 'いずれか', '値': checks('選択') } : { '判定': '計算', '項目': item, '比較': g('比較') || '以上', '値': g('値').trim() }; }
      else if (judge === 'AI') r['条件'] = { '判定': 'AI', '文': g('文').trim(), '見るもの': checks('見るもの') };
      else if (judge === '人') r['条件'] = { '判定': '人', '文': g('文').trim() };
      out.push(r);
    }
    return out;
  }
  function rowEditor(q, rows, keys) {
    const items = matNums(q['対象']);
    const opts = (sel, list) => `<option value="">—</option>` + list.map((m) => `<option value="${E(m.key)}" ${m.key === sel ? 'selected' : ''}>${E(m.key)}${m['単位'] ? `（${E(m['単位'])}）` : ''}</option>`).join('');
    const one = (r, k) => {
      const c = r['条件'] || {}, judge = c['判定'] || (r['条件'] === null && (r['行動'] || !r['名前']) ? 'なし' : 'なし');
      const sc = (r['適用範囲'] || [])[0] || {};
      const scv = Array.isArray(sc['値']) ? sc['値'] : (sc['値'] ? [sc['値']] : []);
      let cond = '';
      if (judge === '計算') {
        const item = c['項目'] || '';
        const m = matItem(item) || {};
        cond = `<label class="f"><span>項目</span><select name="r${k}_項目">${opts(item, items)}</select></label>` + (isPick(item) ? `<div class="f"><span>当てはまるもの（複数可）</span><div class="picks">${(m['選択肢'] || []).map((o) => `<label class="chk"><input type="checkbox" name="r${k}_選択" value="${E(o)}" ${(Array.isArray(c['値']) ? c['値'] : [c['値']]).includes(o) ? 'checked' : ''}> ${E(o)}</label>`).join('')}</div></div>`
          : `<div class="form cols"><label class="f"><span>比較</span><select name="r${k}_比較">${CMPS.map((x) => `<option ${c['比較'] === x ? 'selected' : ''}>${x}</option>`).join('')}</select></label><label class="f"><span>値${m['単位'] ? `（${E(m['単位'])}）` : ''}<small>数字か {キー}</small></span><input name="r${k}_値" value="${E(Array.isArray(c['値']) ? '' : (c['値'] == null ? '' : c['値']))}"></label></div>`);
      } else if (judge === 'AI') {
        cond = `<label class="f span"><span>文（AIが読んで決める）</span><textarea name="r${k}_文" rows="2">${E(c['文'] || '')}</textarea></label><div class="f span"><span>見るもの</span><div class="picks">${matDocs().map((m) => `<label class="chk"><input type="checkbox" name="r${k}_見るもの" value="${E(m.key)}" ${(c['見るもの'] || []).includes(m.key) ? 'checked' : ''}> ${E(m.key)}</label>`).join('')}</div></div>`;
      } else if (judge === '人') {
        cond = `<label class="f span"><span>文（人に聞く）</span><textarea name="r${k}_文" rows="2">${E(c['文'] || '')}</textarea></label>`;
      }
      return `<div class="cond rowed"><div class="form cols"><label class="f"><span>名前<small>短く。変えない</small></span><input name="r${k}_名前" value="${E(r['名前'] || '')}"></label><label class="f"><span>判定</span><select name="r${k}_判定" class="rjudge">${['計算', 'AI', '人', 'なし'].map((x) => `<option ${judge === x ? 'selected' : ''}>${x}</option>`).join('')}</select></label></div>${cond}
<label class="f span"><span>行動<small>当たった時に何をするか。数字は {キー}</small></span><textarea name="r${k}_行動" rows="2">${E(r['行動'] || '')}</textarea></label>
<details class="fold"><summary>時点と適用範囲${(r['時点'] || []).length || scv.length ? `：${E(scopeText(r))}` : '（問いの時点ぜんぶ・対象ぜんぶ）'}</summary><div class="f"><span>いつ見るか<small>空なら問いの時点ぜんぶ</small></span><div class="picks">${(q['時点'] || []).map((tp) => `<label class="chk"><input type="checkbox" name="r${k}_時点" value="${E(tp)}" ${(r['時点'] || []).includes(tp) ? 'checked' : ''}> ${E(tp)}</label>`).join('')}</div></div><label class="f"><span>対象の属性で絞る</span><select name="r${k}_適用項目" class="rscope">${opts(sc['項目'] || '', scopeItems())}</select></label>${sc['項目'] ? `<div class="picks">${((matItem(sc['項目']) || {})['選択肢'] || []).map((o) => `<label class="chk"><input type="checkbox" name="r${k}_適用値" value="${E(o)}" ${scv.includes(o) ? 'checked' : ''}> ${E(o)}</label>`).join('')}</div>` : ''}</details>
<div class="btns"><button type="button" class="b quiet small" data-act="up-row" data-r="${k}">上へ</button><button type="button" class="b quiet small danger" data-act="del-row" data-r="${k}">この行を消す</button></div></div>`;
    };
    return `<h4>行<small>${E(COMP_SUB[q['合成']] || '')}</small></h4><p class="note">文を「〜なら、〜する」にする。「〜なら」が条件（○×で答えられる。材料で言えれば計算、資料を読むならAI、人にしか分からなければ人）、「〜する」が行動。いつもすることは条件なし。いつ見るかは時点、どの銘柄かは適用範囲</p>${(rows.length ? rows : [{ '名前': '', '適用範囲': null, '時点': null, '条件': { '判定': '計算' }, '行動': null }]).map(one).join('')}<div class="btns"><button type="button" class="b" data-act="add-row">行を足す</button></div>`;
  }
  function strategyForm(q, s0, i) {
    const d = (edit && edit.draft) || {}, s = Object.assign({}, s0, Object.fromEntries(['name', '区分', '一言で', '出典'].filter((k) => d[k] !== undefined).map((k) => [k, d[k]]))); if (d['しないこと'] !== undefined) s['しないこと'] = lines(d['しないこと']);
    const rows = edit && edit.rows ? edit.rows : (s0['行'] || []);
    const numv = (k) => { const v = d['n:' + k] !== undefined ? d['n:' + k] : (s['数値欄'] ? s['数値欄'][k] : ''); return v == null ? '' : v; };
    const numf = (q['数値欄のキー'] || []).map((k) => `<label class="f"><span>${E(keyLabel(k))}</span><input name="n:${E(k)}" value="${E(numv(k))}" inputmode="decimal"></label>`).join('');
    const kub = ['共通', 'IPO', '通常'].map((v) => `<label class="chk"><input type="radio" name="区分" value="${v}" ${s['区分'] === v ? 'checked' : ''}> ${v}</label>`).join('');
    return `<form id="f-strategy" class="strat form editing" data-q="${q.num}" data-i="${i}"><h3>${i >= 0 ? E(s0.name) + ' を編集' : '戦略を追加'}</h3>
${fld('戦略名', 'name', s.name)}<div class="f"><span>区分</span><div class="picks">${kub}</div></div>${fld('一言で', '一言で', s['一言で'])}
${rowEditor(q, rows, q['数値欄のキー'] || [])}
${numf ? `<h4>数値<small>行の {キー} に入る</small></h4><div class="form cols">${numf}</div>` : ''}
<label class="f"><span>しないこと</span><textarea name="しないこと" rows="3" placeholder="1行に1つ">${E(text(s['しないこと']))}</textarea></label>
<label class="f"><span>出典</span><textarea name="出典" rows="2" placeholder="テスタ スイング2、docs/basics/04">${E(s['出典'])}</textarea></label>
${fld('改定の理由（改定履歴に残る）', 'reason', d.reason || '')}
<div class="btns"><button class="b primary" data-act="save-strategy">保存</button><button class="b quiet" data-act="cancel" type="button">取消</button>${i >= 0 ? '<button class="b quiet danger" data-act="del-strategy" type="button">削除</button>' : ''}</div></form>`;
  }
  // 行の検査（保存時。tools/check_rules.py と同じ考え）
  function validateRows(q, rows, keys) {
    const names = new Set();
    for (const r of rows) {
      if (!r['名前']) return '名前の無い行がある';
      if (names.has(r['名前'])) return `行の名前が重複：${r['名前']}`;
      names.add(r['名前']);
      const c = r['条件'];
      if (!c && !r['行動']) return `${r['名前']}：条件も行動も無い`;
      if (c && c['判定'] === '計算') {
        const m = matItem(c['項目']); if (!m) return `${r['名前']}：項目を選ぶ`;
        if (!(ALLOWED[q['対象']] || []).includes(m['対象'])) return `${r['名前']}：この項目（${m['対象']}）はこの問いでは使えない`;
        if (m['種類'] === '選択') { if (!c['値'].length) return `${r['名前']}：当てはまるものを選ぶ`; }
        else { const v = String(c['値']); const km = /^-?\{([^{}]+)\}$/.exec(v); if (km) { if (!keys.includes(km[1])) return `${r['名前']}：{${km[1]}} は数値欄のキーに無い`; } else if (v === '' || isNaN(Number(v))) return `${r['名前']}：値は数字か {キー}`; else c['値'] = Number(v); }
      }
      if (c && c['判定'] === 'AI' && (!c['文'] || !c['見るもの'].length)) return `${r['名前']}：AIの行は文と見るものが要る`;
      if (c && c['判定'] === '人' && !c['文']) return `${r['名前']}：人の行は文が要る`;
      for (const t of [r['行動'] || '', (c || {})['文'] || '']) { for (const k of (t.match(/\{([^{}]+)\}/g) || [])) { if (!keys.includes(k.slice(1, -1))) return `${r['名前']}：${k} は数値欄のキーに無い`; } }
      if (r['適用範囲'] && !r['適用範囲'][0]['値'].length) r['適用範囲'] = null;
    }
    return null;
  }
  function viewMaterials() {
    const groups = {};
    MAT().forEach((m) => { const g = `${m['対象']}／${m['出どころ']}`; (groups[g] = groups[g] || []).push(m); });
    return shell(`<h1>材料の一覧</h1><p class="lead">条件に使える数字と、AIが読む資料。道具（tools/market.py・app/calc.js）が出せるものだけ。足す時は道具に口を作ってから一覧に1行</p>
${Object.entries(groups).map(([g, l]) => `<section>${sh(g)}<div class="rows">${l.map((m) => `<div class="row"><div class="r1"><b>${E(m.key)}</b>${m['単位'] ? `<span class="pill">${E(m['単位'])}</span>` : ''}${m['種類'] === '資料' ? pill('資料') : m['種類'] === '選択' ? `<span class="pill">${E((m['選択肢'] || []).slice(0, 4).join('・'))}${(m['選択肢'] || []).length > 4 ? '…' : ''}</span>` : ''}</div><div class="r2">${E(m['説明'] || '')}</div></div>`).join('')}</div></section>`).join('')}`);
  }

  // ---------- 知識 ----------
  function viewDocs(path) {
    if (!path) {
      return shell(`<h1>知識</h1>${DOCS.map(([g, l]) => `<section><h2>${g}</h2><div class="rows">${l.map(([p, t]) => `<a class="row" href="#docs/${p}"><div class="r1"><b>${E(t)}</b></div><span class="chev">›</span></a>`).join('')}</div></section>`).join('')}`);
    }
    const sel = `<select class="dsel"><option value="">目次</option>${DOCS.map(([g, l]) => `<optgroup label="${E(g)}">${l.map(([p, t]) => `<option value="${E(p)}" ${p === path ? 'selected' : ''}>${E(t)}</option>`).join('')}</optgroup>`).join('')}</select>`;
    return shell(`<h1 class="qh">${sel}</h1><article class="doc" id="doc-box" data-path="${E(path)}"><p class="empty">読み込み中</p></article><p class="foot"><a href="#docs">目次へ</a></p>`);
  }
  function linkTo(u, base) {
    if (/^(https?:)?\/\//.test(u) || /^mailto:/.test(u)) return u;
    const [p0] = u.split('#');
    if (!/\.md$/.test(p0)) return u;
    const parts = (base.split('/').slice(0, -1).join('/') + '/' + p0).split('/');
    const out = []; parts.forEach((x) => { if (x === '..') out.pop(); else if (x && x !== '.') out.push(x); });
    return '#docs/' + out.join('/');
  }
  function mdToHtml(src, base) {
    const inline = (s) => E(s).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, t, u) => { const h = linkTo(u, base); return `<a href="${E(h)}" ${h.startsWith('#') ? '' : 'target="_blank" rel="noopener"'}>${t}</a>`; });
    const out = [], L = src.split('\n'); let i = 0;
    const isSep = (l) => /^\|[\s:|-]+\|?\s*$/.test(l);
    while (i < L.length) {
      const l = L[i];
      if (/^```/.test(l)) { const buf = []; i++; while (i < L.length && !/^```/.test(L[i])) buf.push(L[i++]); i++; out.push(`<pre>${E(buf.join('\n'))}</pre>`); continue; }
      const h = /^(#{1,4})\s+(.*)/.exec(l);
      if (h) { const n = Math.min(h[1].length + 1, 5); out.push(`<h${n}>${inline(h[2])}</h${n}>`); i++; continue; }
      if (/^\|/.test(l)) { const rows = []; while (i < L.length && /^\|/.test(L[i])) rows.push(L[i++]); const body = rows.filter((r) => !isSep(r)); const cells = (r) => r.replace(/^\|/, '').replace(/\|\s*$/, '').split('|').map((c) => inline(c.trim()));
        out.push(`<div class="scroll"><table><thead><tr>${cells(body[0]).map((c) => `<th>${c}</th>`).join('')}</tr></thead><tbody>${body.slice(1).map((r) => `<tr>${cells(r).map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`); continue; }
      if (/^\s*[-*+]\s+/.test(l)) { const items = []; while (i < L.length && /^\s*([-*+]\s+|\s{2,}\S)/.test(L[i])) { const x = L[i++]; if (/^\s*[-*+]\s+/.test(x)) items.push(x.replace(/^\s*[-*+]\s+/, '')); else items[items.length - 1] += ' ' + x.trim(); } out.push(`<ul>${items.map((x) => `<li>${inline(x)}</li>`).join('')}</ul>`); continue; }
      if (/^\s*\d+\.\s+/.test(l)) { const items = []; while (i < L.length && /^\s*(\d+\.\s+|\s{2,}\S)/.test(L[i])) { const x = L[i++]; if (/^\s*\d+\.\s+/.test(x)) items.push(x.replace(/^\s*\d+\.\s+/, '')); else items[items.length - 1] += ' ' + x.trim(); } out.push(`<ol>${items.map((x) => `<li>${inline(x)}</li>`).join('')}</ol>`); continue; }
      if (/^>/.test(l)) { const buf = []; while (i < L.length && /^>/.test(L[i])) buf.push(L[i++].replace(/^>\s?/, '')); out.push(`<blockquote><p>${inline(buf.join(' '))}</p></blockquote>`); continue; }
      if (/^(-{3,}|\*{3,})\s*$/.test(l)) { out.push('<hr>'); i++; continue; }
      if (!l.trim()) { i++; continue; }
      const buf = []; while (i < L.length && L[i].trim() && !/^(#{1,4}\s|\||```|\s*[-*+]\s|\s*\d+\.\s|>)/.test(L[i])) buf.push(L[i++]);
      out.push(`<p>${inline(buf.join(' '))}</p>`);
    }
    return out.join('');
  }

  // ---------- 設定 ----------
  function viewSettings(err) {
    return shell(`<h1>設定</h1><section><h2>GitHub</h2>${err ? `<div class="msg ng">${E(err)}</div>` : ''}
<form id="f-cfg" class="form"><div class="form cols">${fld('リポジトリ', 'repo_full', cfg.owner + '/' + cfg.repo)}${fld('ブランチ', 'branch', cfg.branch)}</div>${fld('トークン', 'token', cfg.token, { type: 'password' })}
<div class="btns"><button class="b primary" data-act="save-cfg">保存</button><button class="b quiet" data-act="clear-cfg" type="button">トークンを消す</button></div></form>
<details class="fold"><summary>トークンの作り方</summary><p>GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token。Repository access で secondary-investment だけを選び、Permissions の Contents を Read and write にする。トークンはこの端末のブラウザにだけ保存される。</p></details></section>`);
  }

  // ---------- 描画とイベント ----------
  function render() {
    const r = route();
    if (!loaded) { app.innerHTML = viewSettings(r[0] === 'settings' ? '' : 'GitHubのトークンを入れると読み込む'); showToast(); return; }
    let html;
    try {
      if (r[0] === 'trades') html = viewTrades();
      else if (r[0] === 'trade') html = viewTrade(r[1] || 'new');
      else if (r[0] === 'cand') html = viewCand(r[1] || 'new');
      else if (r[0] === 'rules') html = viewRules();
      else if (r[0] === 'rule') html = viewRule(r[1]);
      else if (r[0] === 'materials') html = viewMaterials();
      else if (r[0] === 'docs') html = viewDocs(r.slice(1).join('/'));
      else if (r[0] === 'changes') html = viewChanges();
      else if (r[0] === 'settings') html = viewSettings();
      else html = viewToday();
    } catch (e) { html = shell(`<h1>表示できない</h1><div class="msg">${E(e.message)}</div><p class="foot"><a href="#settings">設定</a></p>`); console.error(e); }
    app.innerHTML = html;
    if (r[0] === 'rule' && r[2]) { const el = document.getElementById('s-' + r[2]); if (el) { if (el.tagName === 'DETAILS') el.open = true; el.scrollIntoView(); } }
    showToast();
    after();
  }
  function showToast() {
    if (!msg) return;
    const t = document.createElement('div'); t.className = 'toast' + (msg.ng ? ' ng' : ''); t.textContent = msg.text; document.body.appendChild(t);
    setTimeout(() => t.remove(), msg.ng ? 6000 : 3000); msg = null;
  }
  async function after() {
    const box = document.getElementById('changes-box');
    if (box) { try { const list = await commits(); box.innerHTML = changesHtml(list, 0); } catch (e) { box.innerHTML = '<p class="empty">取れなかった</p>'; } }
    const lu = document.getElementById('last-update');
    if (lu && !isLocal()) { try { const l = await commits(); if (l[0]) { const d = new Date(l[0].date); lu.textContent = `更新 ${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}　${l[0].who === 'Claude' ? 'AI' : l[0].who}`; } } catch (e) { } }
    const doc = document.getElementById('doc-box');
    if (doc) { try { const t = await readText(doc.dataset.path); doc.innerHTML = mdToHtml(t, doc.dataset.path); window.scrollTo(0, 0); } catch (e) { doc.innerHTML = `<p class="empty">${E(e.message)}</p>`; } }
  }
  window.addEventListener('hashchange', () => { edit = null; render(); if (!/^#(rule|docs)\/.+\/.+/.test(location.hash)) window.scrollTo(0, 0); });
  const rerenderStrategy = (f) => { edit.rows = readRowsForm(f); edit.draft = fd(f); render(); };
  app.addEventListener('change', (e) => {
    const f = e.target.closest && e.target.closest('#f-strategy');
    if (f && (e.target.classList.contains('rjudge') || e.target.classList.contains('rscope') || /^r\d+_項目$/.test(e.target.name || ''))) { rerenderStrategy(f); return; }
    if (e.target.classList.contains('qsel')) location.hash = '#rule/' + e.target.value;
    if (e.target.classList.contains('dsel')) location.hash = e.target.value ? '#docs/' + e.target.value : '#docs';
  });
  app.addEventListener('submit', (e) => e.preventDefault());
  const histEntry = (q, name, change, before, after_, reason) => ({ '日付': todayISO(), '問い': String(q.num), '戦略': name, '変更': change, '変更前': before || '', '変更後': after_ || '', '理由': reason || '', '件数': data['取引'].filter((t) => cstate(t) === '決済済み' && Calc.ruleOf(t, q.num) === name).length });
  const renameEverywhere = (q, oldName, newName) => {
    data['取引'].forEach((t) => { if (Calc.ruleOf(t, q.num) === oldName) t['使うルール'][String(q.num)] = newName; });
    data['候補'].forEach((c) => { if (q['結果'] === '候補に入れる' && c['戦略'] === oldName) c['戦略'] = newName; if (q['結果'] === '段階を進める' && c['判定の戦略'] === oldName) c['判定の戦略'] = newName; });
  };
  app.addEventListener('click', async (e) => {
    const c = e.target.closest('[data-copy]');
    if (c) { try { await navigator.clipboard.writeText(c.dataset.copy); msg = { text: 'コピーした ' + c.dataset.copy }; } catch (x) { msg = { ng: true, text: 'コピーできなかった' }; } showToast(); return; }
    const b = e.target.closest('[data-act]'); if (!b) return;
    const act = b.dataset.act; const i = Number(b.dataset.i);
    if (act === 'cancel') { edit = null; render(); return; }
    if (act === 'edit-principles') { edit = { type: 'principle', idx: -2 }; render(); return; }
    if (act === 'edit-principle') { edit = { type: 'principle', idx: i }; render(); return; }
    if (act === 'edit-premise') { edit = { type: 'premise' }; render(); return; }
    if (act === 'edit-strategy') { edit = { type: 'strategy', q: Number(b.dataset.q), idx: i }; render(); return; }
    if (act === 'edit-trade') { edit = { type: 'trade', idx: i }; render(); window.scrollTo(0, 0); return; }
    if (act === 'edit-cand') { edit = { type: 'cand', idx: i }; render(); window.scrollTo(0, 0); return; }
    if (act === 'add-row' || act === 'del-row' || act === 'up-row') {
      const f = document.getElementById('f-strategy'), rows = readRowsForm(f), r = Number(b.dataset.r);
      if (act === 'add-row') rows.push({ '名前': '', '適用範囲': null, '時点': null, '条件': { '判定': '計算', '項目': '', '比較': '以上', '値': '' }, '行動': null });
      else if (act === 'del-row') rows.splice(r, 1);
      else if (r > 0) { const x = rows.splice(r, 1)[0]; rows.splice(r - 1, 0, x); }
      edit.rows = rows; edit.draft = fd(f); render(); return;
    }
    if (act === 'clear-cfg') { cfg.token = ''; localStorage.setItem(KEY, JSON.stringify(cfg)); loaded = false; location.hash = '#settings'; render(); return; }
    e.preventDefault();
    if (act === 'save-cfg') { const v = fd(document.getElementById('f-cfg')); if (v.repo_full) { const [o, r] = v.repo_full.trim().split('/'); v.owner = o; v.repo = r || ''; } delete v.repo_full; Object.assign(cfg, v); localStorage.setItem(KEY, JSON.stringify(cfg)); await boot(); location.hash = '#today'; return; }
    if (act === 'set-monthly') { data['前提']['月初資金'] = Number(b.dataset.v); if (await save('前提', '月初資金を更新')) edit = null; render(); return; }
    if (act === 'save-principle') {
      const f = document.getElementById('f-principle'), v = fd(f), idx = Number(f.dataset.i);
      const p = { id: Number(v.id), title: v.title, text: v.text, '出典': v['出典'] };
      if (idx >= 0) data['原則'][idx] = p; else data['原則'].push(p);
      data['原則'].sort((a, b2) => a.id - b2.id);
      if (await save('原則', '原則：' + p.title)) edit = null; render(); return;
    }
    if (act === 'del-principle') { if (!confirm('この原則を消す')) return; const idx = Number(document.getElementById('f-principle').dataset.i); const p = data['原則'].splice(idx, 1)[0]; if (await save('原則', '原則を削除：' + p.title)) edit = null; render(); return; }
    if (act === 'save-premise') {
      const v = fd(document.getElementById('f-premise')); const pre = data['前提'];
      ['初期資金', '月初資金', '停止残高', '単元'].forEach((k) => { pre[k] = Number(v[k]); }); pre['証券会社'] = v['証券会社']; pre['休日'] = lines(v['休日']);
      pre['イベント暦'] = lines(v['イベント暦']).map((l) => { const [d, ...n] = l.split(/\s+/); return { '日付': d, '名前': n.join(' ') }; });
      if (await save('前提', '前提を更新')) edit = null; render(); return;
    }
    if (act === 'save-strategy') {
      const f = document.getElementById('f-strategy'), v = fd(f), q = Q(f.dataset.q), idx = Number(f.dataset.i);
      if (!v.name.trim()) { msg = { ng: true, text: '戦略名を入れる' }; showToast(); return; }
      if (!(v['出典'] || '').trim()) { msg = { ng: true, text: '出典を入れる。出典のない戦略は置かない' }; showToast(); return; }
      const old = idx >= 0 ? q['戦略'][idx] : null;
      if (!old && q['戦略'].filter((x) => x['状態'] === '代替案').length >= 2) { msg = { ng: true, text: '代替案は2つまで。先に1つ不採用にする' }; showToast(); return; }
      const keys = q['数値欄のキー'] || [];
      const rows = readRowsForm(f);
      const bad = validateRows(q, rows, keys); if (bad) { msg = { ng: true, text: bad }; showToast(); edit.rows = rows; edit.draft = v; return; }
      const s = { name: v.name.trim(), '状態': old ? old['状態'] : '代替案', '改定日': todayISO(), '区分': v['区分'] || '共通', '一言で': v['一言で'], '行': rows, 'しないこと': lines(v['しないこと']), '出典': v['出典'], '数値欄': {} };
      keys.forEach((k) => { s['数値欄'][k] = numOrNull(v['n:' + k]); });
      if (s['状態'] === '採用') { const dup = q['戦略'].find((x) => x !== old && x['状態'] === '採用' && (s['区分'] === '共通' || x['区分'] === '共通' || x['区分'] === s['区分'])); if (dup) { msg = { ng: true, text: `${dup.name} が${dup['区分'] === '共通' ? '' : dup['区分'] + 'の'}採用。採用は区分ごとに1つ` }; showToast(); return; } }
      if (old && old.name !== s.name) renameEverywhere(q, old.name, s.name);
      if (idx >= 0) q['戦略'][idx] = s; else q['戦略'].push(s);
      // 改定履歴：行の追加・削除、条件変更、数値変更、文言変更
      const oldNames = (old ? old['行'] : []).map((r) => r['名前']), newNames = rows.map((r) => r['名前']);
      const added = newNames.filter((n) => !oldNames.includes(n)), removed = oldNames.filter((n) => !newNames.includes(n));
      const condChanged = old && JSON.stringify(old['行'].map((r) => [r['名前'], r['条件'], r['適用範囲']])) !== JSON.stringify(rows.map((r) => [r['名前'], r['条件'], r['適用範囲']]));
      const entries = [];
      if (!old) entries.push(histEntry(q, s.name, '追加', '', s['状態'], v.reason));
      else {
        if (added.length) entries.push(histEntry(q, s.name, '行の追加', '', added.join('、'), v.reason));
        if (removed.length) entries.push(histEntry(q, s.name, '行の削除', removed.join('、'), '', v.reason));
        if (condChanged && !added.length && !removed.length) entries.push(histEntry(q, s.name, '条件変更', '', rows.filter((r, k) => JSON.stringify(r['条件']) !== JSON.stringify((old['行'].find((x) => x['名前'] === r['名前']) || {})['条件'])).map((r) => r['名前']).join('、'), v.reason));
        if (JSON.stringify(old['数値欄']) !== JSON.stringify(s['数値欄'])) entries.push(histEntry(q, s.name, '数値変更', JSON.stringify(old['数値欄']), JSON.stringify(s['数値欄']), v.reason));
        if (!entries.length) entries.push(histEntry(q, s.name, '文言変更', old['状態'], s['状態'], v.reason));
      }
      entries.forEach((h) => data['改定履歴'].push(h));
      // 影響：条件つきの行が増えた・名前が変わったら、確認済みの候補が確認待ちに戻る
      let affected = 0;
      if (q['結果'] === '段階を進める' && s['状態'] === '採用') affected = data['候補'].filter((cc) => cc['確認'] && candStage(cc) === '確認待ち').length;
      const ok = await save('問い', `${q.num} ${q.name} ${s.name}：${entries.map((h) => h['変更']).join('・')}`);
      if (ok) { await save('改定履歴', `改定履歴：${q.num} ${s.name}`); if (old && old.name !== s.name) { await save('取引', '戦略名の変更を取引に反映'); await save('候補', '戦略名の変更を候補に反映'); } edit = null; if (affected) msg = { text: `保存した。確認待ちに戻る候補 ${affected} 件` }; }
      render(); return;
    }
    if (act === 'adopt' || act === 'retire' || act === 'restore') {
      const q = Q(b.dataset.q), s = q['戦略'][i];
      const hist = (st, x) => data['改定履歴'].push(histEntry(q, x.name, st, x['状態'], st, ''));
      if (act === 'adopt') {
        const rivals = q['戦略'].filter((x) => x !== s && x['状態'] === '採用' && (s['区分'] === '共通' || x['区分'] === '共通' || x['区分'] === s['区分']));
        const w = s['区分'] === '共通' ? '採用' : s['区分'] + 'の採用', names = rivals.map((x) => x.name).join('・');
        if (!confirm(rivals.length ? `${w}を ${names} → ${s.name} に替える。${names} は代替案になる` : `${s.name} を${w}にする`)) return;
        rivals.forEach((x) => { hist('代替案', x); x['状態'] = '代替案'; x['改定日'] = todayISO(); });
        hist('採用', s); s['状態'] = '採用'; s['改定日'] = todayISO();
        if (await save('問い', `${q.num} ${q.name}：${w}を ${s.name} に`)) await save('改定履歴', '改定履歴：採用の入れ替え');
        render(); return;
      }
      if (act === 'retire') {
        if (s['状態'] === '採用') { msg = { ng: true, text: '採用は入れ替えでしか外せない。別の戦略を「採用にする」' }; showToast(); return; }
        if (!confirm(`${s.name} を不採用にする`)) return;
        hist('不採用', s); s['状態'] = '不採用'; s['改定日'] = todayISO();
        if (await save('問い', `${q.num} ${q.name}：${s.name} を不採用に`)) await save('改定履歴', '改定履歴：不採用'); render(); return;
      }
      if (q['戦略'].filter((x) => x['状態'] === '代替案').length >= 2) { msg = { ng: true, text: '代替案は2つまで。先に1つ不採用にする' }; showToast(); return; }
      hist('代替案', s); s['状態'] = '代替案'; s['改定日'] = todayISO();
      if (await save('問い', `${q.num} ${q.name}：${s.name} を代替案に`)) await save('改定履歴', '改定履歴：代替案に戻す'); render(); return;
    }
    if (act === 'del-strategy') {
      const f = document.getElementById('f-strategy'), q = Q(f.dataset.q), idx = Number(f.dataset.i), s = q['戦略'][idx];
      const used = data['取引'].some((t) => Calc.ruleOf(t, q.num) === s.name);
      if (used) { msg = { ng: true, text: '取引で使われている戦略は消せない。不採用にする' }; showToast(); return; }
      if (!confirm(`${s.name} を消す`)) return;
      q['戦略'].splice(idx, 1);
      data['改定履歴'].push(histEntry(q, s.name, '削除', s['状態'], '', ''));
      if (await save('問い', `${q.num} ${s.name}：削除`)) { await save('改定履歴', '改定履歴：削除'); edit = null; } render(); return;
    }
    if (act === 'calc-trade') {
      const f = document.getElementById('f-trade'), v = fd(f);
      const entry = Number(v['発注価格']), stop = Number(v['損切り価格']);
      if (!entry || !stop) { msg = { ng: true, text: '発注価格と損切り価格を入れる' }; showToast(); return; }
      const a = acct(todayISO());
      if (!a || !a['1R額']) { msg = { ng: true, text: '口座の記録に1R額が無い（引け後の作業で入る）。株数は手で入れる' }; showToast(); return; }
      edit = edit || {}; edit.calc = Calc.size({ entry, stop, oneR: a['1R額'], oneRCap: a['1単元上限額'], perStockCap: a['1銘柄上限額'], unit: data['前提']['単元'] });
      const draft = v; draft['株数'] = edit.calc.qty;
      const open = [...f.querySelectorAll('details')].map((d) => d.open);
      render();
      const g = document.getElementById('f-trade');
      [...g.querySelectorAll('details')].forEach((d, k) => { d.open = open[k]; });
      Object.entries(draft).forEach(([k, val]) => { const el = g.elements[k]; if (el && el.type !== 'checkbox') el.value = val == null ? '' : val; });
      if (g.elements['取消']) g.elements['取消'].checked = !!v['取消'];
      return;
    }
    if (act === 'save-trade') {
      const f = document.getElementById('f-trade'), v = fd(f), idx = Number(f.dataset.i), old = idx >= 0 ? data['取引'][idx] : blankTrade();
      const rules = {}; perTradeQs().forEach((q) => { if (v['rule:' + q.num]) rules[String(q.num)] = v['rule:' + q.num]; });
      const t = Object.assign({}, old, { id: Number(v.id), 'コード': v['コード'], '銘柄名': v['銘柄名'], '区分': v['区分'], '市場区分': v['市場区分'] || null, '業種': v['業種'] || null, '使うルール': rules,
        '記録日': v['記録日'] || null, '基準価格': numOrNull(v['基準価格']), '損切り価格': numOrNull(v['損切り価格']), '発注価格': numOrNull(v['発注価格']), '株数': numOrNull(v['株数']),
        '約定日': v['約定日'] || null, '約定価格': numOrNull(v['約定価格']), '約定株数': numOrNull(v['約定株数']), '期限日': v['期限日'] || null, 'イベント日': v['イベント日'] || null, 'イベント種別': v['イベント種別'] || null,
        '売り': [0, 1].filter((k) => v['s' + k + 'd']).map((k) => ({ '日付': v['s' + k + 'd'], '価格': Number(v['s' + k + 'p']), '株数': Number(v['s' + k + 'q']) })),
        '売った理由': v['売った理由'] || null, '次の行動': v['次の行動'] || '', 'メモ': v['メモ'] });
      t['状態'] = v['取消'] ? '取消' : cstate(t);
      if (idx >= 0) data['取引'][idx] = t; else data['取引'].push(t);
      if (await save('取引', `取引 ${t.id} ${t['銘柄名']}：${t['状態']}`)) { edit = null; if (idx < 0) location.hash = '#trade/' + (data['取引'].length - 1); } render(); return;
    }
    if (act === 'del-trade') { const f = document.getElementById('f-trade'), idx = Number(f.dataset.i); if (!confirm('この取引を消す')) return; const t = data['取引'].splice(idx, 1)[0]; if (await save('取引', `取引 ${t.id} を削除`)) location.hash = '#trades'; else render(); return; }
    if (act === 'save-cand') {
      const f = document.getElementById('f-cand'), v = fd(f), idx = Number(f.dataset.i), old = idx >= 0 ? data['候補'][idx] : blankCand();
      const c = Object.assign({}, old, { '日付': v['日付'], 'コード': v['コード'], '銘柄名': v['銘柄名'], '区分': v['区分'], '市場区分': v['市場区分'] || null, '業種': v['業種'] || null, '上場日': v['上場日'] || null, '売買代金_億': numOrNull(v['売買代金_億']), '時価総額_億': numOrNull(v['時価総額_億']),
        '終値': numOrNull(v['終値']), '絞り込み': v['絞り込み'] || '可', '判定': (old['判定'] || []).slice(), '確認': v['確認'] ? (old['確認'] || todayISO()) : null, '型が出た日': v['型が出た日'] || null, 'メモ': v['メモ'] });
      const { q, s, rows } = candRowsOf(c);
      if (q) {
        c['判定の戦略'] = s ? s.name : null;
        rows.filter((r) => r['条件']).forEach((r, k) => {
          const res = v['j' + k] || '未', reason = (v['g' + k] || '').trim();
          const j = Calc.latest(c['判定'], q.num, r['名前']);
          if (!j ? (res !== '未' || reason) : (j['結果'] !== res || (j['根拠'] || '') !== reason)) c['判定'].push({ '問い': q.num, '条件': r['名前'], '結果': res, '根拠': reason, '判定者': '人', '日付': todayISO() });
        });
      }
      if (idx >= 0) data['候補'][idx] = c; else data['候補'].push(c);
      if (await save('候補', `候補 ${c['銘柄名']}：${candStage(c)}`)) { edit = null; if (idx < 0) location.hash = '#cand/' + (data['候補'].length - 1); } render(); return;
    }
    if (act === 'confirm-cand') {
      const cc = data['候補'][i]; cc['確認'] = todayISO();
      if (await save('候補', `候補 ${cc['銘柄名']}：確認（${candStage(cc)}）`)) edit = null; render(); return;
    }
    if (act === 'judge-cand' || act === 'judge-trade') {
      const list = act === 'judge-cand' ? data['候補'] : data['取引'], rec = list[i];
      rec['判定'] = rec['判定'] || [];
      rec['判定'].push({ '問い': Number(b.dataset.q), '条件': b.dataset.name, '結果': b.dataset.v, '根拠': '', '判定者': '人', '日付': todayISO() });
      if (await save(act === 'judge-cand' ? '候補' : '取引', `${rec['銘柄名']}：${b.dataset.name} ${b.dataset.v}（人）`)) edit = null; render(); return;
    }
    if (act === 'del-cand') { const f = document.getElementById('f-cand'), idx = Number(f.dataset.i); if (!confirm('この候補銘柄を消す')) return; const cc = data['候補'].splice(idx, 1)[0]; if (await save('候補', `候補 ${cc['銘柄名']} を削除`)) location.hash = '#trades'; else render(); return; }
  });

  async function boot() {
    try { await loadAll(); render(); }
    catch (e) { loaded = false; app.innerHTML = viewSettings(e.message === 'settings' ? 'GitHubのトークンを入れる' : e.message); }
  }
  boot();
})();
