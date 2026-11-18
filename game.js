// ===== 飲んで人生ゲーム：ボードデータとゲームロジック =====
// ホスト端末だけがこのロジックで状態を更新し、全員に配信する。

const GOAL = 25;
const START_MONEY = 10;           // 単位：万円
const FINISH_BONUS = [100, 50, 30, 10]; // ゴール順位ボーナス
const IKKI = 'ikki';
const IKKI_SIPS = 5;              // イッキは5口換算で集計

const COLORS = ['#ff5a5f', '#3fa7ff', '#ffc531', '#3ddc97', '#b57bff', '#ff8c42', '#ff6fb5', '#2ee6e6'];

// stage: 背景色の分類 / fx: 効果
//  d: 飲む人 self|others|all|pick|pickAndSelf|richest|poorest  n: 口数 or 'ikki'
//  m: 自分のお金  mFromOthers: 他全員からもらう  mToPoorest: 一番貧乏な人にあげる
//  skip: 休み回数  move: 進む(負で戻る)
const BOARD = [
  { stage: 'start', emoji: '👶', short: 'スタート', title: 'オギャー！誕生' },
  { stage: 'school', emoji: '🎓', short: '飲みサー', title: '大学で飲みサーに入る',
    text: '新歓コンパの洗礼。先輩たちのコールに乗せられてイッキ！', fx: [{ d: 'self', n: IKKI }] },
  { happening: true },
  { stage: 'school', emoji: '🏮', short: '居酒屋バイト', title: '居酒屋でバイトを始める',
    text: 'バイト代ゲット！まかないのビールで1口。', fx: [{ m: 15 }, { d: 'self', n: 1 }] },
  { stage: 'school', emoji: '📉', short: '単位落とす', title: '単位を落とした',
    text: '留年の危機…。ヤケ酒で2口。', fx: [{ d: 'self', n: 2 }] },
  { stage: 'school', emoji: '🎪', short: '学園祭', title: '学園祭の模擬店が大当たり',
    text: '売上でみんなと打ち上げ！全員で乾杯（1口）。', fx: [{ m: 20 }, { d: 'all', n: 1 }] },
  { stage: 'challenge', emoji: '🔥', short: 'イッキ挑戦', title: 'イッキチャレンジ！',
    text: 'グラスを一気に飲み干せたら6マス進む！（量はみんなで決めてOK）',
    challenge: { q: 'イッキできた？', ok: [{ move: 6 }], ng: [{ d: 'self', n: 1 }] } },
  { stage: 'work', emoji: '😭', short: '就活失敗', title: '就活に失敗した',
    text: 'お祈りメールの嵐…。ヤケクソになって一気飲み！', fx: [{ d: 'self', n: IKKI }] },
  { happening: true },
  { stage: 'work', emoji: '🎉', short: '内定', title: '内定ゲット！',
    text: '浮かれて好きな人を指名。指名された人は2口！', fx: [{ m: 30 }, { d: 'pick', n: 2 }] },
  { stage: 'work', emoji: '🍶', short: '歓迎会', title: '新人歓迎会',
    text: '上司にお酌されまくる。断れずに3口。', fx: [{ d: 'self', n: 3 }] },
  { stage: 'work', emoji: '🙇', short: 'クビの危機', title: '会社をクビになりそう',
    text: '上司にゴマをするために飲む！3口。接待費で-10万。', fx: [{ d: 'self', n: 3 }, { m: -10 }] },
  { happening: true },
  { stage: 'work', emoji: '💰', short: 'ボーナス', title: 'ボーナス支給！',
    text: '後輩たちにおごってあげる。自分以外は全員1口。', fx: [{ m: 50 }, { d: 'others', n: 1 }] },
  { stage: 'family', emoji: '💒', short: '結婚', title: '結婚する！',
    text: '結婚を祝うために、他の人はみんな2口飲む！ご祝儀として全員から10万ずつもらう。',
    fx: [{ d: 'others', n: 2 }, { mFromOthers: 10 }] },
  { stage: 'family', emoji: '🤢', short: '二日酔い', title: '二日酔いで大遅刻',
    text: '迎え酒で1口。タクシー代-10万、2マス戻る。', fx: [{ d: 'self', n: 1 }, { m: -10 }, { move: -2 }] },
  { stage: 'family', emoji: '🍼', short: '子ども誕生', title: '子どもが生まれる！',
    text: '禁酒を誓って1回休み。出産祝い+20万。', fx: [{ m: 20 }, { skip: 1 }] },
  { happening: true },
  { stage: 'family', emoji: '🏠', short: 'マイホーム', title: 'マイホーム購入',
    text: '35年ローンで-60万。新築祝いで全員乾杯（1口）。', fx: [{ m: -60 }, { d: 'all', n: 1 }] },
  { stage: 'challenge', emoji: '⏱️', short: '早飲み接待', title: '取引先と早飲み対決',
    text: '10秒以内にグラスを空にできたら契約成立で+50万！',
    challenge: { q: '10秒以内に飲み干せた？', ok: [{ m: 50 }], ng: [{ d: 'self', n: 2 }] } },
  { stage: 'senior', emoji: '📉', short: '株で大損', title: '株で大損した',
    text: '-50万…。ヤケ酒イッキ！', fx: [{ m: -50 }, { d: 'self', n: IKKI }] },
  { stage: 'senior', emoji: '🏥', short: '糖尿病', title: '糖尿病になる',
    text: '医者に禁酒を命じられ1回休み。治療費-20万。', fx: [{ m: -20 }, { skip: 1 }] },
  { happening: true },
  { stage: 'senior', emoji: '🎊', short: '定年退職', title: '定年退職',
    text: '退職金+100万！送別会で全員乾杯（1口）。', fx: [{ m: 100 }, { d: 'all', n: 1 }] },
  { stage: 'senior', emoji: '👴', short: '孫誕生', title: '孫が生まれる！',
    text: '嬉しくて好きな人と乾杯。指名した人と自分で2口ずつ。', fx: [{ d: 'pickAndSelf', n: 2 }] },
  { stage: 'goal', emoji: '🏁', short: 'ゴール', title: '大往生（ゴール）' },
];

