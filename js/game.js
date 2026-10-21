/* ============================================================
   game.js — ゲームループ、状態遷移、スコア、レベル進行
   ============================================================ */
(function(){
"use strict";

const NEON = window.NEON;
const C = NEON.config;
const P = NEON.piece;
const {
  COLS, HIDDEN, GRID_ROWS, NEXT_COUNT,
  LOCK_DELAY, LOCK_RESETS, CLEAR_ANIM, SOFT_DROP_FACTOR,
  SCORE, LINES_PER_LEVEL, MAX_LEVEL, PIECES
} = C;

/* ------------------------------------------------------------
   DOM
   ------------------------------------------------------------ */
const dom = {
  board:    document.getElementById("board"),
  next:     document.getElementById("next"),
  hold:     document.getElementById("hold"),
  frame:    document.querySelector(".board-frame"),
  score:    document.getElementById("score"),
  best:     document.getElementById("best"),
  level:    document.getElementById("level"),
  lines:    document.getElementById("lines"),
  overlay:  document.getElementById("overlay"),
  ovKicker: document.getElementById("ovKicker"),
  ovTitle:  document.getElementById("ovTitle"),
  ovBody:   document.getElementById("ovBody"),
  ovHint:   document.getElementById("ovHint"),
  callout:  document.getElementById("callout"),
  muteFlag: document.getElementById("muteFlag"),
  muteBtn:  document.getElementById("muteBtn"),
  ovRestart:document.getElementById("ovRestart")
};

/* タッチ端末かどうかで案内文を切り替える */
const TOUCH = window.matchMedia("(pointer: coarse)").matches;

const storage  = NEON.storage;
const audio    = NEON.createAudio();
const renderer = NEON.createRenderer(dom);
const board    = NEON.createBoard();
const queue    = P.createQueue();

storage.load();
audio.setMuted(storage.muted);

/* ------------------------------------------------------------
   ゲーム状態
   ------------------------------------------------------------ */
const TITLE = "TITLE", PLAYING = "PLAYING", PAUSED = "PAUSED", OVER = "OVER";

const S = {
  state: TITLE,
  piece: null,
  hold: null,
  holdUsed: false,

  score: 0, lines: 0, level: 1,
  combo: -1, b2b: false,

  dropAcc: 0,       // 落下タイマー (ms)
  lockAcc: 0,       // 接地してからの経過 (ms)
  lockResets: 0,
  lowestY: -99,     // このミノが到達した最も深い y（ロック延長の上限管理に使う）
  grounded: false,
  touched: false,   // 現在の深さで一度でも接地したか

  clearing: null,   // { rows:[], t:0..1, elapsed }
  pendingSpawn: false,
  trail: null,      // ハードドロップの残像
  time: 0
};

let softDropCells = 0;
let lastWallSfx = 0;
let inputLockUntil = 0;   // ゲームオーバー直後の誤操作でリスタートしないようにする

/* ------------------------------------------------------------
   HUD
   ------------------------------------------------------------ */
const shown = { score:-1, best:-1, level:-1, lines:-1 };

function bump(el){
  el.classList.remove("bump");
  void el.offsetWidth;            // アニメーションを再生し直すための強制リフロー
  el.classList.add("bump");
}

function updateHud(){
  if(shown.score !== S.score){
    dom.score.textContent = S.score.toLocaleString("en-US");
    if(shown.score >= 0 && S.score > shown.score) bump(dom.score);
    shown.score = S.score;
  }
  const best = Math.max(storage.best.score, S.score);
  if(shown.best !== best){
    dom.best.textContent = best.toLocaleString("en-US");
    shown.best = best;
  }
  if(shown.level !== S.level){
    dom.level.textContent = S.level;
    if(shown.level >= 0) bump(dom.level);
    shown.level = S.level;
  }
  if(shown.lines !== S.lines){
    dom.lines.textContent = S.lines;
    shown.lines = S.lines;
  }
}

function showOverlay(kicker, title, body, hint, restartBtn){
  dom.ovKicker.textContent = kicker;
  dom.ovTitle.textContent  = title;
  dom.ovBody.textContent   = body;
  dom.ovHint.textContent   = hint || "";
  dom.ovHint.hidden = !hint;
  dom.ovRestart.hidden = !(restartBtn && TOUCH);
  dom.overlay.hidden = false;
}

function hideOverlay(){ dom.overlay.hidden = true; }

function callout(text){
  dom.callout.textContent = text;
  dom.callout.classList.remove("show");
  void dom.callout.offsetWidth;
  dom.callout.classList.add("show");
}

function shake(){
  dom.frame.classList.remove("shake");
  void dom.frame.offsetWidth;
  dom.frame.classList.add("shake");
}

function applyHue(){
  document.documentElement.style.setProperty("--hue", C.levelHue(S.level));
}

/* ------------------------------------------------------------
   ミノの出現とホールド
   ------------------------------------------------------------ */
function resetLockState(p){
  S.lockAcc = 0;
  S.lockResets = 0;
  S.lowestY = p.y;
  S.grounded = false;
  S.touched = false;
}

/* これまでより深い位置に落ちた：ロック猶予を丸ごと作り直す */
function descended(){
  S.lowestY = S.piece.y;
  S.lockResets = 0;
  S.lockAcc = 0;
  S.touched = false;
}

function spawn(type){
  const p = P.spawnPiece(type || queue.shift());
  S.piece = p;
  S.dropAcc = 0;
  resetLockState(p);

  /* ブロックアウト：出現位置が既に埋まっていたら終了。
     食い込んだままのミノを状態に残さないよう null にしてから終了させる。 */
  if(board.collides(P.cellsOf(p))){
    S.piece = null;
    gameOver("BLOCK OUT");
    return false;
  }
  return true;
}

function doHold(){
  if(S.state !== PLAYING || !S.piece || S.holdUsed) return;
  const current = S.piece.type;
  const swap = S.hold;
  S.hold = current;
  S.holdUsed = true;
  audio.sfx.hold();
  if(swap) spawn(swap);
  else     spawn();
}

/* ------------------------------------------------------------
   ロック延長：接地中に動かせたら猶予をリセットする
   ------------------------------------------------------------ */
function onPieceMoved(){
  if(S.piece.y > S.lowestY){ descended(); return; }

  /* まだ一度も接地していないうちの操作は猶予を消費しない */
  if(!S.touched) return;

  /* 接地後の操作は回数を消費する。空中に蹴り上げられた直後の回転も
     消費対象にしないと、回転を連打するだけで永久に粘れてしまう。 */
  if(S.lockResets < LOCK_RESETS){
    S.lockResets++;
    S.lockAcc = 0;
  }
}

/* ------------------------------------------------------------
   スコア計算
   ------------------------------------------------------------ */
const CLEAR_NAMES = ["", "SINGLE", "DOUBLE", "TRIPLE", "TETRIS"];

function applyScore(n, tspin){
  let base = 0;
  let label = "";

  if(tspin === "tspin"){
    base = SCORE.TSPIN[n] || 0;
    label = n === 0 ? "T-SPIN" : "T-SPIN " + CLEAR_NAMES[n];
  }else if(tspin === "mini"){
    base = SCORE.TSPIN_MINI[n] || 0;
    label = n === 0 ? "T-SPIN MINI" : "T-SPIN MINI " + CLEAR_NAMES[n];
  }else if(n > 0){
    base = SCORE[n];
    label = CLEAR_NAMES[n];
  }

  /* Back-to-Back：テトリスか T-Spin でのライン消去が連続したとき */
  const difficult = (n === 4) || (tspin !== "none" && n > 0);
  let b2bApplied = false;
  if(n > 0){
    if(difficult && S.b2b){ base = Math.floor(base * SCORE.B2B); b2bApplied = true; }
    S.b2b = difficult;
  }

  /* コンボ */
  let comboBonus = 0;
  if(n > 0){
    S.combo++;
    if(S.combo > 0) comboBonus = SCORE.COMBO * S.combo * S.level;
  }else{
    S.combo = -1;
  }

  S.score += base * S.level + comboBonus;

  /* 画面中央の演出テキスト */
  const parts = [];
  if(b2bApplied) parts.push("BACK-TO-BACK");
  if(label) parts.push(label + "!");
  if(S.combo > 0) parts.push(S.combo + " COMBO");
  if(parts.length) callout(parts.join("\n"));

  return { n, tspin, difficult };
}

function addLines(n){
  if(n <= 0) return;
  S.lines += n;
  const next = Math.min(MAX_LEVEL, Math.floor(S.lines / LINES_PER_LEVEL) + 1);
  if(next !== S.level){
    S.level = next;
    audio.sfx.levelUp();
    audio.setLevel(S.level);
    applyHue();
    callout("LEVEL " + S.level);
  }
}

/* ------------------------------------------------------------
   固定処理
   ------------------------------------------------------------ */
function lockPiece(){
  const p = S.piece;
  const cells = P.cellsOf(p);
  const tspin = P.detectTSpin(board, p);

  board.lock(cells, p.type);
  S.piece = null;
  S.holdUsed = false;

  /* ロックアウト：ミノ全体が不可視バッファ内で固定されたら終了 */
  const allHidden = cells.every(c => c[1] < HIDDEN);

  const rows = board.fullLines();
  const n = rows.length;

  applyScore(n, tspin);

  if(n > 0){
    if(n >= 4)                audio.sfx.tetris();
    else                      audio.sfx.clear(n, tspin !== "none");
    if(S.combo > 0)           audio.sfx.combo(S.combo);
    S.clearing = { rows, t:0, elapsed:0 };
    if(n >= 3) shake();
  }else{
    audio.sfx.lock();
    if(allHidden){ gameOver("LOCK OUT"); return; }
    spawn();
  }

  if(allHidden && n > 0){
    /* 消去アニメーションを見せてから終了させる */
    S.clearing.thenGameOver = "LOCK OUT";
  }
}

function hardDrop(){
  if(S.state !== PLAYING || !S.piece) return;
  const p = S.piece;
  const gy = P.ghostY(board, p);
  const dist = gy - p.y;

  if(dist > 0){
    /* 残像用に、各列の始点と終点を控えておく */
    const cols = new Map();
    for(const [x, y] of P.cellsOf(p)){
      const prev = cols.get(x);
      if(prev === undefined || y > prev) cols.set(x, y);
    }
    S.trail = {
      t: 0,
      color: PIECES[p.type].color,
      columns: Array.from(cols, ([x, y]) => [x, y, y + dist])
    };
    p.y = gy;
    S.score += SCORE.HARD * dist;
  }

  audio.sfx.hardDrop();
  shake();
  lockPiece();
}

/* ------------------------------------------------------------
   ゲーム進行
   ------------------------------------------------------------ */
function step(dt){
  if(S.state !== PLAYING) return;

  /* --- ライン消去アニメーション中はミノを動かさない --- */
  if(S.clearing){
    S.clearing.elapsed += dt;
    S.clearing.t = Math.min(1, S.clearing.elapsed / CLEAR_ANIM);
    if(S.clearing.t >= 1){
      const rows = S.clearing.rows;
      const after = S.clearing.thenGameOver;
      board.removeLines(rows);
      addLines(rows.length);
      S.clearing = null;
      if(after){ gameOver(after); return; }
      spawn();
    }
    return;
  }

  if(!S.piece) return;

  /* --- 落下 --- */
  const soft = input.softDrop;
  const interval = soft
    ? Math.max(C.gravityMs(S.level) / SOFT_DROP_FACTOR, 12)
    : C.gravityMs(S.level);

  S.dropAcc += dt;
  let guard = 0;
  while(S.dropAcc >= interval && guard++ < 30){
    S.dropAcc -= interval;
    if(P.tryMove(board, S.piece, 0, 1)){
      if(soft){ S.score += SCORE.SOFT; softDropCells++; }
      if(S.piece.y > S.lowestY) descended();
    }else{
      S.dropAcc = 0;
      break;
    }
  }

  /* --- 接地とロック猶予 --- */
  S.grounded = P.isGrounded(board, S.piece);
  if(S.grounded){
    S.touched = true;
    S.lockAcc += dt;
    if(S.lockAcc >= LOCK_DELAY) lockPiece();
  }else if(S.lockResets < LOCK_RESETS){
    S.lockAcc = 0;
  }else{
    /* 猶予を使い切った後は空中でもタイマーを進め、着地した瞬間に固定する */
    S.lockAcc += dt;
  }
}

/* ------------------------------------------------------------
   状態遷移
   ------------------------------------------------------------ */
function startGame(){
  board.reset();
  queue.reset();
  S.state = PLAYING;
  S.piece = null;
  S.hold = null;
  S.holdUsed = false;
  S.score = 0; S.lines = 0; S.level = 1;
  S.combo = -1; S.b2b = false;
  S.clearing = null; S.trail = null;
  softDropCells = 0;
  shown.score = shown.level = shown.lines = -1;

  applyHue();
  renderer.invalidate();
  audio.setLevel(1);
  audio.sfx.start();
  audio.startBgm();
  hideOverlay();
  spawn();
}

function togglePause(){
  if(S.state === PLAYING){
    S.state = PAUSED;
    audio.duckBgm(true);
    audio.sfx.pause();
    showOverlay("PAUSED", "一時停止",
      "SCORE " + S.score.toLocaleString("en-US") + "\nLEVEL " + S.level + " / LINES " + S.lines,
      TOUCH ? "タップで再開" : "P で再開 / R で最初から", true);
  }else if(S.state === PAUSED){
    S.state = PLAYING;
    audio.duckBgm(false);
    hideOverlay();
  }
}

function gameOver(reason){
  S.state = OVER;
  S.clearing = null;
  inputLockUntil = performance.now() + 900;   // 結果を読む間を作る
  audio.stopBgm();
  audio.sfx.gameOver();

  const isBest = storage.saveBest({ score:S.score, lines:S.lines, level:S.level });
  shown.best = -1;
  updateHud();

  showOverlay(
    isBest ? "NEW RECORD" : reason,
    "GAME OVER",
    "SCORE " + S.score.toLocaleString("en-US") +
      "\nLEVEL " + S.level + " / LINES " + S.lines +
      (isBest ? "\n\n自己ベスト更新！" : "\nBEST " + storage.best.score.toLocaleString("en-US")),
    TOUCH ? "タップでもう一度" : "SPACE または R でもう一度"
  );
}

function backToTitle(){
  S.state = TITLE;
  if(TOUCH){
    showOverlay("READY", "NEON DROP",
      "タップでスタート",
      "◀▶ 移動 / ↺↻ 回転 / DROP ハードドロップ");
  }else{
    showOverlay("READY", "NEON DROP",
      "SPACE キーでスタート",
      "←→ 移動 / ↑ 回転 / SPACE ハードドロップ");
  }
}

function toggleMute(){
  const next = !audio.muted;
  audio.setMuted(next);
  storage.saveMuted(next);
  dom.muteFlag.hidden = !next;
  dom.muteBtn.classList.toggle("off", next);
}

/* ------------------------------------------------------------
   入力ハンドラ
   ------------------------------------------------------------ */
/* iOS Safari は指を離したタイミング（pointerup / touchend）でしか
   AudioContext を再開できないため、毎回 unlock を呼んで resume を試みる。 */
function ensureAudio(){
  const wasReady = audio.ready;
  audio.unlock();
  if(!wasReady){
    audio.setMuted(storage.muted);
    if(S.state === PLAYING) audio.startBgm();
  }
}

window.addEventListener("pointerup", ensureAudio);
window.addEventListener("touchend", ensureAudio);

const input = NEON.createInput({
  onMove(d){
    ensureAudio();
    if(S.state !== PLAYING || !S.piece || S.clearing) return;
    if(P.tryMove(board, S.piece, d, 0)){
      audio.sfx.move();
      onPieceMoved();
    }else{
      const now = performance.now();
      if(now - lastWallSfx > 140){ audio.sfx.wall(); lastWallSfx = now; }
    }
  },

  onRotate(dir){
    ensureAudio();
    if(S.state !== PLAYING || !S.piece || S.clearing) return;
    if(P.tryRotate(board, S.piece, dir)){
      audio.sfx.rotate();
      onPieceMoved();
    }
  },

  onHardDrop(){
    ensureAudio();
    if(performance.now() < inputLockUntil) return;
    if(S.state === TITLE){ startGame(); return; }
    if(S.state === OVER){ startGame(); return; }
    if(S.state === PAUSED) return;
    if(S.clearing) return;
    hardDrop();
  },

  onHold(){
    ensureAudio();
    if(S.clearing) return;
    doHold();
  },

  onPause(){
    ensureAudio();
    togglePause();
  },

  onRestart(){
    ensureAudio();
    if(performance.now() < inputLockUntil) return;
    if(S.state === TITLE) return;
    startGame();
  },

  onMute(){
    ensureAudio();
    toggleMute();
  },

  onSoftDrop(on){
    ensureAudio();
    if(!on) softDropCells = 0;
  }
});

/* ------------------------------------------------------------
   メインループ
   ------------------------------------------------------------ */
let last = 0;

function frame(now){
  if(!last) last = now;
  const dt = Math.min(now - last, 100);   // タブ復帰時の巨大な dt を抑える
  last = now;
  S.time = now;

  input.update(now);
  step(dt);

  /* 残像のフェード */
  if(S.trail){
    S.trail.t += dt / 220;
    if(S.trail.t >= 1) S.trail = null;
  }

  renderer.renderBoard({
    board,
    piece: S.state === OVER ? null : S.piece,
    level: S.level,
    clearing: S.clearing,
    trail: S.trail,
    time: now,
    lockProgress: S.grounded ? Math.min(1, S.lockAcc / LOCK_DELAY) : 0
  });
  renderer.renderNext(queue.peek(NEXT_COUNT));
  renderer.renderHold(S.hold, S.holdUsed);
  renderer.endFrame();
  updateHud();

  requestAnimationFrame(frame);
}

/* ------------------------------------------------------------
   起動
   ------------------------------------------------------------ */
applyHue();
dom.muteFlag.hidden = !storage.muted;
dom.muteBtn.classList.toggle("off", storage.muted);
updateHud();

/* オーバーレイをタップ：タイトル・ゲームオーバーなら開始、ポーズ中なら再開 */
dom.overlay.addEventListener("click", () => {
  ensureAudio();
  if(S.state === PAUSED) togglePause();
  else if(S.state === TITLE || S.state === OVER){
    if(performance.now() < inputLockUntil) return;
    startGame();
  }
});

dom.ovRestart.addEventListener("click", e => {
  e.stopPropagation();
  ensureAudio();
  startGame();
});
backToTitle();
requestAnimationFrame(frame);

/* 動作確認用のフック（コンソールから盤面や状態を覗ける） */
NEON._debug = { S, board, queue, startGame, spawn, lockPiece, hardDrop, applyScore, audio };

/* ウィンドウが隠れたら自動でポーズする */
document.addEventListener("visibilitychange", () => {
  if(document.hidden && S.state === PLAYING) togglePause();
});

})();
