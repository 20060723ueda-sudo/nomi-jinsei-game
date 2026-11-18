// ===== 通信（PeerJS / WebRTC）と画面 =====
// ホスト端末がゲーム状態を持ち、参加者の端末と P2P で同期する。サーバー不要。

const PREFIX = 'nomi-jinsei-v1-';
const app = document.getElementById('app');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const lsGet = k => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { } };
const lsDel = k => { try { localStorage.removeItem(k); } catch { } };
const clone = o => JSON.parse(JSON.stringify(o));
const genId = n => { const c = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let r = ''; for (let i = 0; i < n; i++) r += c[Math.floor(Math.random() * c.length)]; return r; };

let myCid = lsGet('nomi_cid'); if (!myCid) { myCid = genId(12); lsSet('nomi_cid', myCid); }
let myName = lsGet('nomi_name') || '';
let role = null;          // 'host' | 'client' | null
let peer = null, hostConn = null, reconTimer = null;
const clients = new Map(); // conn.peer -> { conn, cid }
let S = null;             // ホストが持つ正式な状態
let view = null;          // 画面に表示中の状態
let roomCode = null;
let status = '';
let lastDiceSeq = null, animating = false, queued = null, lastTurnKey = null;

const urlRoom = (new URLSearchParams(location.search).get('room') || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

// ---------- 状態の受け取りと描画 ----------
function onState(s) {
  if (animating) { queued = s; return; }
  if (lastDiceSeq !== null && s.dice && s.dice.seq !== lastDiceSeq && s.dice.seq > 0) {
    lastDiceSeq = s.dice.seq;
    const p = s.players.find(x => x.id === s.dice.pid);
    animating = true;
    playDice(s.dice.v, p, () => {
      animating = false; view = s; render();
      if (queued) { const q = queued; queued = null; onState(q); }
    });
    return;
  }
  lastDiceSeq = s.dice ? s.dice.seq : 0;
  view = s; render();
}

function playDice(v, p, done) {
  const ov = document.createElement('div');
  ov.className = 'dice-overlay';
  ov.innerHTML = `<div class="dice-who">${esc(p ? p.name : '')} のサイコロ</div><div class="die rolling">?</div>`;
  document.body.appendChild(ov);
  const die = ov.querySelector('.die');
  let t = 0;
  const iv = setInterval(() => { die.textContent = 1 + Math.floor(Math.random() * 6); if (++t > 10) { clearInterval(iv); die.textContent = v; die.classList.remove('rolling'); die.classList.add('landed'); setTimeout(() => { ov.remove(); done(); }, 700); } }, 75);
}

function render() {
  const vals = {};
  app.querySelectorAll('input[id]').forEach(i => { vals[i.id] = i.value; });
  const ae = document.activeElement && document.activeElement.id;
  const s = view;
  let html;
  if (!role) html = homeHTML();
  else if (!s) html = `<div class="card center"><div class="big-emoji">📡</div><p>${esc(status || '接続中…')}</p><button class="ghost" data-act="leave">トップに戻る</button></div>`;
  else if (s.phase === 'lobby') html = lobbyHTML(s);
  else if (s.phase === 'end') html = endHTML(s);
  else html = gameHTML(s);
  const bar = role && status && s ? `<div class="status-bar">${esc(status)}</div>` : '';
  app.innerHTML = bar + html;
  for (const id in vals) { const el = document.getElementById(id); if (el) el.value = vals[id]; }
  if (ae) { const el = document.getElementById(ae); if (el) el.focus(); }
  if (s && s.phase === 'lobby') drawQR();
  // 自分の番になったら振動
  if (s && s.phase === 'roll') {
    const key = s.round + ':' + s.turn;
    if (key !== lastTurnKey && s.players[s.turn].owner === myCid && navigator.vibrate) { try { navigator.vibrate(200); } catch { } }
    lastTurnKey = key;
  }
}

function roomUrl() { return location.origin + location.pathname + '?room=' + roomCode; }

function drawQR() {
  const el = document.getElementById('qr');
  if (!el || !window.QRCode) return;
  el.innerHTML = '';
  try { new QRCode(el, { text: roomUrl(), width: 150, height: 150, correctLevel: QRCode.CorrectLevel.M }); } catch { }
}

// ---------- 画面 ----------
const RULES = `
<details class="rules"><summary>📖 ルール</summary>
<ul>
<li>順番にサイコロ（1〜6）を振ってマスを進み、止まったマスのイベントに従います。</li>
<li>「？」マスはハプニングカード。何が起こるかはお楽しみ。</li>
<li>チャレンジマスは成功・失敗を自己申告（みんなで判定）。</li>
<li>ゴールの順位でボーナス（1位+100万、2位+50万、3位+30万、4位+10万）。</li>
<li>全員ゴールしたら、総資産がいちばん多い人の勝ち！最下位は罰ゲーム。</li>
<li>だいたい1人6〜8ターンで終わります。</li>
</ul></details>
<p class="caution">⚠️ 20歳未満の飲酒は法律で禁止されています。「1口」「イッキ」はソフトドリンクや水でもOK。無理せず、イッキの強要はやめましょう。</p>`;

function homeHTML() {
  const joining = !!urlRoom;
  return `
  <div class="hero">
    <div class="hero-emoji">🍺🎲</div>
    <h1>飲んで人生ゲーム</h1>
    <p class="sub">サイコロで人生を進め、止まったマスで飲んで稼ぐパーティーゲーム</p>
  </div>
  <div class="card">
    <label class="lbl">あなたの名前</label>
    <input id="nameInput" maxlength="10" placeholder="例：たろう" value="${esc(myName)}" autocomplete="off">
    ${joining ? `
      <p class="hint">部屋 <b>${esc(urlRoom)}</b> に招待されています</p>
      <button class="primary" data-act="join" data-code="${esc(urlRoom)}">この部屋に参加する</button>
      <button class="ghost" data-act="clearRoom">自分で部屋を作る</button>
    ` : `
      <button class="primary" data-act="create">🏠 部屋を作る（ホスト）</button>
      <div class="or">または部屋コードで参加</div>
      <div class="row">
        <input id="codeInput" maxlength="6" placeholder="部屋コード" autocomplete="off" style="text-transform:uppercase">
        <button class="secondary" data-act="join">参加</button>
      </div>
    `}
  </div>
  ${RULES}`;
}

function playerChip(p, extra = '') {
  return `<span class="chip" style="--c:${p.color}"><span class="dot">${esc([...p.name][0] || '?')}</span>${esc(p.name)}${extra}</span>`;
}

function lobbyHTML(s) {
  const isHost = role === 'host';
  const list = s.players.map(p => `
    <li>${playerChip(p)}
      ${p.owner === myCid && !p.local ? '<span class="tag">あなた</span>' : ''}
      ${p.local ? '<span class="tag">この端末</span>' : ''}
      ${p.owner === s.hostCid && !p.local ? '<span class="tag host">ホスト</span>' : ''}
      ${!p.connected && !p.local ? '<span class="tag off">オフライン</span>' : ''}
      ${isHost && p.owner !== myCid ? `<button class="x" data-act="remove" data-id="${p.id}">×</button>` : ''}
      ${isHost && p.local ? `<button class="x" data-act="remove" data-id="${p.id}">×</button>` : ''}
    </li>`).join('');
  return `
  <div class="topbar"><span>🍺 飲んで人生ゲーム</span><button class="ghost sm" data-act="leave">退出</button></div>
  <div class="card center">
    <div class="lbl">部屋コード</div>
    <div class="code">${esc(roomCode)}</div>
    <div id="qr" class="qr"></div>
    <p class="hint">QRコードを読み取るか、URLを送って友だちを招待</p>
    <button class="secondary" data-act="copy">🔗 招待URLをコピー</button>
    ${navigator.share ? '<button class="ghost" data-act="share">📤 共有する</button>' : ''}
  </div>
  <div class="card">
    <div class="lbl">参加者（${s.players.length}/8）</div>
    <ul class="plist">${list}</ul>
    ${isHost ? `
      <details class="local"><summary>📱 スマホを持っていない人をこの端末に追加</summary>
        <div class="row"><input id="localName" maxlength="10" placeholder="名前" autocomplete="off"><button class="secondary" data-act="addLocal">追加</button></div>
      </details>
      <button class="primary" data-act="start" ${s.players.length < 1 ? 'disabled' : ''}>🎬 ゲームスタート（順番はランダム）</button>
    ` : `<p class="hint center">ホストがスタートするのを待っています…</p>`}
  </div>
  ${RULES}`;
}

function boardHTML(s) {
  return `<div class="board">${Engine.BOARD.map((sq, i) => {
    const here = s.players.filter(p => p.pos === i);
    const cls = sq.happening ? 'hap' : sq.stage;
    const active = s.event && s.event.square === i && (s.phase === 'event' || s.phase === 'choice');
    return `<div class="cell ${cls} ${active ? 'active' : ''}">
      <span class="num">${i}</span>
      <span class="em">${sq.happening ? '❓' : sq.emoji}</span>
      <span class="nm">${sq.happening ? 'ハプニング' : esc(sq.short)}</span>
      <span class="toks">${here.map(p => `<i class="tok ${p.id === cur(s).id ? 'me' : ''}" style="background:${p.color}" title="${esc(p.name)}">${esc([...p.name][0])}</i>`).join('')}</span>
    </div>`;
  }).join('')}</div>`;
}

function canAct(s) { return role === 'host' || cur(s).owner === myCid; }
function isProxy(s) { return cur(s).owner !== myCid; } // ホストが他人の代わりに操作

function gameHTML(s) {
  const p = cur(s);
  const mine = p.owner === myCid;
  let turnBox;
  if (s.phase === 'roll') {
    turnBox = `
      ${s.skipped && s.skipped.length ? `<div class="skipnote">💤 ${esc(s.skipped.join('、'))} は1回休み</div>` : ''}
      <div class="turn" style="--c:${p.color}">
        <div class="turn-name">${mine ? '🎯 あなたの番！' : ''}<b>${esc(p.name)}</b> さんの番</div>
        ${mine ? `<button class="primary huge" data-act="roll">🎲 サイコロを振る</button>`
               : `<p class="hint">${esc(p.name)} さんがサイコロを振るのを待っています…</p>
                  ${role === 'host' ? `<button class="ghost sm" data-act="roll">ホスト権限で代わりに振る</button>` : ''}`}
      </div>`;
  } else {
    turnBox = `<div class="turn" style="--c:${p.color}"><div class="turn-name"><b>${esc(p.name)}</b> さんのイベント中…</div></div>`;
  }
  const players = s.players.map((x, i) => `
    <div class="pl ${i === s.turn ? 'now' : ''}" style="--c:${x.color}">
      <div class="pl-top">${playerChip(x)}${x.owner === myCid && !x.local ? '<span class="tag">あなた</span>' : ''}${!x.connected && !x.local ? '<span class="tag off">オフライン</span>' : ''}</div>
      <div class="pl-stats">
        <span>📍${x.finished ? `🏁${x.finishOrder}位` : x.pos + 'マス'}</span>
        <span class="${x.money < 0 ? 'neg' : ''}">💰${x.money}万</span>
        <span>🍺${x.drinks}口</span>
        ${x.skip ? '<span class="tag off">休み</span>' : ''}
      </div>
    </div>`).join('');
  return `
  <div class="topbar"><span>部屋 <b>${esc(roomCode)}</b>・第${s.round}ラウンド</span><button class="ghost sm" data-act="leave">退出</button></div>
  ${turnBox}
  ${boardHTML(s)}
  <div class="legend"><span class="lg school">学生</span><span class="lg work">社会人</span><span class="lg family">家庭</span><span class="lg senior">老後</span><span class="lg hap">ハプニング</span><span class="lg challenge">チャレンジ</span></div>
  <div class="players">${players}</div>
  <details class="log" open><summary>📝 ログ</summary><ul>${[...s.log].reverse().slice(0, 25).map(l => `<li>${esc(l)}</li>`).join('')}</ul></details>
  ${(s.phase === 'event' || s.phase === 'choice') && s.event ? eventModal(s) : ''}`;
}

function eventModal(s) {
  const p = cur(s), ev = s.event, act = canAct(s), proxy = isProxy(s);
  const btn = proxy ? 'ghost sm' : 'primary';
  let body = '';
  if (s.phase === 'choice' && s.pending) {
    if (s.pending.kind === 'challenge') {
      body = `<div class="q">${esc(s.pending.q)}</div>` + (act
        ? `<div class="row2"><button class="${proxy ? 'ghost sm' : 'success'}" data-act="choose" data-v="ok">できた！🎉</button><button class="${proxy ? 'ghost sm' : 'danger'}" data-act="choose" data-v="ng">できなかった…😵</button></div>${proxy ? '<p class="hint">※ホスト権限で代理入力</p>' : ''}`
        : `<p class="hint">${esc(p.name)} さんの結果を待っています…</p>`);
    } else {
      body = `<div class="q">飲ませる相手を指名！</div>` + (act
        ? `<div class="picks">${s.players.filter(x => x !== p).map(x => `<button class="pick" style="--c:${x.color}" data-act="choose" data-v="${x.id}">${esc(x.name)}</button>`).join('')}</div>${proxy ? '<p class="hint">※ホスト権限で代理入力</p>' : ''}`
        : `<p class="hint">${esc(p.name)} さんが指名中…</p>`);
    }
  } else {
    body = `<ul class="lines">${ev.lines.map(l => `<li>${esc(l)}</li>`).join('')}</ul>` + (act
      ? `<button class="${btn}" data-act="ok">${proxy ? 'ホスト権限で次へ' : 'OK！次の人へ ▶'}</button>`
      : `<p class="hint">${esc(p.name)} さんが OK を押すと次に進みます</p>`);
  }
  return `
  <div class="modal-bg"><div class="modal ${ev.happening ? 'is-hap' : ''}">
    <div class="ev-who" style="--c:${p.color}">${esc(p.name)}${ev.square != null ? `・${ev.square}マス目` : ''}</div>
    ${ev.happening ? '<div class="hap-badge">❓ ハプニング！</div>' : ''}
    <div class="ev-emoji">${esc(ev.emoji)}</div>
    <h2>${esc(ev.title)}</h2>
    ${ev.text ? `<p class="ev-text">${esc(ev.text)}</p>` : ''}
    ${body}
  </div></div>`;
}

function endHTML(s) {
  const rk = Engine.ranking(s);
  const medals = ['🥇', '🥈', '🥉'];
  const maxDrink = Math.max(...s.players.map(p => p.drinks));
  const kings = s.players.filter(p => p.drinks === maxDrink);
  const last = rk[rk.length - 1];
  return `
  <div class="topbar"><span>部屋 <b>${esc(roomCode)}</b></span><button class="ghost sm" data-act="leave">退出</button></div>
  <div class="card center">
    <div class="big-emoji">🏆</div>
    <h1>結果発表</h1>
    <ol class="result">${rk.map((p, i) => `
      <li style="--c:${p.color}"><span class="rank">${medals[i] || (i + 1) + '位'}</span>
        <span class="rname">${esc(p.name)}</span>
        <span class="rmoney ${p.money < 0 ? 'neg' : ''}">${p.money}万</span>
        <span class="rsub">ゴール${p.finishOrder}着・🍺${p.drinks}口${p.ikki ? `（イッキ${p.ikki}回）` : ''}</span></li>`).join('')}
    </ol>
    <div class="award">🍺 酒豪賞：<b>${esc(kings.map(k => k.name).join('、'))}</b>（${maxDrink}口）</div>
    ${s.players.length > 1 ? `<div class="punish">😈 最下位の <b>${esc(last.name)}</b> さんは罰ゲームでイッキ！</div>` : ''}
    ${role === 'host' ? '<button class="primary" data-act="restart">🔁 同じメンバーでもう一度</button>' : '<p class="hint">ホストが次のゲームを始めるのを待っています</p>'}
  </div>`;
}

// ---------- ボタン操作 ----------
document.addEventListener('click', e => {
  const b = e.target.closest('[data-act]');
  if (!b || b.disabled) return;
  const a = b.dataset.act;
  switch (a) {
    case 'create': {
      if (!takeName()) return;
      createRoom(); break;
    }
    case 'join': {
      if (!takeName()) return;
      const code = (b.dataset.code || (document.getElementById('codeInput') || {}).value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (!code) { alert('部屋コードを入力してください'); return; }
      startClient(code); break;
    }
    case 'clearRoom': history.replaceState(null, '', location.pathname); location.reload(); break;
    case 'copy': copyText(roomUrl()); break;
    case 'share': navigator.share({ title: '飲んで人生ゲーム', text: '一緒に飲んで人生ゲームしよう！', url: roomUrl() }).catch(() => { }); break;
    case 'addLocal': {
      const el = document.getElementById('localName');
      const n = (el.value || '').trim();
      if (!n) return;
      el.value = '';
      send('addLocal', { name: n }); break;
    }
    case 'leave': leave(); break;
    case 'choose': send('choose', { value: b.dataset.v }); break;
    case 'remove': send('remove', { id: b.dataset.id }); break;
    default: send(a, {});
  }
});
document.addEventListener('keydown', e => {
  if (e.key !== 'Enter') return;
  const id = e.target && e.target.id;
  if (id === 'localName') document.querySelector('[data-act="addLocal"]')?.click();
  if (id === 'codeInput') document.querySelector('[data-act="join"]')?.click();
});

function takeName() {
  const n = (document.getElementById('nameInput').value || '').trim();
  if (!n) { alert('名前を入力してください'); return false; }
  myName = n.slice(0, 10); lsSet('nomi_name', myName); return true;
}
function copyText(t) {
  const ok = () => toast('コピーしました！');
  if (navigator.clipboard) navigator.clipboard.writeText(t).then(ok, () => prompt('このURLをコピーしてください', t));
  else prompt('このURLをコピーしてください', t);
}
function toast(msg) {
  const d = document.createElement('div'); d.className = 'toast'; d.textContent = msg;
  document.body.appendChild(d); setTimeout(() => d.remove(), 2200);
}
function send(action, payload) {
  const msg = { t: 'act', action, ...payload };
  if (role === 'host') hostHandle(myCid, msg);
  else if (hostConn && hostConn.open) hostConn.send(msg);
  else toast('ホストに接続されていません');
}
function leave() {
  const msg = role === 'host' ? '退出すると部屋が閉じ、全員のゲームが終了します。よろしいですか？' : '退出しますか？';
  if (role && !confirm(msg)) return;
  if (role === 'host' && roomCode) lsDel('nomi_host_' + roomCode);
  try { peer && peer.destroy(); } catch { }
  location.href = location.pathname;
}

// ---------- ホスト ----------
function newLobby(code) {
  return { phase: 'lobby', code, hostCid: myCid, players: [], log: [], seq: 0, pidCounter: 0, dice: { v: 0, seq: 0 } };
}
function addPlayer(s, name, owner, local) {
  const used = s.players.map(p => p.color);
  const color = Engine.COLORS.find(c => !used.includes(c)) || Engine.COLORS[s.players.length % 8];
  const p = { id: 'p' + (++s.pidCounter), name: String(name).slice(0, 10), owner, local: !!local, connected: true, color, pos: 0, money: 0, drinks: 0, ikki: 0, skip: 0, finished: false, finishOrder: null };
  s.players.push(p); return p;
}

function createRoom() {
  const code = genId(5);
  S = newLobby(code);
  addPlayer(S, myName, myCid, false);
  startHost(code, false);
}

function setUrl(code) { history.replaceState(null, '', location.pathname + '?room=' + code); }

function startHost(code, restoring) {
  role = 'host'; roomCode = code; S.code = code;
  setUrl(code);
  lsSet('nomi_host_' + code, JSON.stringify(S));
  status = '部屋を開いています…';
  commit(false);
  try { peer && peer.destroy(); } catch { }
  if (!window.Peer) { status = '通信ライブラリを読み込めませんでした（この端末だけで遊べます）'; render(); return; }
  peer = new Peer(PREFIX + code, { debug: 0 });
  peer.on('open', () => { status = ''; render(); });
  peer.on('connection', conn => {
    conn.on('data', d => {
      if (!d || typeof d !== 'object') return;
      if (d.t === 'join') onJoin(conn, String(d.cid || ''), String(d.name || '').slice(0, 10));
      else if (d.t === 'act') { const c = clients.get(conn.peer); if (c) hostHandle(c.cid, d); }
    });
    conn.on('close', () => onLeave(conn));
    conn.on('error', () => onLeave(conn));
  });
  peer.on('disconnected', () => { status = 'サーバーとの接続が切れました。再接続中…'; render(); setTimeout(() => { try { if (!peer.destroyed) peer.reconnect(); } catch { } }, 1500); });
  peer.on('error', err => {
    if (err.type === 'unavailable-id') {
      if (restoring) {
        status = '部屋を復元中…（数秒かかります）'; render();
        try { peer.destroy(); } catch { }
        setTimeout(() => startHost(code, true), 3000);
      } else {
        lsDel('nomi_host_' + code);
        const nc = genId(5); startHost(nc, false);
      }
    } else if (err.type === 'peer-unavailable') {
      // ホストでは無視
    } else {
      status = '通信エラー（' + err.type + '）。この端末内では遊べます'; render();
    }
  });
}

function onJoin(conn, cid, name) {
  if (!cid) return;
  clients.set(conn.peer, { conn, cid });
  const mine = S.players.filter(p => p.owner === cid && !p.local);
  if (mine.length) {
    mine.forEach(p => { p.connected = true; });
  } else if (S.phase === 'lobby') {
    if (S.players.length >= 8) { conn.send({ t: 'notice', msg: '満員のため観戦モードです' }); }
    else { addPlayer(S, name || 'ゲスト', cid, false); addLog(S, `👋 ${name} が参加`); }
  } else {
    conn.send({ t: 'notice', msg: 'ゲーム進行中のため観戦モードです' });
  }
  commit();
}

function onLeave(conn) {
  const c = clients.get(conn.peer);
  if (!c) return;
  clients.delete(conn.peer);
  const still = [...clients.values()].some(x => x.cid === c.cid);
  if (!still) {
    if (S.phase === 'lobby') {
      // ロビーでは抜けた人を外す
      S.players = S.players.filter(p => p.owner !== c.cid || p.local);
    } else S.players.forEach(p => { if (p.owner === c.cid && !p.local) p.connected = false; });
    commit();
  }
}

function hostHandle(cid, msg) {
  if (!S || msg.t !== 'act') return;
  const isHostActor = cid === myCid;
  const s = S;
  const ownsTurn = () => s.players[s.turn] && (s.players[s.turn].owner === cid || isHostActor);
  switch (msg.action) {
    case 'start':
      if (!isHostActor || s.phase !== 'lobby' || !s.players.length) return;
      Engine.startGame(s); break;
    case 'addLocal':
      if (!isHostActor || s.phase !== 'lobby' || s.players.length >= 8) return;
      addPlayer(s, String(msg.name || '').trim() || 'ゲスト', myCid, true); break;
    case 'remove':
      if (!isHostActor || s.phase !== 'lobby') return;
      s.players = s.players.filter(p => p.id !== msg.id || (p.owner === myCid && !p.local)); break;
    case 'roll':
      if (s.phase !== 'roll' || !ownsTurn()) return;
      Engine.roll(s); break;
    case 'choose':
      if (s.phase !== 'choice' || !ownsTurn()) return;
      if (!Engine.choose(s, msg.value)) return; break;
    case 'ok':
      if (s.phase !== 'event' || !ownsTurn()) return;
      Engine.nextTurn(s); break;
    case 'restart':
      if (!isHostActor || s.phase !== 'end') return;
      s.phase = 'lobby'; s.event = null; s.pending = null; s.log = [];
      s.players = s.players.filter(p => p.local || p.owner === myCid || p.connected);
      break;
    default: return;
  }
  commit();
}

function commit(broadcast = true) {
  S.seq = (S.seq || 0) + 1;
  lsSet('nomi_host_' + roomCode, JSON.stringify(S));
  if (broadcast) {
    const data = { t: 'state', s: S };
    for (const { conn } of clients.values()) { try { if (conn.open) conn.send(data); } catch { } }
  }
  onState(clone(S));
}

// ---------- 参加者 ----------
function startClient(code) {
  role = 'client'; roomCode = code; setUrl(code);
  status = '部屋に接続中…'; render();
  if (!window.Peer) { status = '通信ライブラリを読み込めませんでした。ページを再読み込みしてください'; render(); return; }
  peer = new Peer({ debug: 0 });
  peer.on('open', connectHost);
  peer.on('disconnected', () => { setTimeout(() => { try { if (!peer.destroyed) peer.reconnect(); } catch { } }, 1500); });
  peer.on('error', err => {
    if (err.type === 'peer-unavailable') status = '部屋が見つかりません。コードを確認するか、ホストの準備を待っています…';
    else status = '通信エラー（' + err.type + '）。再接続中…';
    render(); scheduleReconnect();
  });
}
function connectHost() {
  if (hostConn) { try { hostConn.close(); } catch { } }
  const conn = peer.connect(PREFIX + roomCode, { reliable: true });
  hostConn = conn;
  conn.on('open', () => { status = ''; conn.send({ t: 'join', cid: myCid, name: myName }); render(); });
  conn.on('data', d => {
    if (!d) return;
    if (d.t === 'state') onState(d.s);
    else if (d.t === 'notice') toast(d.msg);
  });
  conn.on('close', () => { if (hostConn === conn) { status = 'ホストとの接続が切れました。再接続中…'; render(); scheduleReconnect(); } });
}
function scheduleReconnect() {
  if (reconTimer) return;
  reconTimer = setTimeout(() => {
    reconTimer = null;
    if (!peer || peer.destroyed) return;
    if (peer.disconnected) { try { peer.reconnect(); } catch { } return; } // open で再接続
    if (!hostConn || !hostConn.open) connectHost();
  }, 3000);
}

// ---------- 起動 ----------
(function boot() {
  if (urlRoom) {
    const saved = lsGet('nomi_host_' + urlRoom);
    if (saved) {
      try {
        S = JSON.parse(saved);
        S.players.forEach(p => { if (!p.local && p.owner !== myCid) p.connected = false; });
        if (S.phase === 'lobby') S.players = S.players.filter(p => p.local || p.owner === myCid);
        startHost(urlRoom, true);
        return;
      } catch { lsDel('nomi_host_' + urlRoom); S = null; }
    }
  }
  render();
})();
