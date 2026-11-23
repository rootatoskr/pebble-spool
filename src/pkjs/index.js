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
  if (transfer.item === sync.SETTINGS_ITEM) {
    localStorage.setItem('settingsState', ok ? 'synced' : 'failed');
    console.log('Settings ' + (ok ? 'stored on the watch' : 'failed'));
  } else {
    setSyncState(transfer.slot, ok ? 'synced' : 'failed');
    console.log('Slot ' + transfer.slot + ', transfer ' + transfer.id +
                (ok ? ' stored on the watch' : ' failed'));
  }
  startNextTransfer();
}

function isCurrent(transfer) {
  return function() {
    return transfer !== currentTransfer;
  };
}

function sendChunk(transfer, index) {
  sendReliably(sync.chunkMessage(transfer, index), isCurrent(transfer), function() {
    // After the last chunk the watch confirms with ResultId/ResultOk.
    if (index + 1 < transfer.chunks.length) {
      sendChunk(transfer, index + 1);
    }
  }, function() {
    finishTransfer(transfer, false);
  });
}

// Sends the settings. The watch acknowledges the message and answers with its state.
function sendSettings(transfer) {
  var settings = sync.readSettings(localStorage, 'settings');
  sendReliably(sync.settingsMessage(settings), isCurrent(transfer), function() {
    finishTransfer(transfer, true);
  }, function() {
    finishTransfer(transfer, false);
  });
}

// Sends what waits next in the queue, unless a transfer is still running.
function startNextTransfer() {
  if (currentTransfer || queue.length === 0) {
    return;
  }
  var item = queue.shift();
  if (item === sync.SETTINGS_ITEM) {
    currentTransfer = {item: item};
    localStorage.setItem('settingsState', 'pending');
    console.log('Settings: sending');
    sendSettings(currentTransfer);
    return;
  }
  var transfer = sync.buildTransfer(localStorage, item);
  transfer.item = item;
  currentTransfer = transfer;
  setSyncState(transfer.slot, 'pending');
  console.log('Slot ' + transfer.slot + ', transfer ' + transfer.id + ': ' +
              transfer.totalBytes + ' bytes, ' + transfer.chunks.length + ' chunks');
  sendChunk(transfer, 0);
}

// Puts ``item`` at the front of the queue. A running transfer of something else is
// abandoned and gets its turn again right after it. The caller starts the queue.
function sendFirst(item) {
  if (currentTransfer) {
    if (currentTransfer.item !== item) {
      sync.queueAdd(queue, currentTransfer.item, true);
    }
    currentTransfer = null;
  }
  sync.queueAdd(queue, item, true);
}

// Saves a new version of a slot to be sent before other texts. An empty text clears
// the slot on the watch. A text that would not fit on the watch is not saved: the
// settings page does not let it through, so it can only come from elsewhere.
function saveText(slot, name, newText) {
  if (!sync.textFits(newText)) {
    console.log('Slot ' + slot + ': text too long, not saved');
    return;
  }
  localStorage.setItem(sync.storageKey('text', slot), newText);
  localStorage.setItem(sync.storageKey('name', slot), name);
  // A positive 31-bit id, 0 means "nothing stored" on the watch.
  localStorage.setItem(sync.storageKey('textId', slot),
                       String(Math.floor(Math.random() * 0x7FFFFFFE) + 1));
  setSyncState(slot, 'pending');
  sendFirst(slot);
}

function saveSettings(settings) {
  localStorage.setItem('settings', JSON.stringify(sync.normalizeSettings(settings)));
  localStorage.setItem('settingsState', 'pending');
  sendFirst(sync.SETTINGS_ITEM);
}

// The watch reported its state. Send our texts again where it has a different version:
// this restores them after a broken transfer or a reinstall. The same for settings.
function handleWatchState(state) {
  if (state.watchSlots) {
    sync.takeWatchSlots(localStorage, state.watchSlots);
  }
  var phoneIds = sync.localIds(localStorage);
  var resend = sync.slotsToResend(phoneIds, state.ids);
  for (var slot = 0; slot < sync.SLOT_COUNT; slot++) {
    var busy = currentTransfer && currentTransfer.item === slot;
    if (resend.indexOf(slot) >= 0) {
      if (!busy) {
        sync.queueAdd(queue, slot, false);
      }
    } else if (phoneIds[slot] !== null && !busy && queue.indexOf(slot) < 0) {
      setSyncState(slot, 'synced');
    }
  }
  var settingsBusy = (currentTransfer && currentTransfer.item === sync.SETTINGS_ITEM) ||
    queue.indexOf(sync.SETTINGS_ITEM) >= 0;
  if (state.settings && !settingsBusy &&
      sync.takeWatchSettings(localStorage, state.settings, state.textSize)) {
    sync.queueAdd(queue, sync.SETTINGS_ITEM, true);
  } else if (state.settings && settingsBusy && state.textSize !== null) {
    localStorage.setItem('textSize', String(state.textSize));
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
  var state = sync.stateFromPayload(payload);
  if (state) {
    handleWatchState(state);
  }
});

Pebble.addEventListener('showConfiguration', function() {
  Pebble.openURL(configPage.buildUrl({
    slots: sync.pageSlots(localStorage),
    selected: sync.selectedSlot(localStorage),
    maxBytes: text.MAX_TEXT_BYTES,
    sizes: sync.SIZES,
    appearance: sync.pageSettings(localStorage)
  }));
});

Pebble.addEventListener('webviewclosed', function(e) {
  var result = configPage.parseResponse(e.response, sync.SLOT_COUNT);
  if (!result) {
    return;
  }
  localStorage.setItem('lastSlot', String(result.slot));
  // Only what changed is sent: the settings first, then the text.
  if (result.settings &&
      !sync.settingsEqual(result.settings, sync.readSettings(localStorage, 'settings'))) {
    saveSettings(result.settings);
  }
  if (result.text !== null) {
    saveText(result.slot, result.name, result.text);
  }
  startNextTransfer();
});
