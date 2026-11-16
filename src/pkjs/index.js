var configPage = require('./config_page');
var sync = require('./sync');
var text = require('./text');

var MAX_ATTEMPTS = 3;
var RETRY_DELAY_MS = 1000;

// The transfer in progress. Only one runs at a time. A newer transfer replaces it, and
// callbacks of the replaced one stop when they see that they are no longer current.
var currentTransfer = null;
// Slots that wait for their turn to be sent.
var queue = [];

function setSyncState(slot, state) {
  localStorage.setItem(sync.storageKey('syncState', slot), state);
}

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
  setSyncState(transfer.slot, ok ? 'synced' : 'failed');
  console.log('Slot ' + transfer.slot + ', transfer ' + transfer.id +
              (ok ? ' stored on the watch' : ' failed'));
  startNextTransfer();
}

function sendChunk(transfer, index) {
  var isCancelled = function() {
    return transfer !== currentTransfer;
  };
  sendReliably(sync.chunkMessage(transfer, index), isCancelled, function() {
    // After the last chunk the watch confirms with ResultId/ResultOk.
    if (index + 1 < transfer.chunks.length) {
      sendChunk(transfer, index + 1);
    }
  }, function() {
    finishTransfer(transfer, false);
  });
}

// Sends the next waiting slot, unless a transfer is still running.
function startNextTransfer() {
  if (currentTransfer || queue.length === 0) {
    return;
  }
  var transfer = sync.buildTransfer(localStorage, queue.shift());
  currentTransfer = transfer;
  setSyncState(transfer.slot, 'pending');
  console.log('Slot ' + transfer.slot + ', transfer ' + transfer.id + ': ' +
              transfer.totalBytes + ' bytes, ' + transfer.chunks.length + ' chunks');
  sendChunk(transfer, 0);
}

// Saves a new version of a slot and sends it before anything else. An empty text
// clears the slot on the watch.
function saveText(slot, name, newText) {
  localStorage.setItem(sync.storageKey('text', slot), newText);
  localStorage.setItem(sync.storageKey('name', slot), name);
  // A positive 31-bit id, 0 means "nothing stored" on the watch.
  localStorage.setItem(sync.storageKey('textId', slot),
                       String(Math.floor(Math.random() * 0x7FFFFFFE) + 1));
  setSyncState(slot, 'pending');
  if (currentTransfer) {
    // The running transfer is abandoned. If it belongs to another slot, that slot
    // gets its turn again right after this one.
    if (currentTransfer.slot !== slot) {
      sync.queueAdd(queue, currentTransfer.slot, true);
    }
    currentTransfer = null;
  }
  sync.queueAdd(queue, slot, true);
  startNextTransfer();
}

// The watch reported which versions it has. Send ours again where it has a different
// one: this restores the texts after a broken transfer or a reinstall.
function handleWatchState(watchIds) {
  var phoneIds = sync.localIds(localStorage);
  var resend = sync.slotsToResend(phoneIds, watchIds);
  for (var slot = 0; slot < sync.SLOT_COUNT; slot++) {
    var busy = currentTransfer && currentTransfer.slot === slot;
    if (resend.indexOf(slot) >= 0) {
      if (!busy) {
        sync.queueAdd(queue, slot, false);
      }
    } else if (phoneIds[slot] !== null && !busy && queue.indexOf(slot) < 0) {
      setSyncState(slot, 'synced');
    }
  }
  startNextTransfer();
}

Pebble.addEventListener('ready', function() {
  sync.migrateStorage(localStorage);
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
    return;
  }
  var watchIds = sync.watchIdsFromPayload(payload);
  if (watchIds) {
    handleWatchState(watchIds);
  }
});

Pebble.addEventListener('showConfiguration', function() {
  var syncState = localStorage.getItem(sync.storageKey('syncState', 0));
  Pebble.openURL(configPage.buildUrl({
    text: localStorage.getItem(sync.storageKey('text', 0)) || '',
    maxBytes: text.MAX_TEXT_BYTES,
    failed: syncState !== null && syncState !== 'synced'
  }));
});

Pebble.addEventListener('webviewclosed', function(e) {
  var newText = configPage.parseResponse(e.response);
  if (newText !== null) {
    saveText(0, '', newText);
  }
});
