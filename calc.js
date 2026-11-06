/* 戦略を知らない算数と、記録から出す口座の数字。画面（ブラウザ）と AI（node app/calc.js …）が同じものを使う。
   仕組みが知らないこと：問いの番号と役割、戦略名、行の数と中身、数値欄のキー名、材料の名前。
   知っていること：属性の値（対象・結果・判定者）、記録の形、算数。

   node app/calc.js materials [--code コード] [--trade id] [YYYY-MM-DD]   口座・銘柄・建玉・暦の材料（内部名で）
   node app/calc.js size 発注価格 損切り価格 1R額 1単元上限額 1銘柄上限額 [YYYY-MM-DD]   株数の算数
   node app/calc.js days YYYY-MM-DD N          N営業日後（負なら前）
   node app/calc.js stages [YYYY-MM-DD]         候補・取引・口座の段階
   node app/calc.js summary [YYYY-MM-DD]        問い×戦略の材料（評価の層）
*/
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Calc = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const DAY = 86400000;
  const d = (s) => (s ? new Date(String(s).slice(0, 10) + 'T00:00:00Z') : null);
  const iso = (x) => x.toISOString().slice(0, 10);

  // ---------- 暦 ----------
  function makeCal(holidays) {
    const H = new Set(holidays || []);
    const isBd = (x) => { const w = x.getUTCDay(); return w !== 0 && w !== 6 && !H.has(iso(x)); };
    const workday = (x, n) => { let y = new Date(x.getTime()); const step = n > 0 ? 1 : -1; while (n !== 0) { y = new Date(y.getTime() + step * DAY); if (isBd(y)) n -= step; } return y; };
    const bdays = (a, b) => { if (b < a) return -bdays(b, a); let n = 0, y = new Date(a.getTime()); while (y < b) { y = new Date(y.getTime() + DAY); if (isBd(y)) n++; } return n; };
    // 明日から数えて休場が何日続くか（3以上なら「3連休以上の前日」）
    const offDaysAhead = (x) => { let n = 0, y = new Date(x.getTime() + DAY); while (!isBd(y)) { n++; y = new Date(y.getTime() + DAY); if (n > 30) break; } return n; };
    return { isBd, workday, bdays, offDaysAhead };
  }

  // ---------- 問いと戦略（属性で探す。番号は使わない） ----------
  const questionsBy = (questions, pred) => (questions || []).filter(pred);
  const adoptedFor = (q, kubun) => {
    const list = (q['戦略'] || []).filter((s) => s['状態'] === '採用');
    return list.find((s) => s['区分'] === kubun) || list.find((s) => s['区分'] === '共通') || list[0] || null;
  };
  const byName = (q, name) => (q && (q['戦略'] || []).find((s) => s.name === name)) || null;
  // 適用範囲：対象の属性（区分・市場区分・業種…）で行を絞る
  const inScope = (row, attrs) => (row['適用範囲'] || []).every((a) => { const v = (attrs || {})[a['項目']]; const want = Array.isArray(a['値']) ? a['値'] : [a['値']]; return v != null && want.includes(v); });
  const rowsFor = (strategy, attrs) => (strategy ? (strategy['行'] || []) : []).filter((r) => inScope(r, attrs));
  const condRows = (strategy, attrs) => rowsFor(strategy, attrs).filter((r) => r['条件']);


  // ---------- 問いの群と並び（属性から導く。番号は使わない） ----------
  // 群：対象が 戦略・人 なら「仕組み」、採用の単位が 口座で1つ なら「口座全体」、それ以外は「取引の流れ」
  // 並び：結果の語彙の順（1つの取引を上から下へ）。同じ結果なら番号順
  const GROUPS = [['取引の流れ', '1つの取引を上から順に'], ['口座全体', '毎日、銘柄によらずかかる'], ['仕組み', '月末と、人がすること']];
  const RESULT_ORDER = ['候補に入れる', '段階を進める', '可否', '注文を作る', '注文の形', '株数', '売り注文', '新規可否', '提案', '人の手順'];
  const STEP = { '候補に入れる': '候補を出す', '段階を進める': '買ってよい銘柄か', '可否': '今日買うか', '注文を作る': '今日買うか', '注文の形': 'どう注文するか', '株数': 'いくら買うか', '売り注文': 'いつ売るか' };
  const groupOf = (q) => (['戦略', '人'].includes(q['対象']) ? '仕組み' : q['採用の単位'] === '口座で1つ' ? '口座全体' : '取引の流れ');
  const stepOf = (q) => STEP[q['結果']] || '';
  const sortQuestions = (qs) => (qs || []).slice().sort((a, b) => (RESULT_ORDER.indexOf(a['結果']) - RESULT_ORDER.indexOf(b['結果'])) || (a.num - b.num));

  // ---------- 判定の記録 ----------
  // 同じ（問い・条件）に複数あれば最後が有効。人が直した時もAIの分は残る
  const latest = (list, qnum, name) => { let hit = null; (list || []).forEach((j) => { if (j && typeof j === 'object' && j['問い'] === qnum && j['条件'] === name) hit = j; }); return hit; };
  const results = (list, qnum, names) => names.map((n) => { const j = latest(list, qnum, n); return j ? j['結果'] : '未'; });
  const compose = (gosei, rs) => (gosei === '全部' ? (rs.includes('×') ? '×' : rs.every((r) => r === '○') ? '○' : '未') : (rs.includes('○') ? '○' : rs.every((r) => r === '×') ? '×' : '未'));

  // ---------- 建玉 ----------
  function pl(t) { if (!t['約定価格'] || !t['売り'] || !t['売り'].length) return null; return t['売り'].reduce((a, s) => a + (s['価格'] - t['約定価格']) * s['株数'], 0); }
  const soldQty = (t) => (t['売り'] || []).reduce((a, s) => a + (s['株数'] || 0), 0);
  const remQty = (t) => (t['約定株数'] || 0) - soldQty(t);
  function state(t) {
    if (t['状態'] === '取消') return '取消';
    if (!t['約定日']) return t['記録日'] ? '注文中' : '';
    if (remQty(t) <= 0) return '決済済み';
    return soldQty(t) > 0 ? '一部利確' : '保有中';
  }
  const closeDate = (t) => (state(t) === '決済済み' ? t['売り'].map((s) => s['日付']).sort().slice(-1)[0] : null);
  const rValue = (t) => { const p = pl(t); return p == null ? null : p / ((t['約定価格'] - t['損切り価格']) * t['約定株数']); };
  const ruleOf = (t, qnum) => ((t['使うルール'] || {})[String(qnum)] || null);

  // ---------- 銘柄（候補）の段階 ----------
  // gate：対象が銘柄で結果が「段階を進める」問い。requiredNames：採用戦略の条件つきの行の名前
  // 候補の段階。型が出た日が入っていれば取引の状態で決まる：続いていれば「型が出た」、取消なら「ウォッチ中」に戻る、決済済みなら「終了」
  //（終了した銘柄は、次にスクリーニングを通った時に新しい候補として入り直す）
  const OPEN = ['注文中', '保有中', '一部利確'];
  function candStage(c, gate, trades) {
    if (c['絞り込み'] && c['絞り込み'] !== '可') return '見送り';
    const js = (c['判定'] || []).filter((j) => j && typeof j === 'object');
    if (!gate) return js.some((j) => j['根拠']) ? '確認待ち' : '仮判定中';
    const rs = results(js, gate.qnum, gate.names);
    if (rs.includes('×')) return '見送り';
    if (gate.names.length && rs.every((r) => r === '○') && c['確認']) {
      if (!c['型が出た日']) return 'ウォッチ中';
      const ts = (trades || []).filter((t) => t['コード'] === c['コード']);
      if (!ts.length) return 'ウォッチ中';
      if (ts.some((t) => OPEN.includes(state(t)))) return '型が出た';
      const last = ts.slice().sort((a, b) => String(a['記録日'] || '').localeCompare(String(b['記録日'] || ''))).slice(-1)[0];
      return state(last) === '取消' ? 'ウォッチ中' : '終了';
    }
    return js.some((j) => j['問い'] === gate.qnum && (j['根拠'] || j['結果'] === '○' || j['結果'] === '×')) ? '確認待ち' : '仮判定中';
  }
  // 候補の属性（適用範囲と採用の選択に使う）
  const heldNow = (code, trades) => (trades || []).some((t) => t['コード'] === code && OPEN.includes(state(t)));
  const candAttrs = (c, trades) => ({ '区分': c['区分'], '市場区分': c['市場区分'] || null, '業種（33業種）': c['業種'] || null, '保有の有無': heldNow(c['コード'], trades) ? 'はい' : 'いいえ' });
  function gateFor(questions, c, trades) {
    const q = questionsBy(questions, (x) => x['対象'] === '銘柄' && x['結果'] === '段階を進める')[0];
    if (!q) return null;
    const s = adoptedFor(q, c['区分']);
    return { qnum: q.num, strategy: s ? s.name : null, names: condRows(s, candAttrs(c, trades)).map((r) => r['名前']) };
  }

  // ---------- 口座の段階（口座.json の最新から） ----------
  const latestAccount = (acct, today) => (acct || []).filter((x) => x['日付'] <= today).sort((a, b) => (a['日付'] < b['日付'] ? -1 : 1)).slice(-1)[0] || null;
  function accountStage(acct, today) {
    const a = latestAccount(acct, today);
    if (!a) return '未記録';
    if (a['取引停止']) return '停止';
    if (a['停止解除日'] && a['停止解除日'] > today) return '新規停止';
    return '通常';
  }

  // ---------- 材料（記録から出す数字。内部名は data/材料.json の「計算」） ----------
  function materials(data, today, opts) {
    opts = opts || {};
    const pre = data['前提'], trades = data['取引'] || [], acct = data['口座'] || [];
    const cal = makeCal(pre['休日']);
    const T = d(today);
    const closed = trades.filter((t) => state(t) === '決済済み').map((t) => ({ t, pl: pl(t), c: closeDate(t) })).sort((a, b) => (a.c < b.c ? -1 : 1));
    let cash = pre['初期資金'], peak = pre['初期資金'], maxDd = 0;
    closed.forEach((x) => { cash += x.pl; peak = Math.max(peak, cash); maxDd = Math.max(maxDd, 1 - cash / peak); });
    const dd = 1 - cash / peak;
    const held = trades.filter((t) => ['保有中', '一部利確'].includes(state(t)));
    const waiting = trades.filter((t) => state(t) === '注文中');
    let openRisk = 0, invested = 0;
    held.forEach((t) => { openRisk += (t['約定価格'] - t['損切り価格']) * remQty(t); invested += t['約定価格'] * remQty(t); });
    waiting.forEach((t) => { openRisk += (t['発注価格'] - t['損切り価格']) * (t['株数'] || 0); invested += (t['発注価格'] || 0) * (t['株数'] || 0); });
    // 連敗：停止解除日（口座の記録）より後の決済だけ数える
    const lastRelease = acct.map((x) => x['停止解除日']).filter(Boolean).sort().slice(-1)[0] || null;
    let streak = 0;
    for (let i = closed.length - 1; i >= 0 && closed[i].pl < 0 && !(lastRelease && closed[i].c <= lastRelease); i--) streak++;
    const prevBd = iso(cal.workday(T, -1));
    const lossToday = closed.some((x) => x.c === today && x.pl < 0);
    const lossPrev = closed.some((x) => x.c === prevBd && x.pl < 0);
    // 改定後の件数：最後の改定（提案と初版を除く）以後の決済
    const changes = (data['改定履歴'] || []).filter((h) => !['提案', '追加', '削除'].includes(h['変更']) && h['問い'] !== '全部').map((h) => h['日付']).sort();
    const lastChange = changes.slice(-1)[0] || null;
    const sinceChange = closed.filter((x) => !lastChange || x.c > lastChange).length;
    // 連続マイナス年数（今年を含めず、終わった年だけ）
    const byYear = {}; closed.forEach((x) => { const y = x.c.slice(0, 4); byYear[y] = (byYear[y] || 0) + x.pl; });
    let losingYears = 0; for (let y = Number(today.slice(0, 4)) - 1; byYear[String(y)] != null && byYear[String(y)] < 0; y--) losingYears++;
    const events = (pre['イベント暦'] || []).map((e) => (typeof e === 'string' ? e : e['日付']));
    const nextBd = iso(cal.workday(T, 1));
    const out = {
      cash: Math.round(cash), peak: Math.round(peak), ddPct: r1(dd * 100), maxDdPct: r1(maxDd * 100), stop_balance: pre['停止残高'],
      'cash / stop_balance * 100': r1(cash / pre['停止残高'] * 100),
      held: held.length, waiting: waiting.length, 'held + waiting': held.length + waiting.length,
      openRiskPct: r1(openRisk / pre['月初資金'] * 100), cashRatioPct: r1((pre['月初資金'] - invested) / pre['月初資金'] * 100),
      streak, lossToday: yn(lossToday), lossPrev: yn(lossPrev), closed_since_last_change: sinceChange, losing_years_streak: losingYears,
      before_long_holiday: yn(cal.offDaysAhead(T) >= 3), before_event: yn(events.includes(nextBd)),
      shikin: pre['月初資金'], unit: pre['単元'],
    };
    if (opts.code) {
      const live = held.concat(waiting);
      const ind = opts.industry || ((data['候補'] || []).find((c) => c['コード'] === opts.code) || {})['業種'] || null;
      out.same_code_held = live.filter((t) => t['コード'] === opts.code).length;
      out.held_now = yn(out.same_code_held > 0);
      out.same_industry_held = ind ? live.filter((t) => t['コード'] !== opts.code && t['業種'] === ind).length : 0;
      const lastLoss = closed.filter((x) => x.t['コード'] === opts.code && x.pl < 0).map((x) => x.c).sort().slice(-1)[0] || null;
      out.bdays_since_last_loss = lastLoss ? cal.bdays(d(lastLoss), T) : 99999;
      // 銘柄の問いで建玉の材料を使う時は、その銘柄の保有中の建玉で解く
      const t = held.find((x) => x['コード'] === opts.code);
      if (t) Object.assign(out, tradeMaterials(t, cal, T));
    }
    if (opts.trade != null) {
      const t = trades.find((x) => x.id === Number(opts.trade));
      if (t) Object.assign(out, tradeMaterials(t, cal, T));
    }
    return out;
  }
  function tradeMaterials(t, cal, T) {
    return { bdays_held: t['約定日'] ? cal.bdays(d(t['約定日']), T) : null, bdays_since_order: t['記録日'] ? cal.bdays(d(t['記録日']), T) : null,
      partially_sold: yn(soldQty(t) > 0 && remQty(t) > 0), entry: t['約定価格'] || null, stop: t['損切り価格'] || null, rem: remQty(t) };
  }
  const r1 = (v) => Math.round(v * 10) / 10;
  const yn = (b) => (b ? 'はい' : 'いいえ');

  // ---------- 株数の算数（戦略を知らない。1R額などは呼ぶ側が渡す） ----------
  function size(o) {
    const per = o.entry - o.stop, unit = o.unit || 100;
    const out = { entry: o.entry, stop: o.stop, widthPct: Math.round(per / o.entry * 10000) / 100, oneR: o.oneR };
    if (!(per > 0)) return Object.assign(out, { qty: 0, reasons: ['損切りが発注価格より上'] });
    let n = Math.floor(o.oneR / per / unit) * unit;
    const reasons = [];
    if (n === 0 && o.oneRCap != null && per * unit <= o.oneRCap) n = unit;
    if (o.perStockCap != null) { const cap = Math.floor(o.perStockCap / o.entry / unit) * unit; if (n > cap) { n = cap; reasons.push('1銘柄の上限で株数を減らした'); } }
    if (n === 0) reasons.push('1単元でも1Rの上限を超える');
    return Object.assign(out, { qty: n, amount: n * o.entry, risk: Math.round(n * per), reasons });
  }

  // ---------- 段階の一覧 ----------
  function stages(data, today) {
    const qs = data['問い'];
    return {
      候補: (data['候補'] || []).map((c) => ({ コード: c['コード'], 銘柄名: c['銘柄名'], 段階: candStage(c, gateFor(qs, c, data['取引']), data['取引']) })),
      取引: (data['取引'] || []).map((t) => ({ id: t.id, 銘柄名: t['銘柄名'], 段階: state(t) })),
      口座: accountStage(data['口座'], today),
    };
  }

  // ---------- 集計（評価の層。戦略の材料。内部名は data/材料.json の「計算」） ----------
  function summary(data, today) {
    const qs = data['問い'], trades = data['取引'] || [], cands = data['候補'] || [], acct = data['口座'] || [], hist = data['改定履歴'] || [];
    const cal = makeCal(data['前提']['休日']);
    const ym = today.slice(0, 7);
    const closed = trades.filter((t) => state(t) === '決済済み');
    const month = (x) => (x || '').startsWith(ym);
    const avg = (a) => (a.length ? Math.round(a.reduce((p, q) => p + q, 0) / a.length * 100) / 100 : null);
    const pct = (num, den) => (den ? Math.round(num / den * 100) : null);
    const agreement = (records, qnum) => {  // AIの判定を人が直さなかった割合（行ごとにも）
      let n = 0, same = 0; const rows = {};
      records.forEach((rec) => { const js = (rec['判定'] || []).filter((j) => j['問い'] === qnum); const seen = {};
        js.forEach((j) => { const k = j['条件']; if (j['判定者'] === 'AI') seen[k] = j['結果']; else if (j['判定者'] === '人' && seen[k] != null) { n++; rows[k] = rows[k] || { n: 0, same: 0 }; rows[k].n++; if (seen[k] === j['結果']) { same++; rows[k].same++; } } }); });
      return { pct: pct(same, n), rows: Object.fromEntries(Object.entries(rows).map(([k, v]) => [k, pct(v.same, v.n)])) };
    };
    const after = (recs) => avg(recs.map((r) => (r['その後'] || {})['変化率_pct']).filter((v) => v != null));
    const out = {};
    qs.forEach((q) => {
      out[q.num] = (q['戦略'] || []).map((s) => {
        const m = { name: s.name, state: s['状態'] };
        let ts = [], cs = [];
        if (q['対象'] === '建玉' || q['結果'] === '注文を作る' || q['結果'] === '可否') ts = closed.filter((t) => ruleOf(t, q.num) === s.name);
        if (q['結果'] === '候補に入れる') cs = cands.filter((c) => c['戦略'] === s.name);
        if (q['結果'] === '段階を進める') cs = cands.filter((c) => c['判定の戦略'] === s.name);
        if (['口座', '戦略', '人'].includes(q['対象'])) ts = s['状態'] === '採用' ? closed : [];
        const rs = ts.map(rValue);
        m.n = ts.length; m.winPct = pct(ts.filter((t) => pl(t) >= 0).length, ts.length); m.rAvg = avg(rs); m.rSum = rs.length ? Math.round(rs.reduce((a, b) => a + b, 0) * 100) / 100 : null;
        const comp = ts.map((t) => ((t['遵守'] || {})[String(q.num)])).filter((v) => v === '○' || v === '×');
        m.compliancePct = pct(comp.filter((v) => v === '○').length, comp.length);
        const ag = agreement(q['対象'] === '銘柄' ? cs.length ? cs : cands : ts.length ? ts : trades, q.num); m.agreementPct = ag.pct; m.agreementRows = ag.rows;
        m.candidates_month = cs.filter((c) => month(c['日付'])).length;
        m.setups_month = cs.filter((c) => month(c['型が出た日'])).length;
        m.after_avg_change = after(cs.length ? cs : ts);
        m.cancelled = trades.filter((t) => state(t) === '取消' && ruleOf(t, q.num) === s.name).length;
        m.violations = ts.filter((t) => /ルール違反|ミス/.test(t['メモ'] || '')).length;
        m.sold_by_deadline = ts.filter((t) => t['売った理由'] === '期限').length;
        const rest = ts.filter((t) => (t['売り'] || []).length >= 2).map((t) => { const last = t['売り'][t['売り'].length - 1]; return (last['価格'] - t['約定価格']) / (t['約定価格'] - t['損切り価格']); });
        m.rest_over_1r_pct = pct(rest.filter((v) => v > 1).length, rest.length);
        if (s['状態'] === '採用' && ['口座', '戦略', '人'].includes(q['対象'])) {
          const mine = acct.filter((a) => (a['判定'] || []).some((j) => j['問い'] === q.num));
          m.blocked = acct.reduce((n, a) => n + ((a['見送り'] || []).filter((x) => x['問い'] === q.num).length), 0);
          m.blocked_days = mine.filter((a) => (a['判定'] || []).some((j) => j['問い'] === q.num && j['結果'] === (q['合成'] === 'どれか' ? '○' : '×'))).length;
          m.skipped_by_limit = m.blocked;
          m.stage1_count = acct.filter((a, i) => a['ロット'] < 1 && (i === 0 || !(acct[i - 1]['ロット'] < 1))).length;
          m.revisions = hist.filter((h) => h['変更'] !== '提案').length;
          m.revision_improved_pct = null;
          const bds = []; let x = d(ym + '-01'); while (iso(x).startsWith(ym) && x <= d(today)) { if (cal.isBd(x)) bds.push(iso(x)); x = new Date(x.getTime() + DAY); }
          const have = new Set(acct.map((a) => a['日付']));
          m.missed_runs = bds.filter((b) => !have.has(b)).length;
          m.unanswered_days = acct.filter((a) => month(a['日付']) && a['答えなし']).length;
        }
        if (q['結果'] === '可否' || q['結果'] === '新規可否') m.blocked = m.blocked != null ? m.blocked : acct.reduce((n, a) => n + ((a['見送り'] || []).filter((x) => x['問い'] === q.num).length), 0);
        return m;
      });
    });
    return out;
  }

  const api = { makeCal, questionsBy, adoptedFor, byName, inScope, rowsFor, condRows, latest, results, compose, pl, soldQty, remQty, state, closeDate, rValue, ruleOf,
    candStage, candAttrs, heldNow, gateFor, latestAccount, accountStage, materials, size, stages, summary, GROUPS, RESULT_ORDER, groupOf, stepOf, sortQuestions };

  if (typeof module === 'object' && module.exports && typeof require === 'function' && require.main === module) {
    const fs = require('fs'), path = require('path');
    const dir = path.join(__dirname, '..', 'data');
    const load = (n) => (fs.existsSync(path.join(dir, n + '.json')) ? JSON.parse(fs.readFileSync(path.join(dir, n + '.json'), 'utf8')) : []);
    const data = { 前提: load('前提'), 問い: load('問い'), 取引: load('取引'), 候補: load('候補'), 口座: load('口座'), 改定履歴: load('改定履歴') };
    const argv = process.argv.slice(2);
    const opt = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
    const cmd = argv[0];
    const jst = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
    const today = argv.find((x, i) => i > 0 && /^\d{4}-\d{2}-\d{2}$/.test(x) && argv[i - 1] !== '--date' && cmd !== 'days') || opt('--date') || jst;
    let res;
    if (cmd === 'materials') res = materials(data, today, { code: opt('--code'), trade: opt('--trade'), industry: opt('--industry') });
    else if (cmd === 'size') res = size({ entry: Number(argv[1]), stop: Number(argv[2]), oneR: Number(argv[3]), oneRCap: argv[4] != null ? Number(argv[4]) : null, perStockCap: argv[5] != null ? Number(argv[5]) : null, unit: data['前提']['単元'] });
    else if (cmd === 'days') { const cal = makeCal(data['前提']['休日']); res = { from: argv[1], n: Number(argv[2]), date: iso(cal.workday(d(argv[1]), Number(argv[2]))) }; }
    else if (cmd === 'stages') res = stages(data, today);
    else if (cmd === 'summary') res = summary(data, today);
    else { console.error('usage: materials|size|days|stages|summary'); process.exit(1); }
    console.log(JSON.stringify(res, null, 1));
  }
  return api;
});
