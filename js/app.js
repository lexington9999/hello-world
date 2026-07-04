/* ══════════════════════════════════════════════════════════════
   app.js — Main application controller
   Orchestrates Board, Engine, Trainer, PDFReader
══════════════════════════════════════════════════════════════ */

// ─────────────────────────────────────────────────────────────
// App — main controller
// ─────────────────────────────────────────────────────────────
const App = (() => {

  let game = null;          // chess.js instance
  let history = [];         // [{san, from, to, quality, scoreBefore, scoreAfter, fen}]
  let historyIdx = -1;      // current position in history (for navigation)
  let pendingAnalysis = null;
  let lastScore = 0;        // engine score before move (white pov, cp)
  let mode = 'free';
  let playAs = 'both';      // both | white | black
  let autoAnalysis = true;
  let engineAvailable = false;
  let isEngineThinking = false;
  let currentBestMove = null;
  let pdfExtractedMoves = [];
  let pdfLoadedGame = [];
  let pdfPlayIdx = 0;
  let soundEnabled = true;

  // AudioContext for sound effects
  let audioCtx = null;
  function getAudio() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    return audioCtx;
  }

  function playSound(type) {
    if (!soundEnabled) return;
    try {
      const ac = getAudio();
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      osc.connect(gain);
      gain.connect(ac.destination);

      if (type === 'move') {
        osc.frequency.setValueAtTime(440, ac.currentTime);
        osc.frequency.exponentialRampToValueAtTime(660, ac.currentTime + 0.05);
        gain.gain.setValueAtTime(0.15, ac.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.12);
        osc.start(); osc.stop(ac.currentTime + 0.12);
      } else if (type === 'capture') {
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(200, ac.currentTime);
        osc.frequency.exponentialRampToValueAtTime(80, ac.currentTime + 0.15);
        gain.gain.setValueAtTime(0.2, ac.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.18);
        osc.start(); osc.stop(ac.currentTime + 0.18);
      } else if (type === 'check') {
        osc.type = 'square';
        osc.frequency.setValueAtTime(880, ac.currentTime);
        gain.gain.setValueAtTime(0.1, ac.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.2);
        osc.start(); osc.stop(ac.currentTime + 0.2);
      } else if (type === 'brilliant') {
        const freqs = [523, 659, 784, 1046];
        freqs.forEach((f, i) => {
          const o2 = ac.createOscillator();
          const g2 = ac.createGain();
          o2.connect(g2); g2.connect(ac.destination);
          o2.frequency.setValueAtTime(f, ac.currentTime + i * 0.07);
          g2.gain.setValueAtTime(0.12, ac.currentTime + i * 0.07);
          g2.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + i * 0.07 + 0.15);
          o2.start(ac.currentTime + i * 0.07);
          o2.stop(ac.currentTime + i * 0.07 + 0.15);
        });
        return;
      } else if (type === 'blunder') {
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(300, ac.currentTime);
        osc.frequency.exponentialRampToValueAtTime(100, ac.currentTime + 0.4);
        gain.gain.setValueAtTime(0.15, ac.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.4);
        osc.start(); osc.stop(ac.currentTime + 0.4);
      }
    } catch(e) { /* audio not available */ }
  }

  // ── Init ─────────────────────────────────────────────────
  function init() {
    game = typeof Chess !== 'undefined' ? new Chess() : null;
    if (!game) {
      document.getElementById('splash-status').textContent = 'chess.js failed to load';
      return;
    }

    // Init engine
    document.getElementById('splash-status').textContent = 'Loading Stockfish engine…';

    Engine.init((ok) => {
      engineAvailable = ok;
      document.getElementById('splash-status').textContent =
        ok ? 'Engine ready!' : 'Playing without engine analysis';

      setTimeout(hideSplash, ok ? 600 : 1500);
    });

    // Splash progress timeout
    setTimeout(() => {
      if (document.getElementById('splash').style.display !== 'none' &&
          !document.getElementById('splash').classList.contains('hidden')) {
        hideSplash();
      }
    }, 5000);

    Board.init();
    bindUI();
    render();
  }

  function hideSplash() {
    const splash = document.getElementById('splash');
    splash.style.opacity = '0';
    splash.style.transition = 'opacity 0.5s ease';
    setTimeout(() => {
      splash.classList.add('hidden');
      document.getElementById('app').classList.remove('hidden');
      Board.render(getPosition());
    }, 500);
  }

  // ── UI binding ───────────────────────────────────────────
  function bindUI() {
    // Board controls
    document.getElementById('btn-flip').addEventListener('click', () => {
      Board.flip();
      Board.render(getPosition());
    });
    document.getElementById('btn-settings').addEventListener('click', () => {
      document.getElementById('settings-modal').classList.remove('hidden');
    });
    document.getElementById('btn-close-settings').addEventListener('click', () => {
      document.getElementById('settings-modal').classList.add('hidden');
    });
    document.getElementById('btn-new').addEventListener('click', newGame);
    document.getElementById('btn-takeback').addEventListener('click', takeback);
    document.getElementById('btn-start').addEventListener('click', goToStart);
    document.getElementById('btn-prev').addEventListener('click', goToPrev);
    document.getElementById('btn-next').addEventListener('click', goToNext);
    document.getElementById('btn-end').addEventListener('click', goToEnd);
    document.getElementById('btn-analyze').addEventListener('click', triggerAnalysis);
    document.getElementById('btn-hint').addEventListener('click', showHint);

    // Mode tabs
    document.querySelectorAll('.mode-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.mode-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        mode = tab.dataset.mode;
        handleModeChange(mode);
      });
    });

    // Engine controls
    const depthSlider = document.getElementById('depth-slider');
    depthSlider.addEventListener('input', () => {
      document.getElementById('depth-label').textContent = depthSlider.value;
      Engine.setDepth(parseInt(depthSlider.value));
    });
    document.getElementById('skill-select').addEventListener('change', (e) => {
      Engine.setSkill(parseInt(e.target.value));
    });
    document.getElementById('side-select').addEventListener('change', (e) => {
      playAs = e.target.value;
    });

    // Settings
    document.getElementById('board-theme').addEventListener('change', (e) => {
      const themes = ['cosmic','emerald','ocean','fire','classic'];
      themes.forEach(t => document.body.classList.remove('theme-' + t));
      if (e.target.value !== 'cosmic') document.body.classList.add('theme-' + e.target.value);
      Board.render(getPosition());
    });
    document.getElementById('piece-set').addEventListener('change', (e) => {
      Board.setPieceSet(e.target.value);
    });
    document.getElementById('sound-toggle').addEventListener('change', (e) => {
      soundEnabled = e.target.checked;
    });
    document.getElementById('coords-toggle').addEventListener('change', () => {
      Board.render(getPosition());
    });
    document.getElementById('auto-analysis').addEventListener('change', (e) => {
      autoAnalysis = e.target.checked;
    });

    // PDF
    const pdfDrop = document.getElementById('pdf-drop');
    const pdfFile = document.getElementById('pdf-file');

    pdfDrop.addEventListener('click', () => pdfFile.click());
    pdfDrop.addEventListener('dragover', (e) => {
      e.preventDefault();
      pdfDrop.classList.add('drag-over');
    });
    pdfDrop.addEventListener('dragleave', () => pdfDrop.classList.remove('drag-over'));
    pdfDrop.addEventListener('drop', async (e) => {
      e.preventDefault();
      pdfDrop.classList.remove('drag-over');
      const f = e.dataTransfer.files[0];
      if (f && f.type === 'application/pdf') await loadPDF(f);
    });
    pdfFile.addEventListener('change', async (e) => {
      const f = e.target.files[0];
      if (f) await loadPDF(f);
    });

    document.getElementById('pdf-prev').addEventListener('click', async () => {
      await PDFReader.prevPage();
    });
    document.getElementById('pdf-next').addEventListener('click', async () => {
      await PDFReader.nextPage();
    });
    document.getElementById('btn-extract-moves').addEventListener('click', extractPDFMoves);
    document.getElementById('btn-load-pdf-game').addEventListener('click', loadPDFGame);

    // Close modal on backdrop click
    document.getElementById('settings-modal').addEventListener('click', (e) => {
      if (e.target === document.getElementById('settings-modal')) {
        document.getElementById('settings-modal').classList.add('hidden');
      }
    });

    // Window resize
    window.addEventListener('resize', () => {
      setTimeout(() => Board.render(getPosition()), 100);
    });
  }

  // ── Mode handling ────────────────────────────────────────
  function handleModeChange(m) {
    const pdfMovesCard = document.getElementById('pdf-moves-card');
    const pdfCard = document.getElementById('pdf-card');

    if (m === 'pdf') {
      pdfCard.classList.remove('hidden');
      showToast('📄 PDF mode: upload a chess PDF to extract moves', 'info');
    } else if (m === 'puzzle') {
      loadPuzzle(0);
    } else if (m === 'train') {
      showToast('🎓 Training mode: analysis hints enabled', 'info');
    } else {
      pdfMovesCard.classList.add('hidden');
    }
  }

  function loadPuzzle(idx) {
    const pos = Trainer.getPracticePosition(idx);
    if (!pos) return;
    game.load(pos.fen);
    history = [];
    historyIdx = -1;
    currentBestMove = pos.bestMove || null;
    Board.clearLastMove();
    Board.clearHighlights();
    Board.clearArrows();
    render();
    showToast(`🧩 ${pos.name}: ${pos.theme}`, 'info');
    const hintEl = document.getElementById('hint-text');
    hintEl.style.display = 'block';
    hintEl.textContent = `💡 ${pos.tip}`;
  }

  // ── Game state ───────────────────────────────────────────
  function getPosition() {
    if (!game) return {};
    const board = game.board();
    const pos = {};
    for (let r = 0; r < 8; r++) {
      for (let f = 0; f < 8; f++) {
        const piece = board[r][f];
        if (piece) {
          const file = String.fromCharCode(97 + f);
          const rank = 8 - r;
          pos[file + rank] = piece;
        }
      }
    }
    return pos;
  }

  function canPickUp(sq) {
    if (!game) return false;
    if (historyIdx < history.length - 1) return false; // browsing history
    const piece = game.get(sq);
    if (!piece) return false;
    if (playAs === 'both') return true;
    if (playAs === 'white' && piece.color === 'w' && game.turn() === 'w') return true;
    if (playAs === 'black' && piece.color === 'b' && game.turn() === 'b') return true;
    return false;
  }

  function getPieceAt(sq) {
    return game ? game.get(sq) : null;
  }

  function getLegalMoves(sq) {
    if (!game) return [];
    return game.moves({ square: sq, verbose: true });
  }

  async function tryMove(from, to) {
    if (!game) return;

    // Check for promotion
    let promotion = 'q';
    const piece = game.get(from);
    if (piece && piece.type === 'p') {
      const toRank = parseInt(to[1]);
      if ((piece.color === 'w' && toRank === 8) || (piece.color === 'b' && toRank === 1)) {
        promotion = 'q'; // Auto-promote to queen
      }
    }

    const fenBefore = game.fen();
    const move = game.move({ from, to, promotion });

    if (!move) {
      Board.render(getPosition());
      return;
    }

    const isCapture = move.flags.includes('c') || move.flags.includes('e');
    const isCheck   = game.in_check();

    // Sound
    if (isCheck)        playSound('check');
    else if (isCapture) playSound('capture');
    else                playSound('move');

    // Animate
    Board.setLastMove(from, to);
    Board.animateMove(move, from, to, getPosition());

    // Trim future history if we were browsing
    if (historyIdx < history.length - 1) {
      history = history.slice(0, historyIdx + 1);
    }

    const entry = {
      san: move.san,
      from, to,
      quality: null,
      badge: '',
      cssClass: '',
      scoreBefore: lastScore,
      scoreAfter: null,
      fen: game.fen(),
      fenBefore
    };
    history.push(entry);
    historyIdx = history.length - 1;

    updateMoveList();
    updateStats();
    checkGameEnd();

    // Analyse the move
    if ((engineAvailable || true) && autoAnalysis) {
      await analyzeAfterMove(entry, fenBefore, move, isCapture);
    }

    // Computer move if in vs-computer mode
    if (!game.game_over()) {
      const needsCompMove =
        (playAs === 'white' && game.turn() === 'b') ||
        (playAs === 'black' && game.turn() === 'w');
      if (needsCompMove) {
        setTimeout(makeComputerMove, 500);
      }
    }

    if (mode === 'pdf' && pdfLoadedGame.length > 0) {
      advancePDFGame(move.san);
    }
  }

  async function analyzeAfterMove(entry, fenBefore, move, isCapture) {
    if (!engineAvailable) {
      // Heuristic quality without engine
      const quality = heuristicQuality(move, game);
      applyQuality(entry, quality);
      return;
    }

    if (isEngineThinking) Engine.stop();
    isEngineThinking = true;

    // Get score before
    const resBefore = await Engine.analyze(fenBefore, { depth: parseInt(document.getElementById('depth-slider').value), multiPV: 1 });
    const scoreBefore = resBefore && resBefore.lines[0] ? (resBefore.lines[0].scoreRaw || 0) : lastScore;

    // Get score after (from the other side's perspective)
    const resCurrent = await Engine.analyze(game.fen(), {
      depth: parseInt(document.getElementById('depth-slider').value),
      multiPV: 3
    });
    isEngineThinking = false;

    if (resCurrent) {
      const scoreAfter = resCurrent.lines[0] ? -(resCurrent.lines[0].scoreRaw || 0) : 0;
      entry.scoreAfter = scoreAfter;
      currentBestMove = resCurrent.bestMove;

      // From the player's perspective
      const wasWhite = (game.turn() === 'b'); // before move was made, it was white's turn if now black's
      const delta = wasWhite
        ? (scoreAfter - scoreBefore)
        : (scoreBefore - scoreAfter);

      const quality = Engine.classifyMove(scoreBefore, scoreAfter, isCapture, game.in_check());
      applyQuality(entry, quality);
      lastScore = -scoreAfter;

      // Update eval bar
      updateEvalBar(resCurrent.lines[0]);
      // Update engine lines
      updateEngineLines(resCurrent.lines);
    }
  }

  function heuristicQuality(move, chess) {
    // Without engine: use simple heuristics
    const pieceValues = { p:1, n:3, b:3, r:5, q:9, k:0 };
    let delta = 0;
    if (move.captured) delta += (pieceValues[move.captured] || 0) * 10;
    if (move.san.includes('+')) delta += 20;
    if (move.flags.includes('p')) delta += 50; // promotion
    if (chess.in_checkmate()) delta = 999;

    // Rough heuristic
    if (delta > 80)       return { quality:'brilliant', label:'Brilliant!!', badge:'!!', cssClass:'qual-brilliant' };
    if (delta > 40)       return { quality:'great',     label:'Great!',     badge:'!',  cssClass:'qual-great' };
    if (delta >= 0)       return { quality:'good',      label:'Good',       badge:'≈',  cssClass:'qual-good' };
    if (delta >= -30)     return { quality:'inaccuracy',label:'Inaccuracy', badge:'?',  cssClass:'qual-inaccuracy' };
    return                       { quality:'mistake',   label:'Mistake',    badge:'??', cssClass:'qual-mistake' };
  }

  function applyQuality(entry, quality) {
    entry.quality   = quality.quality;
    entry.badge     = quality.badge;
    entry.cssClass  = quality.cssClass;
    entry.label     = quality.label;

    // Show badge
    showMoveBadge(quality);

    // Sound for extreme cases
    if (quality.quality === 'brilliant') {
      playSound('brilliant');
      Board.spawnParticles(entry.to, '#a855f7');
    } else if (quality.quality === 'blunder') {
      playSound('blunder');
    }

    updateMoveList();
  }

  function showMoveBadge(quality) {
    const badge = document.getElementById('move-badge');
    const icon  = document.getElementById('move-badge-icon');
    const text  = document.getElementById('move-badge-text');

    const colors = {
      brilliant: '#a855f7', great:'#60a5fa', best:'#10b981',
      good:'#6ee7b7', inaccuracy:'#fbbf24', mistake:'#f97316', blunder:'#ef4444'
    };
    const color = colors[quality.quality] || '#e2e8f0';

    icon.textContent  = quality.badge;
    text.textContent  = quality.label;
    badge.style.color = color;
    badge.style.borderColor = color;
    badge.style.boxShadow = `0 0 20px ${color}40`;
    badge.classList.remove('hidden');

    clearTimeout(badge._timeout);
    badge._timeout = setTimeout(() => {
      badge.style.opacity = '0';
      badge.style.transition = 'opacity 0.5s';
      setTimeout(() => {
        badge.classList.add('hidden');
        badge.style.opacity = '';
        badge.style.transition = '';
      }, 500);
    }, 2500);
  }

  // ── Computer move ────────────────────────────────────────
  async function makeComputerMove() {
    if (!game || game.game_over()) return;

    let moveUCI;
    if (engineAvailable) {
      isEngineThinking = true;
      const res = await Engine.analyze(game.fen(), {
        depth: parseInt(document.getElementById('depth-slider').value),
        multiPV: 1
      });
      isEngineThinking = false;
      moveUCI = res ? res.bestMove : null;
    }

    if (!moveUCI || moveUCI === '(none)') {
      // Fallback: random legal move
      const moves = game.moves({ verbose: true });
      if (moves.length === 0) return;
      const rnd = moves[Math.floor(Math.random() * moves.length)];
      moveUCI = rnd.from + rnd.to + (rnd.promotion || '');
    }

    if (moveUCI && moveUCI.length >= 4) {
      const from = moveUCI.slice(0, 2);
      const to   = moveUCI.slice(2, 4);
      const promo = moveUCI[4] || 'q';
      await tryMove(from, to);
    }
  }

  // ── Navigation ───────────────────────────────────────────
  function goToStart() {
    game.reset();
    historyIdx = -1;
    for (let i = 0; i < history.length; i++) {
      // replay up to -1 = start
    }
    replayTo(-1);
  }
  function goToPrev() { replayTo(historyIdx - 1); }
  function goToNext() { replayTo(historyIdx + 1); }
  function goToEnd()  { replayTo(history.length - 1); }

  function replayTo(idx) {
    if (!game) return;
    idx = Math.max(-1, Math.min(history.length - 1, idx));
    historyIdx = idx;
    game.reset();
    for (let i = 0; i <= idx; i++) {
      const h = history[i];
      game.move({ from: h.from, to: h.to, promotion: 'q' });
    }
    Board.clearHighlights();
    Board.clearArrows();
    if (idx >= 0) {
      Board.setLastMove(history[idx].from, history[idx].to);
    } else {
      Board.clearLastMove();
    }
    Board.render(getPosition());
    updateMoveList();
    updateStats();
    if (game.in_check()) {
      // find king square
      const pos = getPosition();
      const color = game.turn();
      for (const [sq, p] of Object.entries(pos)) {
        if (p.type === 'k' && p.color === color) { Board.setCheck(sq); break; }
      }
    } else {
      Board.clearCheck();
    }
  }

  // ── Takeback ─────────────────────────────────────────────
  function takeback() {
    if (!game || history.length === 0) return;
    game.undo();
    history.pop();
    historyIdx = history.length - 1;

    Board.clearHighlights();
    Board.clearArrows();
    Board.clearCheck();
    if (history.length > 0) {
      const last = history[history.length - 1];
      Board.setLastMove(last.from, last.to);
    } else {
      Board.clearLastMove();
    }
    Board.render(getPosition());
    updateMoveList();
    updateStats();
    showToast('↩ Move taken back', 'info');
  }

  // ── New game ─────────────────────────────────────────────
  function newGame() {
    if (!game) return;
    game.reset();
    history = [];
    historyIdx = -1;
    lastScore = 0;
    currentBestMove = null;
    Board.clearLastMove();
    Board.clearHighlights();
    Board.clearArrows();
    Board.clearCheck();
    pdfLoadedGame = [];
    pdfPlayIdx = 0;
    render();
    resetEngineUI();
    showToast('♟ New game started', 'info');
  }

  // ── Analysis ─────────────────────────────────────────────
  async function triggerAnalysis() {
    if (!engineAvailable) {
      showToast('Engine not available', 'bad');
      return;
    }
    document.getElementById('btn-analyze').textContent = '⏳ Analysing…';
    document.getElementById('btn-analyze').disabled = true;

    const res = await Engine.analyze(game.fen(), {
      depth: parseInt(document.getElementById('depth-slider').value),
      multiPV: 3
    });

    document.getElementById('btn-analyze').textContent = '⚡ Analyze Position';
    document.getElementById('btn-analyze').disabled = false;

    if (res) {
      updateEvalBar(res.lines[0]);
      updateEngineLines(res.lines);
      currentBestMove = res.bestMove;
      if (res.bestMove && res.bestMove.length >= 4) {
        const from = res.bestMove.slice(0, 2);
        const to   = res.bestMove.slice(2, 4);
        Board.setArrow(from, to, 'rgba(6,182,212,0.7)');
      }
    }
  }

  function updateEvalBar(line) {
    if (!line) return;
    const score = line.scoreRaw;
    const pct = Engine.scoreToBarPercent(score);
    const fill = document.getElementById('eval-fill');
    const label = document.getElementById('eval-label');
    fill.style.width = pct + '%';
    label.textContent = line.score;
  }

  function updateEngineLines(lines) {
    if (!lines) return;
    for (let i = 0; i < 3; i++) {
      const item = document.getElementById(`line-${i + 1}`);
      if (!item) continue;
      const l = lines[i];
      if (l) {
        item.querySelector('.line-score').textContent = l.score;
        item.querySelector('.line-moves').textContent = l.moves;
        item.style.display = '';
      } else {
        item.querySelector('.line-score').textContent = '';
        item.querySelector('.line-moves').textContent = '';
      }
    }
  }

  function resetEngineUI() {
    for (let i = 1; i <= 3; i++) {
      const item = document.getElementById(`line-${i}`);
      if (item) {
        item.querySelector('.line-score').textContent = i === 1 ? '---' : '';
        item.querySelector('.line-moves').textContent = i === 1 ? 'Waiting for analysis…' : '';
      }
    }
    document.getElementById('eval-fill').style.width = '50%';
    document.getElementById('eval-label').textContent = '0.0';
  }

  // ── Move list UI ─────────────────────────────────────────
  function updateMoveList() {
    const list = document.getElementById('move-list');
    list.innerHTML = '';

    for (let i = 0; i < history.length; i += 2) {
      const row = document.createElement('div');
      row.className = 'move-row';

      const num = document.createElement('div');
      num.className = 'move-num';
      num.textContent = Math.floor(i / 2) + 1;
      row.appendChild(num);

      for (let j = 0; j <= 1; j++) {
        const h = history[i + j];
        if (!h) break;
        const cell = document.createElement('div');
        cell.className = 'move-cell' + (j === 0 ? ' white-move' : '') +
          ((i + j === historyIdx) ? ' current' : '');

        const sanSpan = document.createElement('span');
        sanSpan.textContent = h.san;
        cell.appendChild(sanSpan);

        if (h.badge) {
          const badge = document.createElement('span');
          badge.className = 'move-qual ' + (h.cssClass || '');
          badge.textContent = h.badge;
          cell.appendChild(badge);
        }

        const idx = i + j;
        cell.addEventListener('click', () => replayTo(idx));
        row.appendChild(cell);
      }
      list.appendChild(row);
    }
    list.scrollTop = list.scrollHeight;
  }

  function updateStats() {
    if (!game) return;
    const pos = getPosition();
    const mat = Trainer.getMaterial(pos);
    const moves = Math.ceil(game.history().length / 2);
    const phase = Trainer.getPhase(moves);
    const turn  = game.turn() === 'w' ? 'White' : 'Black';

    document.getElementById('stat-material').textContent =
      mat > 0 ? `+${mat} White` : mat < 0 ? `${mat} Black` : 'Equal';
    document.getElementById('stat-phase').textContent = phase;
    document.getElementById('stat-turn').textContent  = turn;
    document.getElementById('stat-moves').textContent = moves;

    // Opening detection
    const sanHistory = history.map(h => h.san);
    const opening = Trainer.detectOpening(sanHistory);
    if (opening) {
      document.getElementById('stat-phase').textContent = opening.name;
    }

    // Player card highlight
    document.getElementById('card-white').classList.toggle('active', game.turn() === 'w');
    document.getElementById('card-black').classList.toggle('active', game.turn() === 'b');
  }

  function checkGameEnd() {
    if (!game.game_over()) {
      if (game.in_check()) {
        const pos = getPosition();
        const color = game.turn();
        for (const [sq, p] of Object.entries(pos)) {
          if (p.type === 'k' && p.color === color) { Board.setCheck(sq); break; }
        }
      } else {
        Board.clearCheck();
      }
      return;
    }

    Board.clearCheck();
    let msg = '♟ Game over! ';
    if (game.in_checkmate()) {
      const winner = game.turn() === 'w' ? 'Black' : 'White';
      msg += `${winner} wins by checkmate! ♛`;
      Board.spawnParticles(game.turn() === 'w' ? 'e1' : 'e8', '#f59e0b');
    } else if (game.in_stalemate())    msg += 'Stalemate — draw';
    else if (game.in_threefold_repetition()) msg += 'Draw by repetition';
    else if (game.insufficient_material())   msg += 'Draw — insufficient material';
    else if (game.in_draw())                 msg += 'Draw';
    showToast(msg, 'info');
  }

  // ── Hint ─────────────────────────────────────────────────
  async function showHint() {
    const hintEl = document.getElementById('hint-text');
    const threatEl = document.getElementById('threat-text');

    if (!engineAvailable) {
      hintEl.style.display = 'block';
      hintEl.textContent = '💡 Enable engine analysis for hints.';
      return;
    }

    if (!currentBestMove) await triggerAnalysis();

    const hint = Trainer.getHint(game.fen(), currentBestMove);
    hintEl.style.display = 'block';
    hintEl.textContent = '💡 ' + hint;

    // Show arrow
    if (currentBestMove && currentBestMove.length >= 4) {
      const from = currentBestMove.slice(0, 2);
      const to   = currentBestMove.slice(2, 4);
      Board.setArrow(from, to, 'rgba(16,185,129,0.7)');
    }

    // Threat
    const threat = Trainer.analyzeThreat(game);
    if (threat) {
      threatEl.style.display = 'block';
      threatEl.textContent = '⚠ ' + threat;
    } else {
      threatEl.style.display = 'none';
    }

    showToast('💡 Hint shown on board', 'info');
  }

  // ── PDF ──────────────────────────────────────────────────
  async function loadPDF(file) {
    showToast('📄 Loading PDF…', 'info');
    const ok = await PDFReader.loadFile(file);
    if (ok) {
      document.getElementById('pdf-page-controls').classList.remove('hidden');
      showToast(`✅ PDF loaded (${PDFReader.getPageCount()} pages)`, 'good');
    } else {
      showToast('❌ Could not load PDF', 'bad');
    }
  }

  async function extractPDFMoves() {
    showToast('🔍 Extracting moves…', 'info');
    const moves = await PDFReader.extractMovesFromAllPages();
    if (moves.length === 0) {
      showToast('No chess moves found in PDF', 'bad');
      return;
    }

    pdfExtractedMoves = moves;
    Trainer.setPdfMoves(moves);

    const listEl = document.getElementById('pdf-moves-list');
    listEl.innerHTML = '';
    moves.forEach((m, i) => {
      const span = document.createElement('span');
      span.className = 'pdf-move-item';
      span.textContent = m;
      span.addEventListener('click', () => jumpToPDFMove(i));
      listEl.appendChild(span);
    });

    document.getElementById('pdf-moves-card').classList.remove('hidden');
    showToast(`✅ Found ${moves.length} moves!`, 'good');
  }

  function jumpToPDFMove(i) {
    pdfPlayIdx = i;
    // Replay game to this move
    game.reset();
    for (let j = 0; j <= i && j < pdfExtractedMoves.length; j++) {
      const result = game.move(pdfExtractedMoves[j]);
      if (!result) { game.reset(); break; }
    }
    Board.render(getPosition());
    showToast(`Moved to position after ${pdfExtractedMoves[i]}`, 'info');
  }

  function loadPDFGame() {
    if (pdfExtractedMoves.length === 0) return;
    pdfLoadedGame = [...pdfExtractedMoves];
    pdfPlayIdx    = 0;
    newGame();

    // Load all moves into game
    let ok = true;
    for (const mv of pdfLoadedGame) {
      const result = game.move(mv);
      if (!result) { ok = false; break; }
      history.push({
        san: result.san, from: result.from, to: result.to,
        quality: null, badge: '', cssClass: ''
      });
    }
    historyIdx = history.length - 1;

    // Reset to start for study mode
    replayTo(-1);
    showToast(`📋 ${pdfLoadedGame.length} move game loaded — use ▶ to step through`, 'good');
  }

  function advancePDFGame(san) {
    if (pdfPlayIdx < pdfLoadedGame.length) {
      const expected = pdfLoadedGame[pdfPlayIdx];
      // Normalise
      if (san === expected || san.replace(/[+#]/g,'') === expected.replace(/[+#]/g,'')) {
        pdfPlayIdx++;
        showToast(`✅ Correct! Move ${pdfPlayIdx}/${pdfLoadedGame.length}`, 'good');
      } else {
        showToast(`Expected: ${expected}`, 'bad');
      }
    }
  }

  // ── Toast ────────────────────────────────────────────────
  function showToast(msg, type = 'info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = msg;
    container.appendChild(toast);
    setTimeout(() => {
      toast.classList.add('out');
      setTimeout(() => toast.remove(), 350);
    }, 2800);
  }

  // ── Render all ───────────────────────────────────────────
  function render() {
    Board.render(getPosition());
    updateMoveList();
    updateStats();
  }

  // ── Expose to Board (callback interface) ─────────────────
  return {
    init, getPosition, canPickUp, getPieceAt, getLegalMoves, tryMove, showToast
  };
})();

// Bootstrap
window.addEventListener('DOMContentLoaded', () => App.init());
