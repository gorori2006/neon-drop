/* ============================================================
   piece.js — 7-bag ランダマイザ、ミノの移動・SRS回転、
              ゴースト位置の算出、T-Spin 判定
   ============================================================ */
(function(){
"use strict";

const NEON = window.NEON = window.NEON || {};
const C = NEON.config;
const { PIECES, TYPES, KICKS_I, KICKS_JLSTZ, KICKS_180, NEXT_COUNT, GRID_ROWS } = C;

/* ------------------------------------------------------------
   7-bag ランダマイザ
     7種を1セットとしてシャッフルし、使い切ったら次のセットを補充する。
     これにより同じミノが極端に偏って出続けることがなくなる。
   ------------------------------------------------------------ */
function createQueue(){
  let queue = [];

  function refill(){
    const bag = TYPES.slice();
    for(let i = bag.length - 1; i > 0; i--){
      const j = Math.floor(Math.random() * (i + 1));
      const t = bag[i]; bag[i] = bag[j]; bag[j] = t;
    }
    queue = queue.concat(bag);
  }

  function ensure(){
    while(queue.length <= NEXT_COUNT) refill();
  }

  function shift(){
    ensure();
    return queue.shift();
  }

  function peek(n){
    ensure();
    return queue.slice(0, n);
  }

  function reset(){
    queue = [];
    ensure();
  }

  reset();
  return { shift, peek, reset };
}

/* ------------------------------------------------------------
   ミノの生成と座標
   ------------------------------------------------------------ */
function spawnPiece(type){
  const def = PIECES[type];
  return { type, rot:0, x:def.spawn.x, y:def.spawn.y, lastKick:-1, lastWasRotation:false };
}

/* バウンディングボックス内の相対座標から絶対グリッド座標へ */
function cellsAt(type, rot, x, y){
  const rel = PIECES[type].cells[rot & 3];
  const out = new Array(4);
  for(let i = 0; i < 4; i++) out[i] = [x + rel[i][0], y + rel[i][1]];
  return out;
}

function cellsOf(p){ return cellsAt(p.type, p.rot, p.x, p.y); }

/* ------------------------------------------------------------
   移動：置ければ座標を更新して true
   ------------------------------------------------------------ */
function tryMove(board, p, dx, dy){
  const cells = cellsAt(p.type, p.rot, p.x + dx, p.y + dy);
  if(board.collides(cells)) return false;
  p.x += dx; p.y += dy;
  p.lastWasRotation = false;
  return true;
}

/* ------------------------------------------------------------
   回転：SRS のウォールキックを順に試す
     dir  1 = 右回転 / -1 = 左回転 / 2 = 180度回転
     成功したら true。使ったキックの index を p.lastKick に残す
     （T-Spin mini 判定で使う）。
   ------------------------------------------------------------ */
function tryRotate(board, p, dir){
  const from = p.rot & 3;
  const to   = (from + (dir === 2 ? 2 : dir) + 4) & 3;
  if(to === from) return false;

  let kicks;
  if(dir === 2)            kicks = KICKS_180;
  else if(p.type === "I")  kicks = KICKS_I[String(from) + String(to)];
  else if(p.type === "O")  kicks = [[0,0]];
  else                     kicks = KICKS_JLSTZ[String(from) + String(to)];

  for(let i = 0; i < kicks.length; i++){
    const nx = p.x + kicks[i][0];
    const ny = p.y + kicks[i][1];
    if(!board.collides(cellsAt(p.type, to, nx, ny))){
      p.rot = to; p.x = nx; p.y = ny;
      p.lastKick = i;
      p.lastWasRotation = true;
      return true;
    }
  }
  return false;
}

/* ------------------------------------------------------------
   ゴースト：現在位置から落とせるところまで落とした y
   ------------------------------------------------------------ */
function ghostY(board, p){
  let y = p.y;
  while(!board.collides(cellsAt(p.type, p.rot, p.x, y + 1))) y++;
  return y;
}

/* 接地しているか（1 マス下に動かせない） */
function isGrounded(board, p){
  return board.collides(cellsAt(p.type, p.rot, p.x, p.y + 1));
}

/* ------------------------------------------------------------
   T-Spin 判定（3コーナールール）
     T ミノの中心 (box 内 1,1) の四隅のうち 3 つ以上が埋まっていれば T-Spin。
     さらに「向いている側の 2 隅」が両方埋まっていなければ mini 扱い。
     ただし最後のキックが 5 番目（index 4）だった場合は常に通常の T-Spin。
     直前の操作が回転でなければ成立しない。
   ------------------------------------------------------------ */
const CORNERS = [[-1,-1],[1,-1],[1,1],[-1,1]];  // TL, TR, BR, BL
const FRONT   = [[0,1],[1,2],[2,3],[3,0]];      // 回転状態ごとの「正面」2隅

function detectTSpin(board, p){
  if(p.type !== "T" || !p.lastWasRotation) return "none";

  const cx = p.x + 1, cy = p.y + 1;
  const filled = CORNERS.map(([dx,dy]) => {
    const x = cx + dx, y = cy + dy;
    if(x < 0 || x >= C.COLS || y >= GRID_ROWS) return true;  // 壁・床は埋まり扱い
    if(y < 0) return false;
    return board.at(x, y) !== null;
  });

  const total = filled.reduce((n, f) => n + (f ? 1 : 0), 0);
  if(total < 3) return "none";

  const front = FRONT[p.rot & 3];
  const frontCount = (filled[front[0]] ? 1 : 0) + (filled[front[1]] ? 1 : 0);

  if(frontCount === 2) return "tspin";
  return p.lastKick === 4 ? "tspin" : "mini";
}

NEON.piece = { createQueue, spawnPiece, cellsAt, cellsOf, tryMove, tryRotate, ghostY, isGrounded, detectTSpin };

})();
