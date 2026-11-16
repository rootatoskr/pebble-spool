// The parts of the phone-to-watch synchronization that do not need the Pebble
// runtime, so that they can be tested with plain Node.js.

var text = require('./text');

// Keep in sync with ``STORAGE_TEXT_COUNT`` in ``src/c/storage.h``.
var SLOT_COUNT = 5;

// localStorage keeps four values for every slot, the slot number is appended to the key:
// - text: the text as the user saved it;
// - name: the name as the user typed it, may be empty;
// - textId: id of that version, the watch stores it together with the text;
// - syncState: 'pending', 'synced' or 'failed'.
function storageKey(field, slot) {
  return field + slot;
}

// Version 1.1 kept one text under keys without a number. It becomes slot 0.
function migrateStorage(storage) {
  if (storage.getItem('textId') === null) {
    return;
  }
  if (storage.getItem(storageKey('textId', 0)) === null) {
    storage.setItem(storageKey('text', 0), storage.getItem('text') || '');
    storage.setItem(storageKey('name', 0), '');
    storage.setItem(storageKey('textId', 0), storage.getItem('textId'));
    storage.setItem(storageKey('syncState', 0), storage.getItem('syncState') || 'pending');
  }
  storage.removeItem('text');
  storage.removeItem('textId');
  storage.removeItem('syncState');
}

// Ids of the saved versions, null for a slot that was never saved on this phone.
function localIds(storage) {
  var ids = [];
  for (var slot = 0; slot < SLOT_COUNT; slot++) {
    var id = storage.getItem(storageKey('textId', slot));
    ids.push(id === null ? null : Number(id));
  }
  return ids;
}

// Reads the ids the watch reports on launch. Returns null for any other message.
function watchIdsFromPayload(payload) {
  var ids = [];
  for (var slot = 0; slot < SLOT_COUNT; slot++) {
    var id = payload['SlotId' + slot];
    if (id === undefined) {
      return null;
    }
    ids.push(id);
  }
  return ids;
}

// Slots whose version on the watch differs from the one saved on the phone.
// A slot that was never saved on this phone is left alone.
function slotsToResend(phoneIds, watchIds) {
  var slots = [];
  for (var slot = 0; slot < SLOT_COUNT; slot++) {
    if (phoneIds[slot] !== null && phoneIds[slot] !== watchIds[slot]) {
      slots.push(slot);
    }
  }
  return slots;
}

// Adds a slot to the queue of slots waiting to be sent. A slot is never queued twice.
// ``first`` puts it at the front: a text the user has just saved goes before resends.
function queueAdd(queue, slot, first) {
  var position = queue.indexOf(slot);
  if (first) {
    if (position >= 0) {
      queue.splice(position, 1);
    }
    queue.unshift(slot);
  } else if (position < 0) {
    queue.push(slot);
  }
}

// Everything needed to send the saved version of a slot.
function buildTransfer(storage, slot) {
  var normalized = text.normalizeText(storage.getItem(storageKey('text', slot)) || '');
  return {
    slot: slot,
    id: Number(storage.getItem(storageKey('textId', slot))),
    name: text.makeName(storage.getItem(storageKey('name', slot)) || '', normalized),
    chunks: text.splitIntoChunks(normalized),
    totalBytes: text.utf8Length(normalized)
  };
}

// The AppMessage for one chunk. The name travels with the first chunk only.
function chunkMessage(transfer, index) {
  var message = {
    'TransferId': transfer.id,
    'Slot': transfer.slot,
    'ChunkIndex': index,
    'ChunkCount': transfer.chunks.length,
    'TotalBytes': transfer.totalBytes,
    'ChunkData': transfer.chunks[index]
  };
  if (index === 0) {
    message.Name = transfer.name;
  }
  return message;
}

module.exports = {
  SLOT_COUNT: SLOT_COUNT,
  storageKey: storageKey,
  migrateStorage: migrateStorage,
  localIds: localIds,
  watchIdsFromPayload: watchIdsFromPayload,
  slotsToResend: slotsToResend,
  queueAdd: queueAdd,
  buildTransfer: buildTransfer,
  chunkMessage: chunkMessage
};
