/* 売買ノート。data/ の JSON を GitHub から読み書きする1枚のアプリ。 */
(function () {
  'use strict';
  const E = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const yen = (v) => (v == null || v === '' ? '' : Number(v).toLocaleString('ja-JP'));
  const todayISO = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
  const WD = '日月火水木金土';
  const FILES = ['前提', '問い', '原則', '取引', '候補', '改定履歴'];
  const KEY = 'si.cfg';
  const app = document.getElementById('app');

  // ---------- 設定と保存先 ----------
  let cfg = { owner: 'Tatsu001', repo: 'secondary-investment', branch: 'master', token: '' };
  try { Object.assign(cfg, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (e) { }
  const isLocal = () => location.protocol === 'http:' && /^(localhost|127\.0\.0\.1)/.test(location.host) && !cfg.token;
  let data = {}, shas = {}, edit = null, msg = null, loaded = false;

  const b64enc = (s) => { const u = new TextEncoder().encode(s); let b = ''; for (let i = 0; i < u.length; i += 0x8000) b += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(b); };
  const b64dec = (b) => new TextDecoder().decode(Uint8Array.from(atob(b.replace(/\n/g, '')), (c) => c.charCodeAt(0)));
  const ghUrl = (name) => `https://api.github.com/repos/${cfg.owner}/${cfg.repo}/contents/data/${encodeURIComponent(name)}.json`;
  const ghHeaders = () => ({ Authorization: 'Bearer ' + cfg.token, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' });

  async function ghGet(name) {
    const r = await fetch(ghUrl(name) + '?ref=' + encodeURIComponent(cfg.branch), { headers: ghHeaders(), cache: 'no-store' });
    if (!r.ok) throw new Error(`${name}.json を読めません（${r.status}）`);
    const j = await r.json();
    shas[name] = j.sha;
    return JSON.parse(b64dec(j.content));
  }
  async function ghPut(name, obj, message) {
    const r = await fetch(ghUrl(name), { method: 'PUT', headers: Object.assign({ 'Content-Type': 'application/json' }, ghHeaders()),
      body: JSON.stringify({ message, content: b64enc(JSON.stringify(obj, null, 1) + '\n'), sha: shas[name], branch: cfg.branch }) });
    if (r.status === 409 || r.status === 422) { data[name] = await ghGet(name); throw new Error(`${name} は他で更新されていたので読み直しました。もう一度保存してください`); }
    if (!r.ok) throw new Error(`保存に失敗（${r.status}）`);
    const j = await r.json(); shas[name] = j.content.sha;
  }
  async function loadAll() {
    if (isLocal()) {
      for (const n of FILES) { const r = await fetch('../data/' + n + '.json', { cache: 'no-store' }); data[n] = await r.json(); }
    } else {
      if (!cfg.token) throw new Error('settings');
      for (const n of FILES) data[n] = await ghGet(n);
    }
    loaded = true;
  }
  async function save(name, message) {
    if (isLocal()) { msg = { ng: true, text: 'ローカル表示では保存できません。GitHubの設定をすると保存できます' }; return false; }
    try { await ghPut(name, data[name], message); msg = { text: '保存しました：' + message }; return true; }
    catch (e) { msg = { ng: true, text: e.message }; return false; }
  }

  // ---------- 共通部品 ----------
  const route = () => (location.hash || '#today').slice(1).split('/');
  const nav = (cur) => {
    const items = [['today', '今日の作業'], ['rules', '原則と前提'], ['q', '問い'], ['records', '記録'], ['history', '改定履歴'], ['settings', '接続']];
    return '<nav class="site">' + items.map(([k, n]) => `<a href="#${k}" class="${cur === k ? 'on' : ''}">${n}</a>`).join('') + '</nav>';
  };
  const shell = (title, cur, body, date) => `<div class="top"><h1>${E(title)}</h1><span class="date">${E(date || '')}</span></div>${nav(cur)}${msg ? `<div class="msg ${msg.ng ? 'ng' : ''}">${E(msg.text)}</div>` : ''}${body}`;
  const pill = (st) => `<span class="pill ${st === '採用' ? 'pill-ok' : st === '不採用' ? 'pill-ng' : ''}">${E(st)}</span>`;
  const fld = (label, name, value, o = {}) => {
    const v = value == null ? '' : value;
    let inp;
    if (o.type === 'select') inp = `<select name="${name}">${o.options.map((x) => `<option value="${E(x)}" ${String(x) === String(v) ? 'selected' : ''}>${E(x || '—')}</option>`).join('')}</select>`;
    else if (o.type === 'textarea') inp = `<textarea name="${name}" ${o.rows ? `rows="${o.rows}"` : ''}>${E(v)}</textarea>`;
    else inp = `<input name="${name}" type="${o.type || 'text'}" value="${E(v)}" ${o.step ? `step="${o.step}"` : ''} ${o.ph ? `placeholder="${E(o.ph)}"` : ''}>`;
    return `<label class="f"><span>${E(label)}</span>${inp}</label>`;
  };
  const lines = (t) => String(t || '').split('\n').map((s) => s.trim()).filter(Boolean);
  const text = (a) => (Array.isArray(a) ? a.join('\n') : a || '');
  const numOrNull = (v) => (v === '' || v == null ? null : isNaN(Number(v)) ? v : Number(v));
  const fd = (form) => { const o = {}; new FormData(form).forEach((v, k) => { o[k] = v; }); return o; };
  const Q = (n) => data['問い'].find((q) => q.num === Number(n));
  const qTitle = (q) => `問い${q.num} ${q.name}`;
  const slist = (num) => (Q(num) ? Q(num)['戦略'].map((s) => s.name) : []);

  // ---------- 今日 ----------
  function viewToday() {
    const today = todayISO();
    const st = Calc.status(data, today), od = Calc.orders(data, today);
    const cands = data['候補'];
    const nJudge = cands.filter((c) => candState(c) === '判断待ち').length, nWatch = cands.filter((c) => candState(c) === '監視中').length;
    const STAGE = { '通常': '通常', '段階1': 'ロット半分', '段階2': '新規買い停止', '停止': '取引停止' };
    const verdict = st.ok
      ? `<div class="verdict ok"><span class="v-label">今日</span><span class="v-main">新規買いできる</span></div>`
      : `<div class="verdict ng"><span class="v-label">今日</span><span class="v-main">新規買いはしない</span><span class="v-note">${E(st.reasons.join('・'))}</span></div>`;
    const facts = `<dl class="facts"><div><dt>資金（確定ベース）</dt><dd>${yen(st.cash)}円</dd></div><div><dt>最高額からの減り</dt><dd>${st.ddPct}%</dd></div>
<div><dt>縮小段階</dt><dd class="${['停止', '段階2'].includes(st.stage) ? 'bad' : ''}">${STAGE[st.stage]}</dd></div><div><dt>保有銘柄数</dt><dd>${st.held} <span class="of">/ 上限${st.heldMax}</span></dd></div>
<div><dt>全部損切りした時の損失</dt><dd>${st.openRiskPct}% <span class="of">/ 上限${st.openRiskMax}%</span></dd></div><div><dt>連敗</dt><dd>${st.streak}</dd></div></dl>`;
    const rows = [];
    od.new.forEach((o) => {
      rows.push(['新規', o.t, o.buy.kind, yen(o.buy.price), o.buy.qty, o.note + (o.expired ? '。取消の期限を過ぎている' : '')]);
      rows.push(['新規', o.t, o.stop.kind, yen(o.stop.price), o.stop.qty, '買いが約定したら入れる']);
    });
    od.hold.forEach((h) => h.orders.forEach((x) => rows.push(['保有', h.t, x.kind, x.price ? yen(x.price) : '成行', x.qty, x.why])));
    const orders = rows.length ? `<div class="scroll"><table class="orders"><thead><tr><th></th><th>銘柄</th><th>注文</th><th class="num">価格</th><th class="num">株数</th><th>メモ</th></tr></thead><tbody>${rows.map(([g, t, k, p, q, m]) =>
      `<tr><td><span class="tag ${g === '新規' ? '' : 'tag-hold'}">${g}</span></td><td class="name">${E(t['銘柄名'])}<span class="code">${E(t['コード'])}</span></td><td>${E(k)}</td><td class="num">${p}</td><td class="num">${q}</td><td class="note">${E(m)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="empty">注文なし</p>';
    const tasks = (key, items) => `<ol class="tasks">${items.map(([t, d], i) => `<li><label><input type="checkbox" data-task="${key}-${i}"><span>${E(t)}</span>${d ? `<small>${E(d)}</small>` : ''}</label></li>`).join('')}</ol>`;
    const panels = {
      pre: `<div class="card"><h2>注文一覧</h2>${orders}</div><div class="card"><h2>手順</h2>${tasks('pre', [['注文一覧のとおりにSBIで注文する', ''], ['一覧と違う注文を出したら、引け後にAIに伝える', '']])}</div>`,
      noon: `<div class="card"><h2>手順</h2>${tasks('noon', [['約定を確認する', st.waiting + '件'], ['約定していたらAIに伝える（または記録に入力）', '']])}</div>`,
      post: `<div class="card"><h2>手順（AIに聞かれる順）</h2>${tasks('post', [['AIに「引け後の作業」と言う', ''], ['地合い：指数は25日線の上か、先物の夜間は−2%以内か', ''], ['約定と売り', `注文中 ${st.waiting}件、保有中 ${st.held}件`], ['保有中：売り条件に当たったか、決算・材料は出たか', ''], ['候補の4項目', nJudge + '件'], ['型が出たか、出ていれば損切り価格', '監視中 ' + nWatch + '件'], ['明日の注文一覧を受け取る', '']])}</div>`,
      week: `<div class="card"><h2>手順</h2>${tasks('week', [['AIに「週次の作業」と言う', ''], ['スクリーナーの結果を貼る', ''], ['通った銘柄の4項目', ''], ['今週の売買を振り返る', '']])}</div>`,
    };
    const holds = od.hold.length ? `<div class="holds">${od.hold.map((h) => { const t = h.t; const p = h.left <= 0 ? '<span class="pill pill-ng">期限</span>' : h.left <= 3 ? `<span class="pill pill-warn">あと${h.left}営業日</span>` : `<span class="pill">あと${h.left}営業日</span>`;
      return `<article class="hold"><header><div><b>${E(t['銘柄名'])}</b><span class="code">${E(t['コード'])}</span><span class="sub">${E(t['区分'])}・<a href="#q/3/${encodeURIComponent(t['型'])}">${E(t['型'])}</a>・<a href="#q/6/${encodeURIComponent(t['利確'])}">${E(t['利確'])}</a></span></div>${p}</header>
<dl><div><dt>約定 ${E((t['約定日'] || '').slice(5).replace('-', '/'))}</dt><dd>${yen(t['約定価格'])}円</dd></div><div><dt>損切り</dt><dd>${yen(t['損切り価格'])}円</dd></div><div><dt>残株数</dt><dd>${h.rem}株</dd></div><div><dt>期限</dt><dd>${E(h.limit.slice(5).replace('-', '/'))}</dd></div></dl>
<p class="label">引け後に確認</p><ul class="checks">${h.checks.map((c) => `<li>${E(c)}</li>`).join('')}</ul></article>`; }).join('')}</div>` : '<p class="empty">なし</p>';
    const live = cands.filter((c) => ['監視中', '判断待ち'].includes(candState(c)));
    const candTbl = live.length ? `<div class="scroll"><table><thead><tr><th>銘柄</th><th>区分</th><th>状態</th><th>やること</th></tr></thead><tbody>${live.map((c) => `<tr><td class="name">${E(c['銘柄名'])}<span class="code">${E(c['コード'])}</span></td><td class="nw">${E(c['区分'])}</td><td><span class="pill ${candState(c) === '監視中' ? 'pill-ok' : ''}">${candState(c)}</span></td><td class="note">${candState(c) === '監視中' ? '型が出たか' : '4項目の残り'}</td></tr>`).join('')}</tbody></table></div>` : '<p class="empty">なし</p>';
    const adopt = data['問い'].map((q) => `<tr><td><a href="#q/${q.num}">${E(qTitle(q))}</a></td><td>${E(q['戦略'].filter((s) => s['状態'] === '採用').map((s) => (s['区分'] === '共通' ? '' : s['区分'] + '：') + s.name).join('　／　') || '—')}</td></tr>`).join('');
    const d = new Date(today + 'T00:00:00');
    return shell('今日の作業', 'today', `
<section>${verdict}${facts}</section>
<section><div class="seg" role="tablist"><button role="tab" data-p="pre">寄付前</button><button role="tab" data-p="noon">昼</button><button role="tab" data-p="post">引け後</button><button role="tab" data-p="week">週末</button></div>
<div class="panel" id="p-pre">${panels.pre}</div><div class="panel" id="p-noon">${panels.noon}</div><div class="panel" id="p-post">${panels.post}</div><div class="panel" id="p-week">${panels.week}</div></section>
<section><h2>保有中 ${st.held}件</h2>${holds}</section>
<section class="card"><h2>候補 監視中 ${nWatch}件・判断待ち ${nJudge}件</h2>${candTbl}</section>
<section class="card ref"><h2>採用中の戦略</h2><table><tbody>${adopt}</tbody></table></section>
<footer>記録の入力はAIとの会話か「記録」から。</footer>`, `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日（${WD[d.getDay()]}）`);
  }
  function afterToday() {
    const tabs = [...document.querySelectorAll('.seg button')];
    const pick = () => { const d = new Date(), h = d.getHours() + d.getMinutes() / 60, w = d.getDay(); if (w === 0 || w === 6) return 'week'; if (h < 9) return 'pre'; if (h < 15.5) return 'noon'; return 'post'; };
    const show = (p) => tabs.forEach((b) => { const on = b.dataset.p === p; b.setAttribute('aria-selected', on); document.getElementById('p-' + b.dataset.p).classList.toggle('on', on); });
    tabs.forEach((b) => b.addEventListener('click', () => show(b.dataset.p)));
    const want = route()[1]; show(['pre', 'noon', 'post', 'week'].includes(want) ? want : pick());
    const key = 'si.task.' + todayISO();
    document.querySelectorAll('[data-task]').forEach((c) => {
      try { c.checked = localStorage.getItem(key + ':' + c.dataset.task) === '1'; } catch (e) { }
      c.addEventListener('change', () => { try { localStorage.setItem(key + ':' + c.dataset.task, c.checked ? '1' : '0'); } catch (e) { } });
    });
  }
  function candState(c) {
    if (c['絞り込み'] && c['絞り込み'] !== '可') return '除外';
    const j = c['判定'] || [];
    if (j.filter((x) => x === '○').length === 4) return c['型が出た日'] ? '記録へ' : '監視中';
    if (j.some((x) => x === '×')) return '除外';
    return '判断待ち';
  }

  // ---------- 原則と前提 ----------
  function viewRules() {
    const pr = data['原則'], pre = data['前提'];
    const list = pr.map((p, i) => edit && edit.type === 'principle' && edit.idx === i ? principleForm(p, i)
      : `<div class="principle"><span class="n">${p.id}</span><div><b>${E(p.title)}</b>${E(p.text)}<div class="src">${E(p['出典'])}</div><div class="btns"><button class="b quiet" data-act="edit-principle" data-i="${i}">編集</button></div></div></div>`).join('');
    const addForm = edit && edit.type === 'principle' && edit.idx === -1 ? principleForm({ id: pr.length + 1, title: '', text: '', '出典': '' }, -1) : `<div class="btns"><button class="b" data-act="edit-principle" data-i="-1">原則を足す</button></div>`;
    const preForm = edit && edit.type === 'premise' ? `<form id="f-premise" class="form cols">${fld('初期資金（円）', '初期資金', pre['初期資金'], { type: 'number' })}${fld('月初資金（円）', '月初資金', pre['月初資金'], { type: 'number' })}${fld('停止残高（円）', '停止残高', pre['停止残高'], { type: 'number' })}${fld('単元（株）', '単元', pre['単元'], { type: 'number' })}${fld('証券会社', '証券会社', pre['証券会社'])}<label class="f" style="grid-column:1/-1"><span>東証の休業日（1行1日）</span><textarea name="休日" rows="6">${E(pre['休日'].join('\n'))}</textarea></label><div class="btns" style="grid-column:1/-1"><button class="b primary" data-act="save-premise">保存</button><button class="b quiet" data-act="cancel">取消</button></div></form>`
      : `<dl class="facts"><div><dt>初期資金</dt><dd>${yen(pre['初期資金'])}円</dd></div><div><dt>月初資金</dt><dd>${yen(pre['月初資金'])}円</dd></div><div><dt>停止残高</dt><dd>${yen(pre['停止残高'])}円</dd></div><div><dt>単元</dt><dd>${pre['単元']}株</dd></div><div><dt>証券会社</dt><dd>${E(pre['証券会社'])}</dd></div><div><dt>休業日</dt><dd>${pre['休日'].length}日</dd></div></dl><div class="btns"><button class="b quiet" data-act="edit-premise">編集</button></div>`;
    return shell('原則と前提', 'rules', `<section class="card"><h2>原則（変えない10か条）</h2><p class="fieldsum">どの戦略でも変わらないもの。月次の最後に読み上げ、反した場面がなかったか確かめる。</p>${list}${addForm}</section>
<section class="card"><h2>前提</h2><p class="fieldsum">資金と口座の事実。月初資金は毎月1日に現在の資金を書き写す（1Rの基準）。</p>${preForm}</section>`);
  }
  const principleForm = (p, i) => `<form id="f-principle" class="form" data-i="${i}">${fld('番号', 'id', p.id, { type: 'number' })}${fld('見出し', 'title', p.title)}${fld('本文', 'text', p.text, { type: 'textarea', rows: 2 })}${fld('出典', '出典', p['出典'])}<div class="btns"><button class="b primary" data-act="save-principle">保存</button><button class="b quiet" data-act="cancel">取消</button>${i >= 0 ? '<button class="b quiet" data-act="del-principle">削除</button>' : ''}</div></form>`;

  // ---------- 問い ----------
  function viewQIndex() {
    const rows = data['問い'].map((q) => `<tr><td><a href="#q/${q.num}">${E(qTitle(q))}</a><div class="fieldsum">${E(q.question)}</div></td><td>${E(q['戦略'].filter((s) => s['状態'] === '採用').map((s) => (s['区分'] === '共通' ? '' : s['区分'] + '：') + s.name).join('　／　') || '—')}</td><td class="num">${q['戦略'].filter((s) => s['状態'] === '候補').length}</td></tr>`).join('');
    return shell('問い', 'q', `<section class="card"><h2>13の問い</h2><div class="scroll"><table><thead><tr><th>問い</th><th>採用中</th><th class="num">候補</th></tr></thead><tbody>${rows}</tbody></table></div></section>
<section class="card doc"><h2>見方</h2><p>問いは固定。各問いの戦略が増減する。採用は口座で1つ（取引ごとの問いは複数可）。候補は採用と比べるために置く。変えるのは月次の見直しの時だけ。</p></section>`);
  }
  function viewQ(num) {
    const q = Q(num); if (!q) return viewQIndex();
    const qnav = '<nav class="q">' + data['問い'].map((x) => `<a href="#q/${x.num}" class="${x.num === q.num ? 'on' : ''}" title="${E(x.name)}">${x.num}</a>`).join('') + '</nav>';
    const def = q['定義'];
    const defs = `<section class="card"><h2>問いの定義</h2><dl class="def"><dt>何を決める問いか</dt><dd>${E(def['決めること'])}</dd><dt>何は決めないか</dt><dd>${E(def['決めないこと'])}</dd><dt>選び方</dt><dd>${E(def['選び方'])}</dd><dt>計算に使う数字</dt><dd>${E(def['計算に使う数字'] || 'なし')}</dd></dl></section>`;
    const adopted = q['戦略'].filter((s) => s['状態'] === '採用').map((s) => (s['区分'] === '共通' ? '' : s['区分'] + '：') + s.name).join('　／　');
    const cards = q['戦略'].map((s, i) => edit && edit.type === 'strategy' && edit.q === q.num && edit.idx === i ? strategyForm(q, s, i) : strategyCard(q, s, i)).join('');
    const add = edit && edit.type === 'strategy' && edit.q === q.num && edit.idx === -1 ? strategyForm(q, blankStrategy(q), -1) : `<div class="btns"><button class="b" data-act="edit-strategy" data-q="${q.num}" data-i="-1">戦略を足す</button></div>`;
    return shell(`${qTitle(q)}（${q.question}）`, 'q', `${qnav}${defs}<p class="adopt">採用中：${E(adopted || '—')}</p><section><h2>戦略</h2>${cards}${add}</section>`);
  }
  const blankStrategy = (q) => ({ name: '', '状態': '候補', '改定日': todayISO(), '区分': '共通', '一言で': '', '当てはまる条件': [], 'しないこと': [], '兼業での実行手順': '', '出典': '', '向く相場・向かない相場': '', '評価の仕方': '', '数値欄': Object.fromEntries((q['数値欄のキー'] || []).map((k) => [k, null])) });
  function strategyCard(q, s, i) {
    const li = (a) => (Array.isArray(a) ? a : lines(a)).map((x) => `<li>${E(x)}</li>`).join('');
    const nums = Object.entries(s['数値欄'] || {}).filter(([k, v]) => v != null && v !== '').map(([k, v]) => `<b>${E(k.replace(/_pct$/, '（%）').replace(/_億$/, '（億円）').replace(/_営業日$/, '（営業日）').replace(/_日$/, '（日）').replace(/_R$/, '（R）').replace(/_月$/, '（月）'))}</b> ${E(v)}`).join('　');
    return `<article class="strat ${s['状態'] === '不採用' ? 'off' : ''}" id="s-${E(s.name)}"><header><h3>${E(s.name)}</h3>${pill(s['状態'])}${s['区分'] !== '共通' ? `<span class="pill">${E(s['区分'])}</span>` : ''}<span class="rev">改定 ${E(s['改定日'])}</span></header>
<div class="doc"><p><b>一言で</b>　${E(s['一言で'])}</p><p><b>当てはまる条件</b></p><ul>${li(s['当てはまる条件'])}</ul><p><b>しないこと</b></p><ul>${li(s['しないこと'])}</ul>
<p><b>兼業での実行手順</b>　${E(s['兼業での実行手順'])}</p><p><b>出典</b>　${E(s['出典'])}</p><p><b>向く相場・向かない相場</b>　${E(s['向く相場・向かない相場'])}</p><p><b>評価の仕方</b>　${E(s['評価の仕方'])}</p>${nums ? `<div class="k">${nums}</div>` : ''}</div>
<div class="btns"><button class="b quiet" data-act="edit-strategy" data-q="${q.num}" data-i="${i}">編集</button></div></article>`;
  }
  function strategyForm(q, s, i) {
    const numf = (q['数値欄のキー'] || []).map((k) => fld(k, 'n:' + k, s['数値欄'] ? s['数値欄'][k] : '')).join('');
    return `<form id="f-strategy" class="strat form" data-q="${q.num}" data-i="${i}"><div class="form cols">${fld('戦略名', 'name', s.name)}${fld('状態', '状態', s['状態'], { type: 'select', options: ['採用', '候補', '不採用'] })}${fld('区分', '区分', s['区分'], { type: 'select', options: ['共通', 'IPO', '通常'] })}</div>
${fld('一言で', '一言で', s['一言で'])}${fld('当てはまる条件（1行1つ）', '当てはまる条件', text(s['当てはまる条件']), { type: 'textarea' })}${fld('しないこと（1行1つ）', 'しないこと', text(s['しないこと']), { type: 'textarea', rows: 3 })}
${fld('兼業での実行手順', '兼業での実行手順', s['兼業での実行手順'], { type: 'textarea', rows: 2 })}${fld('出典', '出典', s['出典'], { type: 'textarea', rows: 2 })}${fld('向く相場・向かない相場', '向く相場・向かない相場', s['向く相場・向かない相場'], { type: 'textarea', rows: 2 })}${fld('評価の仕方', '評価の仕方', s['評価の仕方'], { type: 'textarea', rows: 2 })}
${numf ? `<p class="fieldsum">数値欄（計算と今日の作業が読む）</p><div class="form cols">${numf}</div>` : ''}${fld('改定の理由（改定履歴に残る）', 'reason', '')}
<div class="btns"><button class="b primary" data-act="save-strategy">保存</button><button class="b quiet" data-act="cancel">取消</button>${i >= 0 ? '<button class="b quiet" data-act="del-strategy">削除</button>' : ''}</div></form>`;
  }

  // ---------- 記録 ----------
  function viewRecords() {
    const trades = data['取引'].slice().sort((a, b) => b.id - a.id);
    const tRows = trades.map((t, k) => { const i = data['取引'].indexOf(t); const st = Calc.state(t); const p = Calc.pl(t); const r = Calc.rValue(t);
      return `<tr class="row" data-act="edit-trade" data-i="${i}"><td class="nw">${t.id}</td><td class="name">${E(t['銘柄名'])}<span class="code">${E(t['コード'])}</span></td><td class="nw">${E(t['区分'])}</td><td class="nw">${E(t['型'])}</td><td class="nw">${E(t['記録日'] || '')}</td><td><span class="pill ${st === '保有中' || st === '一部売却' ? 'pill-ok' : st === '発注待ち' ? 'pill-warn' : ''}">${st}</span></td><td class="num">${p == null ? '' : yen(p)}</td><td class="num">${r == null ? '' : r.toFixed(2)}</td></tr>`; }).join('');
    const tForm = edit && edit.type === 'trade' ? tradeForm(edit.idx >= 0 ? data['取引'][edit.idx] : blankTrade(), edit.idx) : '';
    const cRows = data['候補'].map((c, i) => `<tr class="row" data-act="edit-cand" data-i="${i}"><td class="nw">${E(c['日付'])}</td><td class="name">${E(c['銘柄名'])}<span class="code">${E(c['コード'])}</span></td><td class="nw">${E(c['区分'])}</td><td>${E(c['絞り込み'] || '')}</td><td class="nw">${(c['判定'] || []).map((x) => x || '・').join('')}</td><td><span class="pill ${candState(c) === '監視中' ? 'pill-ok' : ''}">${candState(c)}</span></td></tr>`).join('');
    const cForm = edit && edit.type === 'cand' ? candForm(edit.idx >= 0 ? data['候補'][edit.idx] : blankCand(), edit.idx) : '';
    return shell('記録', 'records', `<section class="card"><div class="bar"><h2>取引（1行1建玉）</h2><button class="b" data-act="edit-trade" data-i="-1">取引を足す</button></div>${tForm}<div class="scroll"><table><thead><tr><th>No</th><th>銘柄</th><th>区分</th><th>型</th><th>記録日</th><th>状態</th><th class="num">損益</th><th class="num">R</th></tr></thead><tbody>${tRows}</tbody></table></div></section>
<section class="card"><div class="bar"><h2>候補</h2><button class="b" data-act="edit-cand" data-i="-1">候補を足す</button></div>${cForm}<div class="scroll"><table><thead><tr><th>日付</th><th>銘柄</th><th>区分</th><th>絞り込み</th><th>4項目</th><th>状態</th></tr></thead><tbody>${cRows}</tbody></table></div></section>`);
  }
  const blankTrade = () => ({ id: Math.max(0, ...data['取引'].map((t) => t.id)) + 1, 'コード': '', '銘柄名': '', '区分': '通常', '型': '', '利確': '', '注文': '', '期限': '', '追加': '', '記録日': todayISO(), '基準価格': null, '損切り価格': null, '発注価格': null, '株数': null, '約定日': null, '約定価格': null, '約定株数': null, 'イベント日': null, 'イベント種別': null, '売り': [], '状態': '', '人の判定': '', 'AIの判定': '', 'メモ': '' });
  function tradeForm(t, i) {
    const sell = (k) => { const s = (t['売り'] || [])[k] || {}; return `<div class="form cols">${fld(`売り${k + 1} 日付`, `s${k}d`, s['日付'], { type: 'date' })}${fld('価格', `s${k}p`, s['価格'], { type: 'number' })}${fld('株数', `s${k}q`, s['株数'], { type: 'number' })}</div>`; };
    const calcBox = edit.calc ? `<div class="calc ${edit.calc.ok ? '' : 'ng'}">発注価格 ${yen(edit.calc.entry)}円、損切り幅 ${edit.calc.widthPct}%、1R ${yen(edit.calc.oneR)}円 → <b>${edit.calc.qty}株</b>（投入 ${yen(edit.calc.amount)}円、この取引のリスク ${yen(edit.calc.risk)}円、全部損切りで ${edit.calc.totalRiskPct}%）${edit.calc.ok ? '　新規買いできる' : '　新規買いしない：' + edit.calc.reasons.join('・')}</div>` : '';
    return `<form id="f-trade" class="form" data-i="${i}"><div class="form cols">${fld('No', 'id', t.id, { type: 'number' })}${fld('コード', 'コード', t['コード'])}${fld('銘柄名', '銘柄名', t['銘柄名'])}${fld('区分', '区分', t['区分'], { type: 'select', options: ['通常', 'IPO'] })}</div>
<div class="form cols">${fld('型（問い3）', '型', t['型'], { type: 'select', options: [''].concat(slist(3)) })}${fld('注文（問い4）', '注文', t['注文'], { type: 'select', options: [''].concat(slist(4)) })}${fld('利確（問い6）', '利確', t['利確'], { type: 'select', options: [''].concat(slist(6)) })}${fld('期限（問い7）', '期限', t['期限'], { type: 'select', options: [''].concat(slist(7)) })}${fld('追加（問い8）', '追加', t['追加'], { type: 'select', options: [''].concat(slist(8)) })}</div>
<div class="form cols">${fld('記録日', '記録日', t['記録日'], { type: 'date' })}${fld('基準価格', '基準価格', t['基準価格'], { type: 'number' })}${fld('損切り価格', '損切り価格', t['損切り価格'], { type: 'number' })}${fld('発注価格', '発注価格', t['発注価格'], { type: 'number' })}${fld('株数', '株数', t['株数'], { type: 'number' })}</div>
<div class="btns"><button class="b" data-act="calc-trade" type="button">発注価格と株数を計算</button></div>${calcBox}
<div class="form cols">${fld('約定日', '約定日', t['約定日'], { type: 'date' })}${fld('約定価格', '約定価格', t['約定価格'], { type: 'number' })}${fld('約定株数', '約定株数', t['約定株数'], { type: 'number' })}${fld('イベント日', 'イベント日', t['イベント日'], { type: 'date' })}${fld('イベント種別', 'イベント種別', t['イベント種別'] || '', { type: 'select', options: ['', '決算', '解除'] })}</div>
${sell(0)}${sell(1)}<div class="form cols">${fld('状態（空欄なら自動）', '状態', t['状態'] === '取消' ? '取消' : '', { type: 'select', options: ['', '取消'] })}${fld('人の判定', '人の判定', t['人の判定'])}${fld('AIの判定', 'AIの判定', t['AIの判定'])}</div>${fld('メモ', 'メモ', t['メモ'])}
<div class="btns"><button class="b primary" data-act="save-trade">保存</button><button class="b quiet" data-act="cancel">取消</button>${i >= 0 ? '<button class="b quiet" data-act="del-trade">削除</button>' : ''}</div></form>`;
  }
  const blankCand = () => ({ '日付': todayISO(), 'コード': '', '銘柄名': '', '区分': '通常', '上場日': null, '売買代金_億': null, '時価総額_億': null, '終値': null, '想定損切り': null, '絞り込み': '', '判定': [null, null, null, null], '型が出た日': null, 'メモ': '' });
  function candForm(c, i) {
    const labels = (Calc.adopted(data['問い'], 2, c['区分']) || {})['当てはまる条件'] || ['項目1', '項目2', '項目3', '項目4'];
    const j = c['判定'] || [];
    return `<form id="f-cand" class="form" data-i="${i}"><div class="form cols">${fld('日付', '日付', c['日付'], { type: 'date' })}${fld('コード', 'コード', c['コード'])}${fld('銘柄名', '銘柄名', c['銘柄名'])}${fld('区分', '区分', c['区分'], { type: 'select', options: ['通常', 'IPO'] })}${fld('上場日（IPO）', '上場日', c['上場日'], { type: 'date' })}</div>
<div class="form cols">${fld('売買代金（億円）', '売買代金_億', c['売買代金_億'], { type: 'number', step: '0.1' })}${fld('時価総額（億円）', '時価総額_億', c['時価総額_億'], { type: 'number' })}${fld('終値', '終値', c['終値'], { type: 'number' })}${fld('想定損切り価格', '想定損切り', c['想定損切り'], { type: 'number' })}${fld('絞り込み（空欄なら自動）', '絞り込み', c['絞り込み'], { ph: '可／不可：理由' })}</div>
<p class="fieldsum">4項目（問い2の採用中から）</p><div class="form cols">${labels.slice(0, 4).map((l, k) => fld(l, 'j' + k, j[k] || '', { type: 'select', options: ['', '○', '×'] })).join('')}</div>
<div class="form cols">${fld('型が出た日', '型が出た日', c['型が出た日'], { type: 'date' })}${fld('メモ', 'メモ', c['メモ'])}</div>
<div class="btns"><button class="b primary" data-act="save-cand">保存</button><button class="b quiet" data-act="cancel">取消</button>${i >= 0 ? '<button class="b quiet" data-act="del-cand">削除</button>' : ''}</div></form>`;
  }
  function screen(c) {
    const n = Calc.nums(data['問い'], 1, c['区分']);
    if (c['売買代金_億'] != null && n['売買代金下限_億'] != null && c['売買代金_億'] < n['売買代金下限_億']) return '不可：売買代金';
    if (c['時価総額_億'] != null && n['時価総額下限_億'] != null && c['時価総額_億'] < n['時価総額下限_億']) return '不可：時価総額';
    if (c['区分'] === 'IPO' && c['上場日'] && c['日付']) {
      const cal = Calc.makeCal(data['前提']['休日']);
      const bd = cal.bdays(new Date(c['上場日'] + 'T00:00:00Z'), new Date(c['日付'] + 'T00:00:00Z')) + 1;
      if (n['上場後下限_営業日'] != null && bd < n['上場後下限_営業日']) return '不可：上場直後';
      const days = (new Date(c['日付']) - new Date(c['上場日'])) / 86400000;
      if (n['上場後上限_日'] != null && days > n['上場後上限_日']) return '不可：IPO期間外';
    }
    return '可';
  }

  // ---------- 改定履歴 ----------
  function viewHistory() {
    const rows = data['改定履歴'].slice().reverse().map((h) => `<tr><td class="nw">${E(h['日付'])}</td><td class="nw">${E(h['問い'])}</td><td>${E(h['戦略'])}</td><td class="nw">${E(h['変更'])}</td><td>${E(h['変更前'])}</td><td>${E(h['変更後'])}</td><td class="note">${E(h['理由'])}</td><td class="num">${E(h['件数'])}</td></tr>`).join('');
    const form = edit && edit.type === 'hist' ? `<form id="f-hist" class="form"><div class="form cols">${fld('日付', '日付', todayISO(), { type: 'date' })}${fld('問い', '問い', '')}${fld('戦略', '戦略', '')}${fld('変更', '変更', '数値変更', { type: 'select', options: ['追加', '採用', '候補', '不採用', '数値変更', '文言変更', '削除'] })}${fld('変更前', '変更前', '')}${fld('変更後', '変更後', '')}${fld('根拠の件数', '件数', 0, { type: 'number' })}</div>${fld('理由', '理由', '')}<div class="btns"><button class="b primary" data-act="save-hist">保存</button><button class="b quiet" data-act="cancel">取消</button></div></form>` : '';
    return shell('改定履歴', 'history', `<section class="card"><div class="bar"><h2>戦略を変えた記録</h2><button class="b" data-act="edit-hist">1行足す</button></div><p class="fieldsum">画面で戦略の状態や数値を変えると自動で1行入る。AIが変えた時も同じ。</p>${form}<div class="scroll"><table><thead><tr><th>日付</th><th>問い</th><th>戦略</th><th>変更</th><th>前</th><th>後</th><th>理由</th><th class="num">件数</th></tr></thead><tbody>${rows}</tbody></table></div></section>`);
  }

  // ---------- 接続 ----------
  function viewSettings(err) {
    return shell('接続', 'settings', `<section class="card"><h2>GitHub</h2><p class="fieldsum">この画面はリポジトリの data/ を直接読み書きする。トークンはこの端末のブラウザにだけ保存される。</p>${err ? `<div class="msg ng">${E(err)}</div>` : ''}
<form id="f-cfg" class="form"><div class="form cols">${fld('owner', 'owner', cfg.owner)}${fld('repo', 'repo', cfg.repo)}${fld('branch', 'branch', cfg.branch)}</div>${fld('トークン（Fine-grained。このリポジトリだけ、Contents の Read and write）', 'token', cfg.token, { type: 'password' })}
<div class="btns"><button class="b primary" data-act="save-cfg">保存して読み込む</button><button class="b quiet" data-act="clear-cfg" type="button">トークンを消す</button></div></form>
<div class="doc" style="margin-top:14px"><p class="fieldsum">トークンの作り方：GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token。Repository access で secondary-investment だけを選び、Permissions の Contents を Read and write にする。</p></div></section>`);
  }

  // ---------- 描画とイベント ----------
  function render() {
    const r = route();
    if (!loaded) { app.innerHTML = viewSettings(r[0] === 'settings' ? '' : 'トークンを入れると読み込みます'); return; }
    let html;
    if (r[0] === 'rules') html = viewRules();
    else if (r[0] === 'q') html = r[1] ? viewQ(r[1]) : viewQIndex();
    else if (r[0] === 'records') html = viewRecords();
    else if (r[0] === 'history') html = viewHistory();
    else if (r[0] === 'settings') html = viewSettings();
    else html = viewToday();
    app.innerHTML = html;
    if (r[0] === 'q' && r[2]) { const el = document.getElementById('s-' + decodeURIComponent(r[2])); if (el) el.scrollIntoView(); }
    if (!r[0] || r[0] === 'today') afterToday();
    msg = null;
  }
  window.addEventListener('hashchange', () => { edit = null; render(); });

  app.addEventListener('submit', (e) => e.preventDefault());
  app.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const act = b.dataset.act; const i = Number(b.dataset.i);
    if (act === 'cancel') { edit = null; render(); return; }
    if (act === 'edit-principle') { edit = { type: 'principle', idx: i }; render(); return; }
    if (act === 'edit-premise') { edit = { type: 'premise' }; render(); return; }
    if (act === 'edit-strategy') { edit = { type: 'strategy', q: Number(b.dataset.q), idx: i }; render(); return; }
    if (act === 'edit-trade') { edit = { type: 'trade', idx: i }; render(); window.scrollTo(0, 0); return; }
    if (act === 'edit-cand') { edit = { type: 'cand', idx: i }; render(); return; }
    if (act === 'edit-hist') { edit = { type: 'hist' }; render(); return; }
    if (act === 'clear-cfg') { cfg.token = ''; localStorage.setItem(KEY, JSON.stringify(cfg)); loaded = false; location.hash = '#settings'; render(); return; }
    e.preventDefault();
    if (act === 'save-cfg') { Object.assign(cfg, fd(document.getElementById('f-cfg'))); localStorage.setItem(KEY, JSON.stringify(cfg)); await boot(); location.hash = '#today'; return; }
    if (act === 'save-principle') {
      const f = document.getElementById('f-principle'), v = fd(f), idx = Number(f.dataset.i);
      const p = { id: Number(v.id), title: v.title, text: v.text, '出典': v['出典'] };
      if (idx >= 0) data['原則'][idx] = p; else data['原則'].push(p);
      data['原則'].sort((a, b) => a.id - b.id);
      if (await save('原則', '原則：' + p.title)) edit = null; render(); return;
    }
    if (act === 'del-principle') { const idx = Number(document.getElementById('f-principle').dataset.i); const p = data['原則'].splice(idx, 1)[0]; if (await save('原則', '原則を削除：' + p.title)) edit = null; render(); return; }
    if (act === 'save-premise') {
      const v = fd(document.getElementById('f-premise')); const pre = data['前提'];
      ['初期資金', '月初資金', '停止残高', '単元'].forEach((k) => { pre[k] = Number(v[k]); }); pre['証券会社'] = v['証券会社']; pre['休日'] = lines(v['休日']);
      if (await save('前提', '前提を更新')) edit = null; render(); return;
    }
    if (act === 'save-strategy') {
      const f = document.getElementById('f-strategy'), v = fd(f), q = Q(f.dataset.q), idx = Number(f.dataset.i);
      if (!v.name.trim()) { msg = { ng: true, text: '戦略名を入れてください' }; render(); return; }
      const old = idx >= 0 ? q['戦略'][idx] : null;
      const s = { name: v.name.trim(), '状態': v['状態'], '改定日': todayISO(), '区分': v['区分'], '一言で': v['一言で'], '当てはまる条件': lines(v['当てはまる条件']), 'しないこと': lines(v['しないこと']),
        '兼業での実行手順': v['兼業での実行手順'], '出典': v['出典'], '向く相場・向かない相場': v['向く相場・向かない相場'], '評価の仕方': v['評価の仕方'], '数値欄': {} };
      (q['数値欄のキー'] || []).forEach((k) => { s['数値欄'][k] = numOrNull(v['n:' + k]); });
      if (old && old.name !== s.name) { data['取引'].forEach((t) => { ['型', '注文', '利確', '期限', '追加'].forEach((k) => { if (t[k] === old.name) t[k] = s.name; }); }); }
      if (idx >= 0) q['戦略'][idx] = s; else q['戦略'].push(s);
      const change = !old ? '追加' : old['状態'] !== s['状態'] ? s['状態'] : JSON.stringify(old['数値欄']) !== JSON.stringify(s['数値欄']) ? '数値変更' : '文言変更';
      const before = !old ? '' : change === '数値変更' ? JSON.stringify(old['数値欄']) : old['状態'];
      const after = change === '数値変更' ? JSON.stringify(s['数値欄']) : s['状態'];
      data['改定履歴'].push({ '日付': todayISO(), '問い': String(q.num), '戦略': s.name, '変更': change, '変更前': before, '変更後': after, '理由': v.reason || '', '件数': data['取引'].filter((t) => Calc.state(t) === '決済済み' && [t['型'], t['注文'], t['利確'], t['期限'], t['追加']].includes(s.name)).length });
      const ok = await save('問い', `問い${q.num} ${s.name}：${change}`);
      if (ok) { await save('改定履歴', `改定履歴：問い${q.num} ${s.name}`); if (old && old.name !== s.name) await save('取引', '戦略名の変更を取引に反映'); edit = null; }
      render(); return;
    }
    if (act === 'del-strategy') {
      const f = document.getElementById('f-strategy'), q = Q(f.dataset.q), idx = Number(f.dataset.i), s = q['戦略'][idx];
      const used = data['取引'].some((t) => [t['型'], t['注文'], t['利確'], t['期限'], t['追加']].includes(s.name));
      if (used) { msg = { ng: true, text: '取引で使われている戦略は消せません。状態を不採用にしてください' }; render(); return; }
      q['戦略'].splice(idx, 1);
      data['改定履歴'].push({ '日付': todayISO(), '問い': String(q.num), '戦略': s.name, '変更': '削除', '変更前': s['状態'], '変更後': '', '理由': '', '件数': 0 });
      if (await save('問い', `問い${q.num} ${s.name}：削除`)) { await save('改定履歴', '改定履歴：削除'); edit = null; } render(); return;
    }
    if (act === 'calc-trade') {
      const v = fd(document.getElementById('f-trade'));
      const o = (Calc.byName(data['問い'], 4, v['注文']) || Calc.adopted(data['問い'], 4) || {})['数値欄'] || {};
      const base = Number(v['基準価格']), stop = Number(v['損切り価格']);
      const entry = v['発注価格'] ? Number(v['発注価格']) : Math.round(base * (1 + (o['乖離_pct'] || 0) / 100));
      edit.calc = Calc.size(data, entry, stop, v['区分'], v['記録日'] || todayISO());
      edit.draft = v; edit.draft['発注価格'] = entry; edit.draft['株数'] = edit.calc.qty;
      render();
      const f = document.getElementById('f-trade');
      Object.entries(edit.draft).forEach(([k, val]) => { const el = f.elements[k]; if (el) el.value = val == null ? '' : val; });
      return;
    }
    if (act === 'save-trade') {
      const f = document.getElementById('f-trade'), v = fd(f), idx = Number(f.dataset.i);
      const t = { id: Number(v.id), 'コード': v['コード'], '銘柄名': v['銘柄名'], '区分': v['区分'], '型': v['型'], '利確': v['利確'], '注文': v['注文'], '期限': v['期限'], '追加': v['追加'],
        '記録日': v['記録日'] || null, '基準価格': numOrNull(v['基準価格']), '損切り価格': numOrNull(v['損切り価格']), '発注価格': numOrNull(v['発注価格']), '株数': numOrNull(v['株数']),
        '約定日': v['約定日'] || null, '約定価格': numOrNull(v['約定価格']), '約定株数': numOrNull(v['約定株数']), 'イベント日': v['イベント日'] || null, 'イベント種別': v['イベント種別'] || null,
        '売り': [0, 1].filter((k) => v['s' + k + 'd']).map((k) => ({ '日付': v['s' + k + 'd'], '価格': Number(v['s' + k + 'p']), '株数': Number(v['s' + k + 'q']) })),
        '状態': '', '人の判定': v['人の判定'], 'AIの判定': v['AIの判定'], 'メモ': v['メモ'] };
      t['状態'] = v['状態'] === '取消' ? '取消' : Calc.state(t);
      if (idx >= 0) data['取引'][idx] = t; else data['取引'].push(t);
      if (await save('取引', `取引 ${t.id} ${t['銘柄名']}：${t['状態']}`)) edit = null; render(); return;
    }
    if (act === 'del-trade') { const idx = Number(document.getElementById('f-trade').dataset.i); const t = data['取引'].splice(idx, 1)[0]; if (await save('取引', `取引 ${t.id} を削除`)) edit = null; render(); return; }
    if (act === 'save-cand') {
      const f = document.getElementById('f-cand'), v = fd(f), idx = Number(f.dataset.i);
      const c = { '日付': v['日付'], 'コード': v['コード'], '銘柄名': v['銘柄名'], '区分': v['区分'], '上場日': v['上場日'] || null, '売買代金_億': numOrNull(v['売買代金_億']), '時価総額_億': numOrNull(v['時価総額_億']),
        '終値': numOrNull(v['終値']), '想定損切り': numOrNull(v['想定損切り']), '絞り込み': v['絞り込み'], '判定': [0, 1, 2, 3].map((k) => v['j' + k] || null), '型が出た日': v['型が出た日'] || null, 'メモ': v['メモ'] };
      if (!c['絞り込み']) c['絞り込み'] = screen(c);
      if (idx >= 0) data['候補'][idx] = c; else data['候補'].push(c);
      if (await save('候補', `候補 ${c['銘柄名']}：${candState(c)}`)) edit = null; render(); return;
    }
    if (act === 'del-cand') { const idx = Number(document.getElementById('f-cand').dataset.i); const c = data['候補'].splice(idx, 1)[0]; if (await save('候補', `候補 ${c['銘柄名']} を削除`)) edit = null; render(); return; }
    if (act === 'save-hist') { const v = fd(document.getElementById('f-hist')); data['改定履歴'].push({ '日付': v['日付'], '問い': v['問い'], '戦略': v['戦略'], '変更': v['変更'], '変更前': v['変更前'], '変更後': v['変更後'], '理由': v['理由'], '件数': Number(v['件数'] || 0) }); if (await save('改定履歴', '改定履歴：' + v['戦略'])) edit = null; render(); return; }
  });

  async function boot() {
    try { await loadAll(); render(); }
    catch (e) { loaded = false; app.innerHTML = viewSettings(e.message === 'settings' ? 'GitHubのトークンを入れてください' : e.message); }
  }
  boot();
})();
