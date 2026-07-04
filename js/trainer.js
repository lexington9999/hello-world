/* ══════════════════════════════════════════════════════════════
   trainer.js — Training mode logic, hints, puzzle generation
══════════════════════════════════════════════════════════════ */

const Trainer = (() => {

  // Openings database (ECO codes, first few moves)
  const OPENINGS = [
    { name: "Ruy López",            moves: ["e4","e5","Nf3","Nc6","Bb5"] },
    { name: "Italian Game",         moves: ["e4","e5","Nf3","Nc6","Bc4"] },
    { name: "Sicilian Defence",     moves: ["e4","c5"] },
    { name: "French Defence",       moves: ["e4","e6","d4","d5"] },
    { name: "Queen's Gambit",       moves: ["d4","d5","c4"] },
    { name: "King's Indian",        moves: ["d4","Nf6","c4","g6","Nc3","Bg7","e4"] },
    { name: "Nimzo-Indian",         moves: ["d4","Nf6","c4","e6","Nc3","Bb4"] },
    { name: "Caro-Kann",            moves: ["e4","c6","d4","d5"] },
    { name: "Pirc Defence",         moves: ["e4","d6","d4","Nf6"] },
    { name: "English Opening",      moves: ["c4"] },
    { name: "Grünfeld Defence",     moves: ["d4","Nf6","c4","g6","Nc3","d5"] },
    { name: "Dutch Defence",        moves: ["d4","f5"] },
    { name: "Scandinavian",         moves: ["e4","d5"] },
    { name: "King's Gambit",        moves: ["e4","e5","f4"] },
    { name: "Alekhine Defence",     moves: ["e4","Nf6"] },
    { name: "Catalan Opening",      moves: ["d4","Nf6","c4","e6","g3"] },
    { name: "London System",        moves: ["d4","d5","Nf3","Nf6","Bf4"] },
    { name: "King's Fianchetto",    moves: ["g3"] },
    { name: "Réti Opening",         moves: ["Nf3","d5","c4"] },
    { name: "Vienna Game",          moves: ["e4","e5","Nc3"] },
  ];

  // Tactics patterns for puzzle generation
  const PATTERNS = [
    'Fork', 'Pin', 'Skewer', 'Discovery', 'Double Check',
    'Back Rank Mate', 'Smothered Mate', 'Greek Gift',
    'Zwischenzug', 'En Passant Tactic', 'Promotion Trick',
    'Trapped Piece'
  ];

  // Built-in practice positions (FEN + theme + solution)
  const PRACTICE_POSITIONS = [
    {
      name: "Fork Tactic",
      fen: "r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4",
      theme: "Development",
      tip: "Develop all pieces before attacking. Control the center!",
      bestMove: "d2d3"
    },
    {
      name: "Back Rank Weakness",
      fen: "6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1",
      theme: "Endgame",
      tip: "Rooks are most powerful on open files and the 7th rank.",
      bestMove: "a1a8"
    },
    {
      name: "Queen Trap",
      fen: "r1bqkb1r/1ppp1ppp/p1n2n2/4p3/B3P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 2 4",
      theme: "Opening",
      tip: "Don't bring out the queen too early — it can be chased away.",
      bestMove: "d1e2"
    },
    {
      name: "Knight Outpost",
      fen: "r1bq1rk1/ppp2ppp/2n2n2/3pp3/2PP4/2N2N2/PP2PPPP/R1BQKB1R w KQ - 0 6",
      theme: "Strategy",
      tip: "Knights are most powerful on outposts — squares protected by pawns.",
      bestMove: "c3d5"
    },
    {
      name: "Passed Pawn Power",
      fen: "8/8/8/3k4/8/3K4/3P4/8 w - - 0 1",
      theme: "Endgame",
      tip: "The key square rule: advance your king to escort the pawn.",
      bestMove: "d3e4"
    },
    {
      name: "Rook Endgame",
      fen: "8/8/8/8/8/R7/8/k1K5 w - - 0 1",
      theme: "Endgame",
      tip: "Cut off the opposing king with your rook on ranks or files.",
      bestMove: "a3a1"
    },
    {
      name: "Discovered Attack",
      fen: "r1bq1rk1/ppp2ppp/2n2n2/3pp3/1bPP4/2NBP N2/PP3PPP/R1BQK2R b KQ - 3 7",
      theme: "Tactics",
      tip: "Move a piece to uncover an attack from another piece behind it.",
      bestMove: "c6d4"
    },
  ];

  let currentPuzzleIdx = 0;
  let mode = 'free'; // free | train | pdf | puzzle
  let pdfMoves = [];
  let pdfGameIdx = 0;

  function detectOpening(moves) {
    if (!moves || moves.length === 0) return null;
    let best = null;
    let bestLen = 0;
    for (const op of OPENINGS) {
      let match = true;
      for (let i = 0; i < op.moves.length; i++) {
        if (i >= moves.length || moves[i] !== op.moves[i]) {
          match = false; break;
        }
      }
      if (match && op.moves.length > bestLen) {
        best = op; bestLen = op.moves.length;
      }
    }
    return best;
  }

  function getHint(fen, bestMove) {
    if (!bestMove) return "No hint available yet — enable analysis.";
    const from = bestMove.slice(0, 2);
    const to   = bestMove.slice(2, 4);

    // Describe the move in human terms
    const fileNames = {a:'a-file',b:'b-file',c:'c-file',d:'d-file',
                       e:'e-file',f:'f-file',g:'g-file',h:'h-file'};
    const hints = [
      `Try moving from ${from.toUpperCase()} to ${to.toUpperCase()}.`,
      `Consider a move in the ${fileNames[to[0]]} area.`,
      `Look for activity near ${to.toUpperCase()}.`
    ];
    return hints[Math.floor(Math.random() * hints.length)];
  }

  function getPracticePosition(idx) {
    return PRACTICE_POSITIONS[idx % PRACTICE_POSITIONS.length];
  }

  function getNextPuzzle() {
    currentPuzzleIdx = (currentPuzzleIdx + 1) % PRACTICE_POSITIONS.length;
    return getPracticePosition(currentPuzzleIdx);
  }
  function getPrevPuzzle() {
    currentPuzzleIdx = (currentPuzzleIdx - 1 + PRACTICE_POSITIONS.length) % PRACTICE_POSITIONS.length;
    return getPracticePosition(currentPuzzleIdx);
  }

  function setPdfMoves(moves) { pdfMoves = moves; pdfGameIdx = 0; }
  function getPdfMoves() { return pdfMoves; }
  function getPdfMove(i) { return pdfMoves[i]; }
  function getPdfMoveCount() { return pdfMoves.length; }

  function getMaterial(position) {
    const values = { p:1, n:3, b:3, r:5, q:9, k:0 };
    let white = 0, black = 0;
    for (const [sq, piece] of Object.entries(position)) {
      const v = values[piece.type] || 0;
      if (piece.color === 'w') white += v;
      else black += v;
    }
    return white - black;
  }

  function getPhase(moveNumber) {
    if (moveNumber < 10) return 'Opening';
    if (moveNumber < 30) return 'Middlegame';
    return 'Endgame';
  }

  function analyzeThreat(game) {
    // Simple threat detection: see if there's a forcing move
    const moves = game.moves({ verbose: true });
    const captures = moves.filter(m => m.flags.includes('c') || m.flags.includes('e'));
    const checks   = moves.filter(m => m.san.includes('+'));

    if (checks.length > 0) {
      return `Threat: ${checks.length} checking move(s) available (${checks.slice(0,2).map(m=>m.san).join(', ')}).`;
    }
    if (captures.length > 0) {
      const sorted = captures.sort((a,b) => {
        const val = {p:1,n:3,b:3,r:5,q:9,k:0};
        return (val[b.captured]||0) - (val[a.captured]||0);
      });
      return `Can capture: ${sorted.slice(0,2).map(m=>m.san).join(', ')}.`;
    }
    return '';
  }

  return {
    detectOpening, getHint, getPracticePosition, getNextPuzzle, getPrevPuzzle,
    setPdfMoves, getPdfMoves, getPdfMove, getPdfMoveCount,
    getMaterial, getPhase, analyzeThreat,
    PATTERNS, PRACTICE_POSITIONS
  };
})();
