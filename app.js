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
    ['基礎', [['docs/basics/01_資金管理と期待値.md', '資金管理と期待値'], ['docs/basics/02_チャートの基礎.md', 'チャートの基礎'], ['docs/basics/03_需給の読み方.md', '需給の読み方'], ['docs/basics/04_決算と業績の基礎.md', '決算と業績の基礎'], ['docs/basics/05_相場心理と行動のクセ.md', '相場心理と行動のクセ'], ['docs/basics/06_地合いと指数・イベント暦.md', '地合いと指数・イベント暦'], ['docs/basics/07_兼業の注文実務.md', '兼業の注文実務']]],
    ['IPO', [['docs/00_株取引の基礎.md', '株取引の基礎'], ['docs/01_IPOの全体像.md', 'IPOの全体像'], ['docs/02_公開価格の決まり方.md', '公開価格の決まり方'], ['docs/03_初値の決まり方.md', '初値の決まり方'], ['docs/04_機関投資家とVCの動き.md', '機関投資家とVCの動き'], ['docs/05_初値後の値動き.md', '初値後の値動き'], ['docs/06_情報源の読み方.md', '情報源の読み方']]],
    ['用語', [['docs/07_用語集.md', '用語集']]],
    ['知見者', [['references/テスタ氏X投稿_株式投資の知見まとめ_2016-2026.md', 'テスタ（X投稿 2016–2026）'], ['references/ミネルヴィニ_成長株投資法_知見まとめ.md', 'ミネルヴィニ『成長株投資法』'], ['references/ミネルヴィニ_株式トレード基本と原則_知見まとめ.md', 'ミネルヴィニ『株式トレード 基本と原則』'], ['references/ティアー_バフェットとソロス_知見まとめ.md', 'ティアー『バフェットとソロス 勝利の投資学』']]],
    ['このノートの前提', [['rules/00_前提.md', '前提（兼業・現物・小資金）'], ['rules/04_テスタ知見との対応表.md', 'テスタ知見との対応表'], ['README.md', 'README']]],
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
  const tabOf = (r) => ({ today: 'today', trades: 'trades', trade: 'trades', cand: 'trades', rules: 'rules', rule: 'rules', docs: 'docs', changes: 'today', settings: 'rules' }[r] || 'today');
  const shell = (body) => {
    const cur = tabOf(route()[0]);
    return body + '<nav class="tabs">' + TABS.map(([k, n]) => `<a href="#${k}" class="${cur === k ? 'on' : ''}">${n}</a>`).join('') + '</nav>';
  };
  const pill = (st) => `<span class="pill ${['採用', '保有中', '一部利確', 'ウォッチ中'].includes(st) ? 'pill-ok' : ['不採用', '見送り', '取消'].includes(st) ? 'pill-ng' : ['注文中', '条件未確認'].includes(st) ? 'pill-warn' : ''}">${E(st)}</span>`;
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
  const genCondLines = (st) => (st['スクリーナー条件'] || []).map(condText).concat([`通った銘柄は平均売買代金の大きい順に${(st['数値欄'] || {})['候補上限_件'] || 10}件まで候補に入れる。買ってよいかは問い2、今買うかは問い3で決める`]);
  // 条件の行を読む。選択式の項目はチェックの付いた値の配列、数字の項目は文字のまま（保存時に数にする）
  const readRows = (f) => { const out = []; for (let r = 0; f.querySelector(`[name="ck${r}"]`); r++) { const k = f.querySelector(`[name="ck${r}"]`).value, co = f.querySelector(`[name="co${r}"]`); out.push({ '項目': k, '比較': isPick(k) ? 'いずれか' : (co ? co.value : '以上'), '値': isPick(k) ? Array.from(f.querySelectorAll(`input[name="cv${r}"]:checked`)).map((x) => x.value) : (f.querySelector(`input[name="cv${r}"]`) || {}).value || '' }); } return out; };
  const readCond = (f) => readRows(f).filter((c) => c['項目'] && (Array.isArray(c['値']) ? c['値'].length : c['値'] !== '')).map((c) => (Array.isArray(c['値']) ? c : Object.assign({}, c, { '値': Number(c['値']) })));
  function condBuilder(conds) {
    const rows = conds.length ? conds : [{ '項目': '', '比較': '以上', '値': '' }];
    const opts = (sel) => `<option value="">—</option>` + CAT().map((x) => `<option value="${E(x.key)}" ${x.key === sel ? 'selected' : ''}>${E(x.key)}${x['単位'] ? `（${E(x['単位'])}）` : ''}</option>`).join('');
    const pickBox = (c, r) => { const w = Array.isArray(c['値']) ? c['値'] : (c['値'] ? [c['値']] : []); return `<div class="f span"><span>当てはまるもの（複数可）</span><div class="picks">${(catItem(c['項目'])['選択肢'] || []).map((o) => `<label class="chk"><input type="checkbox" name="cv${r}" value="${E(o)}" ${w.includes(o) ? 'checked' : ''}> ${E(o)}</label>`).join('')}</div></div>`; };
    return `<h4>スクリーナーの条件</h4><p class="note">項目を選び、以上か以下と数字を入れる（市場区分と業種は当てはまるものにチェック）。項目の一覧に無い条件は書けない</p>${rows.map((c, r) => `<div class="form cols cond"><label class="f"><span>項目</span><select name="ck${r}">${opts(c['項目'])}</select></label>${isPick(c['項目']) ? pickBox(c, r) : `<label class="f"><span>以上／以下</span><select name="co${r}"><option ${c['比較'] === '以上' ? 'selected' : ''}>以上</option><option ${c['比較'] === '以下' ? 'selected' : ''}>以下</option></select></label><label class="f"><span>数字${c['項目'] && catItem(c['項目']) && catItem(c['項目'])['単位'] ? `（${E(catItem(c['項目'])['単位'])}）` : ''}</span><input name="cv${r}" type="number" step="any" inputmode="decimal" value="${E(Array.isArray(c['値']) ? '' : c['値'])}"></label>`}<div class="btns"><button type="button" class="b quiet danger" data-act="del-cond" data-r="${r}">この条件を消す</button></div></div>`).join('')}<div class="btns"><button type="button" class="b" data-act="add-cond">条件を足す</button></div>`;
  }
  function candState(c) {
    if (c['絞り込み'] && c['絞り込み'] !== '可') return '見送り';
    const j = c['判定'] || [];
    if (j.some((x) => x === '×')) return '見送り';
    if (j.filter((x) => x === '○').length === 4 && c['確認']) return c['型が出た日'] ? '取引へ' : 'ウォッチ中';
    return '条件未確認';  // AIの仮判定が4つ○でも、人が「確認」を付けるまではウォッチ中にしない
  }
  const waiting = (c) => candState(c) === '条件未確認' && (c['判定'] || []).filter((x) => x === '○').length === 4;
  const candLabels = (c) => ((Calc.adopted(data['問い'], 2, c['区分']) || {})['当てはまる条件'] || []).slice(0, 4).map((x) => x.replace(/（.*$/, ''));
  const cstate = (t) => Calc.state(t);

  // ---------- 今日 ----------
  const SCENES = [['pre', '寄付前'], ['noon', '昼'], ['post', '引け後'], ['week', '週末'], ['month', '月初']];
  function pickScene() {
    const d = new Date(), h = d.getHours() + d.getMinutes() / 60, w = d.getDay();
    if (w === 0 || w === 6) return 'week';
    if (d.getDate() === 1) return 'month';
    if (h < 9) return 'pre'; if (h < 15.5) return 'noon'; return 'post';
  }
  function viewToday() {
    const today = todayISO();
    const st = Calc.status(data, today), od = Calc.orders(data, today);
    const d = new Date(today + 'T00:00:00');
    const want = route()[1];
    const scene = SCENES.some(([k]) => k === want) ? want : pickScene();
    const seg = `<div class="seg">${SCENES.map(([k, n]) => `<a href="#today/${k}" class="${k === scene ? 'on' : ''}">${n}</a>`).join('')}</div>`;
    const body = { pre: scenePre, noon: sceneNoon, post: scenePost, week: sceneWeek, month: sceneMonth }[scene](st, od, today);
    return shell(`<h1>${d.getMonth() + 1}月${d.getDate()}日（${WD[d.getDay()]}）</h1>${seg}${body}
<p class="foot"><a href="#changes">変更の履歴</a>　<a href="#settings">設定</a></p>`);
  }
  function verdict(st) {
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
<dl class="gates">${rows.map(([k, v, ok]) => `<div class="${ok ? '' : 'bad'}"><dt>${k}</dt><dd>${E(v)}</dd></div>`).join('')}</dl>
<p class="v-cash">資金 ${yen(st.cash)}円　ドローダウン ${st.ddPct}%</p></section>`;
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
  function orderCards(od) {
    const items = [];
    od.new.forEach((o) => {
      const t = o.t, note = sizeNote(t);
      items.push(`<article class="ord"><header>${stock(t)}<span class="tag">新規</span></header>
<div class="line">${E(o.buy.kind)} <span class="nw">${cp(o.buy.price)}円 × ${cp(o.buy.qty)}株</span></div>
<div class="line sub">約定したら ${E(o.stop.kind)} <span class="nw">${cp(o.stop.price)}円 × ${cp(o.stop.qty)}株</span></div>
${o.expired ? '<div class="line warn">取消の期限を過ぎている。AIに伝える</div>' : ''}
${note ? `<details><summary>株数の根拠</summary><p>${E(note)}</p></details>` : ''}</article>`);
    });
    od.hold.forEach((h) => h.orders.forEach((x) => items.push(`<article class="ord"><header>${stock(h.t)}<span class="tag hold">保有</span></header>
<div class="line">${E(x.kind)} <span class="nw">${x.price ? cp(x.price) + '円 × ' : ''}${cp(x.qty)}株</span></div><div class="line sub">${E(x.why)}</div></article>`)));
    return items.length ? items.join('') : '<p class="empty">注文なし</p>';
  }
  function holdCards(od, full) {
    if (!od.hold.length) return '<p class="empty">なし</p>';
    return od.hold.map((h) => {
      const t = h.t;
      const p = h.left <= 0 ? '<span class="pill pill-ng">期限</span>' : h.left <= 3 ? `<span class="pill pill-warn">あと${h.left}営業日</span>` : `<span class="pill">あと${h.left}営業日</span>`;
      return `<article class="hold"><header><div>${stock(t)}<span class="sub">${E(t['区分'])}・<a href="#rule/3/${encodeURIComponent(t['型'])}">${E(t['型'])}</a>・<a href="#rule/6/${encodeURIComponent(t['利確'])}">${E(t['利確'])}</a></span></div>${p}</header>
<dl><div><dt>約定 ${E(dShort(t['約定日']))}</dt><dd>${yen(t['約定価格'])}円</dd></div><div><dt>損切り</dt><dd>${yen(t['損切り価格'])}円</dd></div><div><dt>残株数</dt><dd>${h.rem}株</dd></div><div><dt>期限</dt><dd>${E(dShort(h.limit))}</dd></div></dl>
${full ? `<ul class="checks">${h.checks.map((c) => `<li>${E(c)}</li>`).join('')}</ul>${t['AIの判定'] ? `<p class="ai">AIの判定　${E(t['AIの判定'])}</p>` : ''}` : ''}</article>`;
    }).join('');
  }
  function candRows(list, note) {
    if (!list.length) return '<p class="empty">なし</p>';
    return `<div class="rows">${list.map((c) => { const i = data['候補'].indexOf(c); const s = candState(c); const j = (c['判定'] || []);
      return `<a class="row" href="#cand/${i}"><div class="r1">${stock(c)}${pill(s)}</div><div class="r2">${E(c['区分'])}　${E(dShort(c['日付']))}　${s === '条件未確認' ? `仮判定 ${j.map((x) => x || '・').join('')}${waiting(c) ? '　確認待ち' : ''}` : note ? note(c) : ''}</div><span class="chev">›</span></a>`; }).join('')}</div>`;
  }
  function scenePre(st, od) {
    return `${verdict(st)}<section><h2>SBIに出す注文</h2>${orderCards(od)}</section>
<section><h2>保有中の損切り</h2>${od.hold.length ? `<div class="rows">${od.hold.map((h) => `<div class="row"><div class="r1">${stock(h.t)}</div><div class="r2">逆指値売り ${yen(h.t['損切り価格'])}円 × ${h.rem}株（置いてあれば何もしない）</div></div>`).join('')}</div>` : '<p class="empty">なし</p>'}</section>`;
  }
  function sceneNoon(st, od) {
    return `<section><h2>約定を見る銘柄</h2>${od.new.length ? `<div class="rows">${od.new.map((o) => `<div class="row"><div class="r1">${stock(o.t)}</div><div class="r2">${E(o.buy.kind)} ${yen(o.buy.price)}円 × ${o.buy.qty}株</div></div>`).join('')}</div><p class="note">約定していたらAIに伝える（約定日・価格・株数）。逆指値売り ${od.new.map((o) => yen(o.stop.price) + '円').join('、')} を入れる</p>` : '<p class="empty">注文中の銘柄なし</p>'}</section>`;
  }
  function scenePost(st, od) {
    const q10 = Calc.nums(data['問い'], 10);
    const cands = data['候補'];
    const unchecked = cands.filter((c) => candState(c) === '条件未確認'), watch = cands.filter((c) => candState(c) === 'ウォッチ中');
    const names = (l) => l.map((x) => (x.t || x)['銘柄名']).join('、');
    const items = [];
    if (od.new.length) items.push(`約定したか：${names(od.new)}（約定日・価格・株数）`);
    if (od.hold.length) items.push(`売れたか、一覧と違う注文を出したか：${names(od.hold)}`);
    if (unchecked.length) items.push(`AIの仮判定の根拠を読んで、引っかかる所だけ確かめる：${names(unchecked)}`);
    return `${verdict(st)}<section><h2>AIに答えること</h2>${items.length ? `<ol class="ask">${items.map((x) => `<li>${E(x)}</li>`).join('')}</ol>` : '<p class="empty">なし</p>'}<p class="note">地合い（指数の${q10['移動平均_日'] || 25}日線・先物の夜間）、保有中の売り条件、候補の型はAIが調べて記録する</p></section>
<section><h2>保有中 ${od.hold.length}銘柄</h2>${holdCards(od, true)}</section>
<section><h2>候補銘柄 ${unchecked.length + watch.length}</h2>${candRows(unchecked.concat(watch), (c) => 'エントリーの条件が出たか')}</section>
<section><h2>明日の注文</h2><p class="note">AIの引け後の作業が終わると更新される</p>${orderCards(od)}</section>`;
  }
  function sceneWeek(st, od, today) {
    const q1 = Q(1);
    const cond = q1['戦略'].filter((s) => s['状態'] === '採用').map((s) => { const parts = (s['当てはまる条件'] || []).map((x) => x.replace(/（[^（）]*[<>=][^（）]*）/g, '').trim()).filter((x) => !/^通った銘柄/.test(x));
      return `<div class="row"><div class="r1"><b>${E(s['区分'])}</b><span class="code">${E(s.name)}</span></div><div class="r2">${E(parts.join('、'))}</div></div>`; }).join('');
    const watch = data['候補'].filter((c) => candState(c) === 'ウォッチ中'), wait = data['候補'].filter(waiting);
    const week = new Date(new Date(today).getTime() - 6 * 86400000).toISOString().slice(0, 10);
    const closed = data['取引'].filter((t) => cstate(t) === '決済済み' && Calc.closeDate(t) >= week);
    return `<section><h2>スクリーナーに入れる条件</h2><div class="rows">${cond}</div><p class="note">土曜の定時実行でAIが回し、通った銘柄は候補に入る。4条件の仮判定と根拠が付くので、根拠を読んで引っかかる所だけ確かめ、○×を確定する</p></section>
<section><h2>確認待ち ${wait.length}</h2><p class="note">AIの仮判定が4つ○。候補ページで根拠を読み、引っかかる所だけ確かめて「確認した」を付ける</p>${candRows(wait)}</section>
<section><h2>ウォッチ中 ${watch.length}</h2><p class="note">今回のスクリーナーを通らなかった銘柄は見送りになる</p>${candRows(watch)}</section>
<section><h2>今週の決済</h2>${closed.length ? `<div class="rows">${closed.map((t) => tradeRow(t)).join('')}</div>` : '<p class="empty">なし</p>'}</section>`;
  }
  function sceneMonth(st, od, today) {
    const pre = data['前提'], ym = today.slice(0, 7);
    const closed = data['取引'].filter((t) => cstate(t) === '決済済み' && (Calc.closeDate(t) || '').startsWith(ym));
    const wins = closed.filter((t) => Calc.pl(t) >= 0).length;
    const rs = closed.map(Calc.rValue);
    const avgR = rs.length ? (rs.reduce((a, b) => a + b, 0) / rs.length).toFixed(2) : '—';
    const sm = Calc.summary(data);
    const tbl = (key, title) => `<h3>${title}</h3><div class="rows">${sm[key].filter((x) => x.state !== '不採用').map((x) => `<div class="row"><div class="r1"><b>${E(x.name)}</b>${pill(x.state)}</div><div class="r2">${x.n}件／${x.minN}件${x.n ? `　勝率 ${x.winPct}%　平均R ${x.rAvg}` : ''}${x.ready ? '　判断できる' : ''}</div></div>`).join('')}</div>`;
    return `<section><h2>月初資金</h2><dl class="facts"><div><dt>前提の月初資金</dt><dd>${yen(pre['月初資金'])}円</dd></div><div><dt>いまの資金</dt><dd>${yen(st.cash)}円</dd></div></dl>
${pre['月初資金'] !== st.cash ? `<div class="btns"><button class="b" data-act="set-monthly" data-v="${st.cash}">月初資金をいまの資金にする</button></div>` : '<p class="note">更新済み</p>'}</section>
<section><h2>${Number(ym.slice(5))}月の決済 ${closed.length}件</h2>${closed.length ? `<p class="note">勝率 ${Math.round(wins / closed.length * 100)}%　平均R ${avgR}</p><div class="rows">${closed.map((t) => tradeRow(t)).join('')}</div>` : '<p class="empty">なし</p>'}</section>
<section><h2>戦略ごとの成績（全期間）</h2>${tbl('型', 'エントリー')}${tbl('利確', '利益確定')}${tbl('期限', '保有期限')}</section>
<section><h2>見直しの前に</h2><p class="note"><a href="#rules">原則</a>を読み、今月それに反した場面がなかったか答える</p></section>`;
  }
  function changesHtml(list, n) {
    if (!list.length) return `<p class="empty">${isLocal() ? 'ローカル表示では見られない' : 'なし'}</p>`;
    return `<div class="rows">${list.slice(0, n || list.length).map((c) => { const d = new Date(c.date); return `<div class="row"><div class="r1"><b>${E(c.text)}</b></div><div class="r2">${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}　${E(c.who === 'Claude' ? 'AI' : c.who)}</div></div>`; }).join('')}</div>`;
  }
  function viewChanges() {
    return shell(`<h1>変更の履歴</h1><p class="lead">AIと画面が data/ を書き換えた記録。GitHubのコミット</p><section><div id="changes-box"><p class="empty">読み込み中</p></div></section>`);
  }

  // ---------- 取引 ----------
  function tradeRow(t) {
    const i = data['取引'].indexOf(t), s = cstate(t), p = Calc.pl(t), r = Calc.rValue(t);
    let r2;
    if (s === '注文中') r2 = `逆指値買い ${yen(t['発注価格'])}円 × ${t['株数'] || 0}株　損切り ${yen(t['損切り価格'])}円`;
    else if (s === '保有中' || s === '一部利確') r2 = `約定 ${dShort(t['約定日'])} ${yen(t['約定価格'])}円 × ${Calc.remQty(t)}株　損切り ${yen(t['損切り価格'])}円`;
    else if (s === '決済済み') r2 = `${dShort(Calc.closeDate(t))} 決済　${p >= 0 ? '+' : ''}${yen(p)}円　${r >= 0 ? '+' : ''}${r.toFixed(2)}R`;
    else r2 = `${E(dShort(t['記録日']))}　${E(t['型'])}`;
    return `<a class="row" href="#trade/${i}"><div class="r1">${stock(t)}${pill(s)}</div><div class="r2">${E(t['区分'])}　${r2}</div><span class="chev">›</span></a>`;
  }
  function viewTrades() {
    const T = data['取引'];
    const by = (f) => T.filter((t) => f(cstate(t)));
    const waiting = by((s) => s === '注文中'), held = by((s) => s === '保有中' || s === '一部利確'), closed = by((s) => s === '決済済み').sort((a, b) => (Calc.closeDate(a) < Calc.closeDate(b) ? 1 : -1)), other = by((s) => s === '取消' || s === '');
    const cands = data['候補'];
    const live = cands.filter((c) => ['条件未確認', 'ウォッチ中', '取引へ'].includes(candState(c))), dropped = cands.filter((c) => candState(c) === '見送り');
    const sec = (title, list, add) => `<section><div class="bar"><h2>${title}</h2>${add ? `<a class="b" href="${add}">追加</a>` : ''}</div>${list.length ? `<div class="rows">${list.map(tradeRow).join('')}</div>` : '<p class="empty">なし</p>'}</section>`;
    return shell(`<h1>取引</h1>${sec(`注文中 ${waiting.length}`, waiting, '#trade/new')}${sec(`保有中 ${held.length}`, held)}
<section><div class="bar"><h2>候補銘柄 ${live.length}</h2><a class="b" href="#cand/new">追加</a></div>${candRows(live)}${dropped.length ? `<details class="fold"><summary>見送り ${dropped.length}</summary>${candRows(dropped)}</details>` : ''}</section>
${sec(`決済済み ${closed.length}`, closed)}${other.length ? sec('取消', other) : ''}`);
  }
  const blankTrade = () => ({ id: Math.max(0, ...data['取引'].map((t) => t.id)) + 1, 'コード': '', '銘柄名': '', '区分': '通常', '型': '', '利確': '', '注文': '', '期限': '', '追加': '', '記録日': todayISO(), '基準価格': null, '損切り価格': null, '発注価格': null, '株数': null, '約定日': null, '約定価格': null, '約定株数': null, 'イベント日': null, 'イベント種別': null, '売り': [], '状態': '', '人の判定': '', 'AIの判定': '', 'メモ': '' });
  function viewTrade(key) {
    const i = key === 'new' ? -1 : Number(key);
    const t = i >= 0 ? data['取引'][i] : blankTrade();
    if (!t) return viewTrades();
    const s = i >= 0 ? cstate(t) : '';
    const grp = (title, open, body) => `<details class="grp" ${open ? 'open' : ''}><summary>${title}</summary><div class="form cols">${body}</div></details>`;
    const sell = (k) => { const x = (t['売り'] || [])[k] || {}; return fld(`売り${k + 1} 日付`, `s${k}d`, x['日付'], { type: 'date' }) + fld('価格', `s${k}p`, x['価格'], { type: 'number' }) + fld('株数', `s${k}q`, x['株数'], { type: 'number' }); };
    const calcBox = edit && edit.calc ? `<div class="calc ${edit.calc.ok ? '' : 'ng'}">発注価格 ${yen(edit.calc.entry)}円、損切り幅 ${edit.calc.widthPct}%、1R ${yen(edit.calc.oneR)}円 → <b>${edit.calc.qty}株</b>（投入 ${yen(edit.calc.amount)}円、損切りで −${yen(edit.calc.risk)}円、全損切り時 ${edit.calc.totalRiskPct}%）${edit.calc.ok ? '　新規買い 可' : '　新規買い 不可：' + edit.calc.reasons.join('、')}</div>` : '';
    const rule = (k) => fld(TKEY[k], k, t[k], { type: 'select', options: [''].concat(slist(TQ[k])) });
    return shell(`<h1>${i >= 0 ? E(t['銘柄名'] || '取引') : '取引を追加'}${s ? ' ' + pill(s) : ''}</h1>
<form id="f-trade" data-i="${i}">
${grp('銘柄', !s, fld('コード', 'コード', t['コード']) + fld('銘柄名', '銘柄名', t['銘柄名']) + fld('区分', '区分', t['区分'], { type: 'select', options: ['通常', 'IPO'] }))}
${grp('使うルール', !s, ['型', '注文', '利確', '期限', '追加'].map(rule).join(''))}
${grp('発注', !s || s === '注文中', fld('記録日', '記録日', t['記録日'], { type: 'date' }) + fld('基準価格', '基準価格', t['基準価格'], { type: 'number' }) + fld('損切り価格', '損切り価格', t['損切り価格'], { type: 'number' }) + fld('発注価格（空欄なら基準価格から）', '発注価格', t['発注価格'], { type: 'number' }) + fld('株数', '株数', t['株数'], { type: 'number' }) + `<div class="btns span"><button class="b" data-act="calc-trade" type="button">発注価格と株数を計算</button></div>${calcBox ? `<div class="span">${calcBox}</div>` : ''}`)}
${grp('約定', s === '注文中', fld('約定日', '約定日', t['約定日'], { type: 'date' }) + fld('約定価格', '約定価格', t['約定価格'], { type: 'number' }) + fld('約定株数', '約定株数', t['約定株数'], { type: 'number' }) + fld('イベント日', 'イベント日', t['イベント日'], { type: 'date' }) + fld('イベント種別', 'イベント種別', t['イベント種別'] || '', { type: 'select', options: ['', '決算', '解除'] }))}
${grp('売り', s === '保有中' || s === '一部利確', sell(0) + sell(1))}
${grp('判定とメモ', s === '保有中' || s === '一部利確' || s === '決済済み', fld('人の判定', '人の判定', t['人の判定']) + fld('AIの判定', 'AIの判定', t['AIの判定']) + `<label class="f span"><span>メモ</span><textarea name="メモ" rows="2">${E(t['メモ'])}</textarea></label>` + `<label class="chk span"><input type="checkbox" name="取消" ${t['状態'] === '取消' ? 'checked' : ''}> この取引を取消にする</label>`)}
<input type="hidden" name="id" value="${t.id}">
<div class="btns"><button class="b primary" data-act="save-trade">保存</button><a class="b quiet" href="#trades">戻る</a>${i >= 0 ? '<button class="b quiet danger" data-act="del-trade" type="button">削除</button>' : ''}</div></form>`);
  }
  const blankCand = () => ({ '日付': todayISO(), 'コード': '', '銘柄名': '', '区分': '通常', '上場日': null, '売買代金_億': null, '時価総額_億': null, '終値': null, '想定損切り': null, '絞り込み': '', '判定': [null, null, null, null], '根拠': ['', '', '', ''], '確認': null, '型が出た日': null, 'メモ': '' });
  function viewCand(key) {
    const i = key === 'new' ? -1 : Number(key);
    const c = i >= 0 ? data['候補'][i] : blankCand();
    if (!c) return viewTrades();
    const labels = candLabels(c); while (labels.length < 4) labels.push('条件' + (labels.length + 1));
    const j = c['判定'] || [], g = c['根拠'] || [];
    const grp = (title, body) => `<details class="grp" open><summary>${title}</summary><div class="form cols">${body}</div></details>`;
    return shell(`<h1>${i >= 0 ? E(c['銘柄名'] || '候補銘柄') + ' ' + pill(candState(c)) : '候補銘柄を追加'}</h1>
<form id="f-cand" data-i="${i}">
${grp('銘柄', fld('日付', '日付', c['日付'], { type: 'date' }) + fld('コード', 'コード', c['コード']) + fld('銘柄名', '銘柄名', c['銘柄名']) + fld('区分', '区分', c['区分'], { type: 'select', options: ['通常', 'IPO'] }) + fld('上場日（IPO）', '上場日', c['上場日'], { type: 'date' }))}
${grp('スクリーニング', fld('売買代金（億円）', '売買代金_億', c['売買代金_億'], { type: 'number', step: '0.1' }) + fld('時価総額（億円）', '時価総額_億', c['時価総額_億'], { type: 'number' }) + fld('終値', '終値', c['終値'], { type: 'number' }) + fld('想定損切り価格', '想定損切り', c['想定損切り'], { type: 'number' }) + fld('結果（空欄なら自動）', '絞り込み', c['絞り込み'], { ph: '可／不可：理由' }))}
${grp('銘柄の条件（AIの仮判定と根拠。直してよい）', labels.map((l, k) => fld(l, 'j' + k, j[k] || '', { type: 'select', options: ['', '○', '×'] }) + `<label class="f span"><span>根拠</span><textarea name="g${k}" rows="2">${E(g[k] || '')}</textarea></label>`).join('') + `<label class="chk span"><input type="checkbox" name="確認" ${c['確認'] ? 'checked' : ''}> 根拠を読んで確認した${c['確認'] ? `（${E(dShort(c['確認']))}）` : ''}。4つ○ならウォッチ中になる</label>`)}
${grp('エントリー', fld('条件が出た日', '型が出た日', c['型が出た日'], { type: 'date' }) + fld('メモ', 'メモ', c['メモ']))}
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
    return shell(`<h1>ルール</h1><p class="lead">採用は項目ごとに1つ（IPOと通常で分ける項目は各1つ）、代替案は2つまで。変えるのは${q12['周期_月'] === 1 ? '月1回' : q12['周期_月'] + 'か月に1回'}の見直しで</p>
<section><h2>今のルール</h2><div class="rows">${list}</div></section>
<section><div class="bar"><h2>原則</h2>${pEdit ? '<button class="b quiet" data-act="cancel">閉じる</button>' : '<button class="b quiet" data-act="edit-principles">編集</button>'}</div>${principles}</section>
<section><h2>前提</h2>${preForm}</section>
<section><div class="bar"><h2>改定履歴</h2><button class="b" data-act="edit-hist">追加</button></div>${hForm}${hist.length ? `<div class="rows">${hist.map(histRow).join('')}</div>` : '<p class="empty">なし</p>'}</section>
<p class="foot"><a href="#changes">変更の履歴</a>　<a href="#settings">設定</a></p>`);
  }
  function histRow(h) {
    let chg = E(h['変更']);
    if (h['変更'] === '数値変更') { try { const a = JSON.parse(h['変更前'] || '{}'), b = JSON.parse(h['変更後'] || '{}'); const diff = Object.keys(Object.assign({}, a, b)).filter((k) => a[k] !== b[k]).map((k) => `${keyLabel(k)} ${a[k] == null ? '—' : a[k]} → ${b[k] == null ? '—' : b[k]}`); if (diff.length) chg = E(diff.join('、')); } catch (e) { chg = E(`${h['変更前']} → ${h['変更後']}`); } }
    else if (h['変更前'] && h['変更後']) chg = E(`${h['変更前']} → ${h['変更後']}`);
    const q = Q(h['問い']);
    return `<div class="row"><div class="r1"><b>${q ? E(q.num + ' ' + q.name) : E(h['問い'])}　${E(h['戦略'])}</b></div><div class="r2">${E(dShort(h['日付']))}　${chg}${h['理由'] ? `　${E(h['理由'])}` : ''}${h['件数'] ? `　${h['件数']}件` : ''}</div></div>`;
  }
  const principleForm = (p, i) => `<form id="f-principle" class="form" data-i="${i}">${fld('番号', 'id', p.id, { type: 'number' })}${fld('見出し', 'title', p.title)}${fld('本文', 'text', p.text, { type: 'textarea', rows: 2 })}${fld('出典', '出典', p['出典'])}<div class="btns"><button class="b primary" data-act="save-principle">保存</button><button class="b quiet" data-act="cancel" type="button">取消</button><button class="b quiet danger" data-act="del-principle" type="button">削除</button></div></form>`;

  function viewRule(num) {
    const q = Q(num); if (!q) return viewRules();
    const sel = `<select class="qsel">${data['問い'].map((x) => `<option value="${x.num}" ${x.num === q.num ? 'selected' : ''}>${x.num} ${E(x.name)}</option>`).join('')}</select>`;
    const def = q['定義'];
    const defs = `<details class="fold"><summary>この項目で決めること</summary><dl class="def"><dt>決めること</dt><dd>${E(def['決めること'])}</dd><dt>決めないこと</dt><dd>${E(def['決めないこと'])}</dd><dt>選び方</dt><dd>${E(def['選び方'])}</dd>${def['計算に使う数字'] ? `<dt>計算に使う数字</dt><dd>${E(def['計算に使う数字'])}</dd>` : ''}</dl></details>`;
    const order = { '採用': 0, '代替案': 1, '不採用': 2 };
    const idx = q['戦略'].map((s, i) => i).sort((a, b) => order[q['戦略'][a]['状態']] - order[q['戦略'][b]['状態']]);
    const cards = idx.map((i) => { const s = q['戦略'][i];
      if (edit && edit.type === 'strategy' && edit.q === q.num && edit.idx === i) return strategyForm(q, s, i);
      return s['状態'] === '採用' ? strategyCard(q, s, i) : `<details class="fold strat-fold" id="s-${E(s.name)}"><summary>${E(s.name)} ${pill(s['状態'])}${s['区分'] !== '共通' ? `<span class="pill">${E(s['区分'])}</span>` : ''}</summary>${strategyCard(q, s, i)}</details>`; }).join('');
    const add = edit && edit.type === 'strategy' && edit.q === q.num && edit.idx === -1 ? strategyForm(q, blankStrategy(q), -1) : `<div class="btns"><button class="b" data-act="edit-strategy" data-q="${q.num}" data-i="-1">追加</button></div>`;
    return shell(`<h1 class="qh">${sel}</h1><p class="lead">${E(q.question)}</p>${defs}<p class="adopt">採用中　${E(adoptedText(q))}</p><section>${cards}${add}</section>`);
  }
  const blankStrategy = (q) => ({ name: '', '状態': '代替案', '改定日': todayISO(), '区分': '共通', '一言で': '', '当てはまる条件': [], 'しないこと': [], '兼業での実行手順': '', '出典': '', '向く相場・向かない相場': '', '評価の仕方': '', '数値欄': Object.fromEntries((q['数値欄のキー'] || []).map((k) => [k, null])) });
  function strategyCard(q, s, i) {
    const li = (a) => (Array.isArray(a) ? a : lines(a)).map((x) => `<li>${E(x)}</li>`).join('');
    const nums = Object.entries(s['数値欄'] || {}).filter(([k, v]) => v != null && v !== '').map(([k, v]) => `<span><b>${E(keyLabel(k))}</b> ${E(v)}</span>`).join('');
    const sec = (title, body) => (body ? `<h4>${title}</h4>${body}` : '');
    return `<article class="strat ${s['状態'] === '不採用' ? 'off' : ''}" id="s-${E(s.name)}"><header><h3>${E(s.name)}</h3>${pill(s['状態'])}${s['区分'] !== '共通' ? `<span class="pill">${E(s['区分'])}</span>` : ''}</header>
<p class="one">${E(s['一言で'])}</p>${sec('条件', `<ul>${li(s['当てはまる条件'])}</ul>`)}${nums ? `<div class="k">${nums}</div>` : ''}
<details class="fold"><summary>詳細</summary>${sec('禁止', (s['しないこと'] || []).length ? `<ul>${li(s['しないこと'])}</ul>` : '')}${sec('いつやるか', s['兼業での実行手順'] ? `<p>${E(s['兼業での実行手順'])}</p>` : '')}${sec('出典', s['出典'] ? `<p>${linkify(s['出典'])}</p>` : '')}${sec('向く相場', s['向く相場・向かない相場'] ? `<p>${E(s['向く相場・向かない相場'])}</p>` : '')}${sec('不採用にする基準', s['評価の仕方'] ? `<p>${E(s['評価の仕方'])}</p>` : '')}<p class="rev">改定 ${E(s['改定日'])}</p></details>
<div class="btns"><button class="b quiet" data-act="edit-strategy" data-q="${q.num}" data-i="${i}">編集</button></div></article>`;
  }
  function strategyForm(q, s0, i) {
    // 条件の行を足し引きして描き直した時に、入力途中の文字を失わないよう、下書き（edit.draft）を優先する
    const d = (edit && edit.draft) || {}, s = Object.assign({}, s0, Object.fromEntries(['name', '状態', '区分', '一言で', '兼業での実行手順', '出典', '向く相場・向かない相場', '評価の仕方'].filter((k) => d[k] !== undefined).map((k) => [k, d[k]]))); if (d['しないこと'] !== undefined) s['しないこと'] = lines(d['しないこと']); if (d['当てはまる条件'] !== undefined) s['当てはまる条件'] = lines(d['当てはまる条件']);
    const numf = (q['数値欄のキー'] || []).map((k) => fld(keyLabel(k), 'n:' + k, d['n:' + k] !== undefined ? d['n:' + k] : (s['数値欄'] ? s['数値欄'][k] : ''))).join('');
    return `<form id="f-strategy" class="strat form" data-q="${q.num}" data-i="${i}"><div class="form cols">${fld('戦略名', 'name', s.name)}${fld('状態', '状態', s['状態'], { type: 'select', options: ['採用', '代替案', '不採用'] })}${fld('区分', '区分', s['区分'], { type: 'select', options: ['共通', 'IPO', '通常'] })}</div>
${fld('一言で', '一言で', s['一言で'])}${q.num === 1 ? condBuilder(edit && edit.cond ? edit.cond : (s['スクリーナー条件'] || [])) : fld('条件（1行1つ）', '当てはまる条件', text(s['当てはまる条件']), { type: 'textarea' })}${fld('禁止（1行1つ）', 'しないこと', text(s['しないこと']), { type: 'textarea', rows: 3 })}
${fld('いつやるか', '兼業での実行手順', s['兼業での実行手順'], { type: 'textarea', rows: 2 })}${fld('出典', '出典', s['出典'], { type: 'textarea', rows: 2 })}${fld('向く相場', '向く相場・向かない相場', s['向く相場・向かない相場'], { type: 'textarea', rows: 2 })}${fld('不採用にする基準', '評価の仕方', s['評価の仕方'], { type: 'textarea', rows: 2 })}
${numf ? `<h4>数値</h4><div class="form cols">${numf}</div>` : ''}${fld('改定の理由（改定履歴に残る）', 'reason', d.reason || '')}
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
<form id="f-cfg" class="form"><div class="form cols">${fld('owner', 'owner', cfg.owner)}${fld('repo', 'repo', cfg.repo)}${fld('branch', 'branch', cfg.branch)}</div>${fld('トークン', 'token', cfg.token, { type: 'password' })}
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
    const doc = document.getElementById('doc-box');
    if (doc) { try { const t = await readText(doc.dataset.path); doc.innerHTML = mdToHtml(t, doc.dataset.path); window.scrollTo(0, 0); } catch (e) { doc.innerHTML = `<p class="empty">${E(e.message)}</p>`; } }
  }
  window.addEventListener('hashchange', () => { edit = null; render(); if (!/^#(rule|docs)\/.+\/.+/.test(location.hash)) window.scrollTo(0, 0); });
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
    if (act === 'edit-hist') { edit = { type: 'hist' }; render(); return; }
    if (act === 'clear-cfg') { cfg.token = ''; localStorage.setItem(KEY, JSON.stringify(cfg)); loaded = false; location.hash = '#settings'; render(); return; }
    e.preventDefault();
    if (act === 'save-cfg') { Object.assign(cfg, fd(document.getElementById('f-cfg'))); localStorage.setItem(KEY, JSON.stringify(cfg)); await boot(); location.hash = '#today'; return; }
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
      const old = idx >= 0 ? q['戦略'][idx] : null;
      const s = { name: v.name.trim(), '状態': v['状態'], '改定日': todayISO(), '区分': v['区分'], '一言で': v['一言で'], '当てはまる条件': lines(v['当てはまる条件']), 'しないこと': lines(v['しないこと']),
        '兼業での実行手順': v['兼業での実行手順'], '出典': v['出典'], '向く相場・向かない相場': v['向く相場・向かない相場'], '評価の仕方': v['評価の仕方'], '数値欄': {} };
      (q['数値欄のキー'] || []).forEach((k) => { s['数値欄'][k] = numOrNull(v['n:' + k]); });
      if (q.num === 1) {
        s['スクリーナー条件'] = readCond(f);
        if (s['スクリーナー条件'].some((c) => !catItem(c['項目']))) { msg = { ng: true, text: '項目の一覧に無い条件がある' }; showToast(); return; }
        if (!s['スクリーナー条件'].length) { msg = { ng: true, text: '条件を1つは入れる' }; showToast(); return; }
        s['当てはまる条件'] = genCondLines(s);
      }
      if (old && old.name !== s.name) { data['取引'].forEach((t) => { Object.keys(TKEY).forEach((k) => { if (t[k] === old.name) t[k] = s.name; }); }); }
      if (idx >= 0) q['戦略'][idx] = s; else q['戦略'].push(s);
      const condChanged = q.num === 1 && old && JSON.stringify(old['スクリーナー条件'] || []) !== JSON.stringify(s['スクリーナー条件']);
      const change = !old ? '追加' : old['状態'] !== s['状態'] ? s['状態'] : condChanged ? '条件変更' : JSON.stringify(old['数値欄']) !== JSON.stringify(s['数値欄']) ? '数値変更' : '文言変更';
      const before = !old ? '' : change === '数値変更' ? JSON.stringify(old['数値欄']) : change === '条件変更' ? (old['スクリーナー条件'] || []).map(condText).join('、') : old['状態'];
      const after_ = change === '数値変更' ? JSON.stringify(s['数値欄']) : change === '条件変更' ? s['スクリーナー条件'].map(condText).join('、') : s['状態'];
      data['改定履歴'].push({ '日付': todayISO(), '問い': String(q.num), '戦略': s.name, '変更': change, '変更前': before, '変更後': after_, '理由': v.reason || '', '件数': data['取引'].filter((t) => cstate(t) === '決済済み' && Object.keys(TKEY).some((k) => t[k] === s.name)).length });
      const ok = await save('問い', `${q.num} ${q.name} ${s.name}：${change}`);
      if (ok) { await save('改定履歴', `改定履歴：${q.num} ${s.name}`); if (old && old.name !== s.name) await save('取引', '戦略名の変更を取引に反映'); edit = null; }
      render(); return;
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
      const f = document.getElementById('f-trade'), v = fd(f), idx = Number(f.dataset.i);
      const t = { id: Number(v.id), 'コード': v['コード'], '銘柄名': v['銘柄名'], '区分': v['区分'], '型': v['型'], '利確': v['利確'], '注文': v['注文'], '期限': v['期限'], '追加': v['追加'],
        '記録日': v['記録日'] || null, '基準価格': numOrNull(v['基準価格']), '損切り価格': numOrNull(v['損切り価格']), '発注価格': numOrNull(v['発注価格']), '株数': numOrNull(v['株数']),
        '約定日': v['約定日'] || null, '約定価格': numOrNull(v['約定価格']), '約定株数': numOrNull(v['約定株数']), 'イベント日': v['イベント日'] || null, 'イベント種別': v['イベント種別'] || null,
        '売り': [0, 1].filter((k) => v['s' + k + 'd']).map((k) => ({ '日付': v['s' + k + 'd'], '価格': Number(v['s' + k + 'p']), '株数': Number(v['s' + k + 'q']) })),
        '状態': '', '人の判定': v['人の判定'], 'AIの判定': v['AIの判定'], 'メモ': v['メモ'] };
      t['状態'] = v['取消'] ? '取消' : cstate(t);
      if (idx >= 0) data['取引'][idx] = t; else data['取引'].push(t);
      if (await save('取引', `取引 ${t.id} ${t['銘柄名']}：${t['状態']}`)) { edit = null; location.hash = '#trades'; } else render(); return;
    }
    if (act === 'del-trade') { const f = document.getElementById('f-trade'), idx = Number(f.dataset.i); if (!confirm('この取引を消す')) return; const t = data['取引'].splice(idx, 1)[0]; if (await save('取引', `取引 ${t.id} を削除`)) location.hash = '#trades'; else render(); return; }
    if (act === 'save-cand') {
      const f = document.getElementById('f-cand'), v = fd(f), idx = Number(f.dataset.i);
      const c = { '日付': v['日付'], 'コード': v['コード'], '銘柄名': v['銘柄名'], '区分': v['区分'], '上場日': v['上場日'] || null, '売買代金_億': numOrNull(v['売買代金_億']), '時価総額_億': numOrNull(v['時価総額_億']),
        '終値': numOrNull(v['終値']), '想定損切り': numOrNull(v['想定損切り']), '絞り込み': v['絞り込み'], '判定': [0, 1, 2, 3].map((k) => v['j' + k] || null), '根拠': [0, 1, 2, 3].map((k) => (v['g' + k] || '').trim()), '確認': v['確認'] ? ((idx >= 0 && data['候補'][idx]['確認']) || todayISO()) : null, '型が出た日': v['型が出た日'] || null, 'メモ': v['メモ'] };
      if (!c['絞り込み']) c['絞り込み'] = screen(c);
      if (idx >= 0) data['候補'][idx] = c; else data['候補'].push(c);
      if (await save('候補', `候補 ${c['銘柄名']}：${candState(c)}`)) location.hash = '#trades'; else render(); return;
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
