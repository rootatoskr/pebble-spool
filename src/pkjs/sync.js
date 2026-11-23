// The parts of the phone-to-watch synchronization that do not need the Pebble
// runtime, so that they can be tested with plain Node.js.

var text = require('./text');

// Keep in sync with ``STORAGE_TEXT_COUNT`` in ``src/c/storage.h``.
var SLOT_COUNT = 5;
// The text sizes in pixels, smallest first; bit ``i`` of a size mask stands for SIZES[i].
// Keep in sync with ``SETTINGS_SIZES`` in ``src/c/settings.c``.
var SIZES = [14, 18, 20, 24];
var DEFAULT_MENU_SIZE = 18;
// The queue item that stands for the appearance settings; texts are queued by slot number.
var SETTINGS_ITEM = 'settings';

// localStorage keeps four values for every slot, the slot number is appended to the key:
// - text: the text as the user saved it;
// - name: the name as the user typed it, may be empty;
// - textId: id of that version, the watch stores it together with the text;
// - syncState: 'pending', 'synced' or 'failed'.
// One more key, lastSlot, remembers which slot was saved last.
// The appearance settings use four keys of their own:
// - settings: the settings the phone wants on the watch, as JSON;
// - settingsState: 'synced', 'pending' or 'failed', as for texts;
// - watchSettings: the settings the watch reported last, as JSON;
// - textSize: the text size the watch reported last.
// One more key, watchSlots, keeps the name and size of every text the watch reported
// last, as JSON. The page uses it for the texts this phone has no copy of.
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

// Appearance settings: ``showTime``, ``sizes`` (the sizes that holding Select cycles
// through, never empty), ``menuSize``, ``invert`` and ``scrollMode`` ('screen' or
// 'smooth'). Anything invalid or missing, as in settings from version 1.3, becomes
// the default.
function normalizeSettings(settings) {
  settings = settings || {};
  var sizes = SIZES.filter(function(size) {
    return (settings.sizes || []).indexOf(size) >= 0;
  });
  return {
    showTime: settings.showTime !== false,
    sizes: sizes.length > 0 ? sizes : SIZES.slice(),
    menuSize: SIZES.indexOf(settings.menuSize) >= 0 ? settings.menuSize : DEFAULT_MENU_SIZE,
    invert: settings.invert === true,
    scrollMode: settings.scrollMode === 'smooth' ? 'smooth' : 'screen'
  };
}

function settingsEqual(a, b) {
  return JSON.stringify(normalizeSettings(a)) === JSON.stringify(normalizeSettings(b));
}

function encodeSizeMask(sizes) {
  var mask = 0;
  SIZES.forEach(function(size, index) {
    if (sizes.indexOf(size) >= 0) {
      mask |= 1 << index;
    }
  });
  return mask;
}

function decodeSizeMask(mask) {
  return SIZES.filter(function(size, index) {
    return (mask & (1 << index)) !== 0;
  });
}

// The AppMessage that sends the settings to the watch.
function settingsMessage(settings) {
  settings = normalizeSettings(settings);
  return {
    'ShowTime': settings.showTime ? 1 : 0,
    'SizeMask': encodeSizeMask(settings.sizes),
    'MenuSize': settings.menuSize,
    'Invert': settings.invert ? 1 : 0,
    'ScrollMode': settings.scrollMode === 'smooth' ? 1 : 0
  };
}

function readSettings(storage, key) {
  try {
    var value = storage.getItem(key);
    return value === null ? null : normalizeSettings(JSON.parse(value));
  } catch (e) {
    return null;
  }
}

// What the settings page shows: the settings the phone wants, or before anything was
// saved, the ones the watch reported, or the defaults; and the watch's text size.
function pageSettings(storage) {
  var textSize = Number(storage.getItem('textSize'));
  return {
    settings: readSettings(storage, 'settings') || readSettings(storage, 'watchSettings') ||
      normalizeSettings(null),
    textSize: SIZES.indexOf(textSize) >= 0 ? textSize : null,
    failed: storage.getItem('settingsState') === 'failed'
  };
}

