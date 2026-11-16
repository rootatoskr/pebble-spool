var text = require('./text');

var MAX_ATTEMPTS = 3;
var RETRY_DELAY_MS = 1000;

// localStorage keys:
//   text      - the text as the user saved it;
//   textId    - id of that text, the watch stores it together with the text;
//   syncState - 'pending', 'synced' or 'failed'.

var CONFIG_HTML = '<!DOCTYPE html><html><head><meta charset="utf-8">' +
  '<meta name="viewport" content="width=device-width,initial-scale=1">' +
  '<title>pebble-spool</title></head><body>' +
  '<textarea id="text" rows="15" style="width:100%;box-sizing:border-box"></textarea>' +
  '<p>Bytes: <span id="count">0</span></p>' +
  '<button id="save">Save</button>' +
  '<script>' +
  'var t=document.getElementById("text"),c=document.getElementById("count");' +
  'function bytes(s){return unescape(encodeURIComponent(s)).length;}' +
  't.addEventListener("input",function(){c.textContent=bytes(t.value);});' +
  'document.getElementById("save").addEventListener("click",function(){' +
  // The emulator appends "?return_to=..." to the URL; on the phone it is absent.
  'var m=location.search.match(/[?&]return_to=(.*)$/);' +
  'var r=m?decodeURIComponent(m[1]):"pebblejs://close#";' +
  'location.href=r+encodeURIComponent(JSON.stringify({text:t.value}));});' +
  '</script></body></html>';

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
  var saved = localStorage.getItem('text') || '';
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
  Pebble.openURL('data:text/html;charset=utf-8,' + encodeURIComponent(CONFIG_HTML));
});

Pebble.addEventListener('webviewclosed', function(e) {
  if (!e || !e.response) {
    return;
  }
  // iOS decodes the response once, the emulator passes it still encoded.
  var response = e.response;
  if (response.charAt(0) !== '{') {
    response = decodeURIComponent(response);
  }
  saveText(JSON.parse(response).text);
});
