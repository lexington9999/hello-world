/* ══════════════════════════════════════════════════════════════
   pdfReader.js — PDF loading, rendering, move extraction
══════════════════════════════════════════════════════════════ */

const PDFReader = (() => {
  let pdfDoc    = null;
  let pageNum   = 1;
  let pageCount = 0;
  const canvas  = document.getElementById('pdf-canvas');
  let ctx       = canvas ? canvas.getContext('2d') : null;

  // ── Load PDF from File ──────────────────────────────────
  async function loadFile(file) {
    if (typeof pdfjsLib === 'undefined') {
      showToast('PDF.js not loaded', 'bad');
      return false;
    }
    const arrayBuffer = await file.arrayBuffer();
    const data = new Uint8Array(arrayBuffer);
    try {
      const loadingTask = pdfjsLib.getDocument({ data });
      pdfDoc = await loadingTask.promise;
      pageCount = pdfDoc.numPages;
      pageNum   = 1;
      await renderPage(pageNum);
      updatePageInfo();
      return true;
    } catch(e) {
      console.error('PDF load error:', e);
      return false;
    }
  }

  async function renderPage(num) {
    if (!pdfDoc) return;
    if (!ctx) {
      canvas = document.getElementById('pdf-canvas');
      ctx = canvas ? canvas.getContext('2d') : null;
    }
    if (!ctx) return;

    try {
      const page = await pdfDoc.getPage(num);
      const viewport = page.getViewport({ scale: 1.0 });
      // Fit to container width
      const container = document.getElementById('pdf-preview-wrap');
      const containerW = container ? container.clientWidth : 200;
      const scale = containerW / viewport.width;
      const scaledViewport = page.getViewport({ scale });

      canvas.width  = scaledViewport.width;
      canvas.height = scaledViewport.height;

      await page.render({
        canvasContext: ctx,
        viewport: scaledViewport
      }).promise;
    } catch(e) {
      console.error('PDF render error:', e);
    }
  }

  function updatePageInfo() {
    const el = document.getElementById('pdf-page-info');
    if (el) el.textContent = `Page ${pageNum} / ${pageCount}`;
  }

  async function prevPage() {
    if (pageNum <= 1) return;
    pageNum--;
    await renderPage(pageNum);
    updatePageInfo();
  }
  async function nextPage() {
    if (pageNum >= pageCount) return;
    pageNum++;
    await renderPage(pageNum);
    updatePageInfo();
  }

  // ── Extract chess moves from text ────────────────────────
  // Handles PGN notation, algebraic moves, numbered lists
  async function extractMovesFromPage(num) {
    if (!pdfDoc) return [];
    const page = await pdfDoc.getPage(num);
    const textContent = await page.getTextContent();
    const text = textContent.items.map(item => item.str).join(' ');
    return parseMoveText(text);
  }

  async function extractMovesFromAllPages() {
    if (!pdfDoc) return [];
    let allMoves = [];
    for (let p = 1; p <= pageCount; p++) {
      const moves = await extractMovesFromPage(p);
      allMoves = allMoves.concat(moves);
    }
    return deduplicateMoves(allMoves);
  }

  function parseMoveText(text) {
    const moves = [];

    // Remove comments in parentheses and curly braces
    let cleaned = text
      .replace(/\([^)]*\)/g, ' ')
      .replace(/\{[^}]*\}/g, ' ')
      .replace(/;[^\n]*/g, ' ');

    // Match PGN-like move numbers and moves
    // Pattern: "1. e4 e5 2. Nf3 Nc6" or "1...e5"
    const pgnPattern = /\d+\.{1,3}\s*([A-Za-z][a-zA-Z0-9+#=\-x!?]{1,8})/g;
    let m;
    while ((m = pgnPattern.exec(cleaned)) !== null) {
      const mv = cleanMove(m[1]);
      if (isValidSAN(mv)) moves.push(mv);
    }

    // If no numbered moves found, try to find bare SAN moves
    if (moves.length === 0) {
      const sanPattern = /\b([KQRBN]?[a-h]?[1-8]?x?[a-h][1-8](?:=[QRBN])?[+#]?)\b/g;
      while ((m = sanPattern.exec(cleaned)) !== null) {
        const mv = cleanMove(m[1]);
        if (isValidSAN(mv)) moves.push(mv);
      }
    }

    return moves.filter((v, i, a) => a.indexOf(v) === i); // deduplicate
  }

  function cleanMove(mv) {
    return mv.replace(/[!?]/g, '').trim();
  }

  function isValidSAN(mv) {
    if (!mv || mv.length < 2 || mv.length > 7) return false;

    // Castling
    if (mv === 'O-O' || mv === 'O-O-O' || mv === '0-0' || mv === '0-0-0') return true;

    // Must contain a destination square (file + rank)
    if (!/[a-h][1-8]/.test(mv)) return false;

    // Must not be just a number
    if (/^\d+$/.test(mv)) return false;

    // Common false positives
    const blacklist = ['Ba','Be','Bi','bo','by','do','go','he','if','in',
                       'is','it','of','on','or','so','to','we'];
    if (blacklist.includes(mv.toLowerCase())) return false;

    return true;
  }

  function deduplicateMoves(moves) {
    return moves.filter((v, i, a) => a.indexOf(v) === i);
  }

  function getCurrentPage() { return pageNum; }
  function getPageCount()    { return pageCount; }
  function isLoaded()        { return pdfDoc !== null; }

  // ── Extract from all pages and parse as full PGN game ───
  async function extractFullGame() {
    if (!pdfDoc) return [];
    let allText = '';
    for (let p = 1; p <= pageCount; p++) {
      const page = await pdfDoc.getPage(p);
      const tc = await page.getTextContent();
      allText += ' ' + tc.items.map(i => i.str).join(' ');
    }

    // Try PGN game extraction
    const game = parsePGNGame(allText);
    if (game.length > 0) return game;

    // Fallback: raw move extraction from all text
    return parseMoveText(allText);
  }

  function parsePGNGame(text) {
    // Clean PGN headers
    let cleaned = text.replace(/\[[^\]]*\]/g, '');
    cleaned = cleaned.replace(/\([^)]*\)/g, '');
    cleaned = cleaned.replace(/\{[^}]*\}/g, '');
    cleaned = cleaned.replace(/;[^\n]*/g, '');
    cleaned = cleaned.replace(/1[-–]0|0[-–]1|1\/2[-–]1\/2|\*/g, '');

    const moves = [];
    // Match "1. e4 e5" etc
    const re = /(\d+)\.\s+([^\s.]+)(?:\s+([^\s.\d][^\s.]*?))?(?=\s+\d+\.|\s*$)/g;
    let m;
    while ((m = re.exec(cleaned)) !== null) {
      const w = cleanMove(m[2]);
      if (isValidSAN(w)) moves.push(w);
      if (m[3]) {
        const b = cleanMove(m[3]);
        if (isValidSAN(b)) moves.push(b);
      }
    }
    return moves;
  }

  return {
    loadFile, renderPage, prevPage, nextPage,
    extractMovesFromPage, extractMovesFromAllPages,
    extractFullGame, parseMoveText,
    getCurrentPage, getPageCount, isLoaded
  };
})();
