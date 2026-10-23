/* 売買ノート。data/ の JSON を GitHub から読み書きする1枚のアプリ。スマホ前提。 */
(function () {
  'use strict';
  const E = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const yen = (v) => (v == null || v === '' ? '' : Number(v).toLocaleString('ja-JP'));
  const todayISO = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
  const WD = '日月火水木金土';
  const dShort = (s) => (s ? String(s).slice(5).replace('-', '/') : '');
  const FILES = ['前提', '問い', '原則', '取引', '候補', '改定履歴', '地合い', 'スクリーナー項目'];
  const OPTIONAL = { '地合い': [] };
  const KEY = 'si.cfg';
  const app = document.getElementById('app');
  const TKEY = { '型': 'エントリー', '注文': '発注方法', '利確': '利益確定', '期限': '保有期限', '追加': '買い増し' };
  const TQ = { '型': 3, '注文': 4, '利確': 6, '期限': 7, '追加': 8 };
  const DOCS = [
    ['基礎', [['docs/00_株取引の基礎.md', '株取引の基礎'], ['docs/basics/01_資金管理と期待値.md', '資金管理と期待値'], ['docs/basics/02_チャートの基礎.md', 'チャートの基礎'], ['docs/basics/03_需給の読み方.md', '需給の読み方'], ['docs/basics/04_決算と業績の基礎.md', '決算と業績の基礎'], ['docs/basics/05_相場心理と行動のクセ.md', '相場心理と行動のクセ'], ['docs/basics/06_地合いと指数・イベント暦.md', '地合いと指数・イベント暦'], ['docs/basics/07_兼業の注文実務.md', '兼業の注文実務']]],
    ['IPO', [['docs/01_IPOの全体像.md', 'IPOの全体像'], ['docs/02_公開価格の決まり方.md', '公開価格の決まり方'], ['docs/03_初値の決まり方.md', '初値の決まり方'], ['docs/04_機関投資家とVCの動き.md', '機関投資家とVCの動き'], ['docs/05_初値後の値動き.md', '初値後の値動き'], ['docs/06_情報源の読み方.md', '情報源の読み方']]],
    ['用語', [['docs/07_用語集.md', '用語集']]],
    ['知見者', [['references/テスタ氏X投稿_株式投資の知見まとめ_2016-2026.md', 'テスタ（X投稿 2016–2026）'], ['references/ミネルヴィニ_成長株投資法_知見まとめ.md', 'ミネルヴィニ『成長株投資法』'], ['references/ミネルヴィニ_株式トレード基本と原則_知見まとめ.md', 'ミネルヴィニ『株式トレード 基本と原則』'], ['references/ティアー_バフェットとソロス_知見まとめ.md', 'ティアー『バフェットとソロス 勝利の投資学』']]],
    ['ノートの設計', [['rules/00_前提.md', '前提（兼業・現物・小資金）'], ['rules/04_テスタ知見との対応表.md', 'テスタ知見との対応表']]],
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
  const tabOf = (r) => ({ today: 'today', trades: 'trades', trade: 'trades', cand: 'trades', rules: 'rules', rule: 'rules', docs: 'docs', changes: 'today', settings: 'today' }[r] || 'today');
  const shell = (body) => {
    const cur = tabOf(route()[0]);
    return body + '<nav class="tabs">' + TABS.map(([k, n]) => `<a href="#${k}" class="${cur === k ? 'on' : ''}">${n}</a>`).join('') + '</nav>';
  };
  const pill = (st) => `<span class="pill ${['採用', '保有中', '一部利確', 'ウォッチ中', '判断できる'].includes(st) ? 'pill-ok' : ['不採用', '見送り', '取消'].includes(st) ? 'pill-ng' : ['注文中', '確認待ち'].includes(st) ? 'pill-warn' : st === '型が出た' ? 'pill-acc' : ''}">${E(st)}</span>`;
  const sh = (t, sub) => `<h2 class="sh">${E(t)}${sub ? `<small>${E(sub)}</small>` : ''}</h2>`;
  const fld = (label, name, value, o = {}) => {
    const v = value == null ? '' : value;
    let inp;
    if (o.type === 'select') inp = `<select name="${name}">${o.options.map((x) => `<option value="${E(x)}" ${String(x) === String(v) ? 'selected' : ''}>${E(x || '—')}</option>`).join('')}</select>`;
    else if (o.type === 'textarea') inp = `<textarea name="${name}" ${o.rows ? `rows="${o.rows}"` : ''}>${E(v)}</textarea>`;
    else inp = `<input name="${name}" type="${o.type || 'text'}" value="${E(v)}" ${o.type === 'number' ? 'inputmode="decimal"' : ''} ${o.step ? `step="${o.step}"` : ''} ${o.ph ? `placeholder="${E(o.ph)}"` : ''}>`;
    return `<label class="f"><span>${E(label)}</span>${inp}</label>`;
  };
  const lines = (t) => String(t || '').split('\n').map((s) => s.trim()).filter(Boolean);
  const text = (a) => (Array.isArray(a) ? a.join('\n') : a || '');
  const numOrNull = (v) => (v === '' || v == null ? null : isNaN(Number(v)) ? v : Number(v));
  const fd = (form) => { const o = {}; new FormData(form).forEach((v, k) => { o[k] = v; }); return o; };
  const Q = (n) => data['問い'].find((q) => q.num === Number(n));
  const slist = (num) => (Q(num) ? Q(num)['戦略'].map((s) => s.name) : []);
  const adoptedText = (q) => q['戦略'].filter((s) => s['状態'] === '採用').map((s) => (s['区分'] === '共通' ? '' : s['区分'] + '：') + s.name).join(' ／ ') || '—';
  const cp = (v) => `<button type="button" class="cp" data-copy="${E(v)}">${yen(v)}</button>`;
  const stock = (t) => `<b>${E(t['銘柄名'])}</b><span class="code">${E(t['コード'])}</span>`;
  const docLink = (p, label) => `<a href="#docs/${p.split('/').map(encodeURIComponent).join('/')}">${E(label || docTitle(p))}</a>`;
  const linkify = (s) => E(s).replace(/docs\/(basics\/)?(\d\d)/g, (m, b, n) => { const hit = DOC_LIST.find(([p]) => p.startsWith(`docs/${b || ''}${n}_`)); return hit ? `<a href="#docs/${hit[0]}">${m}</a>` : m; });
  const keyLabel = (k) => k.replace(/_件$/, '（件）').replace(/_pct$/, '（%）').replace(/_億$/, '（億円）').replace(/_営業日$/, '（営業日）').replace(/_日$/, '（日）').replace(/_R$/, '（R）').replace(/_月$/, '（月）');
  // 1 スクリーニングのスクリーナー条件（項目・以上／以下・数字）。項目の一覧は data/スクリーナー項目.json
  const CAT = () => data['スクリーナー項目'] || [];
  const catItem = (k) => CAT().find((x) => x.key === k);
  const fmtNum = (v) => (Number.isInteger(Number(v)) ? String(Number(v)) : String(v));
  const isPick = (k) => ((catItem(k) || {})['種類'] === '選択');
  const condText = (c) => { if (isPick(c['項目'])) { const w = Array.isArray(c['値']) ? c['値'] : [c['値']]; return `${c['項目']}が${w.join('・')}${w.length > 1 ? 'のいずれか' : ''}`; } return `${c['項目']}が${fmtNum(c['値'])}${(catItem(c['項目']) || {})['単位'] || ''}${c['比較']}`; };
  const genCondLines = (st) => (st['スクリーナー条件'] || []).map(condText).concat(['平均売買代金の大きい順に{候補上限_件}件まで候補に入れる']);
  // 条件の行を読む。選択式の項目はチェックの付いた値の配列、数字の項目は文字のまま（保存時に数にする）
  const readRows = (f) => { const out = []; for (let r = 0; f.querySelector(`[name="ck${r}"]`); r++) { const k = f.querySelector(`[name="ck${r}"]`).value, co = f.querySelector(`[name="co${r}"]`); out.push({ '項目': k, '比較': isPick(k) ? 'いずれか' : (co ? co.value : '以上'), '値': isPick(k) ? Array.from(f.querySelectorAll(`input[name="cv${r}"]:checked`)).map((x) => x.value) : (f.querySelector(`input[name="cv${r}"]`) || {}).value || '' }); } return out; };
  const readCond = (f) => readRows(f).filter((c) => c['項目'] && (Array.isArray(c['値']) ? c['値'].length : c['値'] !== '')).map((c) => (Array.isArray(c['値']) ? c : Object.assign({}, c, { '値': Number(c['値']) })));
  function condBuilder(conds) {
    const rows = conds.length ? conds : [{ '項目': '', '比較': '以上', '値': '' }];
    const opts = (sel) => `<option value="">—</option>` + CAT().map((x) => `<option value="${E(x.key)}" ${x.key === sel ? 'selected' : ''}>${E(x.key)}${x['単位'] ? `（${E(x['単位'])}）` : ''}</option>`).join('');
    const pickBox = (c, r) => { const w = Array.isArray(c['値']) ? c['値'] : (c['値'] ? [c['値']] : []); return `<div class="f"><span>当てはまるもの（複数可）</span><div class="picks">${(catItem(c['項目'])['選択肢'] || []).map((o) => `<label class="chk"><input type="checkbox" name="cv${r}" value="${E(o)}" ${w.includes(o) ? 'checked' : ''}> ${E(o)}</label>`).join('')}</div></div>`; };
    const unit = (c) => ((catItem(c['項目']) || {})['単位'] || '');
    return `<h4>スクリーナーの条件<small>全部満たした銘柄が候補になる</small></h4>${rows.map((c, r) => `<div class="cond"><div class="f"><span>項目</span><div class="hx"><select name="ck${r}">${opts(c['項目'])}</select><button type="button" class="b quiet x" data-act="del-cond" data-r="${r}" aria-label="この条件を消す">×</button></div></div>${isPick(c['項目']) ? pickBox(c, r) : `<div class="form cols"><label class="f"><span>以上／以下</span><select name="co${r}"><option ${c['比較'] === '以上' ? 'selected' : ''}>以上</option><option ${c['比較'] === '以下' ? 'selected' : ''}>以下</option></select></label><label class="f"><span>値${unit(c) ? `（${E(unit(c))}）` : ''}</span><input name="cv${r}" type="number" step="any" inputmode="decimal" value="${E(Array.isArray(c['値']) ? '' : c['値'])}"></label></div>`}</div>`).join('')}<div class="btns"><button type="button" class="b" data-act="add-cond">条件を足す</button></div>`;
  }
  // 候補の状態：仮判定中（AIがまだ）→ 確認待ち（根拠あり。人が読む）→ ウォッチ中（人が確認した）→ 型が出た（注文を作った）。×か絞り込み不可は見送り
  function candState(c) {
    if (c['絞り込み'] && c['絞り込み'] !== '可') return '見送り';
    const j = c['判定'] || [], g = c['根拠'] || [];
    if (j.some((x) => x === '×')) return '見送り';
    if (j.filter((x) => x === '○').length === 4 && c['確認']) return c['型が出た日'] ? '型が出た' : 'ウォッチ中';
    return g.some((x) => x && String(x).trim()) ? '確認待ち' : '仮判定中';
  }
  const waiting = (c) => candState(c) === '確認待ち';
  const blanks = (c) => (c['判定'] || [null, null, null, null]).filter((x) => !x).length;
  const byBlanks = (a, b) => blanks(a) - blanks(b);
  const candLabels = (c) => ((Calc.adopted(data['問い'], 2, c['区分']) || {})['当てはまる条件'] || []).slice(0, 4).map((x) => x.replace(/（.*$/, ''));
  const typeName = (c) => ((Calc.adopted(data['問い'], 3, c['区分']) || {}).name || '型');
  const cstate = (t) => Calc.state(t);

  // ---------- 今日 ----------
  const SCENES = [['pre', '寄付前'], ['noon', '昼'], ['post', '引け後'], ['week', '週末'], ['month', '月初']];
  function pickScene() {
    const d = new Date(), h = d.getHours() + d.getMinutes() / 60, w = d.getDay();
    if (w === 0 || w === 6) return 'week';
    if (h < 9) return 'pre'; if (h < 15.5) return 'noon'; return 'post';
  }
  function viewToday() {
    const today = todayISO();
    const st = Calc.status(data, today), od = Calc.orders(data, today);
    const d = new Date(today + 'T00:00:00');
    const want = route()[1];
    const scene = SCENES.some(([k]) => k === want) ? want : pickScene();
    const seg = `<div class="seg">${SCENES.map(([k, n]) => `<a href="#today/${k}" class="${k === scene ? 'on' : ''}">${n}</a>`).join('')}</div>`;
    const month = d.getDate() <= 3 && scene !== 'month' && scene !== 'week' ? `<div class="rows"><a class="row" href="#today/month"><div class="r1"><b>月初の見直し</b></div><div class="r2">集計を見て、戦略の状態を決める</div><span class="chev">›</span></a></div>` : '';
    const body = { pre: scenePre, noon: sceneNoon, post: scenePost, week: sceneWeek, month: sceneMonth }[scene](st, od, today);
    return shell(`<h1>${d.getMonth() + 1}月${d.getDate()}日（${WD[d.getDay()]}）</h1><p class="foot" id="last-update"></p>${seg}${month}${body}
<p class="foot"><a href="#changes">更新の記録</a>　<a href="#settings">設定</a></p>`);
  }
  function verdict(st, full) {
    const q11 = Calc.nums(data['問い'], 11);
    const lot = st.stage === '停止' ? '取引停止' : st.stage === '段階2' ? '新規停止' : `${Math.round(st.lot * 100)}%` + (st.stage === '段階1' ? `（ドローダウン${st.ddPct}%）` : st.lossPrev ? '（損切り翌日）' : '');
    const rows = [
      ['ロット', lot, !['停止', '段階2'].includes(st.stage)],
      ['保有銘柄数', `${st.held + st.waiting} / ${st.heldMax}`, st.held + st.waiting < st.heldMax],
      ['全損切り時の損失', `${st.openRiskPct}% / ${st.openRiskMax}%`, st.openRiskPct <= st.openRiskMax],
      ['連敗', `${st.streak} / ${q11['連敗停止']}`, st.streak < q11['連敗停止']],
      ['損切り当日', st.lossToday ? 'あり' : 'なし', !st.lossToday],
      ['地合い', st.market.text, st.market.ok !== false],
    ];
    return `<section class="verdict ${st.ok ? 'ok' : 'ng'}"><div class="v-main">新規買い ${st.ok ? '可' : '不可'}</div>${st.ok ? '' : `<div class="v-why">${E(st.reasons.join('。'))}</div>`}
${full ? `<dl class="gates">${rows.map(([k, v, ok]) => `<div class="${ok ? '' : 'bad'}"><dt>${k}</dt><dd>${E(v)}</dd></div>`).join('')}</dl><p class="v-cash">資金 ${yen(st.cash)}円　ドローダウン ${st.ddPct}%</p>` : ''}</section>`;
  }
  function sizeNote(t) {
    const pre = data['前提'], q5 = Calc.nums(data['問い'], 5);
    const entry = t['発注価格'], stop = t['損切り価格'];
    if (!entry || !stop) return '';
    const sz = Calc.size(data, entry, stop, t['区分'], t['記録日'] || todayISO());
    const per = entry - stop;
    const raw = per > 0 ? Math.floor(sz.oneR / per / pre['単元']) * pre['単元'] : 0;
    let s = `1R ${yen(sz.oneR)}円（月初資金 ${yen(pre['月初資金'])}円 × ${q5['1R_pct']}%${sz.lot < 1 ? ` × ロット${Math.round(sz.lot * 100)}%` : ''}）÷ 1株の損失 ${yen(per)}円（${yen(entry)} − ${yen(stop)}）= ${yen(raw)}株`;
    if (raw === 0 && sz.qty > 0) s += `。1単元の損失 ${yen(per * pre['単元'])}円は1Rの上限（${q5['1R上限_pct']}%）内なので1単元`;
    if (sz.qty < raw) s += `。1銘柄の上限（月初資金の${q5['1銘柄上限_pct']}%）で ${yen(sz.qty)}株`;
    if (t['株数'] != null && t['株数'] !== sz.qty) s += `。記録は ${yen(t['株数'])}株`;
    s += `。損切り幅 ${sz.widthPct}%`;
    return s;
  }
  function newCard(o, off, why) {
    const t = o.t, note = sizeNote(t);
    return `<article class="ord ${off ? 'off' : ''}"><header>${stock(t)}<span class="tag">新規</span></header>${why ? `<div class="line warn">${E(why)}</div>` : ''}
<div class="line">${E(o.buy.kind)} <span class="nw">${cp(o.buy.price)}円 × ${cp(o.buy.qty)}株</span></div>
<div class="line sub">約定したら ${E(o.stop.kind)} <span class="nw">${cp(o.stop.price)}円 × ${cp(o.stop.qty)}株</span></div>
${note ? `<details><summary>株数の根拠</summary><p>${E(note)}</p></details>` : ''}</article>`;
  }
  const holdOrderCards = (od) => od.hold.flatMap((h) => h.orders.map((x) => `<article class="ord"><header>${stock(h.t)}<span class="tag hold">保有</span></header><div class="line">${E(x.kind)} <span class="nw">${x.price ? cp(x.price) + '円 × ' : ''}${cp(x.qty)}株</span></div><div class="line sub">${E(x.why)}</div></article>`)).join('');
  // 出す注文：新規買い可の日の、期限内の新規注文と、保有中の注文
  function orderCards(od, st) {
    const go = st.ok ? od.new.filter((o) => !o.expired) : [];
    return go.map((o) => newCard(o)).join('') + holdOrderCards(od);
  }
  // 今日は出さない注文：期限切れと、新規買い不可の日の新規
  function skipCards(od, st) {
    return od.new.filter((o) => o.expired || !st.ok).map((o) => newCard(o, true, o.expired ? `${o.cancelDays || ''}営業日で約定なし。今日は出さない。引け後に取消になる` : `新規買い 不可：${st.reasons.join('、')}`)).join('');
  }
  function holdCards(od, full) {
    if (!od.hold.length) return '<p class="empty">なし</p>';
    return od.hold.map((h) => {
      const t = h.t;
      const p = h.left <= 0 ? '<span class="pill pill-ng">期限</span>' : h.left <= 3 ? `<span class="pill pill-warn">あと${h.left}営業日</span>` : `<span class="pill">あと${h.left}営業日</span>`;
      return `<article class="hold"><header><div>${stock(t)}<span class="sub">${E(t['区分'])}・<a href="#rule/3/${encodeURIComponent(t['型'])}">${E(t['型'])}</a>・<a href="#rule/6/${encodeURIComponent(t['利確'])}">${E(t['利確'])}</a></span></div>${p}</header>
<dl><div><dt>約定 ${E(dShort(t['約定日']))}</dt><dd>${yen(t['約定価格'])}円</dd></div><div><dt>損切り${h.state === '一部利確' ? '（建値）' : ''}</dt><dd>${yen(h.stopPrice)}円</dd></div><div><dt>残株数</dt><dd>${h.rem}株</dd></div><div><dt>期限</dt><dd>${E(dShort(h.limit))}</dd></div></dl>
${full ? `<h4>売る条件<small>AIが毎日見る</small></h4><ul class="checks">${h.checks.filter((c) => !/1単元/.test(c)).map((c) => `<li>${E(c)}</li>`).join('')}<li>期限 ${E(dShort(h.limit))}${h.left <= 0 ? '（今日）' : `（あと${h.left}営業日）`}</li></ul>${h.noTp ? '<p class="ai">利確の指値 なし（1単元）</p>' : ''}${t['AIの判定'] ? `<p class="ai">AIの根拠　${E(t['AIの判定'])}</p>` : ''}` : ''}</article>`;
    }).join('');
  }
  function candRows(list) {
    if (!list.length) return '<p class="empty">なし</p>';
    return `<div class="rows">${list.map((c) => { const i = data['候補'].indexOf(c), st = candState(c), j = c['判定'] || [], nb = blanks(c);
      const r2 = st === '仮判定中' ? 'AIが仮判定中' : st === '確認待ち' ? `仮判定 ${j.map((x) => x || '・').join('')}${nb ? `　未確認 ${nb}` : ''}` : st === 'ウォッチ中' ? `${typeName(c)} を待つ` : st === '型が出た' ? `型が出た ${dShort(c['型が出た日'])} → 注文中` : (c['絞り込み'] && c['絞り込み'] !== '可') ? c['絞り込み'] : `仮判定 ${j.map((x) => x || '・').join('')}`;
      return `<a class="row" href="#cand/${i}"><div class="r1">${stock(c)}${pill(st)}</div><div class="r2">${E(c['区分'])}　${E(dShort(c['日付']))}　${E(r2)}</div><span class="chev">›</span></a>`; }).join('')}</div>`;
  }
  function scenePre(st, od) {
    const skip = skipCards(od, st);
    return `<section>${sh('SBIに出す注文')}${orderCards(od, st) || '<p class="empty">注文なし</p>'}</section>
${skip ? `<section>${sh('今日は出さない注文')}${skip}</section>` : ''}
<section>${sh('保有中の損切り', '置いてあれば何もしない')}${od.hold.length ? `<div class="rows">${od.hold.map((h) => `<div class="row"><div class="r1">${stock(h.t)}</div><div class="r2">逆指値売り ${yen(h.stopPrice)}円 × ${h.rem}株${h.state === '一部利確' ? '（建値）' : ''}</div></div>`).join('')}</div>` : '<p class="empty">なし</p>'}</section>
${verdict(st, false)}`;
  }
  function sceneNoon(st, od) {
    const go = st.ok ? od.new.filter((o) => !o.expired) : [];
    return `<section>${sh('約定したか', '約定していたら、逆指値売りを置いてAIに伝える')}${go.length ? `<div class="rows">${go.map((o) => `<div class="row"><div class="r1">${stock(o.t)}</div><div class="r2">${E(o.buy.kind)} ${yen(o.buy.price)}円 × ${o.buy.qty}株　→ 約定したら 逆指値売り ${yen(o.stop.price)}円 × ${o.stop.qty}株</div></div>`).join('')}</div>` : '<p class="empty">今日は何もしない</p>'}</section>`;
  }
  function scenePost(st, od) {
    const wait = data['候補'].filter(waiting).sort(byBlanks);
    const names = (l) => l.map((x) => x.t['銘柄名']).join('、');
    const items = [];
    if (od.new.length) items.push(`約定したか：${names(od.new)}（約定日・価格・株数）`);
    if (od.hold.length) items.push(`売れたか、一覧と違う注文を出したか：${names(od.hold)}`);
    const skip = skipCards(od, st);
    return `<section>${sh('AIに答えること')}${items.length ? `<ol class="ask">${items.map((x) => `<li>${E(x)}</li>`).join('')}</ol>` : '<p class="empty">なし</p>'}</section>
<section>${sh('明日の注文')}${verdict(st, true)}${orderCards(od, st) || (skip ? '' : '<p class="empty">注文なし</p>')}${skip}</section>
<section>${sh(`保有中 ${od.hold.length}`)}${holdCards(od, true)}</section>
<section>${sh(`確認待ちの候補 ${wait.length}`, '根拠を読んで「確認した」を付ける')}${candRows(wait)}</section>`;
  }
  function sceneWeek(st, od, today) {
    const C = data['候補'], week = new Date(new Date(today).getTime() - 6 * 86400000).toISOString().slice(0, 10);
    const wait = C.filter(waiting).sort(byBlanks), watch = C.filter((c) => candState(c) === 'ウォッチ中');
    const added = C.filter((c) => c['日付'] >= week && c['絞り込み'] === '可'), dropped = C.filter((c) => c['日付'] >= week && c['絞り込み'] && c['絞り込み'] !== '可');
    const ipo = added.filter((c) => c['区分'] === 'IPO').length;
    const closed = data['取引'].filter((t) => cstate(t) === '決済済み' && Calc.closeDate(t) >= week);
    return `<section>${sh(`確認待ち ${wait.length}`, '根拠を読んで「確認した」を付ける')}${candRows(wait)}</section>
<section>${sh(`ウォッチ中 ${watch.length}`, '型が出るのを待つ。スクリーナーから外れたら見送り')}${candRows(watch)}</section>
<section>${sh('今週の決済')}${closed.length ? `<div class="rows">${closed.map((t) => tradeRow(t)).join('')}</div>` : '<p class="empty">なし</p>'}</section>
<section>${sh('今週のスクリーニング')}<div class="rows"><div class="row"><div class="r1"><b>候補に入った ${added.length}</b></div><div class="r2">IPO ${ipo}・通常 ${added.length - ipo}${dropped.length ? `　外れて見送り ${dropped.length}` : ''}</div></div><a class="row" href="#rule/1"><div class="r1"><b>条件</b></div><div class="r2">1 スクリーニング</div><span class="chev">›</span></a></div></section>`;
  }
  function sceneMonth(st, od, today) {
    const pre = data['前提'], ym = today.slice(0, 7);
    const closed = data['取引'].filter((t) => cstate(t) === '決済済み' && (Calc.closeDate(t) || '').startsWith(ym));
    const wins = closed.filter((t) => Calc.pl(t) >= 0).length;
    const rs = closed.map(Calc.rValue);
    const avgR = rs.length ? (rs.reduce((a, b) => a + b, 0) / rs.length).toFixed(2) : '—';
    const sm = Calc.summary(data);
    const tbl = (key, title, qn) => `<h3>${title}</h3><div class="rows">${sm[key].filter((x) => x.state !== '不採用').map((x) => `<a class="row" href="#rule/${qn}/${encodeURIComponent(x.name)}"><div class="r1"><b>${E(x.name)}</b>${pill(x.state)}${x.ready ? pill('判断できる') : ''}</div><div class="r2">${x.n}件${x.n ? `　勝率 ${x.winPct}%　平均R ${x.rAvg}` : ''}${x.ready ? '' : `　あと${x.minN - x.n}件で判断`}</div><span class="chev">›</span></a>`).join('')}</div>`;
    return `<section>${sh('月初資金')}<dl class="facts"><div><dt>月初資金（1Rの基準）</dt><dd>${yen(pre['月初資金'])}円</dd></div><div><dt>いまの資金</dt><dd>${yen(st.cash)}円</dd></div></dl>
${pre['月初資金'] !== st.cash ? `<div class="btns"><button class="b" data-act="set-monthly" data-v="${st.cash}">月初資金をいまの資金にする</button></div>` : ''}</section>
<section>${sh(`${Number(ym.slice(5))}月の決済 ${closed.length}件`, closed.length ? `勝率 ${Math.round(wins / closed.length * 100)}%　平均R ${avgR}` : '')}${closed.length ? `<div class="rows">${closed.map((t) => tradeRow(t)).join('')}</div>` : '<p class="empty">なし</p>'}</section>
<section>${sh('戦略ごとの成績', '全期間。行を開くと採用を入れ替えられる')}${tbl('型', 'エントリー', 3)}${tbl('利確', '利益確定', 6)}${tbl('期限', '保有期限', 7)}</section>
<section>${sh('見直しの前に')}<div class="rows"><a class="row" href="#rules"><div class="r1"><b>原則を読む</b></div><div class="r2">今月、反した場面がなかったか</div><span class="chev">›</span></a></div></section>`;
  }
  function changesHtml(list, n) {
    if (!list.length) return `<p class="empty">${isLocal() ? 'ローカル表示では見られない' : 'なし'}</p>`;
    let last = '';
    return `<div class="rows">${list.slice(0, n || list.length).map((c) => { const d = new Date(c.date), day = `${d.getMonth() + 1}/${d.getDate()}`, head = day !== last ? `<div class="row dh"><div class="r1"><b>${day}（${WD[d.getDay()]}）</b></div></div>` : ''; last = day;
      return head + `<div class="row"><div class="r1">${E(c.text)}</div><div class="r2">${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}　${E(c.who === 'Claude' ? 'AI' : c.who)}</div></div>`; }).join('')}</div>`;
  }
  function viewChanges() {
    return shell(`<h1>更新の記録</h1><section><div id="changes-box"><p class="empty">読み込み中</p></div></section>`);
  }

  // ---------- 取引 ----------
  function tradeRow(t) {
    const i = data['取引'].indexOf(t), s = cstate(t), p = Calc.pl(t), r = Calc.rValue(t);
    let r2;
    if (s === '注文中') r2 = `逆指値買い ${yen(t['発注価格'])}円 × ${t['株数'] || 0}株　損切り ${yen(t['損切り価格'])}円`;
    else if (s === '保有中' || s === '一部利確') { const h = Calc.orders(data, todayISO()).hold.find((x) => x.t === t) || {}; r2 = `約定 ${dShort(t['約定日'])} ${yen(t['約定価格'])}円 × ${Calc.remQty(t)}株　損切り ${yen(h.stopPrice != null ? h.stopPrice : t['損切り価格'])}円　期限 ${dShort(h.limit)}（あと${h.left}）`; }
    else if (s === '決済済み') r2 = `${dShort(Calc.closeDate(t))} 決済　${p >= 0 ? '+' : ''}${yen(p)}円　${r >= 0 ? '+' : ''}${r.toFixed(2)}R`;
    else r2 = `${E(dShort(t['記録日']))}　${E(t['型'])}`;
    return `<a class="row" href="#trade/${i}"><div class="r1">${stock(t)}${pill(s)}</div><div class="r2">${E(t['区分'])}　${r2}</div><span class="chev">›</span></a>`;
  }
  function viewTrades() {
    const T = data['取引'];
    const by = (f) => T.filter((t) => f(cstate(t)));
    const waitingT = by((s) => s === '注文中'), held = by((s) => s === '保有中' || s === '一部利確'), closed = by((s) => s === '決済済み').sort((a, b) => (Calc.closeDate(a) < Calc.closeDate(b) ? 1 : -1)), other = by((s) => s === '取消' || s === '');
    const cands = data['候補'];
    const live = cands.filter((c) => ['仮判定中', '確認待ち', 'ウォッチ中', '型が出た'].includes(candState(c))).sort((a, b) => ['型が出た', 'ウォッチ中', '確認待ち', '仮判定中'].indexOf(candState(a)) - ['型が出た', 'ウォッチ中', '確認待ち', '仮判定中'].indexOf(candState(b))), dropped = cands.filter((c) => candState(c) === '見送り');
    const sec = (title, list, add) => `<section><div class="bar">${sh(title)}${add ? `<a class="b" href="${add}">追加</a>` : ''}</div>${list.length ? `<div class="rows">${list.map(tradeRow).join('')}</div>` : '<p class="empty">なし</p>'}</section>`;
    return shell(`<h1>取引</h1>${sec(`注文中 ${waitingT.length}`, waitingT, '#trade/new')}${sec(`保有中 ${held.length}`, held)}
<section><div class="bar">${sh(`候補銘柄 ${live.length}`)}<a class="b" href="#cand/new">追加</a></div>${candRows(live)}${dropped.length ? `<details class="fold"><summary>見送り ${dropped.length}</summary>${candRows(dropped)}</details>` : ''}</section>
${sec(`決済済み ${closed.length}`, closed)}${other.length ? sec('取消', other) : ''}`);
  }
  const blankTrade = () => ({ id: Math.max(0, ...data['取引'].map((t) => t.id)) + 1, 'コード': '', '銘柄名': '', '区分': '通常', '型': '', '利確': '', '注文': '', '期限': '', '追加': '', '記録日': todayISO(), '基準価格': null, '損切り価格': null, '発注価格': null, '株数': null, '約定日': null, '約定価格': null, '約定株数': null, 'イベント日': null, 'イベント種別': null, '売り': [], '状態': '', '人の判定': '', 'AIの判定': '', 'メモ': '' });
  function viewTrade(key) {
    const i = key === 'new' ? -1 : Number(key);
    const t = i >= 0 ? data['取引'][i] : blankTrade();
    if (!t) return viewTrades();
    const s = i >= 0 ? cstate(t) : '', holding = s === '保有中' || s === '一部利確';
    const grp = (title, open, body, sum) => `<details class="grp" ${open ? 'open' : ''}><summary>${title}${sum ? `<span class="sum">${E(sum)}</span>` : ''}</summary><div class="form cols">${body}</div></details>`;
    const sell = (k) => { const x = (t['売り'] || [])[k] || {}; return `<div class="span"><div class="f"><span>${k + 1}回目</span></div><div class="form three">${fld('日付', `s${k}d`, x['日付'], { type: 'date' })}${fld('価格', `s${k}p`, x['価格'], { type: 'number' })}${fld('株数', `s${k}q`, x['株数'], { type: 'number' })}</div></div>`; };
    const calcBox = edit && edit.calc ? `<div class="calc ${edit.calc.ok ? '' : 'ng'}">発注価格 ${yen(edit.calc.entry)}円、損切り幅 ${edit.calc.widthPct}%、1R ${yen(edit.calc.oneR)}円 → <b>${edit.calc.qty}株</b>（投入 ${yen(edit.calc.amount)}円、損切りで −${yen(edit.calc.risk)}円、全損切り時 ${edit.calc.totalRiskPct}%）${edit.calc.ok ? '　新規買い 可' : '　新規買い 不可：' + edit.calc.reasons.join('、')}</div>` : '';
    const rule = (k) => fld(TKEY[k], k, t[k], { type: 'select', options: [''].concat(slist(TQ[k])) });
    const ruleSum = ['型', '注文', '利確', '期限'].map((k) => t[k]).filter(Boolean).join('・');
    const q4 = Calc.nums(data['問い'], 4, t['区分']);
    const h = holding ? (Calc.orders(data, todayISO()).hold.find((x) => x.t === t) || {}) : {};
    const evSel = `<label class="f"><span>イベント</span><select name="イベント種別">${[['', '—'], ['決算', '決算発表'], ['解除', 'ロックアップ解除']].map(([v, l]) => `<option value="${v}" ${(t['イベント種別'] || '') === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>`;
    return shell(`<h1>${i >= 0 ? E(t['銘柄名'] || '取引') : '取引を追加'}${s ? ' ' + pill(s) : ''}</h1>
<form id="f-trade" data-i="${i}">
${grp('銘柄', !s, fld('コード', 'コード', t['コード']) + fld('銘柄名', '銘柄名', t['銘柄名']) + fld('区分', '区分', t['区分'], { type: 'select', options: ['通常', 'IPO'] }), s ? `${t['コード']} ${t['銘柄名']}　${t['区分']}` : '')}
${grp('使うルール', !s, ['型', '注文', '利確', '期限'].map(rule).join(''), s ? ruleSum : '')}
${grp('発注', !s || s === '注文中', fld('型が出た日', '記録日', t['記録日'], { type: 'date' }) + fld('基準価格', '基準価格', t['基準価格'], { type: 'number' }) + fld('損切り価格', '損切り価格', t['損切り価格'], { type: 'number' }) + fld('発注価格', '発注価格', t['発注価格'], { type: 'number', ph: `空欄なら 基準価格 +${q4['乖離_pct'] || 1}%` }) + fld('株数', '株数', t['株数'], { type: 'number' }) + `<div class="btns span"><button class="b" data-act="calc-trade" type="button">発注価格と株数を計算</button></div>${calcBox ? `<div class="span">${calcBox}</div>` : ''}` + (s === '注文中' || s === '取消' ? `<label class="chk span"><input type="checkbox" name="取消" ${t['状態'] === '取消' ? 'checked' : ''}> この注文を取消にする</label>` : ''), s && s !== '注文中' ? `${dShort(t['記録日'])}　${yen(t['発注価格'])}円 × ${t['株数']}株　損切り ${yen(t['損切り価格'])}円` : '')}
${grp('約定', s === '注文中', fld('約定日', '約定日', t['約定日'], { type: 'date' }) + fld('約定価格', '約定価格', t['約定価格'], { type: 'number' }) + fld('約定株数', '約定株数', t['約定株数'], { type: 'number' }), holding || s === '決済済み' ? `${dShort(t['約定日'])}　${yen(t['約定価格'])}円 × ${t['約定株数']}株` : '')}
${grp('期限', holding, `<div class="f"><span>期限日</span><div class="ro">${h.limit ? `${E(dShort(h.limit))}（あと${h.left}営業日）` : '—'}</div></div>` + fld('イベント日', 'イベント日', t['イベント日'], { type: 'date' }) + evSel)}
${grp('売り', holding, sell(0) + sell(1))}
${grp('AIの根拠とメモ', holding || s === '決済済み', fld('AIの根拠', 'AIの判定', t['AIの判定']) + `<label class="f span"><span>メモ</span><textarea name="メモ" rows="2">${E(t['メモ'])}</textarea></label>`)}
<input type="hidden" name="id" value="${t.id}">
<div class="btns"><button class="b primary" data-act="save-trade">保存</button><a class="b quiet" href="#trades">戻る</a>${i >= 0 ? '<button class="b quiet danger" data-act="del-trade" type="button">削除</button>' : ''}</div></form>`);
  }
  const blankCand = () => ({ '日付': todayISO(), 'コード': '', '銘柄名': '', '区分': '通常', '上場日': null, '売買代金_億': null, '時価総額_億': null, '終値': null, '絞り込み': '', '判定': [null, null, null, null], '根拠': ['', '', '', ''], '確認': null, '型が出た日': null, 'メモ': '' });
  function viewCand(key) {
    const i = key === 'new' ? -1 : Number(key);
    const c = i >= 0 ? data['候補'][i] : blankCand();
    if (!c) return viewTrades();
    const isNew = i < 0;
    const labels = candLabels(c); while (labels.length < 4) labels.push('条件' + (labels.length + 1));
    const j = c['判定'] || [], g = c['根拠'] || [];
    const grp = (title, open, body, sum) => `<details class="grp" ${open ? 'open' : ''}><summary>${title}${sum ? `<span class="sum">${E(sum)}</span>` : ''}</summary><div class="form cols">${body}</div></details>`;
    const cond = labels.map((l, k) => `<div class="span cond4"><div class="f"><span>${E(l)}</span><div class="picks">${[['○', '○'], ['×', '×'], ['', '未']].map(([v, lab]) => `<label class="chk"><input type="radio" name="j${k}" value="${v}" ${(j[k] || '') === v ? 'checked' : ''}> ${lab}</label>`).join('')}</div></div><label class="f"><span>根拠</span><textarea name="g${k}" rows="2">${E(g[k] || '')}</textarea></label></div>`).join('');
    const trade = c['型が出た日'] ? data['取引'].find((t) => t['コード'] === c['コード']) : null;
    const typed = c['型が出た日'] ? `<p class="ai">型が出た ${E(dShort(c['型が出た日']))}${trade ? `　<a href="#trade/${data['取引'].indexOf(trade)}">取引 ${E(cstate(trade))}</a>` : ''}</p>` : '';
    return shell(`<h1>${!isNew ? E(c['銘柄名'] || '候補銘柄') + ' ' + pill(candState(c)) : '候補銘柄を追加'}</h1>
<form id="f-cand" data-i="${i}">
${grp('銘柄', isNew, fld('候補に入った日', '日付', c['日付'], { type: 'date' }) + fld('コード', 'コード', c['コード']) + fld('銘柄名', '銘柄名', c['銘柄名']) + fld('区分', '区分', c['区分'], { type: 'select', options: ['通常', 'IPO'] }) + fld('上場日（IPO）', '上場日', c['上場日'], { type: 'date' }), isNew ? '' : `${c['コード']} ${c['銘柄名']}　${c['区分']}${c['上場日'] ? `　上場 ${dShort(c['上場日'])}` : ''}`)}
${grp('スクリーニング', isNew, fld('売買代金（億円）', '売買代金_億', c['売買代金_億'], { type: 'number', step: '0.1' }) + fld('時価総額（億円）', '時価総額_億', c['時価総額_億'], { type: 'number' }) + fld('終値', '終値', c['終値'], { type: 'number' }) + fld('絞り込み', '絞り込み', c['絞り込み'], { ph: '空欄なら自動' }), isNew ? '' : `${dShort(c['日付'])}　${c['絞り込み'] || '—'}　売買代金 ${c['売買代金_億'] != null ? c['売買代金_億'] + '億' : '—'}・時価総額 ${c['時価総額_億'] != null ? c['時価総額_億'] + '億' : '—'}・終値 ${yen(c['終値']) || '—'}`)}
${grp('4条件<small>AIの仮判定。直してよい</small>', true, cond + `<label class="chk span"><input type="checkbox" name="確認" ${c['確認'] ? 'checked' : ''}> 根拠を読んで確認した${c['確認'] ? `　${E(dShort(c['確認']))}` : ''}</label>`)}
<input type="hidden" name="型が出た日" value="${E(c['型が出た日'] || '')}">${typed}
<label class="f"><span>メモ</span><textarea name="メモ" rows="2">${E(c['メモ'])}</textarea></label>
<div class="btns"><button class="b primary" data-act="save-cand">保存</button><a class="b quiet" href="#trades">戻る</a>${i >= 0 ? '<button class="b quiet danger" data-act="del-cand" type="button">削除</button>' : ''}</div></form>`);
  }
  function screen(c) {
    const st = Calc.adopted(data['問い'], 1, c['区分']) || {};
    const days = c['上場日'] && c['日付'] ? Math.floor((new Date(c['日付']) - new Date(c['上場日'])) / 86400000) : 99999;
    const vals = { '時価総額': c['時価総額_億'], '平均売買代金（10日）': c['売買代金_億'], '平均売買代金（30日）': c['売買代金_億'], '当日売買代金': c['売買代金_億'], '上場からの日数': days, '株価': c['終値'] };
    for (const k of st['スクリーナー条件'] || []) {
      const v = vals[k['項目']];
      if (v == null || v === '') continue;
      if (!(k['比較'] === '以上' ? v >= k['値'] : v <= k['値'])) return '不可：' + k['項目'];
    }
    return '可';
  }

  // ---------- ルール ----------
  function viewRules() {
    const pr = data['原則'], pre = data['前提'];
    const q12 = Calc.nums(data['問い'], 12);
    const list = data['問い'].map((q) => `<a class="row" href="#rule/${q.num}"><div class="r1"><span class="n">${q.num}</span><b>${E(q.name)}</b></div><div class="r2">${E(adoptedText(q))}</div><span class="chev">›</span></a>`).join('');
    const pEdit = edit && edit.type === 'principle';
    const principles = pr.map((p, i) => pEdit && edit.idx === i ? principleForm(p, i)
      : `<div class="principle"><span class="n">${p.id}</span><div><b>${E(p.title)}</b>${E(p.text)}<div class="src">${E(p['出典'])}</div>${pEdit ? `<div class="btns"><button class="b quiet" data-act="edit-principle" data-i="${i}">編集</button></div>` : ''}</div></div>`).join('');
    const preForm = edit && edit.type === 'premise' ? `<form id="f-premise" class="form cols">${fld('初期資金（円）', '初期資金', pre['初期資金'], { type: 'number' })}${fld('月初資金（円）', '月初資金', pre['月初資金'], { type: 'number' })}${fld('停止残高（円）', '停止残高', pre['停止残高'], { type: 'number' })}${fld('単元（株）', '単元', pre['単元'], { type: 'number' })}${fld('証券会社', '証券会社', pre['証券会社'])}<label class="f span"><span>東証の休業日（1行1日）</span><textarea name="休日" rows="6">${E(pre['休日'].join('\n'))}</textarea></label><div class="btns span"><button class="b primary" data-act="save-premise">保存</button><button class="b quiet" data-act="cancel" type="button">取消</button></div></form>`
      : `<dl class="facts"><div><dt>初期資金</dt><dd>${yen(pre['初期資金'])}円</dd></div><div><dt>月初資金（1Rの基準）</dt><dd>${yen(pre['月初資金'])}円</dd></div><div><dt>停止残高</dt><dd>${yen(pre['停止残高'])}円</dd></div><div><dt>単元</dt><dd>${pre['単元']}株</dd></div><div><dt>証券会社</dt><dd>${E(pre['証券会社'])}</dd></div><div><dt>休業日</dt><dd>${pre['休日'].length}日</dd></div></dl><div class="btns"><button class="b quiet" data-act="edit-premise">編集</button></div>`;
    const hist = data['改定履歴'].slice().reverse();
    const hForm = edit && edit.type === 'hist' ? `<form id="f-hist" class="form cols">${fld('日付', '日付', todayISO(), { type: 'date' })}${fld('項目（番号）', '問い', '')}${fld('戦略', '戦略', '')}${fld('変更', '変更', '数値変更', { type: 'select', options: ['追加', '採用', '代替案', '不採用', '数値変更', '条件変更', '文言変更', '削除'] })}${fld('変更前', '変更前', '')}${fld('変更後', '変更後', '')}${fld('根拠の件数', '件数', 0, { type: 'number' })}<label class="f span"><span>理由</span><input name="理由"></label><div class="btns span"><button class="b primary" data-act="save-hist">保存</button><button class="b quiet" data-act="cancel" type="button">取消</button></div></form>` : '';
    return shell(`<h1>ルール</h1>
<section>${sh('13項目', '採用している戦略')}<div class="rows">${list}</div></section>
<section><div class="bar"><h2>原則</h2>${pEdit ? '<button class="b quiet" data-act="cancel">閉じる</button>' : '<button class="b quiet" data-act="edit-principles">編集</button>'}</div>${principles}</section>
<section><h2>前提</h2>${preForm}</section>
<section><details class="fold"><summary>ルールの改定 ${hist.length}</summary>${hist.length ? `<div class="rows">${hist.map(histRow).join('')}</div>` : '<p class="empty">なし</p>'}</details></section>`);
  }
  function histRow(h) {
    let chg = E(h['変更']);
    if (h['変更'] === '数値変更') { try { const a = JSON.parse(h['変更前'] || '{}'), b = JSON.parse(h['変更後'] || '{}'); const diff = Object.keys(Object.assign({}, a, b)).filter((k) => a[k] !== b[k]).map((k) => `${keyLabel(k)} ${a[k] == null ? '—' : a[k]} → ${b[k] == null ? '—' : b[k]}`); if (diff.length) chg = E(diff.join('、')); } catch (e) { chg = E(`${h['変更前']} → ${h['変更後']}`); } }
    else if (h['変更前'] && h['変更後']) chg = E(`${h['変更前']} → ${h['変更後']}`);
    const q = Q(h['問い']);
    const kind = chg !== E(h['変更']) ? pill(h['変更']) + ' ' : '';
    return `<div class="row"><div class="r1"><b>${q ? E(q.num + ' ' + q.name) : E(h['問い'])}${h['戦略'] && h['戦略'] !== h['問い'] ? '　' + E(h['戦略']) : ''}</b></div><div class="r2">${E(dShort(h['日付']))}　${kind}${chg}${h['理由'] ? `　${E(h['理由'])}` : ''}${h['件数'] ? `　${h['件数']}件` : ''}</div></div>`;
  }
  const principleForm = (p, i) => `<form id="f-principle" class="form" data-i="${i}">${fld('番号', 'id', p.id, { type: 'number' })}${fld('見出し', 'title', p.title)}${fld('本文', 'text', p.text, { type: 'textarea', rows: 2 })}${fld('出典', '出典', p['出典'])}<div class="btns"><button class="b primary" data-act="save-principle">保存</button><button class="b quiet" data-act="cancel" type="button">取消</button><button class="b quiet danger" data-act="del-principle" type="button">削除</button></div></form>`;

  const COND_SUB = { 1: '全部満たした銘柄が候補になる', 2: '全部○なら買ってよい', 3: '全部そろった日に買う', 4: 'この形で注文する', 5: 'この式で株数を決める', 6: 'この手順で売る', 7: 'どれか1つに当たれば手仕舞う', 8: 'この決まりで扱う', 9: '全部守れている時だけ新規買い', 10: 'どれか1つに当たれば新規買いを止める', 11: '当たった段階まで縮める', 12: 'この手順で見直す', 13: 'いつ何をするか' };
  const STATE_DESC = { '採用': 'いま使っている', '代替案': '月次の見直しで採用と比べる控え。2つまで', '不採用': '記録として残す' };
  // 数値欄の各キーを、どの計算・作業が読むか（フォームの札）
  const USE = { '候補上限_件': 'スクリーナー', '損切り幅下限_pct': '型の判定', '損切り幅上限_pct': '型の判定', '乖離_pct': '発注価格', '取消_営業日': '注文の期限', '追わない上限_pct': 'AIの判定', '1R_pct': '株数', '1R上限_pct': '株数', '1銘柄上限_pct': '株数', '利確水準_R': '利確の注文', '利確割合_pct': '利確の注文', 'トレーリング': '利確の注文', '最大保有_営業日': '期限', '解除前_営業日': '期限', '決算前_営業日': '期限', '再エントリー_営業日': 'AIの判定', '同時保有上限': '新規買いの関門', '現金下限_pct': '新規買いの関門', '合計リスク上限_pct': '新規買いの関門', '同セクター上限': '新規買いの関門', '移動平均_日': '地合い', '先物夜間_pct': '地合い', '損切り直後ロット_pct': 'ロットと停止', '連敗停止': 'ロットと停止', '停止_営業日': 'ロットと停止', '段階1_pct': 'ロットと停止', '段階1ロット_pct': 'ロットと停止', '段階2_pct': 'ロットと停止', '段階3_pct': 'ロットと停止', '周期_月': '月次の見直し', '最小件数': '月次の見直し', '不採用判断': '月次の見直し', '改定後慎重': '月次の見直し' };
  const UNIT = [['_pct', '%'], ['_億', '億円'], ['_営業日', '営業日'], ['_日', '日'], ['_R', 'R'], ['_月', 'か月'], ['_件', '件']];
  const numText = (k, v) => { const u = UNIT.find(([x]) => k.endsWith(x)); return `<b>${E(u ? k.slice(0, -u[0].length) : k)}</b> ${E(v)}${u && !isNaN(Number(v)) ? E(u[1]) : ''}`; };
  // 文章の {キー} に数値欄の値を入れる。数字は数値欄にだけ置く決まり
  const fill = (t, s) => String(t || '').replace(/\{([^{}]+)\}/g, (m, k) => { const v = (s['数値欄'] || {})[k]; return v == null || v === '' ? '—' : String(v); });
  const previewHtml = (ls, nums) => `<span>表示</span><ul>${ls.map((x) => `<li>${E(fill(x, { '数値欄': nums }))}</li>`).join('')}</ul>`;
  const previewFromForm = (f) => { const v = fd(f), nums = {}; (Q(f.dataset.q)['数値欄のキー'] || []).forEach((k) => { nums[k] = v['n:' + k]; }); return previewHtml(lines(v['当てはまる条件']), nums); };
  // 採用の枠：区分ごとに1つ。calc と同じ選び方で出すので、画面とAIの見方がずれない
  const adoptRows = (q) => {
    const ad = q['戦略'].filter((s) => s['状態'] === '採用');
    const kinds = ad.some((s) => s['区分'] !== '共通') ? ['IPO', '通常'] : ['共通'];
    return kinds.map((k) => { const s = Calc.adopted(data['問い'], q.num, k === '共通' ? undefined : k); const borrowed = s && k !== '共通' && s['区分'] !== k && s['区分'] !== '共通';
      return `<div class="arow"><span class="ak">${E(k)}</span>${s ? `<b>${E(s.name)}</b>${borrowed ? `<span class="pill pill-warn">${E(s['区分'])}の採用を流用</span>` : ''}` : '<span class="pill pill-ng">なし</span>'}</div>`; }).join('');
  };
  function viewRule(num) {
    const q = Q(num); if (!q) return viewRules();
    const sel = `<select class="qsel">${data['問い'].map((x) => `<option value="${x.num}" ${x.num === q.num ? 'selected' : ''}>${x.num} ${E(x.name)}</option>`).join('')}</select>`;
    const def = q['定義'];
    const defs = `<details class="fold"><summary>この項目で決めること</summary><dl class="def"><dt>決めること</dt><dd>${E(def['決めること'])}</dd><dt>決めないこと</dt><dd>${E(def['決めないこと'])}</dd><dt>選び方</dt><dd>${E(def['選び方'])}</dd></dl></details>`;
    const editing = (i) => edit && edit.type === 'strategy' && edit.q === q.num && edit.idx === i;
    const card = (s, i, state) => editing(i) ? strategyForm(q, s, i) : state === '採用' ? strategyCard(q, s, i)
      : `<details class="fold strat-fold" id="s-${E(s.name)}"><summary>${E(s.name)}${s['区分'] !== '共通' ? ` <span class="pill">${E(s['区分'])}</span>` : ''}<span class="sum">${E(fill(s['一言で'], s))}</span></summary>${strategyCard(q, s, i)}</details>`;
    const section = (state) => {
      const g = q['戦略'].map((s, i) => [s, i]).filter(([s]) => s['状態'] === state);
      if (!g.length && state === '不採用') return '';
      const addBtn = state === '代替案' ? (editing(-1) ? strategyForm(q, blankStrategy(q), -1) : `<div class="btns"><button class="b" data-act="edit-strategy" data-q="${q.num}" data-i="-1">戦略を追加</button></div>`) : '';
      return `<section><h2 class="sh">${E(state)}<small>${E(STATE_DESC[state])}</small></h2>${state === '採用' ? `<div class="adoptbox">${adoptRows(q)}</div>` : ''}${g.length ? g.map(([s, i]) => card(s, i, state)).join('') : '<p class="empty">なし</p>'}${addBtn}</section>`;
    };
    return shell(`<h1 class="qh">${sel}</h1><p class="lead">${E(q.question)}</p>${defs}${section('採用')}${section('代替案')}${section('不採用')}`);
  }
  const blankStrategy = (q) => ({ name: '', '状態': '代替案', '改定日': todayISO(), '区分': '共通', '一言で': '', '当てはまる条件': [], 'しないこと': [], '出典': '', '数値欄': Object.fromEntries((q['数値欄のキー'] || []).map((k) => [k, null])) });
  function strategyCard(q, s, i) {
    const li = (a) => (a || []).map((x) => `<li>${E(fill(x, s))}</li>`).join('');
    const nums = Object.entries(s['数値欄'] || {}).filter(([k, v]) => v != null && v !== '').map(([k, v]) => `<span>${numText(k, v)}</span>`).join('');
    const st = s['状態'], a = (act, label, cls) => `<button class="b ${cls || ''}" data-act="${act}" data-q="${q.num}" data-i="${i}">${label}</button>`;
    const acts = [a('edit-strategy', '編集', 'quiet')];
    if (st === '代替案') acts.push(a('adopt', '採用にする'), a('retire', '不採用にする', 'quiet'));
    if (st === '不採用') acts.push(a('restore', '代替案に戻す'));
    return `<article class="strat ${st === '不採用' ? 'off' : ''}" id="s-${E(s.name)}"><header><h3>${E(s.name)}</h3>${s['区分'] !== '共通' ? `<span class="pill">${E(s['区分'])}</span>` : ''}</header>
<p class="one">${E(fill(s['一言で'], s))}</p>
<h4>当てはまる条件<small>${E(COND_SUB[q.num] || '')}</small></h4><ul>${li(s['当てはまる条件'])}</ul>${nums ? `<div class="k">${nums}</div>` : ''}
<h4>しないこと</h4>${(s['しないこと'] || []).length ? `<ul class="ng">${li(s['しないこと'])}</ul>` : '<p class="empty">なし</p>'}
<p class="rev">${s['出典'] ? `出典　${linkify(s['出典'])}　` : ''}改定 ${E(s['改定日'])}</p>
<div class="btns">${acts.join('')}</div></article>`;
  }
  function strategyForm(q, s0, i) {
    // 条件の行を足し引きして描き直した時に、入力途中の文字を失わないよう、下書き（edit.draft）を優先する
    const d = (edit && edit.draft) || {}, s = Object.assign({}, s0, Object.fromEntries(['name', '区分', '一言で', '出典'].filter((k) => d[k] !== undefined).map((k) => [k, d[k]]))); if (d['しないこと'] !== undefined) s['しないこと'] = lines(d['しないこと']); if (d['当てはまる条件'] !== undefined) s['当てはまる条件'] = lines(d['当てはまる条件']);
    const numv = (k) => { const v = d['n:' + k] !== undefined ? d['n:' + k] : (s['数値欄'] ? s['数値欄'][k] : ''); return v == null ? '' : v; };
    const nums = Object.fromEntries((q['数値欄のキー'] || []).map((k) => [k, numv(k)]));
    const numf = (q['数値欄のキー'] || []).map((k) => `<label class="f"><span>${E(keyLabel(k))}${USE[k] ? `<span class="pill">${E(USE[k])}</span>` : ''}</span><input name="n:${E(k)}" value="${E(numv(k))}" inputmode="decimal">${q.num !== 1 ? `<button type="button" class="key" data-act="ins-key" data-k="${E(k)}">{${E(k)}}</button>` : ''}</label>`).join('');
    const kub = ['共通', 'IPO', '通常'].map((v) => `<label class="chk"><input type="radio" name="区分" value="${v}" ${s['区分'] === v ? 'checked' : ''}> ${v}</label>`).join('');
    const condField = q.num === 1 ? condBuilder(edit && edit.cond ? edit.cond : (s['スクリーナー条件'] || []))
      : `<label class="f"><span>当てはまる条件<small>${E(COND_SUB[q.num] || '')}</small></span><textarea name="当てはまる条件" rows="5" placeholder="1行に1つ">${E(text(s['当てはまる条件']))}</textarea></label><div class="preview" id="cond-preview">${previewHtml(s['当てはまる条件'] || [], nums)}</div>`;
    return `<form id="f-strategy" class="strat form editing" data-q="${q.num}" data-i="${i}"><h3>${i >= 0 ? E(s0.name) + ' を編集' : '戦略を追加'}</h3>
${fld('戦略名', 'name', s.name)}<div class="f"><span>区分</span><div class="picks">${kub}</div></div>${fld('一言で', '一言で', s['一言で'])}
${condField}
${numf ? `<h4>数値</h4><div class="form cols">${numf}</div>` : ''}
<label class="f"><span>しないこと</span><textarea name="しないこと" rows="4" placeholder="1行に1つ">${E(text(s['しないこと']))}</textarea></label>
<label class="f"><span>出典</span><textarea name="出典" rows="2" placeholder="テスタ スイング2、docs/basics/04">${E(s['出典'])}</textarea></label>
${fld('改定の理由（改定履歴に残る）', 'reason', d.reason || '')}
<div class="btns"><button class="b primary" data-act="save-strategy">保存</button><button class="b quiet" data-act="cancel" type="button">取消</button>${i >= 0 ? '<button class="b quiet danger" data-act="del-strategy" type="button">削除</button>' : ''}</div></form>`;
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
    if (r[0] === 'trades') html = viewTrades();
    else if (r[0] === 'trade') html = viewTrade(r[1] || 'new');
    else if (r[0] === 'cand') html = viewCand(r[1] || 'new');
    else if (r[0] === 'rules') html = viewRules();
    else if (r[0] === 'rule') html = viewRule(r[1]);
    else if (r[0] === 'docs') html = viewDocs(r.slice(1).join('/'));
    else if (r[0] === 'changes') html = viewChanges();
    else if (r[0] === 'settings') html = viewSettings();
    else html = viewToday();
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
  app.addEventListener('input', (e) => {
    const f = e.target.closest && e.target.closest('#f-strategy'); if (!f) return;
    const pv = document.getElementById('cond-preview'); if (pv) pv.innerHTML = previewFromForm(f);
  });
  app.addEventListener('change', (e) => {
    if (/^ck\d+$/.test(e.target.name || '')) { const f = document.getElementById('f-strategy'); const rows = readRows(f); const r = Number(e.target.name.slice(2)); rows[r]['値'] = isPick(rows[r]['項目']) ? [] : ''; rows[r]['比較'] = isPick(rows[r]['項目']) ? 'いずれか' : '以上'; edit.cond = rows; edit.draft = fd(f); render(); return; }
    if (e.target.classList.contains('qsel')) location.hash = '#rule/' + e.target.value;
    if (e.target.classList.contains('dsel')) location.hash = e.target.value ? '#docs/' + e.target.value : '#docs';
  });
  app.addEventListener('submit', (e) => e.preventDefault());
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
    if (act === 'add-cond' || act === 'del-cond') {
      const f = document.getElementById('f-strategy'), rows = readRows(f);
      if (act === 'add-cond') rows.push({ '項目': '', '比較': '以上', '値': '' }); else rows.splice(Number(b.dataset.r), 1);
      edit.cond = rows; edit.draft = fd(f); render(); return;
    }
    if (act === 'ins-key') {
      const f = document.getElementById('f-strategy'), ta = f && f.querySelector('textarea[name="当てはまる条件"]'); if (!ta) return;
      const k = '{' + b.dataset.k + '}', focused = document.activeElement === ta, a = focused ? ta.selectionStart : ta.value.length, z = focused ? ta.selectionEnd : a;  // 文章を触っていなければ末尾に足す
      ta.value = ta.value.slice(0, a) + k + ta.value.slice(z); ta.focus(); ta.setSelectionRange(a + k.length, a + k.length);
      const pv = document.getElementById('cond-preview'); if (pv) pv.innerHTML = previewFromForm(f); return;
    }
    if (act === 'edit-hist') { edit = { type: 'hist' }; render(); return; }
    if (act === 'clear-cfg') { cfg.token = ''; localStorage.setItem(KEY, JSON.stringify(cfg)); loaded = false; location.hash = '#settings'; render(); return; }
    e.preventDefault();
    if (act === 'save-cfg') { const v = fd(document.getElementById('f-cfg')); if (v.repo_full) { const [o, r] = v.repo_full.trim().split('/'); v.owner = o; v.repo = r || ''; } delete v.repo_full; Object.assign(cfg, v); localStorage.setItem(KEY, JSON.stringify(cfg)); await boot(); location.hash = '#today'; return; }
    if (act === 'set-monthly') { data['前提']['月初資金'] = Number(b.dataset.v); if (await save('前提', '月初資金を更新')) edit = null; render(); return; }
    if (act === 'save-principle') {
      const f = document.getElementById('f-principle'), v = fd(f), idx = Number(f.dataset.i);
      const p = { id: Number(v.id), title: v.title, text: v.text, '出典': v['出典'] };
      if (idx >= 0) data['原則'][idx] = p; else data['原則'].push(p);
      data['原則'].sort((a, b) => a.id - b.id);
      if (await save('原則', '原則：' + p.title)) edit = null; render(); return;
    }
    if (act === 'del-principle') { if (!confirm('この原則を消す')) return; const idx = Number(document.getElementById('f-principle').dataset.i); const p = data['原則'].splice(idx, 1)[0]; if (await save('原則', '原則を削除：' + p.title)) edit = null; render(); return; }
    if (act === 'save-premise') {
      const v = fd(document.getElementById('f-premise')); const pre = data['前提'];
      ['初期資金', '月初資金', '停止残高', '単元'].forEach((k) => { pre[k] = Number(v[k]); }); pre['証券会社'] = v['証券会社']; pre['休日'] = lines(v['休日']);
      if (await save('前提', '前提を更新')) edit = null; render(); return;
    }
    if (act === 'save-strategy') {
      const f = document.getElementById('f-strategy'), v = fd(f), q = Q(f.dataset.q), idx = Number(f.dataset.i);
      if (!v.name.trim()) { msg = { ng: true, text: '戦略名を入れる' }; showToast(); return; }
      if (!(v['出典'] || '').trim()) { msg = { ng: true, text: '出典を入れる。出典のない戦略は置かない' }; showToast(); return; }
      const old = idx >= 0 ? q['戦略'][idx] : null;
      if (!old && q['戦略'].filter((x) => x['状態'] === '代替案').length >= 2) { msg = { ng: true, text: '代替案は2つまで。先に1つ不採用にする' }; showToast(); return; }
      const s = { name: v.name.trim(), '状態': old ? old['状態'] : '代替案', '改定日': todayISO(), '区分': v['区分'] || '共通', '一言で': v['一言で'], '当てはまる条件': lines(v['当てはまる条件']), 'しないこと': lines(v['しないこと']), '出典': v['出典'], '数値欄': {} };
      (q['数値欄のキー'] || []).forEach((k) => { s['数値欄'][k] = numOrNull(v['n:' + k]); });
      if (s['状態'] === '採用') { const dup = q['戦略'].find((x) => x !== old && x['状態'] === '採用' && (s['区分'] === '共通' || x['区分'] === '共通' || x['区分'] === s['区分'])); if (dup) { msg = { ng: true, text: `${dup.name} が${dup['区分'] === '共通' ? '' : dup['区分'] + 'の'}採用。採用は区分ごとに1つ` }; showToast(); return; } }
      if (q.num === 1) {
        s['スクリーナー条件'] = readCond(f);
        if (s['スクリーナー条件'].some((c) => !catItem(c['項目']))) { msg = { ng: true, text: '項目の一覧に無い条件がある' }; showToast(); return; }
        if (!s['スクリーナー条件'].length) { msg = { ng: true, text: '条件を1つは入れる' }; showToast(); return; }
        s['当てはまる条件'] = genCondLines(s);
      }
      if (old && old.name !== s.name) { data['取引'].forEach((t) => { Object.keys(TKEY).forEach((k) => { if (t[k] === old.name) t[k] = s.name; }); }); }
      if (idx >= 0) q['戦略'][idx] = s; else q['戦略'].push(s);
      const condChanged = q.num === 1 && old && JSON.stringify(old['スクリーナー条件'] || []) !== JSON.stringify(s['スクリーナー条件']);
      const change = !old ? '追加' : condChanged ? '条件変更' : JSON.stringify(old['数値欄']) !== JSON.stringify(s['数値欄']) ? '数値変更' : '文言変更';
      const before = !old ? '' : change === '数値変更' ? JSON.stringify(old['数値欄']) : change === '条件変更' ? (old['スクリーナー条件'] || []).map(condText).join('、') : old['状態'];
      const after_ = change === '数値変更' ? JSON.stringify(s['数値欄']) : change === '条件変更' ? s['スクリーナー条件'].map(condText).join('、') : s['状態'];
      data['改定履歴'].push({ '日付': todayISO(), '問い': String(q.num), '戦略': s.name, '変更': change, '変更前': before, '変更後': after_, '理由': v.reason || '', '件数': data['取引'].filter((t) => cstate(t) === '決済済み' && Object.keys(TKEY).some((k) => t[k] === s.name)).length });
      const ok = await save('問い', `${q.num} ${q.name} ${s.name}：${change}`);
      if (ok) { await save('改定履歴', `改定履歴：${q.num} ${s.name}`); if (old && old.name !== s.name) await save('取引', '戦略名の変更を取引に反映'); edit = null; }
      render(); return;
    }
    if (act === 'adopt' || act === 'retire' || act === 'restore') {
      const q = Q(b.dataset.q), s = q['戦略'][i];
      const hist = (st, x) => data['改定履歴'].push({ '日付': todayISO(), '問い': String(q.num), '戦略': x.name, '変更': st, '変更前': x['状態'], '変更後': st, '理由': '', '件数': data['取引'].filter((t) => cstate(t) === '決済済み' && Object.keys(TKEY).some((k) => t[k] === x.name)).length });
      if (act === 'adopt') {
        const rivals = q['戦略'].filter((x) => x !== s && x['状態'] === '採用' && (s['区分'] === '共通' || x['区分'] === '共通' || x['区分'] === s['区分']));
        const who = s['区分'] === '共通' ? '採用' : s['区分'] + 'の採用', names = rivals.map((x) => x.name).join('・');
        if (!confirm(rivals.length ? `${who}を ${names} → ${s.name} に替える。${names} は代替案になる` : `${s.name} を${who}にする`)) return;
        rivals.forEach((x) => { hist('代替案', x); x['状態'] = '代替案'; x['改定日'] = todayISO(); });
        hist('採用', s); s['状態'] = '採用'; s['改定日'] = todayISO();
        if (await save('問い', `${q.num} ${q.name}：${who}を ${s.name} に`)) await save('改定履歴', '改定履歴：採用の入れ替え');
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
      const used = data['取引'].some((t) => Object.keys(TKEY).some((k) => t[k] === s.name));
      if (used) { msg = { ng: true, text: '取引で使われている戦略は消せない。不採用にする' }; showToast(); return; }
      if (!confirm(`${s.name} を消す`)) return;
      q['戦略'].splice(idx, 1);
      data['改定履歴'].push({ '日付': todayISO(), '問い': String(q.num), '戦略': s.name, '変更': '削除', '変更前': s['状態'], '変更後': '', '理由': '', '件数': 0 });
      if (await save('問い', `${q.num} ${s.name}：削除`)) { await save('改定履歴', '改定履歴：削除'); edit = null; } render(); return;
    }
    if (act === 'calc-trade') {
      const f = document.getElementById('f-trade'), v = fd(f);
      const o = (Calc.byName(data['問い'], 4, v['注文']) || Calc.adopted(data['問い'], 4) || {})['数値欄'] || {};
      const base = Number(v['基準価格']), stop = Number(v['損切り価格']);
      if (!stop || (!base && !v['発注価格'])) { msg = { ng: true, text: '基準価格（か発注価格）と損切り価格を入れる' }; showToast(); return; }
      const entry = v['発注価格'] ? Number(v['発注価格']) : Math.round(base * (1 + (o['乖離_pct'] || 0) / 100));
      edit = edit || {}; edit.calc = Calc.size(data, entry, stop, v['区分'], v['記録日'] || todayISO());
      const draft = v; draft['発注価格'] = entry; draft['株数'] = edit.calc.qty;
      const open = [...f.querySelectorAll('details')].map((d) => d.open);
      render();
      const g = document.getElementById('f-trade');
      [...g.querySelectorAll('details')].forEach((d, k) => { d.open = open[k]; });
      Object.entries(draft).forEach(([k, val]) => { const el = g.elements[k]; if (el && el.type !== 'checkbox') el.value = val == null ? '' : val; });
      if (g.elements['取消']) g.elements['取消'].checked = !!v['取消'];
      return;
    }
    if (act === 'save-trade') {
      const f = document.getElementById('f-trade'), v = fd(f), idx = Number(f.dataset.i), old = idx >= 0 ? data['取引'][idx] : {};
      const t = { id: Number(v.id), 'コード': v['コード'], '銘柄名': v['銘柄名'], '区分': v['区分'], '型': v['型'], '利確': v['利確'], '注文': v['注文'], '期限': v['期限'], '追加': old['追加'] || '',
        '記録日': v['記録日'] || null, '基準価格': numOrNull(v['基準価格']), '損切り価格': numOrNull(v['損切り価格']), '発注価格': numOrNull(v['発注価格']), '株数': numOrNull(v['株数']),
        '約定日': v['約定日'] || null, '約定価格': numOrNull(v['約定価格']), '約定株数': numOrNull(v['約定株数']), 'イベント日': v['イベント日'] || null, 'イベント種別': v['イベント種別'] || null,
        '売り': [0, 1].filter((k) => v['s' + k + 'd']).map((k) => ({ '日付': v['s' + k + 'd'], '価格': Number(v['s' + k + 'p']), '株数': Number(v['s' + k + 'q']) })),
        '状態': '', '人の判定': old['人の判定'] || '', 'AIの判定': v['AIの判定'], 'メモ': v['メモ'] };
      t['状態'] = v['取消'] ? '取消' : cstate(t);
      if (idx >= 0) data['取引'][idx] = t; else data['取引'].push(t);
      if (await save('取引', `取引 ${t.id} ${t['銘柄名']}：${t['状態']}`)) { edit = null; if (idx >= 0 && history.length > 1) history.back(); else location.hash = '#trades'; } else render(); return;
    }
    if (act === 'del-trade') { const f = document.getElementById('f-trade'), idx = Number(f.dataset.i); if (!confirm('この取引を消す')) return; const t = data['取引'].splice(idx, 1)[0]; if (await save('取引', `取引 ${t.id} を削除`)) location.hash = '#trades'; else render(); return; }
    if (act === 'save-cand') {
      const f = document.getElementById('f-cand'), v = fd(f), idx = Number(f.dataset.i);
      const c = { '日付': v['日付'], 'コード': v['コード'], '銘柄名': v['銘柄名'], '区分': v['区分'], '上場日': v['上場日'] || null, '売買代金_億': numOrNull(v['売買代金_億']), '時価総額_億': numOrNull(v['時価総額_億']),
        '終値': numOrNull(v['終値']), '絞り込み': v['絞り込み'], '判定': [0, 1, 2, 3].map((k) => v['j' + k] || null), '根拠': [0, 1, 2, 3].map((k) => (v['g' + k] || '').trim()), '確認': v['確認'] ? ((idx >= 0 && data['候補'][idx]['確認']) || todayISO()) : null, '型が出た日': v['型が出た日'] || null, 'メモ': v['メモ'] };
      if (!c['絞り込み']) c['絞り込み'] = screen(c);
      if (idx >= 0) data['候補'][idx] = c; else data['候補'].push(c);
      if (await save('候補', `候補 ${c['銘柄名']}：${candState(c)}`)) { if (idx >= 0 && history.length > 1) history.back(); else location.hash = '#trades'; } else render(); return;
    }
    if (act === 'del-cand') { const f = document.getElementById('f-cand'), idx = Number(f.dataset.i); if (!confirm('この候補銘柄を消す')) return; const c = data['候補'].splice(idx, 1)[0]; if (await save('候補', `候補 ${c['銘柄名']} を削除`)) location.hash = '#trades'; else render(); return; }
    if (act === 'save-hist') { const v = fd(document.getElementById('f-hist')); data['改定履歴'].push({ '日付': v['日付'], '問い': v['問い'], '戦略': v['戦略'], '変更': v['変更'], '変更前': v['変更前'], '変更後': v['変更後'], '理由': v['理由'], '件数': Number(v['件数'] || 0) }); if (await save('改定履歴', '改定履歴：' + v['戦略'])) edit = null; render(); return; }
  });

  async function boot() {
    try { await loadAll(); render(); }
    catch (e) { loaded = false; app.innerHTML = viewSettings(e.message === 'settings' ? 'GitHubのトークンを入れる' : e.message); }
  }
  boot();
})();