// 「？」マスで引くハプニングカード
const HAPPENINGS = [
  { emoji: '🎤', title: '上司のカラオケに付き合わされる', text: 'デュエットのたびに乾杯。3口。', fx: [{ d: 'self', n: 3 }] },
  { emoji: '💔', title: '恋人にフラれた', text: '飲まなきゃやってられない。イッキ！', fx: [{ d: 'self', n: IKKI }] },
  { emoji: '📱', title: 'SNSでバズった', text: '広告収入+20万！記念に全員で乾杯（1口）。', fx: [{ m: 20 }, { d: 'all', n: 1 }] },
  { emoji: '👛', title: '財布を落とした', text: '-20万。悲しみの1口。', fx: [{ m: -20 }, { d: 'self', n: 1 }] },
  { emoji: '🚃', title: '終電を逃した', text: '朝まで飲み明かして2口、翌日はダウンで1回休み。', fx: [{ d: 'self', n: 2 }, { skip: 1 }] },
  { emoji: '🚀', title: '仮想通貨が爆上がり', text: '+60万！調子に乗って自分以外全員に1口おごる。', fx: [{ m: 60 }, { d: 'others', n: 1 }] },
  { emoji: '💥', title: '仮想通貨が暴落', text: '-40万。ヤケ酒2口。', fx: [{ m: -40 }, { d: 'self', n: 2 }] },
  { emoji: '👑', title: '王様ゲーム開催', text: '王様のあなたが好きな人を指名！指名された人は3口。', fx: [{ d: 'pick', n: 3 }] },
  { emoji: '☎️', title: '酔って元恋人に電話した', text: '黒歴史確定。2口飲んで2マス戻る。', fx: [{ d: 'self', n: 2 }, { move: -2 }] },
  { emoji: '🎂', title: 'サプライズ誕生日会', text: 'プレゼント代+10万。祝ってくれた他の全員は1口。', fx: [{ m: 10 }, { d: 'others', n: 1 }] },
  { emoji: '💼', title: '転職に成功', text: 'キャリアアップ！3マス進む。', fx: [{ move: 3 }] },
  { emoji: '🍻', title: '飲み会の幹事を任される', text: '集金ミスで-5万。全員で乾杯（1口）。', fx: [{ m: -5 }, { d: 'all', n: 1 }] },
  { emoji: '🤑', title: 'お金持ちは飲め', text: '今いちばんお金を持っている人が2口！', fx: [{ d: 'richest', n: 2 }] },
  { emoji: '🤝', title: '募金活動', text: 'いちばん貧乏な人に10万あげる。善行の1口。', fx: [{ mToPoorest: 10 }, { d: 'self', n: 1 }] },
  { emoji: '💪', title: 'ジム通いを始める', text: '健康第一。今回は飲まずに2マス進む。', fx: [{ move: 2 }] },
  { emoji: '🎫', title: '宝くじが当たった！', text: '+100万！全員におごって自分以外は2口。', fx: [{ m: 100 }, { d: 'others', n: 2 }] },
  { emoji: '🎰', title: 'パチンコで大負け', text: '-30万。帰りのコンビニで1口。', fx: [{ m: -30 }, { d: 'self', n: 1 }] },
  { emoji: '🥂', title: '同窓会', text: '昔話で大盛り上がり。全員2口！', fx: [{ d: 'all', n: 2 }] },
  { emoji: '🚽', title: '飲みすぎてトイレで寝た', text: '1回休み。', fx: [{ skip: 1 }] },
  { emoji: '😇', title: '貧乏は飲め', text: '今いちばんお金がない人が2口！', fx: [{ d: 'poorest', n: 2 }] },
  { emoji: '🍺', title: '生ビール3口チャレンジ', text: '5秒以内に3口飲めたら+30万！',
    challenge: { q: '5秒以内に3口飲めた？', ok: [{ m: 30 }], ng: [{ d: 'self', n: 1 }] } },
  { emoji: '🐶', title: '犬を飼い始める', text: 'エサ代-10万。かわいさに乾杯して1口。', fx: [{ m: -10 }, { d: 'self', n: 1 }] },
];

