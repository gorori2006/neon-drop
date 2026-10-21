/* ============================================================
   board.js — 盤面グリッドと、衝突・固定・ライン消去のロジック
     グリッドの各セルは null（空）か、テトロミノの種類 "I".."L"。
     座標は左上原点、y は下方向が正。上から HIDDEN 行は不可視。
   ============================================================ */
(function(){
"use strict";

const NEON = window.NEON = window.NEON || {};
const { COLS, GRID_ROWS, HIDDEN } = NEON.config;

function createBoard(){
  const grid = [];

  function reset(){
    grid.length = 0;
    for(let y = 0; y < GRID_ROWS; y++) grid.push(new Array(COLS).fill(null));
  }

  /* 指定セルの内容。盤外は undefined */
  function at(x, y){
    if(x < 0 || x >= COLS || y < 0 || y >= GRID_ROWS) return undefined;
    return grid[y][x];
  }

  /* そのセルにミノを置けないなら true（壁・床・既存ブロック）
     天井より上（y < 0）は通り抜け可能として扱う */
  function blocked(x, y){
    if(x < 0 || x >= COLS) return true;
    if(y >= GRID_ROWS) return true;
    if(y < 0) return false;
    return grid[y][x] !== null;
  }

  /* 絶対座標の [x,y] 配列が盤面と衝突するか */
  function collides(cells){
    for(let i = 0; i < cells.length; i++){
      if(blocked(cells[i][0], cells[i][1])) return true;
    }
    return false;
  }

  /* ミノを盤面に固定する */
  function lock(cells, type){
    for(let i = 0; i < cells.length; i++){
      const x = cells[i][0], y = cells[i][1];
      if(y >= 0 && y < GRID_ROWS && x >= 0 && x < COLS) grid[y][x] = type;
    }
  }

  /* 揃っている行の index を上から順に返す */
  function fullLines(){
    const rows = [];
    for(let y = 0; y < GRID_ROWS; y++){
      let full = true;
      for(let x = 0; x < COLS; x++){
        if(grid[y][x] === null){ full = false; break; }
      }
      if(full) rows.push(y);
    }
    return rows;
  }

  /* 指定行を取り除き、上の行を落とす */
  function removeLines(rows){
    if(!rows.length) return;
    const doomed = new Set(rows);
    const kept = [];
    for(let y = 0; y < GRID_ROWS; y++){
      if(!doomed.has(y)) kept.push(grid[y]);
    }
    while(kept.length < GRID_ROWS) kept.unshift(new Array(COLS).fill(null));
    for(let y = 0; y < GRID_ROWS; y++) grid[y] = kept[y];
  }

  /* 不可視バッファにブロックが残っているか（トップアウト判定の補助） */
  function overflowed(){
    for(let y = 0; y < HIDDEN; y++){
      for(let x = 0; x < COLS; x++) if(grid[y][x] !== null) return true;
    }
    return false;
  }

  /* 盤面に残っているブロック数（ゲームオーバー演出用） */
  function filledCount(){
    let n = 0;
    for(let y = 0; y < GRID_ROWS; y++)
      for(let x = 0; x < COLS; x++) if(grid[y][x] !== null) n++;
    return n;
  }

  reset();

  return { grid, reset, at, blocked, collides, lock, fullLines, removeLines, overflowed, filledCount };
}

NEON.createBoard = createBoard;

})();
