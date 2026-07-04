// Wrapper that loads the Stockfish 18 asm module and bridges the
// old UCI postMessage interface used by engine.js
importScripts('./stockfish.js');

var sf = null;

Stockfish().then(function(engine) {
  sf = engine;
  engine.addMessageListener(function(line) {
    self.postMessage(line);
  });
  // signal ready
  self.postMessage('worker-ready');
});

self.onmessage = function(e) {
  if (sf) sf.postMessage(e.data);
};