// Stores the settings the watch reported. Returns true if the settings the phone wants
// differ and have to be sent again. Without a pending change the watch's settings are
// taken as they are: they may have been set from another phone.
function takeWatchSettings(storage, watchSettings, textSize) {
  storage.setItem('watchSettings', JSON.stringify(watchSettings));
  if (textSize !== null) {
    storage.setItem('textSize', String(textSize));
  }
  var state = storage.getItem('settingsState');
  var wanted = readSettings(storage, 'settings');
  if (!wanted || (state !== 'pending' && state !== 'failed')) {
    storage.setItem('settings', JSON.stringify(watchSettings));
    storage.setItem('settingsState', 'synced');
    return false;
  }
  if (settingsEqual(wanted, watchSettings)) {
    storage.setItem('settingsState', 'synced');
    return false;
  }
  return true;
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

// Reads the state the watch reports: the ids of all slots and, from a watch that has
// appearance settings, those and its text size. Returns null for any other message.
// Returns ``[{name, bytes}]`` for every slot, or null if the message has none.
function watchSlotsFromPayload(payload) {
  var slots = [];
  for (var slot = 0; slot < SLOT_COUNT; slot++) {
    var name = payload['SlotName' + slot];
    var bytes = payload['SlotSize' + slot];
    if (name === undefined || bytes === undefined) {
      return null;
    }
    slots.push({name: name, bytes: bytes});
  }
  return slots;
}

function stateFromPayload(payload) {
  var ids = watchIdsFromPayload(payload);
  if (!ids) {
    return null;
  }
  var state = {ids: ids, settings: null, textSize: null,
    watchSlots: watchSlotsFromPayload(payload)};
  if (payload.SizeMask !== undefined) {
    state.settings = normalizeSettings({
      showTime: payload.ShowTime !== 0,
      sizes: decodeSizeMask(payload.SizeMask),
      menuSize: payload.MenuSize,
      invert: payload.Invert === 1,
      scrollMode: payload.ScrollMode === 1 ? 'smooth' : 'screen'
    });
    state.textSize = SIZES.indexOf(payload.TextSize) >= 0 ? payload.TextSize : null;
  }
  return state;
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

// Adds a slot or SETTINGS_ITEM to the queue of what waits to be sent. Nothing is queued
// twice. ``first`` puts a slot at the front: a text the user has just saved goes before
// resends. The settings always go first: they are one short message.
function queueAdd(queue, item, first) {
  var position = queue.indexOf(item);
  if (item === SETTINGS_ITEM) {
    first = true;
  }
  if (first) {
    if (position >= 0) {
      queue.splice(position, 1);
    }
    var at = (item !== SETTINGS_ITEM && queue[0] === SETTINGS_ITEM) ? 1 : 0;
    queue.splice(at, 0, item);
  } else if (position < 0) {
    queue.push(item);
  }
}

// What the settings page shows for every slot. A slot that was cleared and whose
// clearing reached the watch counts as empty again.
function takeWatchSlots(storage, watchSlots) {
  storage.setItem('watchSlots', JSON.stringify(watchSlots));
}

function readWatchSlots(storage) {
  try {
    var value = JSON.parse(storage.getItem('watchSlots') || 'null');
    return Array.isArray(value) ? value : [];
  } catch (e) {
    return [];
  }
}

// A slot never saved on this phone is 'watch' if the watch reported a text in it: the
// page shows its name from the watch as ``watchName``.
function pageSlots(storage) {
  var watchSlots = readWatchSlots(storage);
  var slots = [];
  for (var slot = 0; slot < SLOT_COUNT; slot++) {
    var saved = storage.getItem(storageKey('text', slot)) || '';
    var syncState = storage.getItem(storageKey('syncState', slot)) || 'pending';
    var neverSaved = storage.getItem(storageKey('textId', slot)) === null;
    var empty = neverSaved || (syncState === 'synced' && !text.normalizeText(saved));
    var onWatch = neverSaved && watchSlots[slot] && watchSlots[slot].bytes > 0;
    var pageSlot = {
      text: saved,
      name: storage.getItem(storageKey('name', slot)) || '',
      state: onWatch ? 'watch' : empty ? 'empty' : syncState
    };
    if (onWatch) {
      pageSlot.watchName = watchSlots[slot].name;
    }
    slots.push(pageSlot);
  }
  return slots;
}

// The slot the settings page opens with: the one saved last.
function selectedSlot(storage) {
  var slot = Number(storage.getItem('lastSlot'));
  return slot >= 0 && slot < SLOT_COUNT && slot === Math.floor(slot) ? slot : 0;
}

// Everything needed to send the saved version of a slot.
// Whether ``value`` fits on the watch once it is normalized as it will be sent.
function textFits(value) {
  return text.utf8Length(text.normalizeText(value)) <= text.MAX_TEXT_BYTES;
}

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
  SIZES: SIZES,
  SETTINGS_ITEM: SETTINGS_ITEM,
  normalizeSettings: normalizeSettings,
  settingsEqual: settingsEqual,
  encodeSizeMask: encodeSizeMask,
  decodeSizeMask: decodeSizeMask,
  settingsMessage: settingsMessage,
  readSettings: readSettings,
  pageSettings: pageSettings,
  takeWatchSettings: takeWatchSettings,
  stateFromPayload: stateFromPayload,
  takeWatchSlots: takeWatchSlots,
  storageKey: storageKey,
  migrateStorage: migrateStorage,
  localIds: localIds,
  watchIdsFromPayload: watchIdsFromPayload,
  slotsToResend: slotsToResend,
  queueAdd: queueAdd,
  pageSlots: pageSlots,
  selectedSlot: selectedSlot,
  textFits: textFits,
  buildTransfer: buildTransfer,
  chunkMessage: chunkMessage
};
