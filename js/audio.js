/* ============================================================
   audio.js — Web Audio API で効果音と BGM をその場で合成する
     外部の音声ファイルは一切使わない。
     ブラウザの自動再生制限があるため、AudioContext は最初の
     キー入力（unlock()）まで作らない。
   ============================================================ */
(function(){
"use strict";

const NEON = window.NEON = window.NEON || {};

function createAudio(){
  let ctx = null;
  let master = null, sfxBus = null, bgmBus = null;
  let muted = false;
  let noiseBuffer = null;

  /* --- BGM スケジューラの状態 --- */
  let playing = false;
  let timer = null;
  let step = 0;
  let nextTime = 0;
  let bpm = 104;

  const LOOKAHEAD = 0.12;   // 何秒先まで予約するか
  const TICK = 25;          // スケジューラの起動間隔 (ms)

  function midi(n){ return 440 * Math.pow(2, (n - 69) / 12); }

  /* ------------------------------------------------------------
     初期化（最初のユーザー操作で呼ばれる）
     ------------------------------------------------------------ */
  function unlock(){
    if(!ctx){
      const AC = window.AudioContext || window.webkitAudioContext;
      if(!AC) return false;
      ctx = new AC();

      master = ctx.createGain();
      master.gain.value = muted ? 0 : 1;
      master.connect(ctx.destination);

      sfxBus = ctx.createGain();
      sfxBus.gain.value = .5;
      sfxBus.connect(master);

      bgmBus = ctx.createGain();
      bgmBus.gain.value = .001;
      bgmBus.connect(master);

      /* ホワイトノイズ（ハイハットとドロップ音に使う） */
      const len = Math.floor(ctx.sampleRate * .5);
      noiseBuffer = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = noiseBuffer.getChannelData(0);
      for(let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    }
    if(ctx.state === "suspended") ctx.resume();
    return true;
  }

  function setMuted(v){
    muted = !!v;
    if(master) master.gain.setTargetAtTime(muted ? 0 : 1, ctx.currentTime, .02);
  }

  /* ------------------------------------------------------------
     音色ひとつぶん
     ------------------------------------------------------------ */
  function tone(opt){
    if(!ctx || muted) return;
    const t0 = ctx.currentTime + (opt.delay || 0);
    const dur = opt.dur || .12;

    const osc = ctx.createOscillator();
    osc.type = opt.type || "square";
    osc.frequency.setValueAtTime(opt.freq, t0);
    if(opt.to) osc.frequency.exponentialRampToValueAtTime(Math.max(20, opt.to), t0 + dur);

    const gain = ctx.createGain();
    const peak = opt.gain === undefined ? .25 : opt.gain;
    const atk = opt.attack === undefined ? .004 : opt.attack;
    gain.gain.setValueAtTime(.0001, t0);
    gain.gain.exponentialRampToValueAtTime(peak, t0 + atk);
    gain.gain.exponentialRampToValueAtTime(.0001, t0 + dur);

    let node = osc;
    if(opt.cutoff){
      const f = ctx.createBiquadFilter();
      f.type = opt.filterType || "lowpass";
      f.frequency.setValueAtTime(opt.cutoff, t0);
      if(opt.cutoffTo) f.frequency.exponentialRampToValueAtTime(Math.max(40, opt.cutoffTo), t0 + dur);
      f.Q.value = opt.q || 1;
      osc.connect(f); node = f;
    }
    node.connect(gain);
    gain.connect(opt.bus || sfxBus);

    osc.start(t0);
    osc.stop(t0 + dur + .02);
  }

  function noise(opt){
    if(!ctx || muted) return;
    const t0 = ctx.currentTime + (opt.delay || 0);
    const dur = opt.dur || .1;

    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer;

    const f = ctx.createBiquadFilter();
    f.type = opt.filterType || "highpass";
    f.frequency.setValueAtTime(opt.cutoff || 2000, t0);
    if(opt.cutoffTo) f.frequency.exponentialRampToValueAtTime(Math.max(40, opt.cutoffTo), t0 + dur);
    f.Q.value = opt.q || 1;

    const gain = ctx.createGain();
    const peak = opt.gain === undefined ? .18 : opt.gain;
    gain.gain.setValueAtTime(.0001, t0);
    gain.gain.exponentialRampToValueAtTime(peak, t0 + .004);
    gain.gain.exponentialRampToValueAtTime(.0001, t0 + dur);

    src.connect(f); f.connect(gain); gain.connect(opt.bus || sfxBus);
    src.start(t0);
    src.stop(t0 + dur + .02);
  }

  /* ------------------------------------------------------------
     効果音
     ------------------------------------------------------------ */
  const sfx = {
    move(){   tone({ type:"square",   freq:760, dur:.035, gain:.06 }); },
    rotate(){ tone({ type:"triangle", freq:420, to:880, dur:.075, gain:.13 }); },
    hold(){   tone({ type:"sine",     freq:620, to:940, dur:.1,  gain:.14 }); },
    lock(){
      tone({ type:"triangle", freq:200, to:90, dur:.09, gain:.16 });
      noise({ cutoff:1400, cutoffTo:500, dur:.05, gain:.06 });
    },
    hardDrop(){
      tone({ type:"sawtooth", freq:180, to:44, dur:.17, gain:.22, cutoff:1600, cutoffTo:220 });
      noise({ cutoff:5200, cutoffTo:700, dur:.13, gain:.16 });
    },
    wall(){ tone({ type:"square", freq:150, dur:.04, gain:.05 }); },

    /* n ライン消去。行数が増えるほど音数と華やかさが増す */
    clear(n, special){
      const base = [0, 4, 7, 12, 16, 19];
      const root = special ? 64 : 60;
      const count = Math.min(base.length, n + 2);
      for(let i = 0; i < count; i++){
        tone({
          type: special ? "sawtooth" : "square",
          freq: midi(root + base[i]),
          dur: .16, gain: .13, delay: i * .045,
          cutoff: 3200, cutoffTo: 1400
        });
      }
      if(n >= 4 || special){
        noise({ cutoff:600, cutoffTo:7000, filterType:"bandpass", q:.7, dur:.5, gain:.1 });
      }
    },

    /* 4ライン同時消し */
    tetris(){
      [64, 68, 71, 76].forEach((n, i) => {
        tone({ type:"sawtooth", freq:midi(n), dur:.55, gain:.12, delay:i * .035,
               cutoff:900, cutoffTo:4200, q:3 });
      });
      tone({ type:"sine", freq:midi(40), to:midi(28), dur:.6, gain:.22 });
    },

    combo(n){
      tone({ type:"square", freq:midi(72 + Math.min(n, 10)), dur:.09, gain:.1, delay:.02 });
    },

    levelUp(){
      [60, 64, 67, 72, 76].forEach((n, i) => {
        tone({ type:"triangle", freq:midi(n), dur:.22, gain:.15, delay:i * .07,
               cutoff:2600 });
      });
    },

    gameOver(){
      [62, 57, 53, 48, 41].forEach((n, i) => {
        tone({ type:"sawtooth", freq:midi(n), dur:.5, gain:.16, delay:i * .16,
               cutoff:1800, cutoffTo:300, q:2 });
      });
      noise({ cutoff:3000, cutoffTo:120, dur:1.1, gain:.09, delay:.2 });
    },

    start(){
      [48, 55, 60, 67].forEach((n, i) => {
        tone({ type:"square", freq:midi(n), dur:.16, gain:.14, delay:i * .06 });
      });
    },

    pause(){ tone({ type:"sine", freq:520, to:260, dur:.13, gain:.13 }); }
  };

  /* ------------------------------------------------------------
     BGM
       Am - F - C - G の 4 小節ループ。
       ベース（矩形波＋ローパス）、アルペジオ、ハイハットの 3 声。
     ------------------------------------------------------------ */
  const PROG = [
    { bass:45, chord:[69, 72, 76] },   // Am
    { bass:41, chord:[65, 69, 72] },   // F
    { bass:36, chord:[64, 67, 72] },   // C
    { bass:43, chord:[67, 71, 74] }    // G
  ];
  const BASS_STEPS = [0, 3, 6, 8, 11, 14];
  const HAT_STEPS  = [2, 6, 10, 14];

  function scheduleStep(s, time){
    const bar = Math.floor(s / 16) % PROG.length;
    const i   = s % 16;
    const ch  = PROG[bar];

    if(BASS_STEPS.indexOf(i) >= 0){
      tone({ type:"square", freq:midi(ch.bass), dur:.19, gain:.2,
             cutoff:420, cutoffTo:180, q:6, bus:bgmBus,
             delay: time - ctx.currentTime });
    }

    if(i % 2 === 0){
      const note = ch.chord[(i / 2) % ch.chord.length] + (i >= 8 ? 12 : 0);
      tone({ type:"sawtooth", freq:midi(note), dur:.13, gain:.075,
             cutoff:2400, cutoffTo:900, q:4, bus:bgmBus,
             delay: time - ctx.currentTime });
    }

    if(HAT_STEPS.indexOf(i) >= 0){
      noise({ cutoff:7000, dur:.035, gain:.045, bus:bgmBus,
              delay: time - ctx.currentTime });
    }
  }

  function scheduler(){
    if(!ctx || !playing) return;
    const stepDur = 60 / bpm / 4;      // 16分音符の長さ
    while(nextTime < ctx.currentTime + LOOKAHEAD){
      if(nextTime >= ctx.currentTime) scheduleStep(step, nextTime);
      nextTime += stepDur;
      step = (step + 1) % (16 * PROG.length);
    }
  }

  function startBgm(){
    if(!ctx || playing) return;
    playing = true;
    step = 0;
    nextTime = ctx.currentTime + .06;
    bgmBus.gain.cancelScheduledValues(ctx.currentTime);
    bgmBus.gain.setValueAtTime(.001, ctx.currentTime);
    bgmBus.gain.exponentialRampToValueAtTime(.5, ctx.currentTime + .8);
    timer = setInterval(scheduler, TICK);
    scheduler();
  }

  function stopBgm(){
    if(!playing) return;
    playing = false;
    clearInterval(timer);
    timer = null;
    if(ctx) bgmBus.gain.setTargetAtTime(.001, ctx.currentTime, .08);
  }

  /* ポーズ中は音量だけ落とし、再開時に位相のずれを感じさせない */
  function duckBgm(on){
    if(!ctx) return;
    bgmBus.gain.setTargetAtTime(on ? .06 : (playing ? .5 : .001), ctx.currentTime, .06);
  }

  /* レベルが上がるほどテンポを上げて緊張感を出す */
  function setLevel(level){
    bpm = Math.min(104 + (level - 1) * 5, 168);
  }

  return {
    unlock, setMuted, sfx, startBgm, stopBgm, duckBgm, setLevel,
    get ready(){ return !!ctx; },
    get muted(){ return muted; }
  };
}

NEON.createAudio = createAudio;

})();
