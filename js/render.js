/* ============================================================
   render.js — Canvas 描画
     ネオンブロックは shadowBlur を使うため、毎フレーム 200 個描くと
     重い。種類とサイズごとにオフスクリーンへ一度だけ焼き、以降は
     drawImage で貼るだけにしている。
   ============================================================ */
(function(){
"use strict";

const NEON = window.NEON = window.NEON || {};
const C = NEON.config;
const { COLS, ROWS, HIDDEN, GRID_ROWS, CELL, NEXT_COUNT, PIECES } = C;

const BLEED = 10;   // グローがセルの外へにじむ余白 (px)

/* ------------------------------------------------------------
   小物
   ------------------------------------------------------------ */
function hexA(hex, a){
  const n = parseInt(hex.slice(1), 16);
  return "rgba(" + ((n >> 16) & 255) + "," + ((n >> 8) & 255) + "," + (n & 255) + "," + a + ")";
}

function roundRect(ctx, x, y, w, h, r){
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y,     x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x,     y + h, r);
  ctx.arcTo(x,     y + h, x,     y,     r);
  ctx.arcTo(x,     y,     x + w, y,     r);
  ctx.closePath();
}

/* 高解像度ディスプレイでも滲まないよう、論理サイズ→実ピクセルへ拡大する。
   getBoundingClientRect はレイアウトを強制するので、ウィンドウサイズが
   変わったときだけ測り直し、それ以外はキャッシュを使う。 */
let measureDirty = true;
window.addEventListener("resize", () => { measureDirty = true; });

const ctxCache = new WeakMap();

function fitCanvas(cv, logicalW, logicalH){
  let entry = ctxCache.get(cv);
  if(!entry || measureDirty){
    const dpr = window.devicePixelRatio || 1;
    const rect = cv.getBoundingClientRect();
    const w = Math.max(1, Math.round((rect.width  || logicalW) * dpr));
    const h = Math.max(1, Math.round((rect.height || logicalH) * dpr));
    if(cv.width !== w || cv.height !== h){ cv.width = w; cv.height = h; }
    const ctx = cv.getContext("2d");
    ctx.setTransform(w / logicalW, 0, 0, h / logicalH, 0, 0);
    entry = { ctx };
    ctxCache.set(cv, entry);
  }
  return entry.ctx;
}

/* 1 フレームぶんの描画が終わったところで測り直しフラグを下ろす */
function endFrame(){ measureDirty = false; }

/* ------------------------------------------------------------
   ブロックタイルの生成とキャッシュ
     variant: "solid" 通常 / "ghost" ゴースト / "pale" 固定済みの淡い表示
   ------------------------------------------------------------ */
const tiles = new Map();

function getTile(type, size, variant){
  const key = type + ":" + size + ":" + variant;
  let tile = tiles.get(key);
  if(tile) return tile;

  const def = PIECES[type];
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const side = size + BLEED * 2;

  tile = document.createElement("canvas");
  tile.width  = Math.ceil(side * dpr);
  tile.height = Math.ceil(side * dpr);
  const g = tile.getContext("2d");
  g.scale(dpr, dpr);

  paintBlock(g, BLEED, BLEED, size, def.color, def.glow, variant);
  tile.bleed = BLEED;
  tiles.set(key, tile);
  return tile;
}

function paintBlock(ctx, x, y, s, color, glow, variant){
  const r = Math.max(2, s * 0.16);

  if(variant === "ghost"){
    ctx.save();
    ctx.globalAlpha = .5;
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(1, s * 0.07);
    ctx.shadowColor = color;
    ctx.shadowBlur = s * 0.3;
    roundRect(ctx, x + s * .14, y + s * .14, s * .72, s * .72, r * .7);
    ctx.stroke();
    ctx.restore();
    return;
  }

  const pale = variant === "pale";
  const pad = s * 0.05;
  const bx = x + pad, by = y + pad, bw = s - pad * 2, bh = s - pad * 2;

  ctx.save();

  /* 1. 外周：光る縁 */
  ctx.shadowColor = color;
  ctx.shadowBlur = pale ? s * 0.28 : s * 0.55;
  ctx.fillStyle = color;
  roundRect(ctx, bx, by, bw, bh, r);
  ctx.fill();
  ctx.shadowBlur = 0;

  /* 2. 内側を暗く落とし、縁だけがネオン管のように光って見えるようにする */
  const inset = Math.max(1.5, s * 0.11);
  roundRect(ctx, bx + inset, by + inset, bw - inset * 2, bh - inset * 2, r * .6);
  ctx.fillStyle = "#050a14";
  ctx.fill();

  const grad = ctx.createLinearGradient(bx, by, bx, by + bh);
  grad.addColorStop(0, hexA(glow,  pale ? .34 : .5));
  grad.addColorStop(1, hexA(color, pale ? .1  : .16));
  ctx.fillStyle = grad;
  ctx.fill();

  /* 3. 上端のハイライト */
  ctx.fillStyle = hexA(glow, pale ? .4 : .7);
  ctx.fillRect(bx + inset + 1, by + inset + 1, bw - inset * 2 - 2, Math.max(1, s * 0.055));

  ctx.restore();
}

function stampBlock(ctx, px, py, size, type, variant, alpha){
  const tile = getTile(type, size, variant);
  if(alpha !== undefined && alpha !== 1){
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.drawImage(tile, px - BLEED, py - BLEED, size + BLEED * 2, size + BLEED * 2);
    ctx.restore();
  }else{
    ctx.drawImage(tile, px - BLEED, py - BLEED, size + BLEED * 2, size + BLEED * 2);
  }
}

/* ------------------------------------------------------------
   レンダラ本体
   ------------------------------------------------------------ */
function createRenderer(dom){
  const W = COLS * CELL;          // 論理幅  300
  const H = ROWS * CELL;          // 論理高  600

  /* --- プレイフィールドの下地 --- */
  function drawField(ctx, level){
    ctx.clearRect(0, 0, W, H);

    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, "rgba(8,16,32,.92)");
    bg.addColorStop(1, "rgba(2,6,14,.96)");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    ctx.strokeStyle = "rgba(120,220,255,.08)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for(let x = 1; x < COLS; x++){ ctx.moveTo(x * CELL + .5, 0); ctx.lineTo(x * CELL + .5, H); }
    for(let y = 1; y < ROWS; y++){ ctx.moveTo(0, y * CELL + .5); ctx.lineTo(W, y * CELL + .5); }
    ctx.stroke();

    /* 上端のフェード：不可視バッファとの境界をなじませる */
    const top = ctx.createLinearGradient(0, 0, 0, CELL * 1.6);
    top.addColorStop(0, "rgba(34,232,255,.14)");
    top.addColorStop(1, "rgba(34,232,255,0)");
    ctx.fillStyle = top;
    ctx.fillRect(0, 0, W, CELL * 1.6);
  }

  /* --- 固定済みブロック（消去中の行は飛ばす） --- */
  function drawStack(ctx, board, skip){
    for(let y = HIDDEN; y < GRID_ROWS; y++){
      if(skip && skip.has(y)) continue;
      const row = board.grid[y];
      const py = (y - HIDDEN) * CELL;
      for(let x = 0; x < COLS; x++){
        if(row[x]) stampBlock(ctx, x * CELL, py, CELL, row[x], "pale");
      }
    }
  }

  /* --- 消去中の行：白く光って横に潰れる --- */
  function drawClearing(ctx, board, rows, t){
    const flash = t < .35 ? 1 : Math.max(0, 1 - (t - .35) / .65);
    const squeeze = t < .35 ? 1 : 1 - (t - .35) / .65;

    for(const y of rows){
      const py = (y - HIDDEN) * CELL;
      const h  = CELL * squeeze;
      const oy = py + (CELL - h) / 2;

      ctx.save();
      ctx.globalAlpha = flash;
      ctx.shadowColor = "#ffffff";
      ctx.shadowBlur = 26 * flash;
      ctx.fillStyle = "rgba(255,255,255," + (.35 + .55 * flash) + ")";
      ctx.fillRect(0, oy, W, h);
      ctx.restore();

      /* 左右に散る光の筋 */
      ctx.save();
      ctx.globalAlpha = flash * .6;
      const g = ctx.createLinearGradient(0, 0, W, 0);
      g.addColorStop(0,  "rgba(34,232,255,0)");
      g.addColorStop(.5, "rgba(255,47,208,.9)");
      g.addColorStop(1,  "rgba(34,232,255,0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, oy - 2, W, h + 4);
      ctx.restore();
    }
  }

  /* --- ハードドロップの残像 --- */
  function drawTrail(ctx, trail){
    if(!trail || trail.t >= 1) return;
    const fade = 1 - trail.t;
    ctx.save();
    ctx.globalAlpha = fade * .55;
    for(const [x, yFrom, yTo] of trail.columns){
      const py0 = (yFrom - HIDDEN) * CELL;
      const py1 = (yTo   - HIDDEN) * CELL;
      if(py1 <= py0) continue;
      const g = ctx.createLinearGradient(0, py0, 0, py1);
      g.addColorStop(0, hexA(trail.color, 0));
      g.addColorStop(1, hexA(trail.color, .85));
      ctx.fillStyle = g;
      ctx.fillRect(x * CELL + CELL * .22, py0, CELL * .56, py1 - py0);
    }
    ctx.restore();
  }

  /* --- 操作中のミノとゴースト --- */
  function drawPiece(ctx, cells, type, variant, alpha){
    for(const [x, y] of cells){
      if(y < HIDDEN) continue;            // 不可視バッファは描かない
      stampBlock(ctx, x * CELL, (y - HIDDEN) * CELL, CELL, type, variant, alpha);
    }
  }

  /* --- 積み上がり警告：上部が埋まってくると赤く脈打つ --- */
  function drawDanger(ctx, board, time){
    let top = GRID_ROWS;
    for(let y = HIDDEN; y < GRID_ROWS; y++){
      let any = false;
      for(let x = 0; x < COLS; x++) if(board.grid[y][x]){ any = true; break; }
      if(any){ top = y; break; }
    }
    const height = GRID_ROWS - top;
    if(height < ROWS - 4) return;

    const intensity = Math.min(1, (height - (ROWS - 4)) / 4);
    const pulse = .35 + .35 * Math.sin(time / 160);
    ctx.save();
    ctx.globalAlpha = intensity * pulse;
    const g = ctx.createLinearGradient(0, 0, 0, CELL * 5);
    g.addColorStop(0, "rgba(255,59,92,.85)");
    g.addColorStop(1, "rgba(255,59,92,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, CELL * 5);
    ctx.restore();
  }

  /* ------------------------------------------------------------
     盤面ひとまとめ
     ------------------------------------------------------------ */
  function renderBoard(state){
    const ctx = fitCanvas(dom.board, W, H);
    drawField(ctx, state.level);

    const skip = state.clearing ? new Set(state.clearing.rows) : null;
    drawStack(ctx, state.board, skip);
    if(state.clearing) drawClearing(ctx, state.board, state.clearing.rows, state.clearing.t);
    drawTrail(ctx, state.trail);

    if(state.piece && !state.clearing){
      const P = NEON.piece;
      const gy = P.ghostY(state.board, state.piece);
      if(gy !== state.piece.y){
        drawPiece(ctx, P.cellsAt(state.piece.type, state.piece.rot, state.piece.x, gy),
                  state.piece.type, "ghost");
      }
      /* ロック猶予中は明滅させて「そろそろ固定される」ことを伝える */
      let alpha = 1;
      if(state.lockProgress > 0) alpha = 1 - .35 * state.lockProgress;
      drawPiece(ctx, P.cellsOf(state.piece), state.piece.type, "solid", alpha);
    }

    drawDanger(ctx, state.board, state.time);
  }

  /* ------------------------------------------------------------
     プレビュー（NEXT / HOLD）
     ------------------------------------------------------------ */
  function drawPreview(ctx, type, cx, cy, size, dim){
    const rel = PIECES[type].cells[0];
    let minX = 9, maxX = -9, minY = 9, maxY = -9;
    for(const [x, y] of rel){
      if(x < minX) minX = x; if(x > maxX) maxX = x;
      if(y < minY) minY = y; if(y > maxY) maxY = y;
    }
    const w = (maxX - minX + 1) * size;
    const h = (maxY - minY + 1) * size;
    const ox = cx - w / 2 - minX * size;
    const oy = cy - h / 2 - minY * size;

    for(const [x, y] of rel){
      stampBlock(ctx, ox + x * size, oy + y * size, size, type, dim ? "ghost" : "solid");
    }
  }

  let nextKey = null, holdKey = null;

  function renderNext(queue){
    const key = queue.join(",");
    if(key === nextKey && !measureDirty) return;
    nextKey = key;

    const LW = 120, LH = 380;
    const ctx = fitCanvas(dom.next, LW, LH);
    ctx.clearRect(0, 0, LW, LH);

    const slot = LH / NEXT_COUNT;
    for(let i = 0; i < queue.length && i < NEXT_COUNT; i++){
      const size = i === 0 ? 20 : 16;
      drawPreview(ctx, queue[i], LW / 2, slot * i + slot / 2, size, false);
      if(i > 0){
        ctx.save();
        ctx.globalAlpha = .25;
        ctx.strokeStyle = "rgba(120,220,255,.5)";
        ctx.beginPath();
        ctx.moveTo(14, slot * i + .5); ctx.lineTo(LW - 14, slot * i + .5);
        ctx.stroke();
        ctx.restore();
      }
    }
  }

  function renderHold(type, used){
    const key = String(type) + ":" + used;
    if(key === holdKey && !measureDirty) return;
    holdKey = key;

    const LW = 120, LH = 90;
    const ctx = fitCanvas(dom.hold, LW, LH);
    ctx.clearRect(0, 0, LW, LH);
    if(!type){
      ctx.save();
      ctx.globalAlpha = .3;
      ctx.strokeStyle = "rgba(120,220,255,.6)";
      ctx.setLineDash([4, 4]);
      ctx.strokeRect(26.5, 20.5, LW - 53, LH - 41);
      ctx.restore();
      return;
    }
    drawPreview(ctx, type, LW / 2, LH / 2, 20, used);
  }

  /* 新しいゲームを始めるときは、変化検知のキャッシュを捨てる */
  function invalidate(){ nextKey = holdKey = null; }

  return { renderBoard, renderNext, renderHold, endFrame, invalidate };
}

NEON.createRenderer = createRenderer;

})();