// ===== ロジック =====
function rnd(n) { return Math.floor(Math.random() * n); }
function cur(s) { return s.players[s.turn]; }
function addLog(s, msg) { s.log.push(msg); if (s.log.length > 60) s.log.shift(); }
function sipsLabel(n) { return n === IKKI ? 'イッキ！' : `${n}口`; }
function yen(n) { return (n >= 0 ? '+' : '') + n + '万'; }

function drink(t, n, L) {
  if (n === IKKI) { t.drinks += IKKI_SIPS; t.ikki++; } else t.drinks += n;
  L.push(`🍺 ${t.name}：${sipsLabel(n)}`);
}

function finish(s, p, L) {
  if (p.finished) return;
  p.finished = true;
  p.pos = GOAL;
  p.finishOrder = ++s.finishCount;
  const bonus = FINISH_BONUS[p.finishOrder - 1] || 0;
  p.money += bonus;
  L.push(`🏁 ${p.name}：${p.finishOrder}位でゴール！ボーナス${yen(bonus)}`);
  const still = s.players.filter(x => !x.finished);
  if (still.length) L.push('🥂 まだ人生を歩んでいる人はお祝いに1口ずつ');
  still.forEach(x => drink(x, 1, L));
  addLog(s, `🏁 ${p.name} が${p.finishOrder}位でゴール`);
}

function applyFx(s, p, fx, target) {
  const L = [];
  const others = s.players.filter(x => x !== p);
  for (const f of fx || []) {
    if (f.d) {
      let tg = [];
      switch (f.d) {
        case 'self': tg = [p]; break;
        case 'others': tg = others; break;
        case 'all': tg = s.players; break;
        case 'pick': tg = [target || p]; break;
        case 'pickAndSelf': tg = target && target !== p ? [target, p] : [p]; break;
        case 'richest': { const mx = Math.max(...s.players.map(x => x.money)); tg = s.players.filter(x => x.money === mx); break; }
        case 'poorest': { const mn = Math.min(...s.players.map(x => x.money)); tg = s.players.filter(x => x.money === mn); break; }
      }
      tg.forEach(t => drink(t, f.n, L));
    }
    if (f.m != null) { p.money += f.m; L.push(`${f.m >= 0 ? '💰' : '💸'} ${p.name}：${yen(f.m)}`); }
    if (f.mFromOthers) {
      others.forEach(o => { o.money -= f.mFromOthers; });
      p.money += f.mFromOthers * others.length;
      if (others.length) L.push(`💰 ${p.name}：${yen(f.mFromOthers * others.length)}（${others.length}人から${f.mFromOthers}万ずつ）`);
    }
    if (f.mToPoorest) {
      if (others.length) {
        const mn = Math.min(...others.map(x => x.money));
        const t = others.find(x => x.money === mn);
        p.money -= f.mToPoorest; t.money += f.mToPoorest;
        L.push(`🤝 ${p.name} → ${t.name}：${f.mToPoorest}万`);
      }
    }
    if (f.skip) { p.skip += f.skip; L.push(`💤 ${p.name}：次の番は1回休み`); }
    if (f.move) {
      const np = Math.max(0, Math.min(GOAL, p.pos + f.move));
      L.push(f.move > 0 ? `➡️ ${p.name}：${f.move}マス進む（${np}マス目へ）` : `⬅️ ${p.name}：${-f.move}マス戻る（${np}マス目へ）`);
      p.pos = np;
      if (np >= GOAL) finish(s, p, L);
    }
  }
  return L;
}

