/* ============================================================
   storage.js — localStorage へのハイスコア・設定の保存
     プライベートブラウジング等で localStorage が使えない環境でも
     ゲームが動くよう、例外は握りつぶしてメモリ上の値だけを使う。
   ============================================================ */
(function(){
"use strict";

const NEON = window.NEON = window.NEON || {};
const KEY = "neon-drop-v1";

const DEFAULTS = {
  best:  { score:0, lines:0, level:1 },
  muted: false
};

let state = clone(DEFAULTS);

function clone(o){ return JSON.parse(JSON.stringify(o)); }

function load(){
  try{
    const raw = localStorage.getItem(KEY);
    if(raw){
      const parsed = JSON.parse(raw);
      if(parsed && typeof parsed === "object"){
        if(parsed.best && typeof parsed.best.score === "number"){
          state.best = {
            score: parsed.best.score | 0,
            lines: parsed.best.lines | 0,
            level: Math.max(1, parsed.best.level | 0)
          };
        }
        state.muted = !!parsed.muted;
      }
    }
  }catch(e){ /* 読めない環境では初期値のまま続行 */ }
  return state;
}

function persist(){
  try{ localStorage.setItem(KEY, JSON.stringify(state)); }
  catch(e){ /* 保存できなくてもゲームは続行する */ }
}

/* 記録更新なら保存して true を返す */
function saveBest(stats){
  if(stats.score <= state.best.score) return false;
  state.best = { score:stats.score, lines:stats.lines, level:stats.level };
  persist();
  return true;
}

function saveMuted(flag){
  state.muted = !!flag;
  persist();
}

NEON.storage = {
  load,
  saveBest,
  saveMuted,
  get best(){ return state.best; },
  get muted(){ return state.muted; }
};

})();
