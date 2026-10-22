/* 戦略に依存しない計算。画面（ブラウザ）と AI（node app/calc.js status）が同じものを使う。
   node app/calc.js status [YYYY-MM-DD]
   node app/calc.js size 発注価格 損切り価格 区分 [YYYY-MM-DD]
   node app/calc.js orders [YYYY-MM-DD]
*/
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Calc = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const DAY = 86400000;
  const d = (s) => (s ? new Date(s + 'T00:00:00Z') : null);
  const iso = (x) => x.toISOString().slice(0, 10);

  function makeCal(holidays) {
    const H = new Set(holidays || []);
    const isBd = (x) => { const w = x.getUTCDay(); return w !== 0 && w !== 6 && !H.has(iso(x)); };
    const workday = (x, n) => { let y = new Date(x.getTime()); const step = n > 0 ? 1 : -1; while (n !== 0) { y = new Date(y.getTime() + step * DAY); if (isBd(y)) n -= step; } return y; };
    const bdays = (a, b) => { if (b < a) return -bdays(b, a); let n = 0, y = new Date(a.getTime()); while (y < b) { y = new Date(y.getTime() + DAY); if (isBd(y)) n++; } return n; };
    return { isBd, workday, bdays };
  }

  /** 採用中の戦略（区分→共通の順）。 */
  function adopted(questions, num, kubun) {
    const q = questions.find((x) => x.num === num);
    if (!q) return null;
    const list = q['戦略'].filter((s) => s['状態'] === '採用');
    return list.find((s) => s['区分'] === kubun) || list.find((s) => s['区分'] === '共通') || list[0] || null;
  }
  const nums = (questions, num, kubun) => (adopted(questions, num, kubun) || {})['数値欄'] || {};
  function byName(questions, num, name) {
    const q = questions.find((x) => x.num === num);
    return (q && q['戦略'].find((s) => s.name === name)) || null;
  }

  function pl(t) {
    if (!t['約定価格'] || !t['売り'] || !t['売り'].length) return null;
    return t['売り'].reduce((a, s) => a + (s['価格'] - t['約定価格']) * s['株数'], 0);
  }
  const soldQty = (t) => (t['売り'] || []).reduce((a, s) => a + (s['株数'] || 0), 0);
  const remQty = (t) => (t['約定株数'] || 0) - soldQty(t);
  function state(t) {
    if (!t['約定日']) return t['記録日'] ? '注文中' : '';
    if (t['状態'] === '取消') return '取消';
    if (remQty(t) <= 0) return '決済済み';
    return soldQty(t) > 0 ? '一部利確' : '保有中';
  }
  const closeDate = (t) => (state(t) === '決済済み' ? t['売り'].map((s) => s['日付']).sort().slice(-1)[0] : null);
  const rValue = (t) => { const p = pl(t); return p == null ? null : p / ((t['約定価格'] - t['損切り価格']) * t['約定株数']); };

  function status(data, today) {
    const { 前提: pre, 問い: qs, 取引: trades } = data;
    const cal = makeCal(pre['休日']);
    const T = d(today);
    const closed = trades.filter((t) => state(t) === '決済済み').map((t) => ({ t, pl: pl(t), c: closeDate(t) })).sort((a, b) => (a.c < b.c ? -1 : 1));
    const cash = pre['初期資金'] + closed.reduce((a, x) => a + x.pl, 0);
    const peak = Math.max(pre['初期資金'], cash);
    const dd = 1 - cash / peak;
    const q11 = nums(qs, 11), q9 = nums(qs, 9);
    let stage = '通常';
    if (cash < pre['停止残高'] || dd >= q11['段階3_pct'] / 100) stage = '停止';
    else if (dd >= q11['段階2_pct'] / 100) stage = '段階2';
    else if (dd >= q11['段階1_pct'] / 100) stage = '段階1';
    const held = trades.filter((t) => ['保有中', '一部利確'].includes(state(t)));
    const waiting = trades.filter((t) => state(t) === '注文中');
    let openRisk = 0;
    held.forEach((t) => { openRisk += (t['約定価格'] - t['損切り価格']) * remQty(t); });
    waiting.forEach((t) => { openRisk += (t['発注価格'] - t['損切り価格']) * (t['株数'] || 0); });
    let streak = 0;
    for (let i = closed.length - 1; i >= 0 && closed[i].pl < 0; i--) streak++;
    const lossToday = closed.some((x) => x.c === today && x.pl < 0);
    const prevBd = iso(cal.workday(T, -1));
    const lossPrev = closed.some((x) => x.c === prevBd && x.pl < 0);
    // 地合い：引け後に人が答えた値（data/地合い.json）。当日か前営業日の分だけ有効。無ければ未確認（止めない）
    const q10 = nums(qs, 10);
    const mk = (data['地合い'] || []).filter((x) => x['日付'] <= today).sort((a, b) => (a['日付'] < b['日付'] ? -1 : 1)).slice(-1)[0];
    const market = { date: mk ? mk['日付'] : null, ok: null, text: '未確認', bad: [] };
    if (mk && (mk['日付'] === today || mk['日付'] === prevBd)) {
      if (mk['指数25日線'] === '×') market.bad.push('指数が' + (q10['移動平均_日'] || 25) + '日線の下');
      if (mk['先物夜間'] === '×') market.bad.push('先物夜間が−' + (q10['先物夜間_pct'] || 2) + '%超');
      market.ok = market.bad.length === 0;
      market.text = (market.ok ? '○' : market.bad.join('、')) + '（' + mk['日付'].slice(5).replace('-', '/') + '）';
    }
    const reasons = [];
    if (market.ok === false) reasons.push('地合い：' + market.bad.join('、'));
    if (stage === '停止') reasons.push('取引停止（50万円割れ または 最高額から半減）');
    if (stage === '段階2') reasons.push('新規買い停止（最高額から' + q11['段階2_pct'] + '%減）');
    if (lossToday) reasons.push('損切り当日');
    if (streak >= q11['連敗停止']) reasons.push(streak + '連敗');
    if (held.length + waiting.length >= q9['同時保有上限']) reasons.push('保有銘柄数の上限');
    let lot = 1;
    if (stage === '段階1') lot = q11['段階1ロット_pct'] / 100;
    else if (lossPrev) lot = q11['損切り直後ロット_pct'] / 100;
    return {
      today, cash: Math.round(cash), peak: Math.round(peak), ddPct: Math.round(dd * 1000) / 10, stage,
      held: held.length, heldMax: q9['同時保有上限'], waiting: waiting.length,
      openRiskPct: Math.round(openRisk / pre['月初資金'] * 1000) / 10, openRiskMax: q9['合計リスク上限_pct'],
      streak, lossToday, lossPrev, lot, market, ok: reasons.length === 0, reasons,
    };
  }

  function size(data, entry, stop, kubun, today) {
    const { 前提: pre, 問い: qs } = data;
    const st = status(data, today);
    const q5 = nums(qs, 5), unit = pre['単元'];
    const per = entry - stop;
    const out = { entry, stop, widthPct: Math.round(per / entry * 10000) / 100, lot: st.lot };
    if (per <= 0) return Object.assign(out, { qty: 0, ok: false, reasons: ['損切りが発注価格より上'] });
    const oneR = pre['月初資金'] * q5['1R_pct'] / 100 * st.lot;
    let n = Math.floor(oneR / per / unit) * unit;
    if (n === 0 && per * unit <= pre['月初資金'] * q5['1R上限_pct'] / 100) n = unit;
    const cap = Math.floor(pre['月初資金'] * q5['1銘柄上限_pct'] / 100 / entry / unit) * unit;
    n = Math.min(n, cap);
    const total = st.openRiskPct + n * per / pre['月初資金'] * 100;
    const reasons = [...st.reasons];
    if (n === 0) reasons.push('1単元でも1Rの上限を超える');
    if (total > nums(qs, 9)['合計リスク上限_pct']) reasons.push('全部損切りした時の損失が上限を超える');
    const t3 = nums(qs, 3, kubun);
    if (t3['損切り幅下限_pct'] != null && out.widthPct < t3['損切り幅下限_pct']) reasons.push('損切り幅が狭い');
    if (t3['損切り幅上限_pct'] != null && out.widthPct > t3['損切り幅上限_pct']) reasons.push('損切り幅が広い');
    const q7 = nums(qs, 7, kubun);
    const cal = makeCal(pre['休日']);
    return Object.assign(out, { oneR: Math.round(oneR), qty: n, amount: n * entry, risk: Math.round(n * per), totalRiskPct: Math.round(total * 10) / 10,
      ok: reasons.length === 0, reasons, deadline: iso(cal.workday(d(today), q7['最大保有_営業日'])) });
  }

  function deadline(data, t) {
    const { 前提: pre, 問い: qs } = data;
    const cal = makeCal(pre['休日']);
    const q7 = (byName(qs, 7, t['期限']) || adopted(qs, 7, t['区分']) || {})['数値欄'] || {};
    let limit = cal.workday(d(t['約定日']), q7['最大保有_営業日'] || 20);
    if (t['イベント日']) {
      const before = t['イベント種別'] === '解除' ? q7['解除前_営業日'] : q7['決算前_営業日'];
      if (before != null) { const ev = cal.workday(d(t['イベント日']), -before); if (ev < limit) limit = ev; }
    }
    return limit;
  }

  /** 明日の発注と、保有中の次の行動。 */
  function orders(data, today) {
    const { 前提: pre, 問い: qs, 取引: trades } = data;
    const cal = makeCal(pre['休日']);
    const T = d(today), unit = pre['単元'];
    const out = { new: [], hold: [] };
    trades.forEach((t) => {
      const s = state(t);
      if (s === '注文中') {
        const o = (byName(qs, 4, t['注文']) || adopted(qs, 4) || {})['数値欄'] || {};
        const age = cal.bdays(d(t['記録日']), T);
        out.new.push({ t, buy: { kind: '逆指値買い', price: t['発注価格'], qty: t['株数'] }, stop: { kind: '逆指値売り（損切り）', price: t['損切り価格'], qty: t['株数'] },
          note: t['型'] + '。' + (o['取消_営業日'] ? o['取消_営業日'] + '営業日で約定しなければ取消' : ''), expired: o['取消_営業日'] ? age >= o['取消_営業日'] : false });
      } else if (s === '保有中' || s === '一部利確') {
        const limit = deadline(data, t);
        const left = cal.bdays(T, limit);
        const tp = (byName(qs, 6, t['利確']) || adopted(qs, 6) || {})['数値欄'] || {};
        const lvl = tp['利確水準_R'] || 1, pct = tp['利確割合_pct'] || 50, trail = tp['トレーリング'] || '';
        const n = t['約定株数'], rem = remQty(t);
        const tpPrice = Math.round(t['約定価格'] + (t['約定価格'] - t['損切り価格']) * lvl);
        const part = pct >= 100 ? n : (n > unit ? Math.floor(n * pct / 100 / unit) * unit : 0);
        const h = { t, state: s, rem, limit: iso(limit), left, orders: [], checks: [] };
        if (left <= 0) h.orders.push({ kind: '成行売り（寄付）', qty: rem, why: '期限' });
        else if (s === '保有中') {
          if (part) h.orders.push({ kind: '指値売り', price: tpPrice, qty: part, why: '利確（+' + lvl + 'R）。置いてあれば何もしない' });
          else h.checks.push('1単元のため分割利確なし');
          if (trail && trail !== 'なし') h.checks.push(trail);
        } else {
          h.orders.push({ kind: '逆指値売りを変更', price: t['約定価格'], qty: rem, why: '半分利確後は建値へ。済んでいれば何もしない' });
          if (trail && trail !== 'なし') h.checks.push(trail);
        }
        h.checks.push('決算・材料の発表');
        out.hold.push(h);
      }
    });
    return out;
  }

  /** 問い×戦略の集計。 */
  function summary(data) {
    const { 問い: qs, 取引: trades } = data;
    const closed = trades.filter((t) => state(t) === '決済済み');
    const minN = nums(qs, 12)['最小件数'] || 5;
    const table = (num, key) => (qs.find((q) => q.num === num)['戦略']).map((s) => {
      const ts = closed.filter((t) => t[key] === s.name);
      const rs = ts.map(rValue);
      const wins = ts.filter((t) => pl(t) >= 0).length;
      return { name: s.name, state: s['状態'], n: ts.length, winPct: ts.length ? Math.round(wins / ts.length * 100) : null,
        rSum: ts.length ? Math.round(rs.reduce((a, b) => a + b, 0) * 100) / 100 : null, rAvg: ts.length ? Math.round(rs.reduce((a, b) => a + b, 0) / ts.length * 100) / 100 : null,
        ready: ts.length >= minN, minN };
    });
    return { minN, 型: table(3, '型'), 利確: table(6, '利確'), 期限: table(7, '期限'), 注文: table(4, '注文') };
  }

  const api = { makeCal, adopted, nums, byName, pl, state, closeDate, rValue, remQty, status, size, orders, deadline, summary };

  if (typeof module === 'object' && module.exports && typeof require === 'function' && require.main === module) {
    const fs = require('fs'), path = require('path');
    const dir = path.join(__dirname, '..', 'data');
    const load = (n) => JSON.parse(fs.readFileSync(path.join(dir, n + '.json'), 'utf8'));
    const data = { 前提: load('前提'), 問い: load('問い'), 取引: load('取引'), 候補: load('候補'), 地合い: fs.existsSync(path.join(dir, '地合い.json')) ? load('地合い') : [] };
    const [cmd, ...a] = process.argv.slice(2);
    // 日本時間の日付。コンテナの時計はUTCなので、朝9時前は前日になってしまう
    const jst = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
    const today = (a.find((x) => /^\d{4}-\d{2}-\d{2}$/.test(x))) || jst;
    let res;
    if (cmd === 'status') res = status(data, today);
    else if (cmd === 'size') res = size(data, Number(a[0]), Number(a[1]), a[2] || '通常', today);
    else if (cmd === 'orders') { const o = orders(data, today); res = { new: o.new.map((x) => ({ 銘柄: x.t['銘柄名'], 買い: x.buy, 損切り: x.stop, note: x.note, expired: x.expired })), hold: o.hold.map((x) => ({ 銘柄: x.t['銘柄名'], 状態: x.state, 期限日: x.limit, 残り営業日: x.left, 注文: x.orders, 確認: x.checks })) }; }
    else if (cmd === 'summary') res = summary(data);
    else { console.error('usage: status|size|orders|summary'); process.exit(1); }
    console.log(JSON.stringify(res, null, 1));
  }
  return api;
});