function startGame(s) {
  // 順番シャッフル
  for (let i = s.players.length - 1; i > 0; i--) { const j = rnd(i + 1); [s.players[i], s.players[j]] = [s.players[j], s.players[i]]; }
  s.players.forEach((p, i) => Object.assign(p, {
    pos: 0, money: START_MONEY, drinks: 0, ikki: 0, skip: 0, finished: false, finishOrder: null,
    color: p.color || COLORS[i % COLORS.length],
  }));
  Object.assign(s, { phase: 'roll', turn: 0, round: 1, dice: { v: 0, seq: 0 }, event: null, pending: null, finishCount: 0, skipped: [], log: [] });
  addLog(s, '🎬 ゲーム開始！順番：' + s.players.map(p => p.name).join(' → '));
}

function roll(s) {
  const p = cur(s);
  const v = 1 + rnd(6);
  s.dice = { v, seq: (s.dice.seq || 0) + 1, pid: p.id };
  s.skipped = [];
  p.pos = Math.min(GOAL, p.pos + v);
  addLog(s, `🎲 ${p.name}：${v}が出て${p.pos}マス目へ`);
  land(s, p);
}

function land(s, p) {
  if (p.pos >= GOAL) {
    const L = []; finish(s, p, L);
    s.event = { pid: p.id, emoji: '🏁', title: 'ゴール！大往生', text: '波乱万丈の人生を走りきった！', lines: L, square: GOAL };
    s.phase = 'event'; return;
  }
  let sq = BOARD[p.pos], hap = false;
  if (sq.happening) { sq = HAPPENINGS[rnd(HAPPENINGS.length)]; hap = true; }
  s.event = { pid: p.id, emoji: sq.emoji, title: sq.title, text: sq.text, lines: [], happening: hap, square: p.pos };
  addLog(s, `${sq.emoji} ${p.name}：${hap ? '【ハプニング】' : ''}${sq.title}`);
  if (sq.challenge) {
    s.pending = { kind: 'challenge', q: sq.challenge.q, ok: sq.challenge.ok, ng: sq.challenge.ng };
    s.phase = 'choice'; return;
  }
  if (sq.fx.some(f => f.d === 'pick' || f.d === 'pickAndSelf') && s.players.length > 1) {
    s.pending = { kind: 'pick', fx: sq.fx };
    s.phase = 'choice'; return;
  }
  s.event.lines = applyFx(s, p, sq.fx, null);
  s.phase = 'event';
}

function choose(s, v) {
  const p = cur(s), pd = s.pending;
  if (!pd) return false;
  if (pd.kind === 'challenge') {
    const ok = v === 'ok';
    s.event.lines = [ok ? '🎉 成功！' : '😵 失敗…', ...applyFx(s, p, ok ? pd.ok : pd.ng, null)];
    addLog(s, `${ok ? '🎉' : '😵'} ${p.name}：チャレンジ${ok ? '成功' : '失敗'}`);
  } else {
    const t = s.players.find(x => x.id === v && x !== p);
    if (!t) return false;
    s.event.lines = [`👉 ${t.name} を指名！`, ...applyFx(s, p, pd.fx, t)];
  }
  s.pending = null; s.phase = 'event';
  return true;
}

function nextTurn(s) {
  s.event = null; s.pending = null; s.skipped = [];
  if (s.players.every(p => p.finished)) { s.phase = 'end'; addLog(s, '🏆 全員ゴール！結果発表'); return; }
  let i = s.turn;
  for (let guard = 0; guard < 200; guard++) {
    i = (i + 1) % s.players.length;
    if (i === 0) s.round++;
    const p = s.players[i];
    if (p.finished) continue;
    if (p.skip > 0) { p.skip--; s.skipped.push(p.name); addLog(s, `💤 ${p.name} は1回休み`); continue; }
    s.turn = i; s.phase = 'roll'; return;
  }
}

function ranking(s) {
  return [...s.players].sort((a, b) => b.money - a.money || (a.finishOrder || 99) - (b.finishOrder || 99));
}

const Engine = { GOAL, BOARD, HAPPENINGS, COLORS, startGame, roll, choose, nextTurn, ranking, sipsLabel, yen };
if (typeof module !== 'undefined') module.exports = Engine;
