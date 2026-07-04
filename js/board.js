/* ══════════════════════════════════════════════════════════════
   board.js — Canvas chessboard renderer with neon/glow pieces
══════════════════════════════════════════════════════════════ */

const Board = (() => {
  const RANKS = 8, FILES = 8;
  const PIECE_UNICODE = {
    wK:'♔', wQ:'♕', wR:'♖', wB:'♗', wN:'♘', wP:'♙',
    bK:'♚', bQ:'♛', bR:'♜', bB:'♝', bN:'♞', bP:'♟'
  };

  let boardCanvas, pieceCanvas, overlayCanvas;
  let bCtx, pCtx, oCtx;
  let size = 0, sqSize = 0;
  let flipped = false;

  // Theme colours updated from CSS vars
  let sqLight = '#c8a2e8';
  let sqDark  = '#5b21b6';
  let pieceSet = 'neon'; // neon | classic | emoji

  // Animation state
  let animating = false;
  let animPiece = null; // { piece, fromX, fromY, toX, toY, progress }
  let animReq = null;

  // Highlights: {sq: color}
  let highlights = {};
  let legalDots = [];      // squares to show legal move dots
  let lastFrom = null, lastTo = null;
  let checkSquare = null;
  let arrowList = [];      // [{from, to, color}]

  // Drag state
  let dragging = false;
  let dragPiece = null;
  let dragX = 0, dragY = 0;
  let dragFromSq = null;

  // Particles
  let particles = [];

  function init() {
    boardCanvas   = document.getElementById('board-canvas');
    pieceCanvas   = document.getElementById('piece-canvas');
    overlayCanvas = document.getElementById('overlay-canvas');
    bCtx = boardCanvas.getContext('2d');
    pCtx = pieceCanvas.getContext('2d');
    oCtx = overlayCanvas.getContext('2d');

    resize();
    window.addEventListener('resize', resize);

    // Touch events on overlay canvas (top-most)
    overlayCanvas.addEventListener('touchstart', onTouchStart, {passive:false});
    overlayCanvas.addEventListener('touchmove',  onTouchMove,  {passive:false});
    overlayCanvas.addEventListener('touchend',   onTouchEnd,   {passive:false});
    // Mouse events (desktop / iPad pointer)
    overlayCanvas.addEventListener('mousedown',  onMouseDown);
    overlayCanvas.addEventListener('mousemove',  onMouseMove);
    overlayCanvas.addEventListener('mouseup',    onMouseUp);

    requestAnimationFrame(loop);
  }

  function resize() {
    const container = document.getElementById('board-container');
    const dim = Math.min(container.clientWidth, container.clientHeight);
    size = dim;
    sqSize = size / 8;

    for (const c of [boardCanvas, pieceCanvas, overlayCanvas]) {
      c.width  = size * devicePixelRatio;
      c.height = size * devicePixelRatio;
      c.style.width  = size + 'px';
      c.style.height = size + 'px';
      c.getContext('2d').scale(devicePixelRatio, devicePixelRatio);
    }

    readTheme();
    drawBoard();
    drawPieces(App ? App.getPosition() : null);
  }

  function readTheme() {
    const style = getComputedStyle(document.documentElement);
    sqLight  = style.getPropertyValue('--sq-light').trim() || sqLight;
    sqDark   = style.getPropertyValue('--sq-dark').trim()  || sqDark;
  }

  // ── Square helpers ──────────────────────────────────────
  function sqToXY(sq) {
    // sq = 'e4'
    const file = sq.charCodeAt(0) - 97; // a=0
    const rank = parseInt(sq[1]) - 1;    // 1=0
    const col = flipped ? (7 - file) : file;
    const row = flipped ? rank : (7 - rank);
    return { x: col * sqSize, y: row * sqSize };
  }
  function xyToSq(x, y) {
    const col = Math.floor(x / sqSize);
    const row = Math.floor(y / sqSize);
    if (col < 0 || col > 7 || row < 0 || row > 7) return null;
    const file = flipped ? (7 - col) : col;
    const rank = flipped ? row : (7 - row);
    return String.fromCharCode(97 + file) + (rank + 1);
  }
  function sqColor(sq) {
    const file = sq.charCodeAt(0) - 97;
    const rank = parseInt(sq[1]) - 1;
    return (file + rank) % 2 === 0 ? 'dark' : 'light';
  }

  // ── Board drawing ───────────────────────────────────────
  function drawBoard() {
    bCtx.clearRect(0, 0, size, size);

    // Board shadow / glow
    bCtx.save();
    bCtx.shadowColor = 'rgba(124,58,237,0.6)';
    bCtx.shadowBlur  = 24;
    bCtx.fillStyle   = sqDark;
    bCtx.fillRect(0, 0, size, size);
    bCtx.restore();

    for (let r = 0; r < 8; r++) {
      for (let f = 0; f < 8; f++) {
        const x = f * sqSize, y = r * sqSize;
        const isLight = (f + r) % 2 === 0;
        const sq = xyToSq(x + 1, y + 1);

        // Base colour
        bCtx.fillStyle = isLight ? sqLight : sqDark;
        bCtx.fillRect(x, y, sqSize, sqSize);

        // Highlight overlay
        if (sq && highlights[sq]) {
          bCtx.fillStyle = highlights[sq];
          bCtx.fillRect(x, y, sqSize, sqSize);
        }

        // Last move tint
        if (sq && (sq === lastFrom || sq === lastTo)) {
          bCtx.fillStyle = 'rgba(251,191,36,0.35)';
          bCtx.fillRect(x, y, sqSize, sqSize);
        }

        // Check
        if (sq && sq === checkSquare) {
          const grad = bCtx.createRadialGradient(
            x + sqSize/2, y + sqSize/2, 0,
            x + sqSize/2, y + sqSize/2, sqSize * 0.7
          );
          grad.addColorStop(0, 'rgba(239,68,68,0.85)');
          grad.addColorStop(1, 'rgba(239,68,68,0)');
          bCtx.fillStyle = grad;
          bCtx.fillRect(x, y, sqSize, sqSize);
        }

        // Inner subtle gradient
        bCtx.save();
        const inner = bCtx.createLinearGradient(x, y, x + sqSize, y + sqSize);
        inner.addColorStop(0, 'rgba(255,255,255,0.06)');
        inner.addColorStop(1, 'rgba(0,0,0,0.06)');
        bCtx.fillStyle = inner;
        bCtx.fillRect(x, y, sqSize, sqSize);
        bCtx.restore();
      }
    }

    // Legal move dots
    for (const sq of legalDots) {
      const {x, y} = sqToXY(sq);
      const cx = x + sqSize/2, cy = y + sqSize/2;
      const pos = App ? App.getPosition() : null;
      const hasPiece = pos && pos[sq];

      bCtx.save();
      if (hasPiece) {
        // Capture ring
        bCtx.strokeStyle = 'rgba(16,185,129,0.7)';
        bCtx.lineWidth   = sqSize * 0.07;
        bCtx.beginPath();
        bCtx.arc(cx, cy, sqSize * 0.44, 0, Math.PI * 2);
        bCtx.stroke();
      } else {
        // Move dot
        bCtx.fillStyle = 'rgba(16,185,129,0.55)';
        bCtx.beginPath();
        bCtx.arc(cx, cy, sqSize * 0.16, 0, Math.PI * 2);
        bCtx.fill();
      }
      bCtx.restore();
    }

    drawArrows();
    drawCoords();
  }

  function drawArrows() {
    for (const {from, to, color} of arrowList) {
      const f = sqToXY(from), t = sqToXY(to);
      const fx = f.x + sqSize/2, fy = f.y + sqSize/2;
      const tx = t.x + sqSize/2, ty = t.y + sqSize/2;
      const angle = Math.atan2(ty - fy, tx - fx);
      const dist  = Math.hypot(tx - fx, ty - fy);
      const arrowLen = sqSize * 0.4;
      const ex = tx - Math.cos(angle) * arrowLen * 0.5;
      const ey = ty - Math.sin(angle) * arrowLen * 0.5;

      bCtx.save();
      bCtx.strokeStyle = color || 'rgba(250,204,21,0.7)';
      bCtx.fillStyle   = color || 'rgba(250,204,21,0.7)';
      bCtx.lineWidth   = sqSize * 0.1;
      bCtx.lineCap     = 'round';
      bCtx.globalAlpha = 0.8;
      bCtx.beginPath();
      bCtx.moveTo(fx, fy);
      bCtx.lineTo(ex, ey);
      bCtx.stroke();
      // Arrow head
      bCtx.translate(tx, ty);
      bCtx.rotate(angle);
      bCtx.beginPath();
      bCtx.moveTo(0, 0);
      bCtx.lineTo(-arrowLen, arrowLen * 0.4);
      bCtx.lineTo(-arrowLen, -arrowLen * 0.4);
      bCtx.closePath();
      bCtx.fill();
      bCtx.restore();
    }
  }

  function drawCoords() {
    const files = flipped ? ['h','g','f','e','d','c','b','a'] : ['a','b','c','d','e','f','g','h'];
    const ranks = flipped ? ['1','2','3','4','5','6','7','8'] : ['8','7','6','5','4','3','2','1'];

    const topEl    = document.getElementById('coord-top');
    const bottomEl = document.getElementById('coord-bottom');
    const leftEl   = document.getElementById('coord-left');
    const rightEl  = document.getElementById('coord-right');

    if (!topEl) return;

    const showCoords = document.getElementById('coords-toggle');
    if (showCoords && !showCoords.checked) {
      [topEl, bottomEl, leftEl, rightEl].forEach(e => { if (e) e.innerHTML = ''; });
      return;
    }

    topEl.innerHTML    = files.map(f => `<span>${f}</span>`).join('');
    bottomEl.innerHTML = files.map(f => `<span>${f}</span>`).join('');
    leftEl.innerHTML   = ranks.map(r => `<span>${r}</span>`).join('');
    rightEl.innerHTML  = ranks.map(r => `<span>${r}</span>`).join('');
  }

  // ── Piece drawing ───────────────────────────────────────
  function drawPieces(position) {
    pCtx.clearRect(0, 0, size, size);
    if (!position) return;

    for (const [sq, piece] of Object.entries(position)) {
      if (dragging && sq === dragFromSq) continue; // drawn separately
      const {x, y} = sqToXY(sq);
      drawPiece(pCtx, piece, x, y, sqSize);
    }
  }

  function drawPiece(ctx, piece, x, y, sz) {
    const key = piece.color + piece.type.toUpperCase();
    const unicode = PIECE_UNICODE[key];
    if (!unicode) return;

    ctx.save();
    const cx = x + sz/2, cy = y + sz/2;
    const fs = sz * 0.72;

    if (pieceSet === 'neon') {
      // Neon glow effect
      const isWhite = piece.color === 'w';
      const glowColor = isWhite ? 'rgba(248,250,252,0.9)' : 'rgba(99,102,241,0.9)';
      ctx.shadowColor = glowColor;
      ctx.shadowBlur  = sz * 0.25;
      ctx.font        = `${fs}px serif`;
      ctx.textAlign   = 'center';
      ctx.textBaseline= 'middle';
      // Shadow pass
      ctx.fillStyle = isWhite ? 'rgba(0,0,0,0.5)' : 'rgba(0,0,0,0.5)';
      ctx.fillText(unicode, cx + 1.5, cy + 2);
      // Main pass
      ctx.shadowBlur  = sz * 0.3;
      ctx.fillStyle = isWhite ? '#f8fafc' : '#818cf8';
      ctx.fillText(unicode, cx, cy);
      // Bright inner
      ctx.shadowBlur  = sz * 0.1;
      ctx.fillStyle = isWhite ? '#ffffff' : '#c7d2fe';
      ctx.fillText(unicode, cx, cy);

    } else if (pieceSet === 'emoji') {
      ctx.font        = `${fs}px serif`;
      ctx.textAlign   = 'center';
      ctx.textBaseline= 'middle';
      ctx.fillText(unicode, cx, cy);

    } else {
      // Classic — crisp high-contrast
      const isWhite = piece.color === 'w';
      ctx.font        = `${fs}px serif`;
      ctx.textAlign   = 'center';
      ctx.textBaseline= 'middle';
      ctx.fillStyle = '#000';
      ctx.fillText(unicode, cx + 1, cy + 1.5);
      ctx.fillStyle = isWhite ? '#f8fafc' : '#1e1b4b';
      ctx.fillText(unicode, cx, cy);
      if (!isWhite) {
        ctx.fillStyle = 'rgba(255,255,255,0.12)';
        ctx.fillText(unicode, cx, cy);
      }
    }
    ctx.restore();
  }

  // ── Overlay (drag + particles + animated) ──────────────
  function drawOverlay(position) {
    oCtx.clearRect(0, 0, size, size);

    // Particles
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x += p.vx; p.y += p.vy;
      p.vy += 0.3;
      p.life -= 1;
      if (p.life <= 0) { particles.splice(i, 1); continue; }
      oCtx.save();
      oCtx.globalAlpha = p.life / p.maxLife;
      oCtx.fillStyle = p.color;
      oCtx.shadowColor = p.color;
      oCtx.shadowBlur  = 6;
      oCtx.beginPath();
      oCtx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      oCtx.fill();
      oCtx.restore();
    }

    // Animated piece
    if (animating && animPiece) {
      const {piece, fromX, fromY, toX, toY, progress} = animPiece;
      const ease = 1 - Math.pow(1 - progress, 3);
      const x = fromX + (toX - fromX) * ease;
      const y = fromY + (toY - fromY) * ease;
      const scale = 1 + Math.sin(progress * Math.PI) * 0.12;
      oCtx.save();
      oCtx.translate(x + sqSize/2, y + sqSize/2);
      oCtx.scale(scale, scale);
      oCtx.translate(-sqSize/2, -sqSize/2);
      drawPiece(oCtx, piece, 0, 0, sqSize);
      oCtx.restore();
    }

    // Dragging piece
    if (dragging && dragPiece) {
      oCtx.save();
      oCtx.translate(dragX, dragY);
      oCtx.scale(1.1, 1.1);
      oCtx.translate(-sqSize/2, -sqSize/2);
      drawPiece(oCtx, dragPiece, 0, 0, sqSize);
      oCtx.restore();
      // Lift shadow
      oCtx.save();
      oCtx.shadowColor = 'rgba(0,0,0,0.6)';
      oCtx.shadowBlur  = 20;
      oCtx.globalAlpha = 0.3;
      oCtx.fillStyle   = '#000';
      oCtx.beginPath();
      oCtx.ellipse(dragX, dragY + sqSize * 0.4, sqSize * 0.35, sqSize * 0.1, 0, 0, Math.PI * 2);
      oCtx.fill();
      oCtx.restore();
    }
  }

  function loop() {
    if (animating && animPiece) {
      animPiece.progress += 0.06;
      if (animPiece.progress >= 1) {
        animPiece.progress = 1;
        animating = false;
        drawPieces(App ? App.getPosition() : null);
        animPiece = null;
      }
    }
    drawOverlay(App ? App.getPosition() : null);
    animReq = requestAnimationFrame(loop);
  }

  // ── Input events ────────────────────────────────────────
  function getPos(e) {
    const rect = overlayCanvas.getBoundingClientRect();
    if (e.touches) {
      return { x: e.touches[0].clientX - rect.left,
               y: e.touches[0].clientY - rect.top };
    }
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function onTouchStart(e) { e.preventDefault(); onPointerDown(getPos(e)); }
  function onTouchMove(e)  { e.preventDefault(); onPointerMove(getPos(e)); }
  function onTouchEnd(e)   { e.preventDefault(); onPointerUp(getPos(e)); }
  function onMouseDown(e)  { onPointerDown(getPos(e)); }
  function onMouseMove(e)  { onPointerMove(getPos(e)); }
  function onMouseUp(e)    { onPointerUp(getPos(e)); }

  function onPointerDown({x, y}) {
    const sq = xyToSq(x, y);
    if (!sq) return;
    if (App && App.canPickUp(sq)) {
      dragFromSq = sq;
      dragPiece  = App.getPieceAt(sq);
      dragX = x; dragY = y;
      dragging = true;
      legalDots = App.getLegalMoves(sq).map(m => m.to);
      drawBoard();
      drawPieces(App.getPosition());
    }
  }
  function onPointerMove({x, y}) {
    if (!dragging) return;
    dragX = x; dragY = y;
  }
  function onPointerUp({x, y}) {
    if (!dragging) return;
    dragging = false;
    const toSq = xyToSq(x, y);
    legalDots = [];
    if (toSq && toSq !== dragFromSq && App) {
      App.tryMove(dragFromSq, toSq);
    } else {
      drawBoard();
      drawPieces(App ? App.getPosition() : null);
    }
    dragPiece  = null;
    dragFromSq = null;
  }

  // ── Public API ──────────────────────────────────────────
  function render(position) {
    readTheme();
    drawBoard();
    drawPieces(position);
  }

  function animateMove(piece, from, to, position) {
    const fp = sqToXY(from), tp = sqToXY(to);
    animPiece = { piece, fromX: fp.x, fromY: fp.y, toX: tp.x, toY: tp.y, progress: 0 };
    animating  = true;
    lastFrom   = from;
    lastTo     = to;
    drawBoard();
    drawPieces(position); // draw rest without the moving piece (it's on overlay)
  }

  function spawnParticles(sq, color) {
    const {x, y} = sqToXY(sq);
    const cx = x + sqSize/2, cy = y + sqSize/2;
    const colors = ['#a855f7','#06b6d4','#f59e0b','#10b981','#f472b6'];
    for (let i = 0; i < 30; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 2 + Math.random() * 5;
      particles.push({
        x: cx, y: cy,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 2,
        r: 2 + Math.random() * 4,
        life: 40 + Math.random() * 30,
        maxLife: 70,
        color: color || colors[Math.floor(Math.random() * colors.length)]
      });
    }
  }

  function setHighlight(sq, color) {
    if (sq) highlights[sq] = color;
    else     highlights = {};
    drawBoard();
  }
  function clearHighlights() { highlights = {}; drawBoard(); }

  function setCheck(sq) { checkSquare = sq; drawBoard(); }
  function clearCheck()  { checkSquare = null; drawBoard(); }

  function setLastMove(from, to) { lastFrom = from; lastTo = to; drawBoard(); }
  function clearLastMove() { lastFrom = null; lastTo = null; drawBoard(); }

  function setArrow(from, to, color) {
    arrowList = [{ from, to, color }];
    drawBoard();
  }
  function clearArrows() { arrowList = []; drawBoard(); }

  function flip() { flipped = !flipped; drawBoard(); drawPieces(App ? App.getPosition() : null); }
  function setFlipped(f) { flipped = f; drawBoard(); drawPieces(App ? App.getPosition() : null); }
  function isFlipped() { return flipped; }

  function setPieceSet(s) { pieceSet = s; drawPieces(App ? App.getPosition() : null); }

  return {
    init, render, animateMove, flip, setFlipped, isFlipped,
    setHighlight, clearHighlights, setCheck, clearCheck,
    setLastMove, clearLastMove, setArrow, clearArrows,
    spawnParticles, setPieceSet
  };
})();
