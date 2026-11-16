var configPage = require('./config_page');
var text = require('./text');

var MAX_ATTEMPTS = 3;
var RETRY_DELAY_MS = 1000;

// localStorage keys:
//   text      - the text as the user saved it;
//   textId    - id of that text, the watch stores it together with the text;
//   syncState - 'pending', 'synced' or 'failed'.

// The transfer in progress. A newer transfer replaces it, and callbacks of the
// replaced one stop when they see that they are no longer current.
var currentTransfer = null;

// Sends a message, repeating it after a failure. Gives up after MAX_ATTEMPTS.
function sendReliably(message, isCancelled, onSuccess, onGiveUp, attempt) {
  attempt = attempt || 1;
  Pebble.sendAppMessage(message, function() {
    if (!isCancelled()) {
      onSuccess();
    }
  }, function() {
    if (isCancelled()) {
      return;
    }
    if (attempt >= MAX_ATTEMPTS) {
      onGiveUp();
      return;
    }
    setTimeout(function() {
      if (!isCancelled()) {
        sendReliably(message, isCancelled, onSuccess, onGiveUp, attempt + 1);
      }
    }, RETRY_DELAY_MS);
  });
}

function finishTransfer(transfer, ok) {
  if (transfer !== currentTransfer) {
    return;
  }
  currentTransfer = null;
  localStorage.setItem('syncState', ok ? 'synced' : 'failed');
  console.log('Transfer ' + transfer.id + (ok ? ' stored on the watch' : ' failed'));
}

function sendChunk(transfer, index) {
  var isCancelled = function() {
    return transfer !== currentTransfer;
  };
  sendReliably({
    'TransferId': transfer.id,
    'ChunkIndex': index,
    'ChunkCount': transfer.chunks.length,
    'TotalBytes': transfer.totalBytes,
    'ChunkData': transfer.chunks[index]
  }, isCancelled, function() {
    // After the last chunk the watch confirms with ResultId/ResultOk.
    if (index + 1 < transfer.chunks.length) {
      sendChunk(transfer, index + 1);
    }
  }, function() {
    finishTransfer(transfer, false);
  });
}

// Sends the saved text to the watch, replacing any transfer in progress.
function startTransfer() {
  var saved = text.normalizeText(localStorage.getItem('text') || '');
  var transfer = {
    id: Number(localStorage.getItem('textId')),
    chunks: text.splitIntoChunks(saved),
    totalBytes: text.utf8Length(saved)
  };
  currentTransfer = transfer;
  localStorage.setItem('syncState', 'pending');
  console.log('Transfer ' + transfer.id + ': ' + transfer.totalBytes + ' bytes, ' +
              transfer.chunks.length + ' chunks');
  sendChunk(transfer, 0);
}

function saveText(newText) {
  localStorage.setItem('text', newText);
  // A positive 31-bit id, 0 means "no text" on the watch.
  localStorage.setItem('textId', String(Math.floor(Math.random() * 0x7FFFFFFE) + 1));
  startTransfer();
}

// The watch reported which text it has. Send ours again if it has a different one:
// this restores the text after a broken transfer or a reinstall.
function handleWatchState(activeId) {
  var textId = localStorage.getItem('textId');
  if (textId === null || currentTransfer) {
    return;
  }
  if (Number(textId) === activeId) {
    localStorage.setItem('syncState', 'synced');
  } else {
    startTransfer();
  }
}

Pebble.addEventListener('ready', function() {
  var never = function() {
    return false;
  };
  sendReliably({'Hello': 1}, never, function() {}, function() {
    console.log('Watch did not answer');
  });
});

Pebble.addEventListener('appmessage', function(e) {
  var payload = e.payload;
  if (payload.ResultId !== undefined) {
    if (currentTransfer && payload.ResultId === currentTransfer.id) {
      finishTransfer(currentTransfer, payload.ResultOk === 1);
    }
  } else if (payload.ActiveId !== undefined) {
    handleWatchState(payload.ActiveId);
  }
});

Pebble.addEventListener('showConfiguration', function() {
  var syncState = localStorage.getItem('syncState');
  Pebble.openURL(configPage.buildUrl({
    text: localStorage.getItem('text') || '',
    maxBytes: text.MAX_TEXT_BYTES,
    failed: syncState !== null && syncState !== 'synced'
  }));
});

Pebble.addEventListener('webviewclosed', function(e) {
  var newText = configPage.parseResponse(e.response);
  if (newText !== null) {
    saveText(newText);
  }
});
