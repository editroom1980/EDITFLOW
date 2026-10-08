'use strict';
/* ═══════════════════════════════════════════════════════════
   EDITFLOW 2.0（Mac）
   前の EDITFLOW（iPhone の Web アプリ、2026-05）を引き継ぐ。
   ・データは撮影編集フォルダのファイルが正（localStorage は使わない）。Swift が読んで渡し、直しは 案件を直す.py で書き戻す
   ・割り振りは前の computeSchedule ではなく、エンジン（進行を見る.py）の結果（進行.json）を出す
   ・直したら少し待って自動で計算し直す。⌘Z で直したことを1つずつ戻せる
═══════════════════════════════════════════════════════════ */
const EF = window.EF = {};

/* ───────── Swift とのやりとり ───────── */
let 次id = 1;
const 待ち = {};
function 頼む(種, 中 = {}) {
  if (iPhone) return iPhoneに頼む(種, 中);
  return new Promise(res => {
    const id = 次id++;
    待ち[id] = res;
    window.webkit.messageHandlers.ef.postMessage(Object.assign({}, 中, { 種, id }));
  });
}

/* ───────── iPhone（ホーム画面の Web アプリ）：GitHub の非公開リポジトリ EDITFLOW-data と話す ─────────
   ・Mac がエンジンを走らせたあと、進行.json などをこのリポジトリへ push する。iPhone はそれを読む
   ・iPhone で直したことは 変更/ に1件1ファイルで書く（中身は 案件を直す.py の操作と同じ形）。Mac が1分ごとに取り込み、
     計算し直して反映し、push する。それまでは「Mac が取り込むまで待ち」の印を出す
   ・トークンはこの端末の localStorage にだけ置く（画面に出さない・GitHub の API のほかへ送らない） */
