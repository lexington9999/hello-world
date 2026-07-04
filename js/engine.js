/* ══════════════════════════════════════════════════════════════
   engine.js — Stockfish WASM wrapper + move evaluation
══════════════════════════════════════════════════════════════ */

const Engine = (() => {
  let worker = null;
  let ready  = false;
  let busy   = false;
  let currentCallback = null;
  let pendingLines = [];
  let multiPV = 3;
  let depth   = 15;
  let skillLevel = 10;

  // CDN stockfish
  const STOCKFISH_CDN =
    'https://cdnjs.cloudflare.com/ajax/libs/stockfish.js/10.0.2/stockfish.js';

  function init(onReady) {
    try {
      worker = new Worker(STOCKFISH_CDN);
    } catch(e) {
      // Fallback: create blob worker
      console.warn('Direct Worker failed, trying blob…', e);
      try {
        const blob = new Blob([`importScripts('${STOCKFISH_CDN}');`],
          {type:'application/javascript'});
        worker = new Worker(URL.createObjectURL(blob));
      } catch(e2) {
        console.error('Stockfish load failed:', e2);
        if (onReady) onReady(false);
        return;
      }
    }

    worker.onmessage = (e) => {
      const line = e.data;
      handleMessage(line);
    };
    worker.onerror = (e) => {
      console.error('Engine error:', e);
      ready = false;
    };

    worker.postMessage('uci');
    setTimeout(() => {
      if (!ready && onReady) {
        // Engine didn't respond — treat as unavailable
        onReady(false);
      }
    }, 5000);

    function handleMessage(line) {
      if (line === 'uciok') {
        worker.postMessage('setoption name MultiPV value 3');
        worker.postMessage(`setoption name Skill Level value ${skillLevel}`);
        worker.postMessage('isready');
        return;
      }
      if (line === 'readyok') {
        ready = true;
        if (onReady) onReady(true);
        return;
      }

      // Parse info lines
      if (line.startsWith('info') && line.includes('score') && line.includes('pv')) {
        const parsed = parseInfo(line);
        if (parsed) {
          // Slot into pendingLines by multipv index
          const idx = (parsed.multipv || 1) - 1;
          pendingLines[idx] = parsed;
        }
      }

      // Best move — analysis complete
      if (line.startsWith('bestmove')) {
        busy = false;
        const parts = line.split(' ');
        const bestMove = parts[1];
        if (currentCallback) {
          currentCallback({ lines: [...pendingLines], bestMove });
          currentCallback = null;
        }
      }
    }
  }

  function parseInfo(line) {
    try {
      const multipvM = line.match(/multipv\s+(\d+)/);
      const depthM   = line.match(/\bdepth\s+(\d+)/);
      const scoreM   = line.match(/score\s+(cp|mate)\s+(-?\d+)/);
      const pvM      = line.match(/\bpv\s+(.+?)(?:\s+bm|\s+$)/);

      if (!scoreM || !pvM) return null;

      const scoreType = scoreM[1];
      const scoreVal  = parseInt(scoreM[2]);
      let score;
      if (scoreType === 'mate') {
        score = scoreVal > 0 ? `+M${scoreVal}` : `-M${Math.abs(scoreVal)}`;
      } else {
        const pawns = (scoreVal / 100).toFixed(2);
        score = scoreVal >= 0 ? `+${pawns}` : `${pawns}`;
      }

      return {
        multipv: multipvM ? parseInt(multipvM[1]) : 1,
        depth:   depthM   ? parseInt(depthM[1])  : 0,
        score,
        scoreRaw: scoreType === 'cp' ? scoreVal : (scoreVal > 0 ? 99999 : -99999),
        moves: pvM[1].trim().split(' ').slice(0, 6).join(' ')
      };
    } catch(e) { return null; }
  }

  function analyze(fen, opts = {}) {
    return new Promise((resolve) => {
      if (!ready || !worker) { resolve(null); return; }
      if (busy) { worker.postMessage('stop'); busy = false; }

      const d = opts.depth || depth;
      const mv = opts.multiPV || multiPV;

      pendingLines = [];
      busy = true;
      currentCallback = resolve;

      worker.postMessage(`setoption name MultiPV value ${mv}`);
      worker.postMessage(`setoption name Skill Level value ${skillLevel}`);
      worker.postMessage(`position fen ${fen}`);
      worker.postMessage(`go depth ${d}`);
    });
  }

  function stop() {
    if (worker && busy) {
      worker.postMessage('stop');
      busy = false;
    }
  }

  function setDepth(d) { depth = d; }
  function setSkill(s) {
    skillLevel = s;
    if (worker && ready) {
      worker.postMessage(`setoption name Skill Level value ${s}`);
    }
  }
  function isReady() { return ready; }

  // ── Move quality classification ─────────────────────────
  // prevScore: engine score BEFORE the move (from engine's perspective for side to move)
  // afterScore: engine score AFTER the move (negated, from same side's perspective)
  // Returns: {quality, label, badge, cssClass, emoji}
  function classifyMove(prevScore, afterScore, isCapture, isCheck) {
    const delta = afterScore - prevScore; // negative = lost centipawns

    let quality, label, badge, cssClass;

    if (delta >= 100)        { quality='brilliant'; label='Brilliant!!';  badge='!!'; cssClass='qual-brilliant'; }
    else if (delta >= 30)    { quality='great';     label='Great!';       badge='!';  cssClass='qual-great'; }
    else if (delta >= -10)   { quality='best';      label='Best';         badge='✓';  cssClass='qual-best'; }
    else if (delta >= -30)   { quality='good';      label='Good';         badge='≈';  cssClass='qual-good'; }
    else if (delta >= -80)   { quality='inaccuracy';label='Inaccuracy';   badge='?';  cssClass='qual-inaccuracy'; }
    else if (delta >= -200)  { quality='mistake';   label='Mistake';      badge='??'; cssClass='qual-mistake'; }
    else                     { quality='blunder';   label='Blunder!';     badge='✗';  cssClass='qual-blunder'; }

    return { quality, label, badge, cssClass };
  }

  // Convert engine score from white's perspective to a 0-100 percentage for the eval bar
  function scoreToBarPercent(rawCp, sideToMove) {
    // Clamp to ±1000 cp range
    const clamped = Math.max(-1000, Math.min(1000, rawCp));
    // Sigmoid
    const pct = 1 / (1 + Math.exp(-clamped / 300));
    return pct * 100;
  }

  return {
    init, analyze, stop, setDepth, setSkill, isReady,
    classifyMove, scoreToBarPercent
  };
})();
