/* ============================================================
   input.js — キーボードとタッチボタンの入力
     ブラウザ標準のキーリピートは間隔が環境依存で遊びづらいため、
     e.repeat のイベントは無視し、DAS / ARR を自前のタイマーで扱う。
     画面上のボタンは data-key に対応するキーコードを持ち、
     キーボードと同じ press / release を通る。
   ============================================================ */
(function(){
"use strict";

const NEON = window.NEON = window.NEON || {};
const { DAS, ARR } = NEON.config;

function createInput(handlers){
  /* 左右移動の状態 */
  let dir = 0;              // -1 / 0 / +1：いま押している向き
  let dasUntil = 0;         // この時刻を過ぎたら連続移動を開始
  let arrNext  = 0;         // 次に 1 マス動かす時刻
  const held = { left:false, right:false };

  let softDrop = false;
  let enabled  = true;

  /* 押しっぱなしで押し直しが必要なキー（回転など）の重複防止 */
  const down = new Set();

  function startMove(d, now){
    dir = d;
    dasUntil = now + DAS;
    arrNext  = 0;
    handlers.onMove(d);
  }

  /* 左右どちらかを離したとき、もう片方が押されていればそちらに切り替える */
  function releaseMove(d, now){
    if(dir !== d) return;
    if(d === -1 && held.right)      startMove(1, now);
    else if(d === 1 && held.left)   startMove(-1, now);
    else                            dir = 0;
  }

  function onKeyDown(e){
    const code = e.code;

    if(code === "ArrowLeft" || code === "ArrowRight" || code === "ArrowDown" ||
       code === "ArrowUp"   || code === "Space"){
      e.preventDefault();   // ページのスクロールを止める
    }

    if(e.repeat) return;    // 連続移動は自前で処理する
    press(code);
  }

  function press(code){
    if(!enabled) return;
    if(down.has(code)) return;
    down.add(code);

    const now = performance.now();

    switch(code){
      case "ArrowLeft":  held.left = true;  startMove(-1, now); break;
      case "ArrowRight": held.right = true; startMove(1, now);  break;
      case "ArrowDown":  softDrop = true;   handlers.onSoftDrop(true); break;
      case "Space":      handlers.onHardDrop(); break;
      case "ArrowUp":
      case "KeyX":       handlers.onRotate(1);  break;
      case "KeyZ":
      case "ControlLeft":
      case "ControlRight": handlers.onRotate(-1); break;
      case "KeyA":       handlers.onRotate(2);  break;
      case "KeyC":
      case "ShiftLeft":
      case "ShiftRight": handlers.onHold();     break;
      case "KeyP":
      case "Escape":     handlers.onPause();    break;
      case "KeyR":       handlers.onRestart();  break;
      case "KeyM":       handlers.onMute();     break;
      case "Enter":      handlers.onHardDrop(); break;
    }
  }

  function onKeyUp(e){ release(e.code); }

  function release(code){
    down.delete(code);
    const now = performance.now();

    switch(code){
      case "ArrowLeft":  held.left = false;  releaseMove(-1, now); break;
      case "ArrowRight": held.right = false; releaseMove(1, now);  break;
      case "ArrowDown":  softDrop = false;   handlers.onSoftDrop(false); break;
    }
  }

  /* 押しっぱなしのまま画面外に行くと押下状態が残るのでリセットする */
  function onBlur(){
    down.clear();
    held.left = held.right = false;
    dir = 0;
    if(softDrop){ softDrop = false; handlers.onSoftDrop(false); }
  }

  /* 毎フレーム呼び、DAS 経過後は ARR 間隔で移動を繰り返す */
  function update(now){
    if(!dir || !enabled) return;
    if(now < dasUntil) return;
    if(!arrNext) arrNext = now;
    while(now >= arrNext){
      handlers.onMove(dir);
      arrNext += ARR;
      if(ARR <= 0) break;
    }
  }

  /* ミノが固定された直後などに、移動の連射タイミングを引き継ぐ */
  function currentDir(){ return dir; }

  /* タッチボタン：押した指を capture し、指が外へずれても離した時点で release する */
  function bindButton(btn){
    const code = btn.dataset.key;
    let pointer = null;

    btn.addEventListener("pointerdown", e => {
      e.preventDefault();
      if(pointer !== null) return;
      pointer = e.pointerId;
      try{ btn.setPointerCapture(pointer); }catch(_){}
      btn.classList.add("pressed");
      press(code);
    });

    const up = e => {
      if(e.pointerId !== pointer) return;
      pointer = null;
      btn.classList.remove("pressed");
      release(code);
    };
    btn.addEventListener("pointerup", up);
    btn.addEventListener("pointercancel", up);
    btn.addEventListener("lostpointercapture", up);
    btn.addEventListener("contextmenu", e => e.preventDefault());
  }

  document.querySelectorAll("[data-key]").forEach(bindButton);

  window.addEventListener("keydown", onKeyDown, { passive:false });
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", onBlur);

  return {
    update,
    currentDir,
    reset: onBlur,
    get softDrop(){ return softDrop; },
    set enabled(v){ enabled = v; if(!v) onBlur(); },
    get enabled(){ return enabled; }
  };
}

NEON.createInput = createInput;

})();