const Mac = !!(window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.ef);
const iPhone = !Mac;
const 試し = window.__EF_PWA_TEST__ || null;   // 画面外の書き出し：GitHub の代わりに写しのデータを使う
const 同期ファイル = ['進行.json', '編集案件.json', '撮影メモ.json', 'EDITFLOW設定.json', 'しそチャンNET_進行.json', '撮影.json'];
const 端末 = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { } }
};
const GH = {
  repo() { return 端末.get('EF_リポジトリ') || 'editroom1980/EDITFLOW-data'; },
  token() { return 端末.get('EF_トークン'); },
  url(p) { return 'https://api.github.com/repos/' + this.repo() + '/contents/' + p.split('/').map(encodeURIComponent).join('/'); },
  頭(raw) { return { Authorization: 'Bearer ' + this.token(), Accept: raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' }; },
  async 取る(p, raw = true) {
    if (試し) {
      if (p === '変更') return Object.keys(試し.変更).map(n => ({ name: n, type: 'file' }));
      if (p.startsWith('変更/')) return 試し.変更[p.slice(3)] == null ? null : 試し.変更[p.slice(3)];
      return 試し.ファイル[p] == null ? null : 試し.ファイル[p];
    }
    const r = await fetch(this.url(p), { headers: this.頭(raw), cache: 'no-store' });
    if (r.status === 404) return null;
    if (r.status === 401 || r.status === 403) throw new Error('トークンが通らない（' + r.status + '）。設定で貼り直す');
    if (!r.ok) throw new Error('GitHub が ' + r.status + ' を返した');
    return raw ? r.text() : r.json();
  },
  async 置く(p, 字, msg) {
    if (試し) { 試し.変更[p.slice(3)] = 字; return true; }
    const b64 = btoa(Array.from(new TextEncoder().encode(字), c => String.fromCharCode(c)).join(''));
    const r = await fetch(this.url(p), { method: 'PUT', headers: Object.assign(this.頭(false), { 'Content-Type': 'application/json' }), body: JSON.stringify({ message: msg, content: b64 }) });
    if (!r.ok) throw new Error('GitHub に書けない（' + r.status + '）');
    return true;
  }
};
async function iPhoneに頼む(種, 中) {
  if (種 === '読む') {
    if (!試し && !GH.token()) return { ファイル: {}, 撮影: [], 変更: [], トークンなし: true, 置き場: 'GitHub ' + GH.repo() };
    try {
      const ファイル = {}; let 撮影 = [];
      await Promise.all(同期ファイル.map(async f => {
        const t = await GH.取る(f);
        if (f === '撮影.json') { try { 撮影 = JSON.parse(t || '[]'); } catch (e) { } } else ファイル[f] = t;
      }));
      const 一覧 = (await GH.取る('変更', false)) || [];
      const 名 = (Array.isArray(一覧) ? 一覧 : []).filter(x => x.type === 'file' && x.name.endsWith('.json')).map(x => x.name).sort();
      const 変更 = [];
      for (const n of 名) { try { 変更.push(Object.assign({ 名: n }, JSON.parse(await GH.取る('変更/' + n)))); } catch (e) { } }
      return { ファイル, 撮影, 変更, python: '', 写し: false, 画面外: !!試し, 置き場: 'GitHub ' + GH.repo() };
    } catch (e) { return { エラー: e.message }; }
  }
  if (種 === '直す') {
    const 名 = new Date().toISOString().replace(/[-:]/g, '').replace('.', '') + '-' + Math.random().toString(36).slice(2, 7) + '.json';
    const 字 = JSON.stringify({ ファイル: 中.ファイル, 操作: 中.操作, 端末: 'iPhone', 時刻: new Date().toISOString() }, null, 1);
    try { await GH.置く('変更/' + 名, 字, 'iPhone から：' + (ui.最後の説明 || '直し')); return { ok: true, 待ち: 名 }; }
    catch (e) { return { ok: false, エラー: e.message }; }
  }
  if (種 === '開く') { if (!試し) window.open(中.url, '_blank'); return true; }
  if (種 === '計算' || 種 === 'チェックリスト') return { ok: false, エラー: 'iPhone ではできない（Mac が取り込んで計算し、反映する）' };
  return true;
}
EF.返事 = ({ id, 値 }) => { const f = 待ち[id]; delete 待ち[id]; if (f) f(値); };
EF.知らせ = ({ 種, 値 }) => {
  if (種 === '同期') { S.同期 = 値; if (ui.計算中 === 'iPhone') ui.計算中 = null; 帯を描く(); if (値.取り込んだ) 読み直す(false).then(() => 知らせを出す('iPhone で直したことを取り込んで、計算し直した')); return; }
  if (種 === '計算中') { if (!ui.計算中) { ui.計算中 = 'iPhone'; ui.計算の始め = Date.now(); 帯を描く(); } return; }
  if (種 === '変わった') {
    // 自分の書き戻しは数えない。エンジン・ほかのチャット・人の手で変わったものだけ読み直す
    if (!ui.計算中) 読み直す(false).then(() => 知らせを出す('ファイルが外で変わったので読み直した：' + 値.join('・')));
  }
};

/* ───────── 小さな道具 ───────── */
const $ = s => document.querySelector(s);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clone = v => v === undefined ? undefined : JSON.parse(JSON.stringify(v));
const 曜 = ['日', '月', '火', '水', '木', '金', '土'];
function ds(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
function 日(s) { if (!s) return null; const [y, m, d] = s.slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d); }
function 時刻(s) { if (!s) return null; const [a, b] = s.split('T'); const d = 日(a); if (b) { const [h, mi] = b.split(':').map(Number); d.setHours(h, mi, 0, 0); } return d; }
function 足す日(s, n) { const d = 日(s); d.setDate(d.getDate() + n); return ds(d); }
function 日差(a, b) { return Math.round((日(b) - 日(a)) / 86400000); }
function md(s) { const d = 日(s); return d ? `${d.getMonth() + 1}/${d.getDate()}` : '—'; }
function mdw(s) { const d = 日(s); return d ? `${d.getMonth() + 1}/${d.getDate()}(${曜[d.getDay()]})` : '未定'; }
function hm(d) { return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`; }
function 時間(h) { if (h == null) return '未入力'; const v = Math.round(h * 10) / 10; return (Number.isInteger(v) ? v : v.toFixed(1)) + '時間'; }
function 残りの説明(u) {
  // 締切ごとに残り時間が書いてあればそれを並べる（例：確認用納期 8時間・最終納期 3時間）
  const ks = (u.元.締切 || []).filter(k => k.残り編集時間 != null);
  return ks.length ? ks.map(k => `${k.種類} ${時間(k.残り編集時間)}`).join('・') : `残り編集時間 ${時間(u.元.残り編集時間)}`;
}
function h字(h) { const v = Math.round((h || 0) * 10) / 10; return (Number.isInteger(v) ? v : v.toFixed(1)) + 'h'; }
function あと(ms) { const m = Math.max(0, Math.round(ms / 60000)); if (m < 60) return m + '分'; return Math.floor(m / 60) + '時間' + (m % 60 ? m % 60 + '分' : ''); }
function 今() { return new Date(); }
/** 日付・時刻の欄。空のときに WebKit が今日の日付を薄く出して「入っている」ように見えるので、空なら字の欄にして「未定」と出す */
function 欄(種, 値, 他 = '', 空の字) {
  const 空 = !値;
  return `<input class="in" type="${空 ? 'text' : 種}" ${空 ? `placeholder="${空の字 || (種 === 'time' ? '時刻なし' : '未定')}" onfocus="this.type='${種}'"` : ''} value="${esc(値 || '')}" ${他}>`;
}
function 今日() { return ds(今()); }

/* ───────── 状態 ───────── */
const ファイル名 = ['進行.json', '編集案件.json', '食事の予定.json', '献立.json', 'しそチャンNET_進行.json', 'EDITFLOW設定.json', '撮影メモ.json'];
const S = { f: {}, 撮影: [], python: '', 写し: false, 画面外: false, 読めた: false, 読めない: [], 待ち: [], 同期: null, 同期誤り: null, トークンなし: false };
const ui = {
  view: 'today', sel: null, 詳細: true, calMonth: null, 計算中: null, 未計算: false, もう一度: false,
  要点: [], 誤り: null, 最後の計算: null, planTab: '朝', reviewIdx: 0, shootSel: null, 動かす: {}, 印: null,
  pal: { open: false, q: '', idx: 0 }, sheet: null, 下書き: null
};
const 戻す列 = [], 進む列 = [];
const 未確認 = [];   // 書き戻しを頼んで、まだ返事の来ていない操作（読み直しのとき上に重ねる）

const P = () => S.f['進行.json'];
const A = () => S.f['編集案件.json'];
const 設定 = () => S.f['EDITFLOW設定.json'] || {};
const メモ = () => S.f['撮影メモ.json'] || { 撮影: {} };
const しそ設定 = () => (S.f['しそチャンNET_進行.json'] || {}).設定 || {};

/* ───────── JSON の操作（案件を直す.py と同じ決まり） ───────── */
function 進む(cur, st) {
  if (st !== null && typeof st === 'object') {
    if (!Array.isArray(cur)) throw new Error('探す先が配列ではない');
    const 当 = [];
    cur.forEach((v, i) => { if (v && typeof v === 'object' && Object.entries(st).every(([k, w]) => v[k] === w)) 当.push(i); });
    if (当.length !== 1) throw new Error(JSON.stringify(st) + ' に当たる要素が ' + 当.length + ' 件');
    return 当[0];
  }
  return st;
}
function たどる(root, 道, 作る, 入れる) {
  let cur = root;
  for (const st of 道.slice(0, -1)) {
    const k = 進む(cur, st);
    if (typeof k === 'string' && !(k in cur)) { if (!作る) throw new Error('キー ' + k + ' が無い'); cur[k] = {}; }
    cur = cur[k];
  }
  const last = 道[道.length - 1];
  return [cur, 入れる ? last : 進む(cur, last)];
}
function 当てる(root, op) {
  const [p, k] = たどる(root, op.道, op.作る, '入れる' in op);
  if ('入れる' in op) p.splice(k, 0, clone(op.入れる));
  else if (op.消す) { if (Array.isArray(p)) p.splice(k, 1); else delete p[k]; }
  else if ('足す' in op) { if (!(k in p) || p[k] == null) p[k] = []; p[k].push(clone(op.足す)); }
  else if ('値' in op) p[k] = clone(op.値);
}
/** 操作を当てる前に、戻すための操作を作る（道は番号に直す。名前を変えても戻せるように） */
function 逆(root, op) {
  const 数道 = []; let cur = root, 途中で無い = false;
  op.道.forEach((st, i) => {
    const last = i === op.道.length - 1;
    let k = st;
    if (!途中で無い && st !== null && typeof st === 'object') k = 進む(cur, st);
    数道.push(k);
    if (!last) { if (cur == null || !(k in cur)) 途中で無い = true; else cur = cur[k]; }
  });
  const p = 途中で無い ? null : cur, k = 数道[数道.length - 1];
  if ('入れる' in op) return [{ 道: 数道, 消す: true }];
  if ('足す' in op) { const n = p && Array.isArray(p[k]) ? p[k].length : 0; return [{ 道: 数道.concat([n]), 消す: true }]; }
  if (op.消す) {
    if (!p) return [];
    if (Array.isArray(p)) return [{ 道: 数道, 入れる: clone(p[k]) }];
    return k in p ? [{ 道: 数道, 値: clone(p[k]) }] : [];
  }
  if (p && k in p) return [{ 道: 数道, 値: clone(p[k]) }];
  return [{ 道: 数道, 消す: true }];
}

/** 直す：その場で画面に当て、Swift に書き戻しを頼み、⌘Z の列に積む */
function 直す(file, ops, 説明, o = {}) {
  const data = S.f[file];
  if (!data) { 誤りを出す(file + ' が読めていないので直せない'); return false; }
  const inv = [];
  try {
    for (const op of ops) { inv.unshift(...逆(data, op)); 当てる(data, op); }
  } catch (e) { 誤りを出す('直せない：' + e.message); 読み直す(false); return false; }
  ui.最後の説明 = 説明;
  送る(file, ops);
  if (o.undo !== false) { 戻す列.push({ file, ops, inv, 説明 }); 進む列.length = 0; if (戻す列.length > 100) 戻す列.shift(); }
  if (o.計算 !== false && (file === '編集案件.json' || file === '食事の予定.json')) 計算を予約();
  if (説明) 知らせを出す(説明 + (o.undo !== false ? '　⌘Z で戻す' : ''));
  描く();
  return true;
}
function 送る(file, ops) {
  const 札 = { file, ops };
  未確認.push(札);
  return 頼む('直す', { ファイル: file, 操作: ops }).then(r => {
    const i = 未確認.indexOf(札); if (i >= 0) 未確認.splice(i, 1);
    if (r && r.ok === false) { 誤りを出す('書き戻せなかった：' + r.エラー); 読み直す(false); }
    if (r && r.待ち) { S.待ち.push(r.待ち); 帯を描く(); }
    return r;
  });
}
function 取り消す() {
  const a = document.activeElement;
  if (a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA')) { document.execCommand('undo'); return; }
  const r = 戻す列.pop();
  if (!r) { 知らせを出す('戻すものはない'); return; }
  const data = S.f[r.file];
  try { for (const op of r.inv) 当てる(data, op); } catch (e) { 誤りを出す('戻せない：' + e.message); return; }
  送る(r.file, r.inv);
  進む列.push(r);
  if (r.file === '編集案件.json' || r.file === '食事の予定.json') 計算を予約();
  知らせを出す('戻した：' + (r.説明 || ''));
  描く();
}
function やり直す() {
  const r = 進む列.pop();
  if (!r) { 知らせを出す('やり直すものはない'); return; }
  const data = S.f[r.file];
  const inv = [];
  try { for (const op of r.ops) { inv.unshift(...逆(data, op)); 当てる(data, op); } } catch (e) { 誤りを出す('やり直せない：' + e.message); return; }
  送る(r.file, r.ops);
  戻す列.push({ file: r.file, ops: r.ops, inv, 説明: r.説明 });
  if (r.file === '編集案件.json' || r.file === '食事の予定.json') 計算を予約();
  知らせを出す('やり直した：' + (r.説明 || ''));
  描く();
}

/* ───────── 読む・計算 ───────── */
async function 読み直す(撮影も) {
  const r = await 頼む('読む', { 撮影も });
  if (!r) return;
  if (r.エラー) { S.同期誤り = r.エラー; S.読めた = true; 描く(); return; }
  S.同期誤り = null;
  S.トークンなし = !!r.トークンなし;
  if (r.同期) S.同期 = r.同期;
  S.読めない = [];
  for (const f of ファイル名) {
    const t = r.ファイル[f];
    if (t == null) { S.f[f] = null; continue; }
    try { S.f[f] = JSON.parse(t); } catch (e) { S.f[f] = null; S.読めない.push(f); }
  }
  // iPhone：Mac がまだ取り込んでいない変更（この端末とほかの端末の分）を上に重ねる
  if (iPhone) {
    S.待ち = (r.変更 || []).map(x => x.名);
    for (const c of r.変更 || []) { try { for (const op of c.操作) 当てる(S.f[c.ファイル], op); } catch (e) { } }
    S.最後に読んだ = new Date();
  }
  // 返事の来ていない直しを上に重ねる（書き戻しの前に読んだときに消えないように）
  for (const p of 未確認) { try { for (const op of p.ops) 当てる(S.f[p.file], op); } catch (e) { } }
  if (撮影も !== false) S.撮影 = (r.撮影 || []).map(x => { try { return Object.assign({ 計画: JSON.parse(x.中身) }, x); } catch (e) { return null; } }).filter(Boolean);
  S.python = r.python; S.写し = r.写し; S.画面外 = r.画面外; S.置き場 = r.置き場;
  S.読めた = true;
  見た目を当てる();
  if (iPhone && S.トークンなし && !ui.sheet && !試し) シートを開く({ kind: 'phone' });
  if (!ui.sel) { const u = 単位().find(u => !済か(u)); if (u) ui.sel = u.id; }
  描く();
  小窓を送る();
}
let 計算の予約 = null;
function 計算を予約() {
  if (iPhone) { 帯を描く(); return; }   // iPhone では計算できない。Mac が取り込んで計算し直す
  ui.未計算 = true;
  clearTimeout(計算の予約);
  計算の予約 = setTimeout(() => 計算(false), 1500);
  帯を描く();
}
async function 計算(書き込む) {
  if (iPhone) { 知らせを出す('iPhone では計算も反映もできない。直したことは Mac が取り込んで計算し直し、反映する'); return; }
  if (ui.計算中) { ui.もう一度 = true; return; }
  clearTimeout(計算の予約);
  ui.計算中 = 書き込む ? '反映' : '計算';
  ui.計算の始め = Date.now();
  ui.未計算 = false; ui.誤り = null;
  描く();
  const r = await 頼む('計算', { 書き込む });
  ui.計算中 = null;
  ui.最後の計算 = new Date();
  await 読み直す(false);
  if (r && r.ok) {
    const L = (r.出力 || '').split('\n');
    const 入 = L.filter(l => l.startsWith('入れる:')).length, 外 = L.filter(l => l.startsWith('外す:')).length;
    ui.要点 = L.filter(l => l.includes('締切をカレンダーに合わせる'));
    if (書き込む) {
      ui.要点.push(`カレンダー：入れる ${入}件・外す ${外}件`);
      ui.要点.push(...L.filter(l => l.startsWith('リマインダー：') || l.startsWith('買い物リスト：') || l.startsWith('カレンダーは変更なし')));
      直す('EDITFLOW設定.json', [{ 道: ['最後の反映'], 値: new Date().toISOString().slice(0, 16) }], '', { undo: false, 計算: false });
    }
    const p = P();
    if (p) ui.要点.push(`締切 ${p.締切.length}件のうち 間に合わない欄 ${(p.問題 || []).length}件`);
    知らせを出す((書き込む ? '反映した' : '計算し直した') + `（${hm(new Date())}）`);
  } else {
    ui.誤り = ((r && (r.エラー || r.出力)) || '返事が無い').trim().split('\n').slice(-3).join(' ／ ');
  }
  描く();
  if (ui.もう一度 || ui.未計算) { ui.もう一度 = false; 計算(false); }
}

/* ───────── 案件（編集案件.json の 案件 と 定例の回）───────── */
function 進行の締切(id) { return (P() && P().締切.find(k => k.id === id)) || null; }
function 単位() {
  const a = A(); if (!a) return [];
  const out = [];
  (a.案件 || []).forEach(x => {
    const 締 = [...(x.締切 || [])].sort((p, q) => (p.日付 < q.日付 ? -1 : 1));
    out.push({ id: '案件:' + x.名前, 種: '案件', 名前: x.名前, 元: x, 道: ['案件', { 名前: x.名前 }],
      締切: 締.map(k => ({ 種類: k.種類, 日付: k.日付, 時刻: k.時刻 || null, id: x.名前 + ':' + k.種類 })) });
  });
  (a.定例 || []).forEach(t => {
    const 月のある = new Set();
    (t.回 || []).forEach(r => {
      if (!r.月 && !r.取材先) return;
      if (r.月) 月のある.add(r.月);
      const id = t.名前 + ':' + (r.月 || '');
      const k = 進行の締切(id);
      const 名 = t.名前 + '（' + [r.月 ? Number(r.月.slice(5)) + '月' : null, r.取材先].filter(Boolean).join('・') + '）';
      out.push({ id: '回:' + t.名前 + ':' + (r.月 || r.取材先), 種: '回', 名前: 名, 元: r, 定例: t,
        道: ['定例', { 名前: t.名前 }, '回', r.月 ? { 月: r.月 } : { 取材先: r.取材先 }],
        締切: r.月 ? [{ 種類: '納期', 日付: k ? k.日付 : '', 時刻: null, id }] : [] });
    });
    ((P() && P().締切) || []).filter(k => k.id.startsWith(t.名前 + ':')).forEach(k => {
      const m = k.id.slice(t.名前.length + 1);
      if (月のある.has(m)) return;
      out.push({ id: '回:' + t.名前 + ':' + m, 種: '回を作る', 名前: k.名前, 元: {}, 定例: t, 月: m,
        道: ['定例', { 名前: t.名前 }, '回'], 締切: [{ 種類: '納期', 日付: k.日付, 時刻: null, id: k.id }] });
    });
  });
  return out;
}
const 単位を探す = id => 単位().find(u => u.id === id) || null;
const 工程 = u => (u.元 && u.元.工程) || [];
const 版 = u => (u.元 && u.元.版) || [];
const 状態 = u => { const s = (u.元 && u.元.状態) || ''; return s === '編集中' ? '作業中' : s; };
const 済か = u => 状態(u) === '納品済' || u.種 === '回を作る';
const 状態の名 = ['撮影前', '未着手', '作業中', '確認待ち', '直し', '納品済'];
function 開いた締切(u) {
  const t = 今日();
  return u.締切.filter(k => k.日付 && k.日付 >= t).map(k => Object.assign({}, k, { 進行: 進行の締切(k.id) }));
}
function 近い締切(u) { const o = 開いた締切(u); return o[0] || (u.締切.length ? Object.assign({}, u.締切[u.締切.length - 1], { 進行: 進行の締切(u.締切[u.締切.length - 1].id) }) : null); }
function 判定(k) {
  if (!k) return 'silver';
  const m = (k.見込み || '');
  if (m.includes('深夜') || m.includes('間に合わない')) return 'red';
  if (m.includes('時間外')) return 'orange';
  return 'ok';
}
/** 急ぎの度合い：エンジンの見込みが先、その次に残りの日数（3日以内＝赤、7日以内＝橙） */
function 急ぎ(u) {
  if (済か(u)) return 'silver';
  let w = 'silver';
  for (const k of 開いた締切(u)) {
    const j = 判定(k.進行);
    if (j === 'red') return 'red';
    if (j === 'orange') w = 'orange';
  }
  if (w === 'orange') return w;
  const k = 近い締切(u);
  if (k && k.日付) { const n = 日差(今日(), k.日付); if (n <= 3) return 'red'; if (n <= 7) return 'orange'; }
  return 'silver';
}
function 記号(s, i) {
  if (s.記号) return s.記号;
  const lib = (設定().工程の一覧 || []).find(l => l.名前 === s.名前);
  if (lib) return lib.記号;
  return (s.名前 || '?').replace(/[（(].*$/, '').slice(0, 2);
}
function 英名(s) { if (s.英名) return s.英名; const lib = (設定().工程の一覧 || []).find(l => l.名前 === s.名前); return lib ? lib.英名 : ''; }
function 合計(u) { return 工程(u).reduce((a, s) => a + (Number(s.見込み) || 0), 0); }
function 残り(u) { return 工程(u).filter(s => !s.済).reduce((a, s) => a + (Number(s.見込み) || 0), 0); }
function 実績(u) { return 工程(u).reduce((a, s) => a + (Number(s.実績) || 0), 0); }
function 割当の日々(u) {
  // エンジンの割り振り（進行.json の 日.割当）から、この案件に作業がある日
  const p = P(); if (!p) return [];
  const ラベル = new Set(u.締切.map(k => { const e = 進行の締切(k.id); return e ? e.ラベル : null; }).filter(Boolean));
  if (u.種 === '回') { const e = u.締切[0] && 進行の締切(u.締切[0].id); if (e) ラベル.add(e.ラベル); }
  const out = [];
  for (const [d, v] of Object.entries(p.日)) {
    const h = (v.割当 || []).filter(x => ラベル.has(x.名前)).reduce((a, x) => a + (時刻(x.終) - 時刻(x.始)) / 3600000, 0);
    if (h > 0) out.push({ 日: d, 時間: h, 種: (v.割当 || []).filter(x => ラベル.has(x.名前)).map(x => x.種類) });
  }
  return out;
}
function 開始日(u) {
  const e = u.元.着手できる日 || u.元.撮影日; if (e) return e;
  const d = 割当の日々(u); return d.length ? d[0].日 : null;
}

/* ───────── 案件の操作（よく使うものは1手）───────── */
function 工程を置く(u, 新, 説明) {
  if (u.種 === '回を作る') { 誤りを出す('先に「この月の回を作る」を押す'); return; }
  const ops = 新.length ? [{ 道: u.道.concat(['工程']), 値: 新 }] : [{ 道: u.道.concat(['工程']), 消す: true }];
  直す('編集案件.json', ops, 説明);
}
function 工程を切り替える(u, i) {
  const 新 = clone(工程(u)); if (!新[i]) return;
  新[i].済 = !新[i].済;
  工程を置く(u, 新, `${u.名前}：${新[i].名前} を${新[i].済 ? '済み' : '未'}にした`);
}
function 次の工程を済み(u) {
  if (!u) return 誤りを出す('先に案件を選ぶ');
  const i = 工程(u).findIndex(s => !s.済);
  if (i < 0) return 知らせを出す('済んでいない工程が無い');
  工程を切り替える(u, i);
}
function 状態を変える(u, s) {
  if (u.種 === '回を作る') return;
  const ops = [{ 道: u.道.concat(['状態']), 値: s }];
  直す('編集案件.json', ops, `${u.名前}：状態を「${s}」にした`);
}
function 明日へ送る(u) {
  if (!u) return 誤りを出す('先に案件を選ぶ');
  const 明 = 足す日(今日(), 1);
  直す('編集案件.json', [{ 道: u.道.concat(['着手できる日']), 値: 明 }], `${u.名前}：明日（${mdw(明)}）から始める`);
}
function 最優先にする(u, on = true) {
  if (!u) return 誤りを出す('先に案件を選ぶ');
  const ops = on ? [{ 道: u.道.concat(['最優先']), 値: true }] : [{ 道: u.道.concat(['最優先']), 消す: true }];
  直す('編集案件.json', ops, `${u.名前}：${on ? '最優先にした（締切の順より先に割り振る）' : '最優先を外した'}`);
}
function 締切を動かす(u, 種類, 日付, 時刻) {
  if (u.種 !== '案件') return 誤りを出す('定例の回の締切は、まだ動かせない（エンジンが未対応）');
  if (!日付) return 誤りを出す('日付を入れる');
  const 道 = ['案件', { 名前: u.名前 }, '締切', { 種類 }];
  const ops = [{ 道: 道.concat(['日付']), 値: 日付 }];
  ops.push(時刻 ? { 道: 道.concat(['時刻']), 値: 時刻 } : { 道: 道.concat(['時刻']), 消す: true });
  ops.push({ 道: 道.concat(['動かした']), 値: true });
  直す('編集案件.json', ops, `${u.名前}：${種類} を ${mdw(日付)}${時刻 ? ' ' + 時刻 : ''} に動かした（反映するとカレンダーも直る）`);
}
function 時間外を認める(q) {
  直す('EDITFLOW設定.json', [{ 道: ['時間外を認めた', q.id], 値: { 時間外: q.時間外, 深夜: q.深夜, 日: 今日() }, 作る: true }],
    `${q.ラベル}：時間外 ${時間(q.時間外)}${q.深夜 ? '・深夜 ' + 時間(q.深夜) : ''} を認めた`, { 計算: false });
}
function 認めたか(q) {
  const a = (設定().時間外を認めた || {})[q.id];
  return !!a && q.足りない <= 0 && q.時間外 <= (a.時間外 || 0) + 1e-9 && q.深夜 <= (a.深夜 || 0) + 1e-9;
}
function 回を作る(u) {
  直す('編集案件.json', [{ 道: u.道, 足す: { 月: u.月, 状態: '撮影前' } }], `${u.名前}：この月の回を作った`);
}
function 実績を足す(u, i, d) {
  const 新 = clone(工程(u)); if (!新[i]) return;
  const v = Math.max(0, Math.round(((Number(新[i].実績) || 0) + d) * 10) / 10);
  新[i].実績 = v;
  // 夜の締めのために、今日の分も 設定 に残す（エンジンは使わない）
  const 今 = 今日();
  const 日々 = (設定().日々の実績 || {})[今] || {};
  const 前 = Number(日々[u.名前]) || 0;
  直す('編集案件.json', [{ 道: u.道.concat(['工程']), 値: 新 }], `${u.名前}：${新[i].名前} の実績を ${時間(v)} にした`, { 計算: false });
  直す('EDITFLOW設定.json', [{ 道: ['日々の実績', 今, u.名前], 値: Math.max(0, Math.round((前 + d) * 10) / 10), 作る: true }], '', { undo: false, 計算: false });
}
function 見込みを足す(u, i, d) {
  const 新 = clone(工程(u)); if (!新[i]) return;
  新[i].見込み = Math.max(0, Math.round(((Number(新[i].見込み) || 0) + d) * 10) / 10);
  工程を置く(u, 新, `${u.名前}：${新[i].名前} の見込みを ${時間(新[i].見込み)} にした`);
}
function 工程を動かす(u, i, d) {
  const 新 = clone(工程(u)); const j = i + d; if (j < 0 || j >= 新.length) return;
  [新[i], 新[j]] = [新[j], 新[i]];
  工程を置く(u, 新, `${u.名前}：${新[j].名前} を${d < 0 ? '上' : '下'}へ`);
}
function 工程を消す(u, i) {
  const 新 = clone(工程(u)); const x = 新.splice(i, 1)[0];
  工程を置く(u, 新, `${u.名前}：${x.名前} を消した`);
}
function 工程の締切を回す(u, i) {
  const 新 = clone(工程(u)); const 種 = u.締切.map(k => k.種類); if (種.length < 2) return;
  const 今の = 新[i].締切 || 種[0];
  新[i].締切 = 種[(種.indexOf(今の) + 1) % 種.length];
  工程を置く(u, 新, `${u.名前}：${新[i].名前} は「${新[i].締切}」までに`);
}
function 版を足す(u) {
  const vs = 版(u);
  const 確認 = vs.filter(v => v.名前.startsWith('確認用')).length, 直し = vs.filter(v => v.名前.startsWith('直し')).length;
  const 最後 = vs[vs.length - 1];
  const 名 = !最後 || 最後.名前.startsWith('直し') ? `確認用 v${確認 + 1}` : `直し${直し + 1}`;
  const 新 = { 名前: 名, 日付: 今日(), 指摘: [] };
  const ops = [{ 道: u.道.concat(['版']), 足す: 新 }];
  // 確認用を出したら、先方の確認待ち。直しの版を作ったら、直し（Frame.io の流れ）
  ops.push({ 道: u.道.concat(['状態']), 値: 名.startsWith('確認用') ? '確認待ち' : '直し' });
  直す('編集案件.json', ops, `${u.名前}：${名} を足し、状態を「${名.startsWith('確認用') ? '確認待ち' : '直し'}」にした`);
}
function 指摘を足す(u, vi, 内容) {
  if (!内容.trim()) return;
  直す('編集案件.json', [{ 道: u.道.concat(['版', vi, '指摘']), 足す: { 内容: 内容.trim(), 済: false } }], `${u.名前}：${版(u)[vi].名前} に指摘を足した`, { 計算: false });
}
function 指摘を切り替える(u, vi, ni) {
  const n = 版(u)[vi].指摘[ni];
  直す('編集案件.json', [{ 道: u.道.concat(['版', vi, '指摘', ni, '済']), 値: !n.済 }], `${u.名前}：指摘「${n.内容.slice(0, 16)}」を${n.済 ? '戻した' : '直した'}`, { 計算: false });
}
function 版を承認(u, vi) {
  const v = 版(u)[vi];
  直す('編集案件.json', [{ 道: u.道.concat(['版', vi, '承認']), 値: !v.承認 }], `${u.名前}：${v.名前} を${v.承認 ? '承認から戻した' : '承認にした'}`, { 計算: false });
}
function 版を消す(u, vi) {
  const v = 版(u)[vi];
  直す('編集案件.json', [{ 道: u.道.concat(['版', vi]), 消す: true }], `${u.名前}：${v.名前} を消した`, { 計算: false });
}
function 着手できる日を置く(u, v) {
  const ops = v ? [{ 道: u.道.concat(['着手できる日']), 値: v }] : [{ 道: u.道.concat(['着手できる日']), 消す: true }];
  直す('編集案件.json', ops, `${u.名前}：着手できる日を${v ? ' ' + mdw(v) + ' に' : '外'}した`);
}
function 案件を消す(u) {
  if (u.種 !== '案件') return 誤りを出す('定例の回はここでは消せない（編集案件.json の 定例 で直す）');
  const i = A().案件.findIndex(x => x.名前 === u.名前);
  // 消さずに 設定 の 消した案件 へ移す。⌘Z で元の場所に戻る
  直す('EDITFLOW設定.json', [{ 道: ['消した案件'], 足す: Object.assign({ _消した日: 今日() }, clone(u.元)) }], '', { undo: false, 計算: false });
  直す('編集案件.json', [{ 道: ['案件', i], 消す: true }], `${u.名前} を一覧から消した（EDITFLOW設定.json の 消した案件 に残した）`);
  ui.sel = null;
}

/* ───────── 描く ───────── */
const 画面 = {
  today: { en: 'TODAY', jp: '今日' }, projects: { en: 'PROJECTS', jp: '案件' }, calendar: { en: 'CALENDAR', jp: '暦' },
  deadlines: { en: 'DEADLINES', jp: '締切' }, weeks: { en: '3 WEEKS', jp: '3週間' }, plan: { en: 'PLAN', jp: '朝・夜' },
  review: { en: 'REVIEW', jp: '週の見直し' }, shoot: { en: 'SHOOT', jp: '撮影' }, shop: { en: 'SHOPPING', jp: '買い物' }
};
function 描く() {
  if (!S.読めた) { $('#main').innerHTML = '<div class="empty"><b>読み込んでいます…</b></div>'; return; }
  document.getElementById('app').classList.toggle('詳細なし', !ui.詳細);
  $('#nav').innerHTML = 左を描く();
  const g = 画面[ui.view];
  $('#screenTitle').innerHTML = `${g.en}<small>${g.jp}${S.写し ? '　（写しのフォルダ）' : ''}</small>`;
  const 描き手 = { today: 今日を描く, projects: 案件を描く, calendar: 暦を描く, deadlines: 締切を描く, weeks: 三週間を描く,
    plan: 朝夜を描く, review: 見直しを描く, shoot: 撮影を描く }[ui.view === 'shop' ? (ui.view = 'today') : ui.view];
  document.getElementById('detail').classList.toggle('open', !!ui.詳細を開く);
  document.getElementById('app').classList.toggle('詳細を開いた', !!ui.詳細を開く);
  if (iPhone && !A()) { $('#main').innerHTML = `<div class="empty"><b>${S.トークンなし ? 'まだ Mac とつないでいない' : (S.同期誤り ? 'GitHub に届かない' : 'データがまだ無い')}</b>${esc(S.同期誤り || (S.トークンなし ? '設定で EDITFLOW-data のトークンを貼る' : 'Mac で EDITFLOW を開いて計算し直すと届く'))}<br><br><button class="btn btn-primary" data-act="phonePrefs">iPhone の設定</button></div>`; $('#detail').innerHTML = ''; 帯を描く(); if (ui.sheet) シートを描く(); return; }
  try { $('#main').innerHTML = 描き手(); } catch (e) { $('#main').innerHTML = `<div class="empty"><b>描けなかった</b>${esc(e.message)}</div>`; console.error(e); }
  try { $('#detail').innerHTML = (ui.詳細を開く ? '<button class="btn btn-secondary d-back" data-act="closeDetail">‹ 戻る</button>' : '') + 詳細を描く(); } catch (e) { $('#detail').innerHTML = esc(e.message); }
  帯を描く();
  if (ui.sheet) シートを描く();
  if (ui.pal.open) 命令窓を描く();
}
function 左を描く() {
  const p = P();
  const 問題 = p ? (p.問題 || []).filter(q => !認めたか(q)).length : 0;
  const 撮 = S.撮影.filter(x => 取材日(x) && 取材日(x) >= 今日()).length;
  const 見 = 止まっている().length;
  const 札 = { today: 問題, review: 見, shoot: 0 };
  const 品 = (v) => `<button class="nav-item ${ui.view === v ? 'on' : ''}" data-act="view" data-v="${v}">${画面[v].en}${札[v] ? `<span class="badge">${札[v]}</span>` : ''}<span class="jp">${画面[v].jp}</span></button>`;
  return 品('today') + 品('projects') + 品('calendar') + 品('deadlines') + 品('weeks') +
    '<div class="nav-sep"></div>' + 品('plan') + 品('review') + '<div class="nav-sep"></div>' + 品('shoot') +
    `<div class="nav-sep"></div><div class="nav-foot">⌘1〜9 で画面<br>⌘K 命令窓　⌘N 新しい案件<br>スペース 次の工程を済み<br>↑↓ 案件を選ぶ　⌘Z 戻す${撮 ? `<br><br>撮影の予定 ${撮}件` : ''}</div>`;
}
function 帯を描く() {
  const p = P(), s = 設定();
  let 次 = '';
  if (ui.計算中) 次 = `<span class="busy"><span class="spin"></span> ${ui.計算中 === '反映' ? '反映中…（カレンダーとリマインダーへ。1分ほど）' : ui.計算中 === 'iPhone' ? 'iPhone で直したことを取り込んで計算中…' : '計算中…（カレンダーを読むので30秒〜1分）'}　<span class="num">${Math.floor((Date.now() - ui.計算の始め) / 1000)}秒</span></span>`;
  else if (ui.未計算) 次 = '<span class="busy">直した分は、まもなく自動で計算し直す</span>';
  else if (ui.誤り) 次 = `<span class="err">計算できなかった：${esc(ui.誤り)}</span>`;
  else if (!p) 次 = '<span class="next">次に：「計算し直す」を押す</span>';
  else if (p.今日 !== 今日()) 次 = '<span class="next">次に：日付が変わった。「計算し直す」を押す</span>';
  else {
    const 問 = (p.問題 || []).filter(q => !認めたか(q)).length;
    const 未反映 = !s.最後の反映 || p.作成 > s.最後の反映;
    if (問) 次 = `<span class="next">次に：間に合わない締切が ${問}件。「今日」の上の欄で選ぶ</span>`;
    else if (未反映) 次 = '<span class="next">次に：カレンダーに入れるなら「カレンダーとリマインダーへ反映」</span>';
    else 次 = '<span class="next">反映済み。いま押すものはない</span>';
  }
  if (iPhone) {
    if (S.同期誤り) 次 = `<span class="err">GitHub に届かない：${esc(S.同期誤り)}${S.最後に読んだ ? `（${hm(S.最後に読んだ)} に読んだものを出している）` : ''}</span>`;
    else if (S.待ち.length) 次 = `<span class="busy">⏳ Mac が取り込むまで待ち ${S.待ち.length}件（Mac が計算し直すと消える）</span>`;
    else 次 = '<span class="next">Mac と同じ。計算・反映・チェックリストは Mac で（iPhone では押せない）</span>';
  }
  const 要 = ui.要点.length ? `<span>${esc(ui.要点.slice(-3).join('　／　'))}</span>` : '';
  const 同 = Mac && S.同期 ? `iPhone との同期：${esc(S.同期.状態)}　` : '';
  const 反 = s.最後の反映 ? `最後に反映 ${md(s.最後の反映)} ${s.最後の反映.slice(11, 16)}` : '最後に反映：このアプリからはまだ';
  const 計 = p ? `計算 ${md(p.作成)} ${p.作成.slice(11, 16)}` : '';
  $('#statusbar').innerHTML = `${次}${要}<span class="right">${同}${計}　${iPhone ? (S.最後に読んだ ? '読んだ ' + hm(S.最後に読んだ) : '') : 反}${戻す列.length ? `　⌘Z で戻せる ${戻す列.length}件` : ''}</span>`;
  const 未反映 = p && (!s.最後の反映 || p.作成 > s.最後の反映);
  $('#reflectMark').textContent = 未反映 ? '● ' : '';
  $('#btnCalc').disabled = !!ui.計算中 || iPhone;
  $('#btnReflect').disabled = !!ui.計算中 || iPhone;
  if (iPhone) { $('#btnCalc').title = $('#btnReflect').title = 'iPhone では押せない。直したことは Mac が取り込んで計算し直し、反映する'; return; }
  $('#btnCalc').title = ui.計算中 ? '計算が終わるまで押せない' : 'エンジンを引数なしで走らせ、割り振りを作り直す（カレンダーは読むだけ）（⌘R）';
  $('#btnReflect').title = ui.計算中 ? '計算が終わるまで押せない' : (未反映 ? '● はまだカレンダーに入れていない計算があるしるし。' : '') + '作業ブロック・締切・食事をカレンダーへ、段取りの通知をリマインダーへ入れる（⇧⌘R）';
}

/* ═══ 今日 ═══ */
function 今日を描く() {
  const p = P();
  if (!p) return '<div class="empty"><b>進行.json がまだ無い</b>「計算し直す」を押す</div>';
  let h = '';
  // 間に合わない欄（今日以降の全部の締切が対象。エンジンの 問題）
  const 問 = (p.問題 || []);
  h += `<div class="sec"><div class="sec-label">RESOLVE<span class="jp">間に合わない作業</span><span class="right hint">今日以降の締切を全部見て、ふだんの時間で足りないものだけ出す</span></div>`;
  if (!問.length) h += `<div class="issue ok"><div class="issue-head"><span class="lamp green"></span><span class="issue-title">今日以降の締切は全部、ふだんの時間で間に合う</span></div></div>`;
  else h += `<div class="issues">${問.map(問題の札).join('')}</div>`;
  h += '</div>';
  // 次にやること
  h += 次にやることを描く(p);
  // 時間軸
  const t = 今日(), 明 = 足す日(t, 1);
  h += `<div class="sec"><div class="sec-label">TIMELINE<span class="jp">予定・移動・食事・作業を1本の時間軸で</span></div>
    <div class="legend">${['作業', '時間外', '深夜', '予定', '移動', '食事', '用事'].map(k => `<span><i class="k-${k}"></i>${k}</span>`).join('')}</div>
    <div class="days">${時間軸(t, '今日')}${時間軸(明, '明日')}</div></div>`;
  return h;
}
function 問題の札(q) {
  const u = 単位().find(u => u.締切.some(k => k.id === q.id));
  const 認 = 認めたか(q);
  const 色 = 認 ? 'ok' : (q.足りない > 0 || q.深夜 > 0 ? 'red' : 'orange');
  const n = 日差(今日(), q.日付);
  const 回 = !u || u.種 !== '案件';
  const 開 = ui.動かす[q.id];
  const 動かす理由 = !u ? 'この締切の案件が編集案件.json に見つからない' : (回 ? '定例の回の締切は、まだ動かせない（エンジンが未対応）' : '');
  const 最理由 = !u ? 'この締切の案件が見つからない' : (u.元.最優先 ? 'もう最優先にしてある' : '');
  const 認理由 = q.足りない > 0 ? '時間外を足しても足りない。締切を動かすか、最優先にする' : (認 ? 'もう認めた' : '');
  const k = u && u.締切.find(k => k.id === q.id);
  return `<div class="issue ${色}">
    <div class="issue-head"><span class="lamp ${色 === 'ok' ? 'silver' : 色}"></span><span class="issue-title">${esc(q.ラベル)}</span>
      <span class="tag ${n <= 1 ? 'red' : ''}">締切 ${mdw(q.日付)}${q.時刻 ? ' ' + q.時刻 : ''}・${n <= 0 ? '今日' : 'あと' + n + '日'}</span>
      ${q.最優先 ? '<span class="tag violet">★ 最優先</span>' : ''}</div>
    <div class="issue-nums">
      ${q.足りない > 0 ? `<span class="tag red">足りない ${時間(q.足りない)}</span>` : ''}
      ${q.深夜 > 0 ? `<span class="tag red">深夜（徹夜） ${時間(q.深夜)}</span>` : ''}
      ${q.時間外 > 0 ? `<span class="tag orange">時間外 ${時間(q.時間外)}</span>` : ''}
      ${認 ? `<span class="tag green">時間外を認めた（${md((設定().時間外を認めた[q.id] || {}).日)}）</span>` : ''}
    </div>
    <div class="issue-acts">
      <div class="act"><button class="btn btn-secondary btn-small" data-act="moveOpen" data-id="${esc(q.id)}" ${動かす理由 ? 'disabled' : ''} title="${esc(動かす理由 || '締切の日付と時刻を変えて、計算し直す')}">締切を動かす</button>${動かす理由 ? `<span class="why">${esc(動かす理由)}</span>` : ''}</div>
      <div class="act"><button class="btn btn-secondary btn-small" data-act="priority" data-u="${esc(u ? u.id : '')}" ${最理由 ? 'disabled' : ''} title="${esc(最理由 || '締切の順より先に、この案件から割り振る')}">この案件を最優先にする</button>${最理由 ? `<span class="why">${esc(最理由)}</span>` : ''}</div>
      <div class="act"><button class="btn ${q.足りない > 0 ? 'btn-secondary' : 'btn-orange'} btn-small" data-act="allowOT" data-id="${esc(q.id)}" ${認理由 ? 'disabled' : ''} title="${esc(認理由 || 'この時間外を予定どおりやると決める。時間が増えたらまた聞く')}">時間外を認める</button>${認理由 ? `<span class="why">${esc(認理由)}</span>` : ''}</div>
      ${u ? `<div class="act"><button class="btn btn-secondary btn-small" data-act="select" data-u="${esc(u.id)}">詳細を見る</button></div>` : ''}
    </div>
    ${開 && k ? `<div class="move-box"><span class="hint">${esc(k.種類)}を</span>
      ${欄('date', k.日付, `id="mv-d-${esc(q.id)}"`)}${欄('time', k.時刻, `id="mv-t-${esc(q.id)}" style="width:84px"`)}
      <button class="btn btn-primary btn-small" data-act="moveDo" data-id="${esc(q.id)}" data-u="${esc(u.id)}" data-k="${esc(k.種類)}">この日時に動かす</button>
      <button class="btn btn-secondary btn-small" data-act="moveOpen" data-id="${esc(q.id)}">やめる</button></div>` : ''}
  </div>`;
}
function 今日の段取り(d) { const p = P(); const v = p && p.日[d]; return v ? v.段取り.map(x => Object.assign({}, x, { s: 時刻(x.始), e: 時刻(x.終) })) : []; }
function 区分(x) {
  if (x.種 === '作業') return x.題.startsWith('深夜') ? '深夜' : (x.題.startsWith('時間外') ? '時間外' : '作業');
  if (x.種 === '予定') return x.題.startsWith('移動') ? '移動' : '予定';
  return x.種;
}
function 次にやることを描く(p) {
  const now = 今();
  const 全部 = 今日の段取り(今日()).concat(今日の段取り(足す日(今日(), 1))).filter(x => x.種 !== '区切り');
  const 中 = 全部.find(x => x.s <= now && now < x.e);
  const 次 = 全部.filter(x => x.s > now).sort((a, b) => a.s - b.s)[0];
  const 次予 = 全部.filter(x => x.s > now && x.種 !== '作業').sort((a, b) => a.s - b.s)[0];
  const 出 = (p.出発 || []).map(x => Object.assign({}, x, { t: 時刻(x.時刻) })).filter(x => x.t > now).sort((a, b) => a.t - b.t)[0];
  return `<div class="nowbar">
    <div class="nowcell"><div class="k">NOW　いまの作業</div><div class="v">${中 ? esc(中.題) : '段取りの入っていない時間'}</div>
      <div class="s">${中 ? `${hm(中.s)}〜${hm(中.e)}・残り ${あと(中.e - now)}` : (次 ? `次は ${hm(次.s)} から（あと ${あと(次.s - now)}）：${esc(次.題)}` : '')}</div></div>
    <div class="nowcell"><div class="k">NEXT　次の予定</div><div class="v">${次予 ? esc(次予.題) : 'なし'}</div>
      <div class="s">${次予 ? `${mdw(ds(次予.s))} ${hm(次予.s)}・あと ${あと(次予.s - now)}` : ''}</div></div>
    <div class="nowcell go"><div class="k">LEAVE　出発</div><div class="v">${出 ? `出発 ${hm(出.t)}` : '出発の予定なし'}</div>
      <div class="s">${出 ? `${mdw(ds(出.t))}・${esc(出.行き先)}・あと ${あと(出.t - now)}` : '3日先まで'}</div></div>
  </div>`;
}
function 時間軸(d, 名) {
  const xs = 今日の段取り(d);
  const 零 = 日(d);
  const 時 = t => (t - 零) / 3600000;
  const 始 = Math.floor(Math.min(8, ...xs.map(x => 時(x.s))));
  const 終 = Math.ceil(Math.max(22, ...xs.map(x => 時(x.e)))) + 0.5;
  const 一 = 46;
  const y = h => (h - 始) * 一;
  let h = '';
  for (let k = 始; k <= Math.floor(終); k++) h += `<div class="tl-hour" style="top:${y(k)}px"><span>${k % 24}:00</span></div>`;
  // 今晩（夕食のあとの時間外）と 深夜（作業の終わりの時刻から）の区切り
  const 夕 = xs.find(x => x.種 === '食事' && x.題.startsWith('夕食'));
  const 晩 = 夕 ? 時(夕.e) : 19;
  const 夜 = しそ設定().作業の終わり || 22;
  h += `<div class="tl-zone evening" style="top:${y(晩)}px"><b>今晩</b></div><div class="tl-zone night" style="top:${y(夜)}px"><b>深夜</b></div>`;
  // 重なりは横に分ける
  const 並 = xs.filter(x => x.種 !== '区切り').sort((a, b) => a.s - b.s);
  const 列終 = []; const 列 = new Map();
  for (const x of 並) { let i = 列終.findIndex(e => e <= x.s); if (i < 0) { 列終.push(x.e); i = 列終.length - 1; } else 列終[i] = x.e; 列.set(x, i); }
  const n = Math.max(1, 列終.length);
  const now = 今();
  for (const x of 並) {
    const k = 区分(x); const top = y(時(x.s)); const ht = Math.max(18, (時(x.e) - 時(x.s)) * 一 - 2);
    const i = 列.get(x); const いま = x.s <= now && now < x.e;
    const 幅 = n > 1 ? `left:calc(58px + (100% - 66px) * ${i / n});right:auto;width:calc((100% - 66px) / ${n} - 3px);` : '';
    h += `<div class="tl-item k-${k} ${いま ? 'now' : ''}" style="top:${top}px;height:${ht}px;${幅}" title="${esc(x.題 + (x.材料 ? '\n材料：' + x.材料 : ''))}">
      <div class="t">${hm(x.s)}〜${hm(x.e)}${ht < 36 ? '　<b>' + esc(x.題) + '</b>' : ''}</div>${ht >= 36 ? `<div class="n">${esc(x.題)}</div>` : ''}${ht >= 56 && x.材料 ? `<div class="m">材料：${esc(x.材料)}</div>` : ''}</div>`;
  }
  for (const x of xs.filter(x => x.種 === '区切り')) h += `<div class="tl-mark" style="top:${y(時(x.s))}px">${esc(x.題)}</div>`;
  const nh = 時(now);
  if (nh >= 始 && nh <= 終) h += `<div class="tl-now" style="top:${y(nh)}px"><span>いま ${hm(now)}</span></div>`;
  const 作 = xs.filter(x => x.種 === '作業').reduce((a, x) => a + (x.e - x.s) / 3600000, 0);
  return `<div class="tl"><div class="tl-head">${名} ${mdw(d)}<span class="hint">作業 ${時間(作)}</span></div>
    <div class="tl-body" style="height:${(終 - 始) * 一 + 8}px">${xs.length ? h : '<div class="empty">段取りなし</div>'}</div></div>`;
}

/* ═══ 案件（前の PROJECTS） ═══ */
function 案件を描く() {
  const us = 単位();
  if (!us.length) return '<div class="empty"><b>案件がありません</b>「＋ 新しい案件」（⌘N）から作る</div>';
  const 並べ = us.filter(u => u.種 !== '回を作る' && !済か(u)).sort((a, b) => {
    if (!!b.元.最優先 - !!a.元.最優先) return !!b.元.最優先 - !!a.元.最優先;
    const ka = 近い締切(a), kb = 近い締切(b); return (ka ? ka.日付 : '9') < (kb ? kb.日付 : '9') ? -1 : 1;
  });
  const 作る = us.filter(u => u.種 === '回を作る');
  const 済 = us.filter(u => 状態(u) === '納品済');
  let h = `<div class="sec"><div class="sec-label">PROJECTS<span class="jp">進んでいる案件 ${並べ.length}件</span><span class="right hint">札を押すと工程が済み／未に切り替わる・スペースで選んだ案件の次の工程を済みに</span></div>
    <div class="cards">${並べ.map(案件カード).join('')}</div></div>`;
  if (作る.length) h += `<div class="sec"><div class="sec-label">REGULAR<span class="jp">定例の先の月（回がまだ書いてない。定例の 残り編集時間 で数えている）</span></div>
    <div class="panel-card">${作る.map(u => `<div class="list-row"><div class="grow"><div class="t1">${esc(u.名前)}</div><div class="t2">納期 ${mdw(u.締切[0].日付)}・${時間((進行の締切(u.締切[0].id) || {}).残り)}</div></div>
      <button class="btn btn-secondary btn-small" data-act="makeRound" data-u="${esc(u.id)}">この月の回を作る</button></div>`).join('')}</div></div>`;
  if (済.length) h += `<div class="sec"><div class="sec-label">DELIVERED<span class="jp">納品済 ${済.length}件</span><span class="right"><button class="btn btn-secondary btn-small" data-act="toggleDone">${ui.済も出す ? '隠す' : '出す'}</button></span></div>
    ${ui.済も出す ? `<div class="panel-card done-list">${済.map(u => `<div class="list-row ${ui.sel === u.id ? 'sel' : ''}" data-act="select" data-u="${esc(u.id)}" data-ctx="card"><span class="lamp green"></span><div class="grow t1">${esc(u.名前)}</div>
      <span class="hint">${工程(u).length ? h字(合計(u)) + '・実績 ' + h字(実績(u)) : '工程なし'}</span><button class="btn btn-secondary btn-small" data-act="status" data-u="${esc(u.id)}" data-s="作業中" title="納品済から作業中に戻す">作業中に戻す</button></div>`).join('')}</div>` : ''}</div>`;
  return h;
}
function 案件カード(u) {
  const c = 急ぎ(u), done = 済か(u);
  const 工 = 工程(u), 計 = 合計(u), 残 = 残り(u);
  const 済h = 計 - 残, pct = 計 > 0 ? Math.round(済h / 計 * 100) : 0;
  const k = 近い締切(u);
  const n = k && k.日付 ? 日差(今日(), k.日付) : null;
  const badge = done ? '完了' : (n == null ? '締切なし' : n < 0 ? `${-n}日過ぎ` : n === 0 ? '今日' : `残り${n}日`);
  const 次i = 工.findIndex(s => !s.済);
  const 札 = 工.length ? 工.map((s, i) => `<button class="pj-step ${s.済 ? 'done' : 'todo'} ${i === 次i && ui.sel === u.id ? 'next' : ''}" style="flex:${Math.max(1, Number(s.見込み) || 1)}"
      data-act="toggleStep" data-ctx="step" data-u="${esc(u.id)}" data-i="${i}" title="${esc(s.名前)} 見込み${h字(s.見込み)}${s.実績 ? '・実績' + h字(s.実績) : ''}（押すと${s.済 ? '未' : '済み'}に）">${esc(記号(s))}</button>`).join('')
    : `<span class="hint">工程なし（${残りの説明(u)} で数えている）</span><button class="btn btn-secondary btn-small" data-act="presetSheet" data-u="${esc(u.id)}" style="margin-left:auto">プリセットから工程を入れる</button>`;
  const 見 = 開いた締切(u).map(k => { const e = k.進行; if (!e) return ''; const j = 判定(e); return `<span class="tag ${j === 'red' ? 'red' : j === 'orange' ? 'orange' : 'dim'}">${esc(k.種類)} ${md(k.日付)}${k.時刻 ? ' ' + k.時刻 : ''}：${esc(e.見込み)}</span>`; }).join('');
  const vs = 版(u), 最後 = vs[vs.length - 1];
  const 指 = vs.flatMap(v => v.指摘 || []);
  return `<div class="pj ${ui.sel === u.id ? 'sel' : ''} ${done ? 'done' : ''}" data-act="select" data-u="${esc(u.id)}" data-ctx="card">
    <div class="pj-accent ${c}"></div>
    <div class="pj-body">
      <div class="pj-top"><div class="pj-title">${esc(u.名前)}</div>
        ${u.元.最優先 ? '<span class="tag violet">★ 最優先</span>' : ''}${u.種 === '回' ? '<span class="tag dim">定例</span>' : ''}
        <span class="tag ${状態(u) === '確認待ち' ? 'violet' : 状態(u) === '直し' ? 'orange' : 状態(u) === '納品済' ? 'green' : ''}">${esc(状態(u) || '—')}</span></div>
      <div class="pj-row">
        <div class="pj-dates"><span class="lbl">開始</span><span class="val">${md(開始日(u))}</span><span class="arrow">→</span>
          <span class="lbl">納期</span><span class="val ${done ? '' : 'dl-' + c}">${k ? md(k.日付) + (k.時刻 ? ' ' + k.時刻 : '') : '—'}</span></div>
        <span class="pj-meta num">${工.length ? `合計${h字(計)}・残り${h字(残)}` : `残り${h字(u.締切.reduce((t_, k) => t_ + ((進行の締切(k.id) || {}).残り || 0), 0) || u.元.残り編集時間)}`}${実績(u) ? '・実績' + h字(実績(u)) : ''}</span>
        <div class="pj-badge ${done ? 'done' : c}">${badge}</div>
        <button class="pj-gear" data-act="settings" data-u="${esc(u.id)}" title="案件の設定（⌘E）">⚙</button>
      </div>
      <div class="progress"><div class="bar"><i class="bar-${c}" style="width:${pct}%"></i></div><span class="pct num">${pct}%</span></div>
      <div class="pj-steps">${札}</div>
      ${見 || 最後 ? `<div class="pj-foot">${見}${最後 ? `<span class="tag ${最後.承認 ? 'green' : ''}">${esc(最後.名前)}${最後.承認 ? ' 承認' : ''}</span>` : ''}${指.length ? `<span class="tag ${指.some(x => !x.済) ? 'orange' : 'green'}">指摘 ${指.filter(x => x.済).length}/${指.length}</span>` : ''}</div>` : ''}
    </div></div>`;
}

/* ═══ 右の詳細（選んだ案件） ═══ */
function 詳細を描く() {
  const u = ui.sel && 単位を探す(ui.sel);
  if (!u) {
    const p = P();
    return `<div class="sec-label">DETAIL<span class="jp">詳細</span></div><div class="hint">案件を選ぶと、ここに状態・締切・工程・版と指摘が出る。<br><br>
      ${p ? `計算：${esc(p.作成.replace('T', ' '))}<br>` : ''}python：${esc(S.python)}<br>置き場：${esc(S.置き場 || '')}</div>`;
  }
  const 回作 = u.種 === '回を作る';
  let h = `<div class="d-title">${esc(u.名前)}</div><div class="d-sub">${u.種 === '回' ? '<span class="tag dim">定例の回</span>' : ''}
    ${u.元.最優先 ? '<span class="tag violet">★ 最優先</span>' : ''}${u.元.撮影日 ? `<span class="tag">撮影 ${mdw(u.元.撮影日)}</span>` : ''}${u.元._ ? `<span>${esc(u.元._)}</span>` : ''}</div>`;
  if (回作) return h + `<div class="hint" style="margin-bottom:10px">この月の回は、まだ編集案件.json に書いてない。</div><button class="btn btn-primary btn-wide" data-act="makeRound" data-u="${esc(u.id)}">この月の回を作る</button>`;
  // 状態（工程とは別に持つ）
  h += `<div class="sec"><div class="sec-label">STATUS<span class="jp">状態</span></div><div class="seg">${状態の名.map(s => `<button class="${状態(u) === s ? 'on s-' + s : ''}" data-act="status" data-u="${esc(u.id)}" data-s="${s}">${s}</button>`).join('')}</div>
    ${(u.元.状態 === '編集中') ? '<div class="why">前の名前「編集中」は「作業中」として出している</div>' : ''}</div>`;
  // 日付
  h += `<div class="sec"><div class="sec-label">DATES<span class="jp">着手できる日と締切</span></div><div class="panel-card">
    <div class="form-row" style="flex-wrap:wrap"><span class="form-label">着手できる日</span>${欄('date', u.元.着手できる日, `style="width:132px" data-chg="startDate" data-u="${esc(u.id)}"`, 'なし（今日から）')}
      ${u.元.着手できる日 ? `<button class="icon-btn" data-act="clearStart" data-u="${esc(u.id)}" title="着手できる日を外す">✕</button>` : ''}<div class="hint" style="width:100%;padding-left:92px">この日より前には割り振らない（素材や先方の戻り待ち）</div></div>`;
  for (const k of u.締切) {
    const e = 進行の締切(k.id); const j = 判定(e);
    h += `<div class="form-row" style="flex-wrap:wrap"><span class="form-label">${esc(k.種類)}</span>
      ${欄('date', k.日付, `style="width:132px" id="dl-d-${esc(k.id)}" ${u.種 !== '案件' ? 'disabled' : ''}`)}
      ${欄('time', k.時刻, `style="width:84px" id="dl-t-${esc(k.id)}" ${u.種 !== '案件' ? 'disabled' : ''}`)}
      <button class="btn btn-secondary btn-small" data-act="moveDl" data-u="${esc(u.id)}" data-k="${esc(k.種類)}" data-id="${esc(k.id)}" ${u.種 !== '案件' ? 'disabled' : ''} title="${u.種 !== '案件' ? '定例の回の締切は、まだ動かせない（エンジンが未対応）' : '日付・時刻を変えてから押す。計算し直し、反映するとカレンダーも直る'}">締切を動かす</button>
      ${e ? `<div style="width:100%;padding-left:92px" class="hint"><span class="lamp ${j === 'ok' ? 'green' : j}"></span>残り ${時間(e.残り)}・使える ${時間(e.使える)}・${esc(e.見込み)}</div>` : ''}
      ${u.種 !== '案件' ? '<div class="why" style="padding-left:92px">定例の回の締切は、まだ動かせない（エンジンが未対応）</div>' : ''}</div>`;
  }
  h += `</div></div>`;
  // 工程
  const 工 = 工程(u);
  const 種 = u.締切.map(k => k.種類);
  h += `<div class="sec"><div class="sec-label">STEPS<span class="jp">工程・見込み・実績</span><span class="right hint">見込みは済んでいない分だけ残りに数える。実績は記録だけ</span></div><div class="panel-card">`;
  if (!工.length) h += `<div class="list-row"><span class="hint">工程なし。いまは ${残りの説明(u)} で数えている</span></div>`;
  工.forEach((s, i) => {
    h += `<div class="step-row ${s.済 ? 'is-done' : ''}" draggable="true" data-drag="${i}" data-u="${esc(u.id)}" data-ctx="step" data-i="${i}">
      <div class="step-main"><span class="grip" title="ドラッグで並べ替え">⋮⋮</span>
      <button class="step-done-check ${s.済 ? 'on' : ''}" data-act="toggleStep" data-u="${esc(u.id)}" data-i="${i}" title="済み／未を切り替える"></button>
      <div class="step-code">${esc(記号(s))}</div>
      <div class="step-names"><div class="step-jp">${esc(s.名前)}</div><div class="step-en">${esc(英名(s))}</div></div>
      <button class="icon-btn" data-act="stepUp" data-u="${esc(u.id)}" data-i="${i}" ${i === 0 ? 'disabled' : ''} title="${i === 0 ? 'いちばん上' : '上へ'}">↑</button>
      <button class="icon-btn" data-act="stepDown" data-u="${esc(u.id)}" data-i="${i}" ${i === 工.length - 1 ? 'disabled' : ''} title="${i === 工.length - 1 ? 'いちばん下' : '下へ'}">↓</button>
      <button class="icon-btn del" data-act="stepDel" data-u="${esc(u.id)}" data-i="${i}" title="この工程を消す（⌘Z で戻せる）">✕</button></div>
      <div class="step-ctl"><span class="hint">見込み</span><div title="見込み（0.5時間ずつ）" class="stepper"><button data-act="est" data-u="${esc(u.id)}" data-i="${i}" data-d="-0.5" ${s.見込み > 0 ? '' : 'disabled'}>−</button><span class="v">${h字(s.見込み)}</span><button data-act="est" data-u="${esc(u.id)}" data-i="${i}" data-d="0.5">＋</button></div>
      <span class="hint">実績</span><div title="実績（実際にかかった時間。残りの計算には使わない）" class="stepper dim"><button data-act="act" data-u="${esc(u.id)}" data-i="${i}" data-d="-0.5" ${s.実績 > 0 ? '' : 'disabled'}>−</button><span class="v">${s.実績 ? h字(s.実績) : '—'}</span><button data-act="act" data-u="${esc(u.id)}" data-i="${i}" data-d="0.5">＋</button></div>
      ${種.length > 1 ? `<button class="btn btn-secondary btn-small" data-act="stepDl" data-u="${esc(u.id)}" data-i="${i}" title="この工程をどの締切までに済ませるか（押すと切り替わる）">→ ${esc(s.締切 || 種[0])}</button>` : ''}</div></div>`;
  });
  if (工.length) h += `<div class="total-row"><span>合計 ${h字(合計(u))}・済んでいない ${h字(残り(u))}</span><span class="num">実績 ${h字(実績(u))}</span></div>`;
  h += `</div><div style="display:flex;gap:6px;margin-top:6px"><button class="btn btn-secondary btn-small" data-act="addStep" data-u="${esc(u.id)}">＋ 工程を足す</button>
    <button class="btn btn-secondary btn-small" data-act="presetSheet" data-u="${esc(u.id)}">プリセットから入れる</button>
    <button class="btn btn-secondary btn-small" data-act="nextStep" data-u="${esc(u.id)}" ${工.some(s => !s.済) ? '' : 'disabled'} title="${工.some(s => !s.済) ? 'スペースでも同じ' : '済んでいない工程が無い'}">次の工程を済みに</button></div></div>`;
  // 版と指摘
  const vs = 版(u);
  h += `<div class="sec"><div class="sec-label">VERSIONS<span class="jp">版と直しの指摘</span><span class="right hint">確認用 v1 → 直し1 → 確認用 v2 …</span></div><div class="panel-card">`;
  if (!vs.length) h += `<div class="list-row"><span class="hint">版はまだ無い。確認用を書き出したら「版を足す」</span></div>`;
  vs.forEach((v, vi) => {
    const 指 = v.指摘 || [];
    h += `<div class="ver"><div class="ver-head"><span class="ver-name">${esc(v.名前)}</span><span class="hint">${mdw(v.日付)}</span>
      ${指.length ? `<span class="tag ${指.some(x => !x.済) ? 'orange' : 'green'}">${指.filter(x => x.済).length}/${指.length}</span>` : ''}
      <span style="margin-left:auto"></span><button class="btn btn-small ${v.承認 ? 'btn-primary' : 'btn-secondary'}" data-act="verOk" data-u="${esc(u.id)}" data-v="${vi}" title="先方の承認が出たら押す">${v.承認 ? '✓ 承認' : '承認'}</button>
      <button class="icon-btn del" data-act="verDel" data-u="${esc(u.id)}" data-v="${vi}" title="この版を消す（⌘Z で戻せる）">✕</button></div>
      ${指.map((n, ni) => `<div class="note ${n.済 ? 'is-done' : ''}"><button class="step-done-check ${n.済 ? 'on' : ''}" data-act="noteToggle" data-u="${esc(u.id)}" data-v="${vi}" data-n="${ni}" title="直したら押す"></button><span class="txt">${esc(n.内容)}</span></div>`).join('')}
      <div class="note"><input class="in" style="flex:1" placeholder="指摘を足す（return）" data-chg="note" data-u="${esc(u.id)}" data-v="${vi}"></div></div>`;
  });
  h += `</div><button class="btn btn-secondary btn-small" style="margin-top:6px" data-act="addVer" data-u="${esc(u.id)}">＋ 版を足す（${!vs.length || vs[vs.length - 1].名前.startsWith('直し') ? '確認用' : '直し'}）</button></div>`;
  // その他の操作
  h += `<div class="sec"><div class="sec-label">ACTIONS<span class="jp">操作</span></div><div style="display:flex;flex-wrap:wrap;gap:6px">
    <button class="btn btn-secondary btn-small" data-act="tomorrow" data-u="${esc(u.id)}" title="着手できる日を明日にする（⌘]）">明日へ送る</button>
    ${u.元.最優先 ? `<button class="btn btn-secondary btn-small" data-act="unpriority" data-u="${esc(u.id)}">最優先を外す</button>` : `<button class="btn btn-secondary btn-small" data-act="priority" data-u="${esc(u.id)}" title="締切の順より先に割り振る（⇧⌘P）">この案件を最優先にする</button>`}
    <button class="btn btn-secondary btn-small" data-act="settings" data-u="${esc(u.id)}" title="名前・日付・工程をまとめて直す（⌘E）">案件の設定…</button>
    <button class="btn btn-secondary btn-small" data-act="saveAsPreset" data-u="${esc(u.id)}" ${工.length ? '' : 'disabled'} title="${工.length ? 'この工程の組をプリセットにする' : '工程が無い'}">プリセットとして保存</button>
    <button class="btn btn-danger btn-small" data-act="deleteProject" data-u="${esc(u.id)}" ${u.種 !== '案件' ? 'disabled' : ''} title="${u.種 !== '案件' ? '定例の回はここでは消せない' : '一覧から外す（設定の 消した案件 に残る。⌘Z で戻せる）'}">この案件を消す</button></div></div>`;
  return h;
}

/* ═══ 暦（前の CALENDAR。割り振りはエンジンの結果） ═══ */
function 暦を描く() {
  if (!ui.calMonth) { const t = 今(); ui.calMonth = { y: t.getFullYear(), m: t.getMonth() }; }
  const { y, m } = ui.calMonth;
  const 初 = new Date(y, m, 1); const 始 = new Date(初); 始.setDate(1 - 初.getDay());
  const 日々 = []; for (let i = 0; i < 42; i++) { const d = new Date(始); d.setDate(始.getDate() + i); 日々.push(ds(d)); }
  const p = P();
  const us = 単位().filter(u => !済か(u));
  const 帯 = us.map(u => ({ u, c: 急ぎ(u), 日: new Set(割当の日々(u).map(x => x.日)) }));
  const 締 = {}; us.forEach(u => u.締切.forEach(k => { if (k.日付) (締[k.日付] = 締[k.日付] || []).push({ u, k }); }));
  const 予 = {}; if (p) for (const [d, v] of Object.entries(p.日)) 予[d] = (v.段取り || []).filter(x => x.種 === '予定' && !x.題.startsWith('移動')).map(x => x.題.replace(/^撮影：/, '📷 '));
  const t = 今日();
  const cells = 日々.map((d, i) => {
    const dd = 日(d), oth = dd.getMonth() !== m;
    const v = p && p.日[d];
    let bars = '';
    for (const b of 帯) {
      if (!b.日.has(d)) continue;
      const 前 = i % 7 !== 0 && b.日.has(日々[i - 1]), 後 = i % 7 !== 6 && b.日.has(日々[i + 1]);
      bars += `<div class="cal-bar cb-${b.c} ${前 ? '' : 'start'} ${後 ? '' : 'end'}" title="${esc(b.u.名前)}">${前 ? '' : esc(b.u.名前)}</div>`;
    }
    const dl = (締[d] || []).map(x => `<div class="cal-dl ${急ぎ(x.u) === 'red' ? 'dl-red' : 急ぎ(x.u) === 'orange' ? 'dl-orange' : 'dl-silver'}">▲ ${esc(x.k.種類)} ${esc(x.u.名前.slice(0, 12))}</div>`).join('');
    const ev = (予[d] || []).slice(0, 2).map(x => `<div class="cal-ev">${esc(x)}</div>`).join('');
    return `<div class="cal-day ${oth ? 'oth' : ''} ${d === t ? 'tod' : ''}"><div class="cal-day-num">${dd.getDate()}${v && v.使える ? `<span class="free">空き ${h字(v.使える)}</span>` : ''}</div>${bars}${dl}${ev}</div>`;
  }).join('');
  return `<div class="cal-header"><div class="cal-nav"><button class="cal-arrow" data-act="prevMonth" title="前の月">‹</button><div class="cal-title">${y}年${m + 1}月</div>
    <button class="cal-arrow" data-act="nextMonth" title="次の月">›</button><button class="btn btn-secondary btn-small" data-act="thisMonth">今月</button></div>
    <span class="hint">帯＝エンジンが作業を割り振った日（${p ? md(p.今日) + 'から3週間' : '—'}）・▲＝締切・休みと空き時間はカレンダーから</span></div>
    <div class="cal-weekdays">${曜.map((w, i) => `<div class="cal-weekday ${i === 0 ? 'sun' : i === 6 ? 'sat' : ''}">${w}</div>`).join('')}</div>
    <div class="cal-grid">${cells}</div>${工程表(us, y, m)}`;
}
function 工程表(us, y, m) {
  const 日数 = new Date(y, m + 1, 0).getDate();
  const 頭 = `${y}-${String(m + 1).padStart(2, '0')}-`;
  const x = d => (Number(d.slice(8)) - 1) / 日数 * 100;
  const rows = us.map(u => {
    const ds_ = 割当の日々(u).map(a => a.日).filter(d => d.startsWith(頭));
    const dls = u.締切.filter(k => k.日付 && k.日付.startsWith(頭));
    if (!ds_.length && !dls.length) return '';
    const c = 急ぎ(u);
    const 左 = ds_.length ? x(ds_[0]) : 0, 幅 = ds_.length ? Math.max(1.5, x(ds_[ds_.length - 1]) - x(ds_[0]) + 100 / 日数) : 0;
    const 字 = ds_.length ? (ds_.length > 1 ? `${md(ds_[0])}–${md(ds_[ds_.length - 1])}` : md(ds_[0])) : '';
    // 棒が短くて日付が入らないときは、棒の右に出す（切れて読めなくならないように）
    const bar = ds_.length ? (幅 >= 字.length * 1.1
      ? `<div class="g-bar ${c}" style="left:${左}%;width:${幅}%">${字}</div>`
      : `<div class="g-bar ${c}" style="left:${左}%;width:${幅}%"></div><div class="g-lab" style="left:calc(${左 + 幅}% + 6px)">${字}</div>`) : '';
    const mk = dls.map(k => `<div class="g-dl" style="left:calc(${x(k.日付) + 100 / 日数}% - 1px)" title="${esc(k.種類)} ${md(k.日付)}"></div>`).join('');
    return `<div class="g-row"><div class="g-name ${c === 'red' ? 'dl-red' : c === 'orange' ? 'dl-orange' : ''}">${esc(u.名前)}</div><div class="g-track">${bar}${mk}${今日().startsWith(頭) ? `<div class="g-today" style="left:${x(今日())}%"></div>` : ''}</div></div>`;
  }).join('');
  const ax = [1, 5, 10, 15, 20, 25, 日数].map(d => `<span style="left:${(d - 0.5) / 日数 * 100}%">${d}</span>`).join('');
  return `<div class="gantt-card"><div class="gantt-title">PROJECT SCHEDULE — ${y}/${String(m + 1).padStart(2, '0')}　<span style="text-transform:none">横棒＝作業の始めと終わり・白い線＝締切</span></div>${rows || '<div class="hint">この月に割り振りも締切も無い</div>'}<div class="g-axis">${ax}</div></div>`;
}

/* ═══ 締切 ═══ */
function 締切を描く() {
  const p = P(); if (!p) return '<div class="empty"><b>進行.json がまだ無い</b></div>';
  const us = 単位();
  const rows = p.締切.map(k => {
    const u = us.find(u => u.締切.some(x => x.id === k.id));
    const j = 判定(k); const n = 日差(今日(), k.日付);
    return `<tr class="${u && ui.sel === u.id ? 'sel' : ''}" data-act="select" data-u="${esc(u ? u.id : '')}">
      <td><span class="lamp ${j === 'ok' ? 'green' : j}"></span><b class="num">${mdw(k.日付)}${k.時刻 ? ' ' + k.時刻 : ''}</b><div class="hint">${n <= 0 ? '今日' : 'あと' + n + '日'}</div></td>
      <td class="wrap"><b title="${esc(k.名前)}">${esc(k.名前)}</b><div class="hint">${esc(k.種類)}${k.最優先 ? '　★ 最優先' : ''}</div></td>
      <td>${esc((k.状態 === '編集中' ? '作業中' : k.状態) || '—')}</td><td class="num">${k.撮影日 ? mdw(k.撮影日) : '—'}</td><td class="num">${k.着手できる日 ? mdw(k.着手できる日) : '—'}</td>
      <td class="r num">${時間(k.残り)}</td><td class="r num">${時間(k.使える)}</td>
      <td class="wrap ${j === 'red' ? 'dl-red' : j === 'orange' ? 'dl-orange' : ''}">${esc(k.見込み)}</td></tr>`;
  }).join('');
  const し = (p.しそチャンNET || []).map(k => `<tr><td class="num">${mdw(k.締切)}</td><td>${esc(k.番組)} ${k.回}</td><td>${esc(k.状態)}</td><td>${k.ロケ日 ? mdw(k.ロケ日) : '未定'}</td><td class="${(k.見込み || '').includes('間に合わない') ? 'dl-red' : ''}">${esc(k.見込み)}</td></tr>`).join('');
  return `<div class="sec"><div class="sec-label">DEADLINES<span class="jp">締切の一覧（近い順）</span><span class="right hint">緑＝間に合う・橙＝時間外が要る・赤＝深夜・間に合わない</span></div>
    <div class="panel-card"><table class="table"><tr><th>締切</th><th>案件</th><th>状態</th><th>撮影</th><th>着手できる日</th><th class="r">残り</th><th class="r">使える</th><th>見込み</th></tr>${rows}</table></div></div>
    ${し ? `<div class="sec"><div class="sec-label">SHISOCHAN NET<span class="jp">しそチャンNET</span></div><div class="panel-card"><table class="table"><tr><th>締切</th><th>回</th><th>状態</th><th>ロケ</th><th>見込み</th></tr>${し}</table></div></div>` : ''}`;
}

/* ═══ 3週間 ═══ */
function 三週間を描く() {
  const p = P(); if (!p) return '';
  const days = Object.entries(p.日).filter(([d]) => d >= p.今日).slice(0, 21);
  const 長 = (a) => (時刻(a.終) - 時刻(a.始)) / 3600000;
  const 最大 = Math.max(12, ...days.map(([, v]) => Math.max(v.使える || 0, (v.割当 || []).reduce((s, a) => s + 長(a), 0))));
  const ラベル色 = {}; const us = 単位();
  for (const u of us) for (const k of u.締切) { const e = 進行の締切(k.id); if (e) ラベル色[e.ラベル] = 急ぎ(u); }
  const 色 = { red: 'rgba(205,50,50,0.9)', orange: 'rgba(205,100,16,0.9)', silver: 'rgba(140,146,158,0.85)' };
  const rows = days.map(([d, v]) => {
    const 通 = (v.割当 || []).filter(a => a.種類 === '通常'), 外 = (v.割当 || []).filter(a => a.種類 !== '通常');
    let x = 0, segs = '';
    for (const a of 通) { const w = 長(a) / 最大 * 100; segs += `<div class="wk-seg" style="left:${x}%;width:${w}%;background:${色[ラベル色[a.名前] || 'silver']}" title="${esc(a.名前)} ${時間(長(a))}"></div>`; x += w; }
    x = Math.max(x, (v.使える || 0) / 最大 * 100);
    for (const a of 外) { const w = 長(a) / 最大 * 100; segs += `<div class="wk-seg ${a.種類}" style="left:${x}%;width:${w}%;background:${色[ラベル色[a.名前] || 'silver']};opacity:.8" title="${a.種類 === '深夜' ? '深夜' : '時間外'}：${esc(a.名前)} ${時間(長(a))}"></div>`; x += w; }
    const 計 = (v.割当 || []).reduce((s, a) => s + 長(a), 0);
    const w = 日(d).getDay();
    return `<div class="wk-row"><div class="wk-date ${w === 0 || w === 6 ? 'we' : ''} ${d === p.今日 ? 'tod' : ''}">${mdw(d)}</div>
      <div class="wk-track"><div class="wk-free" style="width:${(v.使える || 0) / 最大 * 100}%"></div>${segs}</div>
      <div class="wk-sum">使える ${時間(v.使える)}・割当 ${時間(計)}</div></div>`;
  }).join('');
  return `<div class="sec"><div class="sec-label">3 WEEKS<span class="jp">日ごとの使える時間と割り振り</span><span class="right hint">灰の帯＝ふだんの時間で使える分・色＝案件の急ぎ・枠の橙＝時間外・赤＝深夜</span></div>${rows}</div>`;
}

/* ═══ 朝の計画・夜の締め（Sunsama） ═══ */
function 朝夜を描く() {
  return `<div class="tabs2"><button class="${ui.planTab === '朝' ? 'on' : ''}" data-act="planTab" data-t="朝">朝の計画</button><button class="${ui.planTab === '夜' ? 'on' : ''}" data-act="planTab" data-t="夜">夜の締め</button></div>` +
    (ui.planTab === '朝' ? 朝を描く() : 夜を描く());
}
function その日の案件(d) {
  const p = P(); if (!p || !p.日[d]) return [];
  const ラ = new Map();
  for (const a of p.日[d].割当 || []) ラ.set(a.名前, (ラ.get(a.名前) || 0) + (時刻(a.終) - 時刻(a.始)) / 3600000);
  const us = 単位();
  const out = [];
  for (const [ラベル, h] of ラ) {
    const u = us.find(u => u.締切.some(k => { const e = 進行の締切(k.id); return e && e.ラベル === ラベル; }));
    out.push({ ラベル, h, u });
  }
  return out;
}
function 朝を描く() {
  const p = P(); if (!p) return '';
  const 昨 = 足す日(今日(), -1);
  const 残 = その日の案件(昨).filter(x => x.u && 工程(x.u).some(s => !s.済) && !済か(x.u));
  const 今 = 今日の段取り(今日()).filter(x => x.種 === '作業');
  const 計 = k => 今.filter(x => 区分(x) === k).reduce((a, x) => a + (x.e - x.s) / 3600000, 0);
  const 通 = 計('作業'), 外 = 計('時間外'), 深 = 計('深夜');
  const 上 = (しそ設定().空き日に使える時間 || 9), 外上 = (しそ設定().時間外の上限 || 3);
  const 終 = 今.length ? 今[今.length - 1].e : null;
  let h = `<div class="sec"><div class="sec-label">1. YESTERDAY<span class="jp">昨日の残りを片づける</span><span class="right hint">済んだ＝次の工程を済みに・明日へ＝着手できる日を明日に</span></div><div class="panel-card">`;
  if (!残.length) h += `<div class="list-row"><span class="hint">昨日に割り振った作業で、残っているものは無い（または昨日の割り振りが進行.json に無い）</span></div>`;
  for (const x of 残) {
    const i = 工程(x.u).findIndex(s => !s.済); const s = 工程(x.u)[i];
    h += `<div class="list-row"><div class="grow"><div class="t1">${esc(x.u.名前)}</div><div class="t2">昨日 ${時間(x.h)} 割り振り・次の工程：${esc(s.名前)}（${h字(s.見込み)}）</div></div>
      <button class="btn btn-primary btn-small" data-act="toggleStep" data-u="${esc(x.u.id)}" data-i="${i}">済んだ</button><button class="btn btn-secondary btn-small" data-act="tomorrow" data-u="${esc(x.u.id)}">明日へ</button></div>`;
  }
  h += `</div></div>`;
  h += `<div class="sec"><div class="sec-label">2. TODAY<span class="jp">今日の合計を確かめる</span></div><div class="plan-sum">
    <div class="nowcell"><div class="k">ふだんの時間</div><div class="v num">${時間(通)}</div><div class="s">上限 ${時間(上)}</div></div>
    <div class="nowcell"><div class="k">時間外</div><div class="v num ${外 ? 'dl-orange' : ''}">${時間(外)}</div><div class="s">上限 ${時間(外上)}</div></div>
    <div class="nowcell"><div class="k">深夜</div><div class="v num ${深 ? 'dl-red' : ''}">${時間(深)}</div><div class="s">${深 ? '徹夜になる' : 'なし'}</div></div>
    <div class="nowcell go"><div class="k">終わる見込み</div><div class="v num">${終 ? hm(終) : '—'}</div><div class="s">${終 ? (ds(終) !== 今日() ? '日をまたぐ' : '今日の最後の作業') : '今日の作業なし'}</div></div></div>
    <div class="meter" title="ふだん・時間外・深夜"><i style="width:${通 / (上 + 外上) * 100}%;background:#4a78d4"></i><i style="width:${外 / (上 + 外上) * 100}%;background:#ff9210"></i><i style="width:${Math.min(100, 深 / (上 + 外上) * 100)}%;background:#ff4040"></i></div>
    <div class="panel-card" style="margin-top:10px">${今.map(x => `<div class="list-row"><span class="tag ${区分(x) === '深夜' ? 'red' : 区分(x) === '時間外' ? 'orange' : ''}">${hm(x.s)}〜${hm(x.e)}</span><div class="grow t1">${esc(x.題)}</div></div>`).join('') || '<div class="list-row hint">今日の作業ブロックは無い</div>'}</div></div>`;
  return h;
}
function 夜を描く() {
  const xs = その日の案件(今日()).filter(x => x.u);
  const 日々 = (設定().日々の実績 || {})[今日()] || {};
  const 予 = xs.reduce((a, x) => a + x.h, 0), 実 = Object.values(日々).reduce((a, v) => a + (Number(v) || 0), 0);
  let h = `<div class="plan-sum"><div class="nowcell"><div class="k">今日に割り振った時間</div><div class="v num">${時間(予)}</div></div>
    <div class="nowcell"><div class="k">今日入れた実績</div><div class="v num">${時間(実)}</div></div>
    <div class="nowcell"><div class="k">差</div><div class="v num ${実 > 予 ? 'dl-orange' : ''}">${実 - 予 >= 0 ? '+' : ''}${時間(実 - 予)}</div></div>
    <div class="nowcell"><div class="k">明日の作業</div><div class="v num">${時間(今日の段取り(足す日(今日(), 1)).filter(x => x.種 === '作業').reduce((a, x) => a + (x.e - x.s) / 3600000, 0))}</div><div class="s">計算し直すと変わる</div></div></div>`;
  h += `<div class="sec"><div class="sec-label">ACTUALS<span class="jp">作業ごとに実際にかかった時間を入れる</span><span class="right hint">済んだ工程にチェック。終わらなかった案件は「明日へ送る」</span></div>`;
  if (!xs.length) h += `<div class="panel-card"><div class="list-row hint">今日に割り振った作業は無い</div></div>`;
  for (const x of xs) {
    const u = x.u;
    h += `<div class="panel-card" style="margin-bottom:8px"><div class="list-row"><div class="grow"><div class="t1">${esc(u.名前)}</div><div class="t2">今日 ${時間(x.h)} 割り振り・今日の実績 ${時間(日々[u.名前] || 0)}</div></div>
      <button class="btn btn-secondary btn-small" data-act="tomorrow" data-u="${esc(u.id)}">明日へ送る</button></div>
      ${工程(u).map((s, i) => `<div class="step-row simple ${s.済 ? 'is-done' : ''}"><button class="step-done-check ${s.済 ? 'on' : ''}" data-act="toggleStep" data-u="${esc(u.id)}" data-i="${i}"></button>
        <div class="step-code">${esc(記号(s))}</div><div class="step-names"><div class="step-jp">${esc(s.名前)}</div><div class="step-en">見込み ${h字(s.見込み)}</div></div>
        <div class="stepper"><button data-act="act" data-u="${esc(u.id)}" data-i="${i}" data-d="-0.5">−</button><span class="v">${s.実績 ? h字(s.実績) : '実績'}</span><button data-act="act" data-u="${esc(u.id)}" data-i="${i}" data-d="0.5">＋</button></div></div>`).join('') || '<div class="list-row hint">工程が無い。詳細の欄から足す</div>'}</div>`;
  }
  return h + '</div>';
}

/* ═══ 週の見直し（OmniFocus の Review） ═══ */
function 止まっている() {
  const 見 = 設定().見直し || {}; const 前 = (見.済んだ数 || {});
  const t = 今日();
  return 単位().filter(u => u.種 !== '回を作る' && !済か(u)).map(u => {
    const why = [];
    const 済数 = 工程(u).filter(s => s.済).length;
    if (見.最後 && u.名前 in 前 && 前[u.名前] === 済数 && 工程(u).length) why.push(`前の見直し（${md(見.最後)}）から工程が進んでいない`);
    if (u.元.着手できる日 && u.元.着手できる日 < t && ['未着手', '撮影前', ''].includes(状態(u))) why.push(`着手できる日（${md(u.元.着手できる日)}）を過ぎたのに ${状態(u) || '状態なし'}`);
    if (!工程(u).length && u.元.残り編集時間 == null) why.push('工程も残り時間も無い（割り振れない）');
    if (状態(u) === '確認待ち') { const v = 版(u).slice(-1)[0]; if (v && 日差(v.日付, t) >= 7) why.push(`確認待ちのまま ${日差(v.日付, t)}日（${esc(v.名前)}）`); }
    const k = 近い締切(u); if (k && k.日付 && k.日付 < t) why.push(`締切（${md(k.日付)}）を過ぎている`);
    return { u, why };
  }).filter(x => x.why.length);
}
function 見直しを描く() {
  const xs = 止まっている(); const 見 = 設定().見直し || {};
  const n = 見.最後 ? 日差(見.最後, 今日()) : null;
  let h = `<div class="sec"><div class="sec-label">WEEKLY REVIEW<span class="jp">止まっている案件だけを順に見る</span><span class="right hint">${見.最後 ? `前の見直し ${mdw(見.最後)}（${n}日前）` : 'まだ見直していない'}・週に1回</span></div>`;
  if (!xs.length) return h + `<div class="issue ok"><div class="issue-head"><span class="lamp green"></span><span class="issue-title">止まっている案件は無い</span></div></div>
    <button class="btn btn-primary" style="margin-top:10px" data-act="reviewDone">見直しを終える</button></div>`;
  ui.reviewIdx = Math.min(ui.reviewIdx, xs.length - 1);
  const x = xs[ui.reviewIdx];
  h += `<div class="hint" style="margin-bottom:8px">${ui.reviewIdx + 1} / ${xs.length} 件</div>${案件カード(x.u)}
    <div class="panel-card" style="margin-top:10px">${x.why.map(w => `<div class="list-row"><span class="lamp orange"></span><div class="grow">${w}</div></div>`).join('')}</div>
    <div class="sec-label" style="margin-top:14px">その場で直す</div><div class="seg" style="margin-bottom:10px">${状態の名.map(s => `<button class="${状態(x.u) === s ? 'on s-' + s : ''}" data-act="status" data-u="${esc(x.u.id)}" data-s="${s}">${s}</button>`).join('')}</div>
    <div style="display:flex;gap:6px;flex-wrap:wrap"><button class="btn btn-secondary" data-act="reviewPrev" ${ui.reviewIdx ? '' : 'disabled'}>前へ</button>
    <button class="btn btn-secondary" data-act="tomorrow" data-u="${esc(x.u.id)}">明日へ送る</button><button class="btn btn-secondary" data-act="select" data-u="${esc(x.u.id)}">詳細を見る</button>
    <button class="btn btn-primary" data-act="reviewNext" ${ui.reviewIdx < xs.length - 1 ? '' : 'disabled'}>次へ</button>
    <button class="btn btn-secondary" data-act="reviewDone" style="margin-left:auto" title="いまの工程の進みを覚える。次の見直しで、進んでいない案件を見つけるのに使う">見直しを終える</button></div></div>`;
  return h;
}

/* ═══ 撮影（StudioBinder のコールシートとショットリスト） ═══ */
function 取材日(x) { const m = String(x.計画.取材日 || '').match(/\d{4}-\d{2}-\d{2}/); return m ? m[0] : null; }
function 撮影を描く() {
  const t = 今日();
  // 納品済の回（編集案件.json の 案件・定例の回）の取材計画は出さない
  const 納品済の名 = [];
  for (const a of (A() || {}).案件 || []) if (a.状態 === '納品済') 納品済の名.push(a.名前);
  for (const t_ of (A() || {}).定例 || []) for (const r of t_.回 || []) if (r.状態 === '納品済' && r.取材先) 納品済の名.push(r.取材先);
  const 生きている = S.撮影.filter(x => !納品済の名.some(n => x.相対.normalize('NFC').includes(n.normalize('NFC'))));
  const 先 = 生きている.filter(x => 取材日(x) && 取材日(x) >= t).sort((a, b) => 取材日(a) < 取材日(b) ? -1 : 1);
  const 未 = 生きている.filter(x => !取材日(x));
  if (!ui.shootSel || !S.撮影.some(x => x.フォルダ === ui.shootSel)) ui.shootSel = (先[0] || 未[0] || {}).フォルダ;
  const 名 = x => x.相対.replace(/^.*?\/([^/]+)\/回\//, '$1 ／ ').replace(/進行中_|済_/g, '');
  let h = `<div class="sec"><div class="sec-label">SHOOTS<span class="jp">撮影の予定（映像制作 の 04_取材計画.json を読むだけ）</span></div><div class="seg">
    ${先.map(x => `<button class="${ui.shootSel === x.フォルダ ? 'on' : ''}" data-act="shootSel" data-f="${esc(x.フォルダ)}">${mdw(取材日(x))} ${esc(名(x))}</button>`).join('')}
    ${未.map(x => `<button class="${ui.shootSel === x.フォルダ ? 'on' : ''}" data-act="shootSel" data-f="${esc(x.フォルダ)}">取材日未定 ${esc(名(x))}</button>`).join('')}
    ${!先.length && !未.length ? '<span class="hint">今日以降の取材計画は無い</span>' : ''}</div></div>`;
  const x = S.撮影.find(x => x.フォルダ === ui.shootSel);
  if (!x) return h;
  const c = x.計画; const 印 = ((メモ().撮影 || {})[x.相対] || {});
  const 済 = 印.消し込み || {};
  const 集 = c.集合 || {};
  const 住 = (String(集.場所 || '').match(/（([^）]+)）/) || [])[1] || 集.場所 || '';
  const カ = c.カット || [];
  const 流 = c[Object.keys(c).find(k => k.startsWith('この日の流れ')) || ''] || [];
  const 連 = 印.連絡先 != null ? 印.連絡先 : (c.連絡先 || '');
  h += `<div class="callsheet"><div class="panel-card"><div class="form-row"><span class="form-label">取材日</span><span class="cs-big">${取材日(x) ? mdw(取材日(x)) : esc(c.取材日 || '未定')}</span></div>
      <div class="form-row"><span class="form-label">集合</span><span class="cs-big">${esc(集.時刻 || '未定')}</span><span class="form-val">${esc(集.場所 || '')}</span></div>
      <div class="form-row"><span class="form-label">地図</span>${住 ? `<button class="btn btn-secondary btn-small" data-act="map" data-q="${esc(住)}">地図で開く：${esc(住)}</button>` : '<span class="hint">場所が書いてない</span>'}</div>
      <div class="form-row"><span class="form-label">撮影開始</span><span class="form-val">${esc(c.撮影開始 || '—')}</span></div>
      <div class="form-row"><span class="form-label">解散</span><span class="form-val hint">${esc(c.解散予定 || '—')}</span></div>
      <div class="form-row"><span class="form-label">相手の都合</span><span class="form-val hint">${esc(c.相手の都合 || '—')}</span></div>
      <div class="form-row"><span class="form-label">連絡先</span><input class="in" style="flex:1" placeholder="相手の名前・電話（撮影メモ.json に残す）" data-chg="contact" data-f="${esc(x.相対)}" value="${esc(連)}"></div></div>
    <div class="panel-card"><div class="form-row"><span class="form-label">体制</span><span class="form-val">${Object.entries(c.体制 || {}).map(([k, v]) => `${esc(k)}：${v ? esc(v) : '<span class="dl-orange">未定</span>'}`).join('<br>') || '—'}</span></div>
      <div class="form-row" style="align-items:flex-start"><span class="form-label">機材</span><span class="form-val" style="font-weight:500;font-size:12px">${Object.entries(c.機材 || {}).map(([k, v]) => `<b>${esc(k)}</b>：${String(v).includes('★') ? '<span class="dl-orange">' + esc(v) + '</span>' : esc(v)}`).join('<br>') || '—'}</span></div>
      <div class="form-row"><span class="form-label">リマインダー</span><button class="btn btn-primary btn-small" data-act="checklist" data-f="${esc(x.フォルダ)}" ${取材日(x) && Mac ? '' : 'disabled'} title="${!Mac ? 'iPhone では送れない（Mac の EDITFLOW で押す）' : 取材日(x) ? '撮影チェックリスト.py で「撮影 MM/DD 取材先」のリストを作る。入っている項目は入れ直す' : '取材日が未定なので作れない'}">チェックリストをリマインダーへ</button>${ui.印 && ui.印.f === x.フォルダ ? `<span class="hint">${esc(ui.印.t)}</span>` : ''}</div></div></div>`;
  if (流.length) h += `<div class="sec" style="margin-top:14px"><div class="sec-label">RUN OF DAY<span class="jp">この日の流れ</span></div><div class="panel-card">${流.map(f => `<div class="list-row"><span class="tag">${esc(f.時刻 || '')}</span><div class="grow">${esc(f.内容 || '')}</div><span class="hint">${esc(f.章 || '')}</span></div>`).join('')}</div></div>`;
  const 数 = カ.filter(k => 済[String(k.id)]).length;
  h += `<div class="sec" style="margin-top:14px"><div class="sec-label">SHOT LIST<span class="jp">ショットリスト（撮れたら1行ずつ消す）</span><span class="right">${数}/${カ.length}</span></div><div class="panel-card">
    ${カ.map(k => `<div class="shot ${済[String(k.id)] ? 'is-done' : ''}" data-act="shot" data-f="${esc(x.相対)}" data-id="${esc(String(k.id))}"><span class="step-done-check ${済[String(k.id)] ? 'on' : ''}"></span><span class="id">${esc(String(k.id))}</span>
      <div class="body"><div class="what">${k.動かせない ? '<span class="tag red">その日しか撮れない</span> ' : ''}${esc(k.場所 || '')}：${esc(k.内容 || '')}</div>
      <div class="sub">${esc(k.章 || '')}・${k.秒数 ? k.秒数 + '秒' : ''}・許諾 ${esc(k.許諾 || '—')}${k.備考 ? '・' + esc(k.備考) : ''}</div></div></div>`).join('') || '<div class="list-row hint">カットが書いてない</div>'}</div></div>`;
  return h;
}

/* ═══ 買い物と在庫 ═══ */
function 買い物を描く() {
  const p = P(); const 食 = S.f['食事の予定.json'] || {}; const 献 = S.f['献立.json'] || {};
  const 買 = p ? p.買い物 : { 日: [], もの: {} };
  let h = `<div class="sec"><div class="sec-label">SHOPPING<span class="jp">まとめ買いのリスト</span><span class="right">${(買.日 || []).map(d => `<span class="tag">${mdw(d)} の帰り</span>`).join(' ') || '<span class="hint">3週間のうちに買い物の日が無い</span>'}</span></div><div class="panel-card">
    ${Object.entries(買.もの || {}).map(([k, v]) => { const a = Array.isArray(v) ? v : [String(v)]; return `<div class="list-row"><span class="step-done-check"></span><div class="grow"><div class="t1">${esc(a[0] || k)}</div><div class="t2">${esc(a.slice(1).join('　'))}</div></div></div>`; }).join('') || '<div class="list-row hint">買うものは無い</div>'}</div>
    <div class="hint" style="margin-top:6px">済みにするのはリマインダーの「買い物」リストで。済みにした分はエンジンが在庫に足す</div></div>`;
  const 在 = 食.在庫 || {};
  const 材 = 献.食材 || {};
  h += `<div class="sec"><div class="sec-label">STOCK<span class="jp">在庫（あと何回分あるか）</span><span class="right hint">赤＝無い・橙＝下限より少ない・？＝量が分からない（買い物の日に「在庫を見て」に出る）</span></div><div class="stock">
    ${Object.entries(在).map(([k, v]) => { const f = 材[k] || {}; const lo = f.下限; const c = v === 0 ? 'red' : (v != null && lo != null && v < lo ? 'orange' : '');
      return `<div class="stock-item ${c}"><div style="flex:1;min-width:0"><div class="nm">${esc(k)}</div><div class="lo">${lo != null ? '下限 ' + lo + '回分' : ''}${f.買う ? '・' + esc(f.買う) : ''}${f.回分 ? '（' + f.回分 + '回分）' : ''}</div></div>
      <div class="stepper ${v == null ? 'dim' : ''}"><button data-act="stock" data-k="${esc(k)}" data-d="-1" ${v == null || v <= 0 ? 'disabled' : ''}>−</button><span class="v">${v == null ? '？' : v + '回'}</span><button data-act="stock" data-k="${esc(k)}" data-d="1">＋</button></div>
      <button class="icon-btn" data-act="stockUnknown" data-k="${esc(k)}" title="${v == null ? '量が分からない（いまそうなっている）' : '量が分からないにする'}" ${v == null ? 'disabled' : ''}>？</button></div>`; }).join('')}</div></div>`;
  return h;
}
function 在庫を直す(k, d) {
  const v = (S.f['食事の予定.json'].在庫 || {})[k];
  const 新 = v == null ? Math.max(0, d) : Math.max(0, v + d);
  直す('食事の予定.json', [{ 道: ['在庫', k], 値: 新 }], `在庫：${k} を ${新}回分にした`);
}

/* ═══ シート（新しい案件・案件の設定・工程を足す・プリセット・設定） ═══ */
function シートを開く(s) { ui.sheet = s; $('#overlay').classList.add('on'); $('#sheet').classList.add('on'); シートを描く(); }
function シートを閉じる() { ui.sheet = null; $('#sheet').classList.remove('on'); if (!ui.pal.open) $('#overlay').classList.remove('on'); }
function 工程の行(s, i, mode) {
  return `<div class="step-row simple"><div class="step-code">${esc(記号(s))}</div><div class="step-names"><div class="step-jp">${esc(s.名前)}</div><div class="step-en">${esc(英名(s))}</div></div>
    <div class="stepper"><button data-act="dEst" data-i="${i}" data-d="-0.5">−</button><span class="v">${h字(s.見込み)}</span><button data-act="dEst" data-i="${i}" data-d="0.5">＋</button></div>
    <button class="icon-btn" data-act="dUp" data-i="${i}" ${i === 0 ? 'disabled' : ''}>↑</button><button class="icon-btn del" data-act="dDel" data-i="${i}" title="消す">✕</button></div>`;
}
function シートを描く() {
  const s = ui.sheet; if (!s) return;
  const d = ui.下書き; const st = 設定();
  let head = '', body = '', foot = '';
  if (s.kind === 'new' || s.kind === 'settings') {
    const 新 = s.kind === 'new';
    const total = d.工程.reduce((a, x) => a + (Number(x.見込み) || 0), 0);
    head = `<button class="sheet-back" data-act="closeSheet">キャンセル</button><div class="sheet-title">${新 ? 'NEW PROJECT　新しい案件' : 'PROJECT SETTINGS　案件の設定'}</div><span style="width:50px"></span>`;
    body = `<div class="sec"><div class="sec-label">プロジェクト情報</div><div class="panel-card">
      <div class="form-row"><span class="form-label">名前</span><input class="in" style="flex:1" id="np-title" placeholder="案件の名前…" value="${esc(d.名前)}" ${!新 && s.回 ? 'disabled' : ''}></div>
      <div class="form-row"><span class="form-label">着手できる日</span>${欄('date', d.着手できる日, 'id="np-start"')}<span class="hint">空なら今日から</span></div>
      ${新 ? `<div class="form-row"><span class="form-label">納期</span>${欄('date', d.納期, 'id="np-deadline"')}${欄('time', d.時刻, 'id="np-time" style="width:90px"')}<span class="hint">時刻は任意</span></div>
      <div class="form-row"><span class="form-label">撮影日</span>${欄('date', d.撮影日, 'id="np-shoot"', 'なし')}<span class="hint">あれば、その日の帰りから割り振る</span></div>` :
        `<div class="form-row"><span class="form-label">締切</span><span class="hint">締切の日付は右の詳細の欄の「締切を動かす」で</span></div>`}
      ${!新 && !s.回 ? '<div class="form-row"><span class="hint">名前を変えると、カレンダーの締切は反映のときに入れ直される</span></div>' : ''}</div></div>`;
    if (新) body += `<div class="sec"><div class="sec-label">プリセット選択</div><div class="preset-list">${(st.プリセット || []).map(p => `<div class="preset-card ${d.プリセット === p.id ? 'on' : ''}" data-act="dPreset" data-p="${esc(p.id)}"><div class="preset-radio"></div><div class="preset-info"><div class="preset-name">${esc(p.名前)}</div><div class="preset-desc">${esc(p.説明 || '')}</div></div><div class="preset-meta">${p.工程.length}工程・${h字(p.工程.reduce((a, x) => a + x.見込み, 0))}</div></div>`).join('')}
      <div class="preset-card ${d.プリセット === '' ? 'on' : ''}" data-act="dPreset" data-p=""><div class="preset-radio"></div><div class="preset-info"><div class="preset-name">カスタム</div><div class="preset-desc">空の工程から作成</div></div><div class="preset-meta">—</div></div></div></div>`;
    body += `<div class="sec"><div class="sec-label">工程 / Production Steps</div><div class="panel-card">${d.工程.map((x, i) => 工程の行(x, i)).join('') || '<div class="list-row hint">工程がありません。「工程を追加」を押す</div>'}</div>
      <div class="total-row" style="border-radius:0 0 10px 10px"><span>合計作業時間 / Total</span><span class="num">${h字(total)}</span></div></div>
      <button class="btn btn-secondary btn-wide" data-act="dAddStep">＋ 工程を追加 / Add Step</button>`;
    foot = `<button class="btn btn-primary btn-wide" data-act="${新 ? 'dCreate' : 'dSave'}">${新 ? 'プロジェクト作成 / Create' : '保存 / Save'}</button>`;
  } else if (s.kind === 'addstep') {
    head = `<button class="sheet-back" data-act="${s.戻り ? 'sheetBack' : 'closeSheet'}">⟨ 戻る</button><div class="sheet-title">ADD STEP　工程を足す</div><span style="width:50px"></span>`;
    body = `<div class="tabs2"><button class="${s.mode !== 'create' ? 'on' : ''}" data-act="asMode" data-m="lib">ライブラリから選択</button><button class="${s.mode === 'create' ? 'on' : ''}" data-act="asMode" data-m="create">新規作成</button></div>`;
    if (s.mode !== 'create') body += `<div class="panel-card">${(st.工程の一覧 || []).map((l, i) => `<div class="lib-step" data-act="asPick" data-i="${i}"><div class="step-code">${esc(l.記号)}</div><div class="step-names"><div class="step-jp">${esc(l.名前)}</div><div class="step-en">${esc(l.英名)}・${h字(l.標準時間)}</div></div><span class="hint">›</span></div>`).join('')}</div>`;
    else { body += `<div class="panel-card"><div class="form-row"><span class="form-label">日本語名</span><input class="in" style="flex:1" id="as-jp" placeholder="工程名を入力…"></div>
      <div class="form-row"><span class="form-label">英語名</span><input class="in" style="flex:1" id="as-en" placeholder="English name…"></div>
      <div class="form-row"><span class="form-label">略号(2〜3字)</span><input class="in" id="as-code" maxlength="3" placeholder="XX" style="width:70px"></div>
      <div class="form-row"><span class="form-label">標準時間</span><input class="in" id="as-hours" type="number" min="0" step="0.5" value="1" style="width:70px"></div></div>
      <div class="hint" style="padding:8px 2px">作った工程はライブラリ（EDITFLOW設定.json の 工程の一覧）に残り、ほかの案件でも使える</div>`;
      foot = `<button class="btn btn-primary btn-wide" data-act="asCreate">作成して追加 / Create &amp; Add</button>`; }
  } else if (s.kind === 'preset') {
    const u = 単位を探す(s.u);
    head = `<button class="sheet-back" data-act="closeSheet">キャンセル</button><div class="sheet-title">PRESET　プリセットから工程を入れる</div><span style="width:50px"></span>`;
    body = `<div class="hint" style="margin-bottom:10px">${esc(u ? u.名前 : '')} の工程を、選んだプリセットで置き換える（今の工程は ⌘Z で戻せる）</div><div class="preset-list">${(st.プリセット || []).map(p => `<div class="preset-card" data-act="presetApply" data-p="${esc(p.id)}" data-u="${esc(s.u)}"><div class="preset-radio"></div><div class="preset-info"><div class="preset-name">${esc(p.名前)}</div><div class="preset-desc">${esc(p.工程.map(x => x.記号).join(' ・ '))}</div></div><div class="preset-meta">${p.工程.length}工程・${h字(p.工程.reduce((a, x) => a + x.見込み, 0))}</div></div>`).join('')}</div>`;
  } else if (s.kind === 'prefs') {
    head = `<button class="sheet-back" data-act="closeSheet">閉じる</button><div class="sheet-title">SETTINGS　設定</div><span style="width:50px"></span>`;
    const 今の = 今の見た目();
    body = `<div class="sec"><div class="sec-label">見た目</div><div class="panel-card"><div class="form-row"><span class="form-label">色</span><div class="seg">
        <button class="${今の === '黒' ? 'on' : ''}" data-act="theme" data-t="黒">黒地（v1.0）</button><button class="${今の === '明るい' ? 'on' : ''}" data-act="theme" data-t="明るい">明るい色（v1.4）</button></div>
        <span class="hint">${Mac ? 'EDITFLOW設定.json に覚える' : 'この iPhone に覚える'}</span></div></div></div>
      ${iPhone ? `<div class="sec"><div class="sec-label">Mac とのつなぎ</div><div class="panel-card"><div class="list-row"><div class="grow"><div class="t1">${esc(GH.repo())}</div><div class="t2">${GH.token() ? 'トークンは覚えてある' : 'トークンがまだ無い'}</div></div><button class="btn btn-secondary btn-small" data-act="phonePrefs">つなぎ方を直す</button></div></div></div>` : ''}
      ${Mac ? `<div class="sec"><div class="sec-label">表示</div><div class="panel-card"><div class="form-row"><span class="form-label">メニューバー</span><button class="btn btn-small ${st.メニューバーに出す !== false ? 'btn-primary' : 'btn-secondary'}" data-act="prefMenubar">${st.メニューバーに出す !== false ? '✓ 小窓を出す' : '小窓を出す'}</button><span class="hint">今の作業・残り時間・次の予定の3行</span></div></div></div>` : ''}
      <div class="sec"><div class="sec-label">プリセット</div><div class="panel-card">${(st.プリセット || []).map((p, i) => `<div class="list-row"><div class="grow"><div class="t1">${esc(p.名前)}</div><div class="t2">${esc(p.工程.map(x => x.記号).join(' ・ '))}</div></div><button class="icon-btn del" data-act="presetDel" data-i="${i}" title="このプリセットを消す（⌘Z で戻せる）">✕</button></div>`).join('')}</div></div>
      <div class="sec"><div class="sec-label">工程の一覧（ライブラリ）</div><div class="panel-card">${(st.工程の一覧 || []).map(l => `<div class="lib-step"><div class="step-code">${esc(l.記号)}</div><div class="step-names"><div class="step-jp">${esc(l.名前)}</div><div class="step-en">${esc(l.英名)}・${h字(l.標準時間)}</div></div></div>`).join('')}</div></div>
      <div class="hint">休みと空き時間はカレンダーから、1日の時間はエンジンの設定（しそチャンNET_進行.json の 設定）から。前の EDITFLOW の「編集不可日」と「1日の上限」は使わない。</div>`;
  }
  if (s.kind === 'phone') {
    head = `<button class="sheet-back" data-act="closeSheet">閉じる</button><div class="sheet-title">iPhone の設定</div><span style="width:50px"></span>`;
    body = `<div class="hint" style="margin-bottom:10px">Mac の EDITFLOW が、非公開のリポジトリにデータを置く。そこを読むための鍵（fine-grained token）を一度だけ貼る。鍵はこの iPhone にだけ覚え、画面には出さない。作り方は「iPhoneの入れ方」</div>
      <div class="panel-card"><div class="form-row"><span class="form-label">リポジトリ</span><input class="in" style="flex:1" id="ph-repo" value="${esc(GH.repo())}" autocapitalize="off" autocorrect="off"></div>
      <div class="form-row"><span class="form-label">トークン</span><input class="in" style="flex:1" id="ph-token" type="password" placeholder="${GH.token() ? '覚えてある（貼り直すときだけ入れる）' : 'github_pat_… を貼る'}" autocomplete="off" autocapitalize="off"></div></div>
      ${GH.token() ? '<button class="btn btn-danger btn-small" style="margin-top:10px" data-act="phoneForget">この iPhone のトークンを消す</button>' : ''}`;
    foot = `<button class="btn btn-primary btn-wide" data-act="phoneSave">覚えて読み直す</button>`;
  }
  $('#sheetHeader').innerHTML = head; $('#sheetContent').innerHTML = body; $('#sheetFooter').innerHTML = foot;
  $('#sheetFooter').style.display = foot ? '' : 'none';
}
function 下書きを読む() {
  const d = ui.下書き; const g = id => document.getElementById(id);
  if (g('np-title')) d.名前 = g('np-title').value;
  if (g('np-start')) d.着手できる日 = g('np-start').value;
  if (g('np-deadline')) d.納期 = g('np-deadline').value;
  if (g('np-time')) d.時刻 = g('np-time').value;
  if (g('np-shoot')) d.撮影日 = g('np-shoot').value;
}
function 新しい案件を開く() {
  const st = 設定(); const p0 = (st.プリセット || [])[0];
  ui.下書き = { 名前: '', 着手できる日: 今日(), 納期: 足す日(今日(), 14), 時刻: '', 撮影日: '', プリセット: p0 ? p0.id : '', 工程: p0 ? clone(p0.工程).map(x => Object.assign(x, { 済: false })) : [] };
  シートを開く({ kind: 'new' });
}
function 設定を開く(u) {
  ui.下書き = { 名前: u.種 === '案件' ? u.名前 : u.名前, 着手できる日: u.元.着手できる日 || '', 工程: clone(工程(u)) };
  シートを開く({ kind: 'settings', u: u.id, 回: u.種 !== '案件' });
}
function 案件を作る() {
  下書きを読む(); const d = ui.下書き;
  const 名 = d.名前.trim();
  if (!名) return 知らせを出す('名前を入れてください');
  if (!d.納期) return 知らせを出す('納期を入れてください');
  if (d.着手できる日 && d.納期 < d.着手できる日) return 知らせを出す('納期は着手できる日より後にしてください');
  if ((A().案件 || []).some(a => a.名前 === 名)) return 知らせを出す('同じ名前の案件がもうある');
  const 締 = { 日付: d.納期, 種類: '納期' }; if (d.時刻) 締.時刻 = d.時刻;
  const 新 = { 名前: 名, 締切: [締], 残り編集時間: null, 状態: d.撮影日 ? '撮影前' : '未着手' };
  if (d.着手できる日 && d.着手できる日 > 今日()) 新.着手できる日 = d.着手できる日;
  if (d.撮影日) 新.撮影日 = d.撮影日;
  if (d.工程.length) 新.工程 = d.工程.map(x => ({ 記号: x.記号, 名前: x.名前, 英名: x.英名, 見込み: x.見込み, 済: false }));
  直す('編集案件.json', [{ 道: ['案件'], 足す: 新 }], `${名} を作った`);
  ui.sel = '案件:' + 名; シートを閉じる(); ui.view = 'projects'; 描く();
}
function 設定を保存() {
  下書きを読む(); const d = ui.下書き; const u = 単位を探す(ui.sheet.u); if (!u) return シートを閉じる();
  const ops = [];
  const 名 = d.名前.trim();
  if (u.種 === '案件' && 名 && 名 !== u.名前) {
    if ((A().案件 || []).some(a => a.名前 === 名)) return 知らせを出す('同じ名前の案件がもうある');
    ops.push({ 道: u.道.concat(['名前']), 値: 名 });
  }
  const 道 = u.種 === '案件' && 名 && 名 !== u.名前 ? ['案件', { 名前: 名 }] : u.道;
  if ((d.着手できる日 || '') !== (u.元.着手できる日 || '')) ops.push(d.着手できる日 ? { 道: 道.concat(['着手できる日']), 値: d.着手できる日 } : { 道: 道.concat(['着手できる日']), 消す: true });
  if (JSON.stringify(d.工程) !== JSON.stringify(工程(u))) ops.push(d.工程.length ? { 道: 道.concat(['工程']), 値: d.工程 } : { 道: 道.concat(['工程']), 消す: true });
  if (ops.length) 直す('編集案件.json', ops, `${名 || u.名前}：設定を保存した`);
  if (名 && 名 !== u.名前) ui.sel = '案件:' + 名;
  シートを閉じる();
}

/* ═══ ⌘K 命令窓（Akiflow） ═══ */
function 命令の一覧() {
  const L = [];
  for (const [v, g] of Object.entries(画面)) L.push({ g: '画面', t: `${g.jp}（${g.en}）を開く`, f: () => 画面へ(v) });
  L.push({ g: '計算', t: '計算し直す', k: '⌘R', f: () => 計算(false) }, { g: '計算', t: 'カレンダーとリマインダーへ反映', k: '⇧⌘R', f: () => 計算(true) },
    { g: '案件', t: '新しい案件を作る', k: '⌘N', f: 新しい案件を開く }, { g: '編集', t: '取り消す', k: '⌘Z', f: 取り消す });
  for (const u of 単位().filter(u => !済か(u))) {
    L.push({ g: '開く', t: `${u.名前} を開く`, f: () => { ui.sel = u.id; 画面へ('projects'); } });
    const i = 工程(u).findIndex(s => !s.済);
    if (i >= 0) L.push({ g: '済みに', t: `${u.名前} ▸ ${工程(u)[i].名前} を済みにする`, f: () => 工程を切り替える(u, i) });
    L.push({ g: '明日へ', t: `${u.名前} を明日へ送る`, f: () => 明日へ送る(u) });
    if (!u.元.最優先) L.push({ g: '最優先', t: `${u.名前} を最優先にする`, f: () => 最優先にする(u) });
  }
  return L;
}
function 命令窓を開く() { ui.pal = { open: true, q: '', idx: 0 }; $('#overlay').classList.add('on'); $('#palette').classList.add('on'); $('#palInput').value = ''; 命令窓を描く(); setTimeout(() => $('#palInput').focus(), 0); }
function 命令窓を閉じる() { ui.pal.open = false; $('#palette').classList.remove('on'); if (!ui.sheet) $('#overlay').classList.remove('on'); }
function 命令の候補() {
  const q = ui.pal.q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return 命令の一覧().filter(c => q.every(w => (c.g + ' ' + c.t).toLowerCase().includes(w))).slice(0, 60);
}
function 命令窓を描く() {
  const cs = 命令の候補(); ui.pal.idx = Math.min(ui.pal.idx, Math.max(0, cs.length - 1));
  $('#palList').innerHTML = cs.map((c, i) => `<div class="pal-item ${i === ui.pal.idx ? 'on' : ''}" data-act="palRun" data-i="${i}"><span class="g">${esc(c.g)}</span><span>${esc(c.t)}</span>${c.k ? `<span class="k">${c.k}</span>` : ''}</div>`).join('') || '<div class="pal-item"><span class="hint">当てはまる命令が無い</span></div>';
}
function 命令を実行(i) { const c = 命令の候補()[i]; 命令窓を閉じる(); if (c) c.f(); }

/* ═══ メニューバーの小窓 ═══ */
function 小窓を送る() {
  const p = P(); if (!p) return;
  const now = 今();
  const 全 = 今日の段取り(今日()).concat(今日の段取り(足す日(今日(), 1))).filter(x => x.種 !== '区切り');
  const 中 = 全.find(x => x.s <= now && now < x.e);
  const 次 = 全.filter(x => x.s > now && x.種 !== '作業').sort((a, b) => a.s - b.s)[0];
  const 行 = [中 ? `いま：${中.題}` : 'いま：段取りなし', 中 ? `残り ${あと(中.e - now)}（〜${hm(中.e)}）` : '', 次 ? `次：${hm(次.s)} ${次.題}` : '次の予定なし'].filter(Boolean);
  頼む('小窓', { 行, 出す: 設定().メニューバーに出す !== false });
}
setInterval(() => { if (ui.計算中) 帯を描く(); }, 1000);
setInterval(() => { if (S.読めた) { 小窓を送る(); if (ui.view === 'today' && !document.activeElement.matches('input')) 描く(); } }, 60000);

/* ═══ 画面の切り替え・知らせ ═══ */
function 画面へ(v) { ui.view = v; document.querySelector('#main').scrollTop = 0; 描く(); }
function 知らせを出す(t) {
  if (!t) return; const e = $('#toast'); e.textContent = t; e.classList.add('on');
  clearTimeout(知らせを出す._t); 知らせを出す._t = setTimeout(() => e.classList.remove('on'), 3200);
}
function 誤りを出す(t) { ui.誤り = t; 知らせを出す(t); 帯を描く(); }

/* ═══ 押した・変えた・キー ═══ */
document.addEventListener('click', e => {
  let t = e.target;
  while (t && t !== document.body && !(t.dataset && t.dataset.act)) t = t.parentElement;
  if (!t || !t.dataset || !t.dataset.act || t.disabled) return;
  const a = t.dataset.act, d = t.dataset;
  const u = d.u ? 単位を探す(d.u) : null;
  const i = d.i != null ? Number(d.i) : null;
  // カードの中のボタンは、カードの選択より先に効かせる
  if (a !== 'select') e.stopPropagation();
  switch (a) {
    case 'view': 画面へ(d.v); break;
    case 'select': if (d.u) { ui.sel = d.u; if (狭い()) ui.詳細を開く = true; 描く(); } break;
    case 'closeDetail': ui.詳細を開く = false; 描く(); break;
    case 'prefs': シートを開く({ kind: 'prefs' }); break;
    case 'phonePrefs': シートを開く({ kind: 'phone' }); break;
    case 'theme': 見た目を選ぶ(d.t); break;
    case 'phoneSave': { const t = $('#ph-token').value.trim(), r = $('#ph-repo').value.trim(); if (r) 端末.set('EF_リポジトリ', r); if (t) 端末.set('EF_トークン', t); シートを閉じる(); 知らせを出す('この iPhone に覚えた。読み直す'); 読み直す(true); break; }
    case 'phoneForget': 端末.set('EF_トークン', null); 知らせを出す('トークンを消した'); シートを描く(); break;
    case 'phoneReload': 読み直す(true); break;
    case 'toggleStep': if (u) { ui.sel = u.id; 工程を切り替える(u, i); } break;
    case 'nextStep': 次の工程を済み(u); break;
    case 'status': 状態を変える(u, d.s); break;
    case 'priority': 最優先にする(u, true); break;
    case 'unpriority': 最優先にする(u, false); break;
    case 'tomorrow': 明日へ送る(u); break;
    case 'clearStart': 着手できる日を置く(u, null); break;
    case 'est': 見込みを足す(u, i, Number(d.d)); break;
    case 'act': 実績を足す(u, i, Number(d.d)); break;
    case 'stepUp': 工程を動かす(u, i, -1); break;
    case 'stepDown': 工程を動かす(u, i, 1); break;
    case 'stepDel': 工程を消す(u, i); break;
    case 'stepDl': 工程の締切を回す(u, i); break;
    case 'addVer': 版を足す(u); break;
    case 'verOk': 版を承認(u, Number(d.v)); break;
    case 'verDel': 版を消す(u, Number(d.v)); break;
    case 'noteToggle': 指摘を切り替える(u, Number(d.v), Number(d.n)); break;
    case 'makeRound': 回を作る(u); break;
    case 'deleteProject': if (confirm(`「${u.名前}」を一覧から消しますか？\n（EDITFLOW設定.json の 消した案件 に残ります。⌘Z で戻せます）`)) 案件を消す(u); break;
    case 'moveOpen': ui.動かす[d.id] = !ui.動かす[d.id]; 描く(); break;
    case 'moveDo': { const dd = document.getElementById('mv-d-' + d.id).value, tt = document.getElementById('mv-t-' + d.id).value; ui.動かす[d.id] = false; 締切を動かす(u, d.k, dd, tt); break; }
    case 'moveDl': { const dd = document.getElementById('dl-d-' + d.id).value, tt = document.getElementById('dl-t-' + d.id).value; 締切を動かす(u, d.k, dd, tt); break; }
    case 'allowOT': { const q = (P().問題 || []).find(q => q.id === d.id); if (q) 時間外を認める(q); break; }
    case 'calc': 計算(false); break;
    case 'reflect': 計算(true); break;
    case 'palette': 命令窓を開く(); break;
    case 'palRun': 命令を実行(Number(d.i)); break;
    case 'closeAll': 命令窓を閉じる(); シートを閉じる(); break;
    case 'toggleDetail': ui.詳細 = !ui.詳細; 描く(); break;
    case 'newProject': 新しい案件を開く(); break;
    case 'settings': if (u) 設定を開く(u); break;
    case 'presetSheet': シートを開く({ kind: 'preset', u: d.u }); break;
    case 'presetApply': { const p = 設定().プリセット.find(p => p.id === d.p); if (u && p) { 工程を置く(u, clone(p.工程).map(x => Object.assign(x, { 済: false })), `${u.名前}：プリセット「${p.名前}」の工程を入れた`); シートを閉じる(); } break; }
    case 'presetDel': { const p = 設定().プリセット[i]; 直す('EDITFLOW設定.json', [{ 道: ['プリセット', i], 消す: true }], `プリセット「${p.名前}」を消した`, { 計算: false }); break; }
    case 'saveAsPreset': { const n = prompt('プリセット名を入力\n（例：しそうチャンネル番組）', u.名前); if (n) 直す('EDITFLOW設定.json', [{ 道: ['プリセット'], 足す: { id: 'preset_' + Date.now(), 名前: n.trim(), 説明: '', 工程: 工程(u).map(s => ({ 記号: 記号(s), 名前: s.名前, 英名: 英名(s), 見込み: s.見込み })) } }], `プリセット「${n}」を保存した`, { 計算: false }); break; }
    case 'addStep': if (u) { ui.下書き = null; シートを開く({ kind: 'addstep', u: u.id, mode: 'lib' }); } break;
    case 'closeSheet': シートを閉じる(); break;
    case 'sheetBack': ui.sheet = ui.sheet.戻り; シートを描く(); break;
    case 'dPreset': { 下書きを読む(); const p = 設定().プリセット.find(p => p.id === d.p); ui.下書き.プリセット = d.p; ui.下書き.工程 = p ? clone(p.工程).map(x => Object.assign(x, { 済: false })) : []; シートを描く(); break; }
    case 'dEst': 下書きを読む(); ui.下書き.工程[i].見込み = Math.max(0, (Number(ui.下書き.工程[i].見込み) || 0) + Number(d.d)); シートを描く(); break;
    case 'dUp': 下書きを読む(); { const w = ui.下書き.工程; [w[i - 1], w[i]] = [w[i], w[i - 1]]; } シートを描く(); break;
    case 'dDel': 下書きを読む(); ui.下書き.工程.splice(i, 1); シートを描く(); break;
    case 'dAddStep': 下書きを読む(); ui.sheet = { kind: 'addstep', mode: 'lib', 戻り: ui.sheet }; シートを描く(); break;
    case 'dCreate': 案件を作る(); break;
    case 'dSave': 設定を保存(); break;
    case 'asMode': ui.sheet.mode = d.m === 'create' ? 'create' : 'lib'; シートを描く(); break;
    case 'asPick': { const l = 設定().工程の一覧[i]; 工程を足す_({ 記号: l.記号, 名前: l.名前, 英名: l.英名, 見込み: l.標準時間, 済: false }); break; }
    case 'asCreate': {
      const jp = $('#as-jp').value.trim(), en = $('#as-en').value.trim(), code = $('#as-code').value.trim().toUpperCase(), hrs = Math.max(0, Number($('#as-hours').value) || 0);
      if (!jp || !code) { 知らせを出す('日本語名と略号は必須です'); break; }
      if (!(設定().工程の一覧 || []).some(l => l.記号 === code)) 直す('EDITFLOW設定.json', [{ 道: ['工程の一覧'], 足す: { 記号: code, 名前: jp, 英名: en || jp, 標準時間: hrs } }], '', { undo: false, 計算: false });
      工程を足す_({ 記号: code, 名前: jp, 英名: en || jp, 見込み: hrs, 済: false }); break;
    }
    case 'prevMonth': ui.calMonth.m--; if (ui.calMonth.m < 0) { ui.calMonth.m = 11; ui.calMonth.y--; } 描く(); break;
    case 'nextMonth': ui.calMonth.m++; if (ui.calMonth.m > 11) { ui.calMonth.m = 0; ui.calMonth.y++; } 描く(); break;
    case 'thisMonth': ui.calMonth = null; 描く(); break;
    case 'planTab': ui.planTab = d.t; 描く(); break;
    case 'toggleDone': ui.済も出す = !ui.済も出す; 描く(); break;
    case 'reviewNext': ui.reviewIdx++; 描く(); break;
    case 'reviewPrev': ui.reviewIdx = Math.max(0, ui.reviewIdx - 1); 描く(); break;
    case 'reviewDone': { const 数 = {}; 単位().forEach(u => { 数[u.名前] = 工程(u).filter(s => s.済).length; }); 直す('EDITFLOW設定.json', [{ 道: ['見直し'], 値: { 最後: 今日(), 済んだ数: 数 } }], '見直しを終えた（いまの進みを覚えた）', { 計算: false }); ui.reviewIdx = 0; break; }
    case 'shootSel': ui.shootSel = d.f; 描く(); break;
    case 'map': 頼む('開く', { url: 'https://maps.apple.com/?q=' + encodeURIComponent(d.q) }); break;
    case 'shot': { const 済 = (((メモ().撮影 || {})[d.f] || {}).消し込み || {})[d.id];
      直す('撮影メモ.json', [済 ? { 道: ['撮影', d.f, '消し込み', d.id], 消す: true } : { 道: ['撮影', d.f, '消し込み', d.id], 値: true, 作る: true }], `カット ${d.id} を${済 ? '戻した' : '消した'}`, { 計算: false }); break; }
    case 'checklist': ui.印 = { f: d.f, t: 'リマインダーへ入れている…' }; 描く();
      頼む('チェックリスト', { フォルダ: d.f }).then(r => { ui.印 = { f: d.f, t: r && r.ok ? (r.出力 || '').trim().split('\n').pop() : '失敗：' + ((r && (r.エラー || r.出力)) || '').trim().split('\n').pop() }; 描く(); }); break;
    case 'stock': 在庫を直す(d.k, Number(d.d)); break;
    case 'stockUnknown': 直す('食事の予定.json', [{ 道: ['在庫', d.k], 値: null }], `在庫：${d.k} を「量が分からない」にした`); break;
    case 'prefMenubar': 直す('EDITFLOW設定.json', [{ 道: ['メニューバーに出す'], 値: 設定().メニューバーに出す === false }], 'メニューバーの小窓を切り替えた', { 計算: false }); 小窓を送る(); break;
  }
});
function 工程を足す_(x) {
  const s = ui.sheet;
  if (s.戻り) { ui.sheet = s.戻り; ui.下書き.工程.push(x); シートを描く(); return; }
  const u = 単位を探す(s.u); シートを閉じる();
  if (u) 工程を置く(u, clone(工程(u)).concat([x]), `${u.名前}：${x.名前} を足した`);
}
document.addEventListener('change', e => {
  const t = e.target; const d = t.dataset || {};
  const u = d.u ? 単位を探す(d.u) : null;
  if (d.chg === 'startDate' && u) 着手できる日を置く(u, t.value || null);
  if (d.chg === 'contact') 直す('撮影メモ.json', [{ 道: ['撮影', d.f, '連絡先'], 値: t.value, 作る: true }], '連絡先を残した', { 計算: false });
});
document.addEventListener('keydown', e => {
  const 入力中 = e.target.matches && e.target.matches('input,textarea');
  if (ui.pal.open) {
    if (e.key === 'Escape') { 命令窓を閉じる(); e.preventDefault(); }
    else if (e.key === 'ArrowDown') { ui.pal.idx++; 命令窓を描く(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { ui.pal.idx = Math.max(0, ui.pal.idx - 1); 命令窓を描く(); e.preventDefault(); }
    else if (e.key === 'Enter') { 命令を実行(ui.pal.idx); e.preventDefault(); }
    return;
  }
  if (e.key === 'Escape') { シートを閉じる(); return; }
  if (入力中) {
    if (e.key === 'Enter' && e.target.dataset.chg === 'note') { const u = 単位を探す(e.target.dataset.u); if (u) 指摘を足す(u, Number(e.target.dataset.v), e.target.value); }
    return;
  }
  if (e.metaKey && e.key === 'k') { 命令窓を開く(); e.preventDefault(); return; }   // メニューが無いとき（画面外）の予備
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const us = 単位().filter(u => u.種 !== '回を作る' && !済か(u));
  const ix = us.findIndex(u => u.id === ui.sel);
  if (e.key === ' ') { 次の工程を済み(単位を探す(ui.sel)); e.preventDefault(); }
  else if (e.key === 'ArrowDown' || e.key === 'j') { const u = us[Math.min(us.length - 1, ix + 1)]; if (u) { ui.sel = u.id; 描く(); } e.preventDefault(); }
  else if (e.key === 'ArrowUp' || e.key === 'k') { const u = us[Math.max(0, ix - 1)]; if (u) { ui.sel = u.id; 描く(); } e.preventDefault(); }
});
$('#palInput').addEventListener('input', e => { ui.pal.q = e.target.value; ui.pal.idx = 0; 命令窓を描く(); });

/* ═══ 右クリックのメニュー ═══ */
const 文脈 = document.createElement('div'); 文脈.className = 'ctx'; document.body.appendChild(文脈);
let 文脈の品 = [];
function 文脈を開く(x, y, 品) {
  文脈の品 = 品;
  文脈.innerHTML = 品.map((p, i) => p === '-' ? '<hr>' : `<div class="${p.off ? 'off' : ''}" data-ci="${i}" title="${esc(p.off || '')}">${esc(p.t)}${p.k ? `<span class="k">${p.k}</span>` : ''}</div>`).join('');
  文脈.classList.add('on');
  const r = 文脈.getBoundingClientRect();
  文脈.style.left = Math.min(x, innerWidth - r.width - 8) + 'px'; 文脈.style.top = Math.min(y, innerHeight - r.height - 8) + 'px';
}
function 文脈を閉じる() { 文脈.classList.remove('on'); }
文脈.addEventListener('click', e => { const el = e.target.closest('[data-ci]'); if (!el) return; const p = 文脈の品[Number(el.dataset.ci)]; e.stopPropagation(); if (p.off) return; 文脈を閉じる(); p.f(); });
document.addEventListener('mousedown', e => { if (!文脈.contains(e.target)) 文脈を閉じる(); });
document.addEventListener('contextmenu', e => {
  const t = e.target.closest('[data-ctx]');
  if (!t) return;
  e.preventDefault();
  const u = 単位を探す(t.dataset.u); if (!u) return;
  ui.sel = u.id;
  const i = Number(t.dataset.i);
  const 次 = 工程(u).findIndex(s => !s.済);
  let 品 = [];
  if (t.dataset.ctx === 'step' && 工程(u)[i]) {
    const s = 工程(u)[i];
    品 = [{ t: s.済 ? `「${s.名前}」を未に戻す` : `「${s.名前}」を済みにする`, f: () => 工程を切り替える(u, i) },
      { t: '見込みを 0.5時間ふやす', f: () => 見込みを足す(u, i, 0.5) }, { t: '見込みを 0.5時間へらす', f: () => 見込みを足す(u, i, -0.5), off: s.見込み > 0 ? '' : 'もう 0' },
      { t: '実績を 0.5時間足す', f: () => 実績を足す(u, i, 0.5) }, '-',
      { t: '上へ', f: () => 工程を動かす(u, i, -1), off: i ? '' : 'いちばん上' }, { t: '下へ', f: () => 工程を動かす(u, i, 1), off: i < 工程(u).length - 1 ? '' : 'いちばん下' },
      '-', { t: 'この工程を消す', f: () => 工程を消す(u, i) }];
  } else {
    品 = [{ t: '次の工程を済みにする', k: 'スペース', f: () => 次の工程を済み(u), off: 次 >= 0 ? '' : '済んでいない工程が無い' },
      { t: '明日へ送る', k: '⌘]', f: () => 明日へ送る(u) },
      u.元.最優先 ? { t: '最優先を外す', f: () => 最優先にする(u, false) } : { t: 'この案件を最優先にする', k: '⇧⌘P', f: () => 最優先にする(u, true) }, '-',
      ...状態の名.map(s => ({ t: (状態(u) === s ? '✓ ' : '　') + '状態：' + s, f: () => 状態を変える(u, s), off: 状態(u) === s ? 'いまの状態' : '' })), '-',
      { t: '工程を足す…', k: '⌘T', f: () => シートを開く({ kind: 'addstep', u: u.id, mode: 'lib' }) },
      { t: 'プリセットから工程を入れる…', f: () => シートを開く({ kind: 'preset', u: u.id }) },
      { t: '版を足す', f: () => 版を足す(u) },
      { t: '案件の設定…', k: '⌘E', f: () => 設定を開く(u) }, '-',
      { t: 'この案件を消す', f: () => { if (confirm(`「${u.名前}」を一覧から消しますか？（⌘Z で戻せます）`)) 案件を消す(u); }, off: u.種 === '案件' ? '' : '定例の回はここでは消せない' }];
  }
  描く(); 文脈を開く(e.clientX, e.clientY, 品);
});

/* ═══ ドラッグで工程の並べ替え ═══ */
let 掴み = null;
document.addEventListener('dragstart', e => { const r = e.target.closest && e.target.closest('[data-drag]'); if (!r) return; 掴み = { u: r.dataset.u, i: Number(r.dataset.drag) }; r.classList.add('drag'); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(掴み.i)); });
document.addEventListener('dragover', e => { const r = e.target.closest && e.target.closest('[data-drag]'); if (!r || !掴み || r.dataset.u !== 掴み.u) return; e.preventDefault(); document.querySelectorAll('.step-row.drop').forEach(x => x.classList.remove('drop')); r.classList.add('drop'); });
document.addEventListener('dragend', () => { 掴み = null; document.querySelectorAll('.step-row.drag,.step-row.drop').forEach(x => x.classList.remove('drag', 'drop')); });
document.addEventListener('drop', e => {
  const r = e.target.closest && e.target.closest('[data-drag]'); if (!r || !掴み) return; e.preventDefault();
  const u = 単位を探す(掴み.u); const from = 掴み.i, to = Number(r.dataset.drag); 掴み = null;
  if (!u || from === to) return 描く();
  const 新 = clone(工程(u)); const [x] = 新.splice(from, 1); 新.splice(to, 0, x);
  工程を置く(u, 新, `${u.名前}：${x.名前} を ${to + 1}番目へ`);
});

/* ═══ 見た目（黒地 v1.0 ／ 明るい色 v1.4）═══ */
function 今の見た目() {
  if (window.__EF_見た目) return window.__EF_見た目;
  if (iPhone) return 端末.get('EF_見た目') || '明るい';
  return 設定().見た目 || '黒';
}
function 見た目を当てる() {
  const t = 今の見た目();
  document.documentElement.dataset.theme = t === '明るい' ? 'light' : 'dark';
  const m = document.querySelector('meta[name="theme-color"]'); if (m) m.content = t === '明るい' ? '#f2ede8' : '#06060d';
  if (Mac) 頼む('見た目', { 明るい: t === '明るい' });
}
function 見た目を選ぶ(t) {
  if (iPhone) 端末.set('EF_見た目', t);
  else 直す('EDITFLOW設定.json', [{ 道: ['見た目'], 値: t }], `見た目を「${t === '黒' ? '黒地' : '明るい色'}」にした`, { 計算: false });
  window.__EF_見た目 = null;
  見た目を当てる(); 描く();
}
const 狭い = () => window.matchMedia('(max-width: 760px)').matches;
if (iPhone) {
  // 1分ごとに読み直す（Mac が取り込んだら「待ち」の印が消える）。画面が裏にあるときは読まない
  setInterval(() => { if (!試し && GH.token() && document.visibilityState === 'visible' && !ui.sheet) 読み直す(false); }, 60000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && GH.token() && !試し) 読み直す(false); });
  document.documentElement.classList.add('iphone');
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => { });
}

/* ═══ メニューから（Swift） ═══ */
EF.命令 = 名 => {
  const u = 単位を探す(ui.sel);
  if (名.startsWith('画面:')) return 画面へ(名.slice(3));
  if (名.startsWith('見た目:')) return 見た目を選ぶ(名.slice(4));
  const 表 = {
    設定: () => シートを開く({ kind: 'prefs' }), 新しい案件: 新しい案件を開く, 命令窓: 命令窓を開く, 読み直す: () => 読み直す(true),
    取り消す, やり直す, 次の工程を済み: () => 次の工程を済み(u), 工程を足す: () => u && シートを開く({ kind: 'addstep', u: u.id, mode: 'lib' }),
    明日へ送る: () => 明日へ送る(u), 最優先: () => 最優先にする(u, true), 案件の設定: () => u && 設定を開く(u),
    前の案件: () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp' })), 次の案件: () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' })),
    計算し直す: () => 計算(false), 反映: () => 計算(true), 詳細の欄: () => { ui.詳細 = !ui.詳細; 描く(); },
    小窓: () => { 直す('EDITFLOW設定.json', [{ 道: ['メニューバーに出す'], 値: 設定().メニューバーに出す === false }], 'メニューバーの小窓を切り替えた', { 計算: false }); 小窓を送る(); }
  };
  (表[名] || (() => 知らせを出す('知らない命令：' + 名)))();
};

/* ═══ 画面外の書き出し・通しの試し ═══ */
EF.読めたか = () => S.読めた;
EF.書き出しの場面 = 名 => {
  document.body.classList.add('書き出し');
  命令窓を閉じる(); シートを閉じる();
  const 版のある = 単位().find(u => 版(u).length) || 単位().find(u => 工程(u).length) || 単位()[0];
  if (版のある) ui.sel = 版のある.id;
  const [v, 添] = 名.split('-');
  if (v === 'phone' && 添 === 'edit') { const u = 単位を探す(ui.sel); ui.view = 'projects'; if (u) 次の工程を済み(u); setTimeout(描く, 300); return true; }
  if (v === 'detail') { ui.view = 'projects'; ui.詳細を開く = true; 描く(); return true; }
  if (v === 'prefs') { ui.view = 'today'; 描く(); シートを開く({ kind: iPhone ? 'phone' : 'prefs' }); return true; }
  ui.詳細を開く = false;
  if (v === 'palette') { ui.view = 'today'; 描く(); 命令窓を開く(); ui.pal.q = ''; 命令窓を描く(); return true; }
  if (v === 'new') { ui.view = 'projects'; 描く(); 新しい案件を開く(); return true; }
  if (v === 'plan') ui.planTab = 添 === 'night' ? '夜' : '朝';
  if (v === 'today' && 添 === 'move') { const q = (P().問題 || [])[0]; if (q) ui.動かす[q.id] = true; }
  ui.view = v; 描く();
  return true;
};
EF.書き出しの高さ = () => Math.max(document.documentElement.scrollHeight, document.body.scrollHeight, 狭い() ? 844 : 940);
EF.試しの結果 = null;
EF.通しで試す = async () => {
  const 行 = []; let よい = true;
  const 報 = (ok, s) => { 行.push((ok ? '○ ' : '× ') + s); if (!ok) よい = false; };
  const 待つ = async () => { for (let i = 0; i < 600; i++) { await new Promise(r => setTimeout(r, 500)); if (!ui.計算中 && !ui.未計算 && !未確認.length) return; } };
  try {
    for (let i = 0; i < 100 && !S.読めた; i++) await new Promise(r => setTimeout(r, 200));
    const u = 単位().find(u => u.種 === '案件' && u.締切.length === 1 && !済か(u));
    const id = u.締切[0].id;
    const 残 = () => (進行の締切(id) || {}).残り;
    行.push(`案件：${u.名前}　はじめの残り ${残()}`);
    工程を置く(u, [{ 記号: 'IG', 名前: '素材取り込み', 英名: 'Ingest', 見込み: 1, 済: true }, { 記号: 'RC', 名前: '仮編集', 英名: 'Rough Cut', 見込み: 2.5, 済: false }], '試し：工程を入れる');
    await 待つ(); 報(残() === 2.5, `工程（済1h・未2.5h）を入れる → エンジンの残り ${残()}（2.5 のはず）`);
    工程を切り替える(単位を探す(u.id), 1);
    await 待つ(); 報(残() === 0, `札を押して仮編集を済みに → 残り ${残()}（0 のはず）`);
    取り消す();
    await 待つ(); 報(残() === 2.5, `⌘Z で戻す → 残り ${残()}（2.5 のはず）`);
    実績を足す(単位を探す(u.id), 0, 1.5);
    await new Promise(r => setTimeout(r, 1500));
    await 読み直す(false);
    報(工程(単位を探す(u.id))[0].実績 === 1.5 && 残() === 2.5, `実績 1.5h を入れる → ファイルに残り、残りの計算は変わらない（${残()}）`);
    const 明 = 足す日(今日(), 9);
    締切を動かす(単位を探す(u.id), u.締切[0].種類, 明, '');
    await 待つ();
    const k = A().案件.find(a => a.名前 === u.名前).締切[0];
    報(k.日付 === 明 && k.動かした === true && (進行の締切(id) || {}).日付 === 明, `締切を ${明} に動かす → 編集案件.json に 動かした が付き、進行.json の締切も ${(進行の締切(id) || {}).日付}`);
    const r = 単位().find(u => u.種 === '回' && u.締切.length && !済か(u));
    if (r) {
      工程を置く(r, [{ 名前: '仮編集', 見込み: 3, 済: false }], '試し：定例の回に工程');
      await 待つ(); 報((進行の締切(r.締切[0].id) || {}).残り === 3 && r.元.残り編集時間 !== 3 || (進行の締切(r.締切[0].id) || {}).残り === 3, `定例の回に工程3h → 残り ${(進行の締切(r.締切[0].id) || {}).残り}（3 のはず。残り編集時間には書き写さない）`);
    }
    const 在名 = Object.keys(S.f['食事の予定.json'].在庫 || {})[0];
    在庫を直す(在名, 2);
    await 待つ();
    報(S.f['食事の予定.json'].在庫[在名] === 2, `在庫「${在名}」を2回分に → 食事の予定.json に ${S.f['食事の予定.json'].在庫[在名]}`);
    const a = A(); 報(Object.keys(a)[0] === '_説明' && 'フォルダ' in a.案件[0], `編集案件.json のキーの並び・説明が残る（${Object.keys(a).join(',')}）`);
  } catch (e) { 報(false, '止まった：' + e.message); }
  EF.試しの結果 = 行.join('\n') + (よい ? '\n全部よい' : '');
};

読み直す(true);
