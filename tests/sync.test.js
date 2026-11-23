var assert = require('node:assert');
var test = require('node:test');

var sync = require('../src/pkjs/sync');
var text = require('../src/pkjs/text');

// A stand-in for localStorage.
function fakeStorage(initial) {
  var values = Object.assign({}, initial);
  return {
    values: values,
    getItem: function(key) {
      return Object.prototype.hasOwnProperty.call(values, key) ? values[key] : null;
    },
    setItem: function(key, value) {
      values[key] = String(value);
    },
    removeItem: function(key) {
      delete values[key];
    }
  };
}

test('storageKey appends the slot number', function() {
  assert.strictEqual(sync.storageKey('text', 0), 'text0');
  assert.strictEqual(sync.storageKey('syncState', 4), 'syncState4');
});

test('migrateStorage turns the single text of version 1.1 into slot 0', function() {
  var storage = fakeStorage({text: 'Привіт', textId: '123', syncState: 'synced'});
  sync.migrateStorage(storage);
  assert.deepStrictEqual(storage.values, {
    text0: 'Привіт',
    name0: '',
    textId0: '123',
    syncState0: 'synced'
  });
});

test('migrateStorage does nothing without old keys', function() {
  var storage = fakeStorage({text1: 'a', textId1: '5', syncState1: 'synced', name1: 'n'});
  var before = Object.assign({}, storage.values);
  sync.migrateStorage(storage);
  assert.deepStrictEqual(storage.values, before);
});

test('migrateStorage does not overwrite slot 0 when run again', function() {
  var storage = fakeStorage({
    text: 'old', textId: '1', syncState: 'failed',
    text0: 'new', name0: 'n', textId0: '2', syncState0: 'synced'
  });
  sync.migrateStorage(storage);
  assert.deepStrictEqual(storage.values, {
    text0: 'new', name0: 'n', textId0: '2', syncState0: 'synced'
  });
});

test('localIds gives a number for saved slots and null for the rest', function() {
  var storage = fakeStorage({textId0: '10', textId3: '40'});
  assert.deepStrictEqual(sync.localIds(storage), [10, null, null, 40, null]);
});

test('watchIdsFromPayload reads the five ids', function() {
  var payload = {SlotId0: 1, SlotId1: 0, SlotId2: 3, SlotId3: 0, SlotId4: 5};
  assert.deepStrictEqual(sync.watchIdsFromPayload(payload), [1, 0, 3, 0, 5]);
});

test('watchIdsFromPayload gives null for other messages', function() {
  assert.strictEqual(sync.watchIdsFromPayload({ResultId: 7, ResultOk: 1}), null);
  assert.strictEqual(sync.watchIdsFromPayload({SlotId0: 1, SlotId1: 2}), null);
});

test('slotsToResend picks only slots where the ids differ', function() {
  assert.deepStrictEqual(sync.slotsToResend([1, 2, 3, 4, 5], [1, 2, 3, 4, 5]), []);
  assert.deepStrictEqual(sync.slotsToResend([1, 2, 3, 4, 5], [1, 0, 3, 9, 5]), [1, 3]);
  // After a reinstall the watch has nothing.
  assert.deepStrictEqual(sync.slotsToResend([1, null, 3, null, null], [0, 0, 0, 0, 0]), [0, 2]);
});

test('slotsToResend leaves slots that were never saved on this phone', function() {
  assert.deepStrictEqual(sync.slotsToResend([null, null, null, null, null], [7, 0, 8, 0, 0]), []);
});

test('queueAdd keeps the order and never holds a slot twice', function() {
  var queue = [];
  sync.queueAdd(queue, 1, false);
  sync.queueAdd(queue, 3, false);
  sync.queueAdd(queue, 1, false);
  assert.deepStrictEqual(queue, [1, 3]);
});

test('queueAdd puts a saved slot before the resends', function() {
  var queue = [1, 3, 4];
  sync.queueAdd(queue, 3, true);
  assert.deepStrictEqual(queue, [3, 1, 4]);
  sync.queueAdd(queue, 0, true);
  assert.deepStrictEqual(queue, [0, 3, 1, 4]);
});

test('the queue sends resends one by one in slot order', function() {
  var queue = [];
  sync.slotsToResend([1, 2, 3, null, 5], [0, 2, 0, 0, 0]).forEach(function(slot) {
    sync.queueAdd(queue, slot, false);
  });
  assert.deepStrictEqual(queue, [0, 2, 4]);
  assert.strictEqual(queue.shift(), 0);
  // A save for slot 4 arrives while slot 0 is being sent: it goes next.
  sync.queueAdd(queue, 4, true);
  assert.deepStrictEqual(queue, [4, 2]);
});

test('pageSlots reports text, name and state of every slot', function() {
  var storage = fakeStorage({
    text0: 'Перший', name0: 'Назва', textId0: '1', syncState0: 'synced',
    text1: 'Другий', name1: '', textId1: '2', syncState1: 'failed',
    text2: 'Третій', name2: '', textId2: '3', syncState2: 'pending',
    // A slot that was cleared on the watch.
    text3: '', name3: '', textId3: '4', syncState3: 'synced',
    // A clearing that has not reached the watch yet.
    text4: ' \n', name4: '', textId4: '5', syncState4: 'failed'
  });
  assert.deepStrictEqual(sync.pageSlots(storage), [
    {text: 'Перший', name: 'Назва', state: 'synced'},
    {text: 'Другий', name: '', state: 'failed'},
    {text: 'Третій', name: '', state: 'pending'},
    {text: '', name: '', state: 'empty'},
    {text: ' \n', name: '', state: 'failed'}
  ]);
});

test('pageSlots shows slots never saved on this phone as empty', function() {
  sync.pageSlots(fakeStorage({})).forEach(function(slot) {
    assert.deepStrictEqual(slot, {text: '', name: '', state: 'empty'});
  });
});

test('pageSlots shows a text that is only on the watch with its name from the watch', function() {
  var storage = fakeStorage({
    // Saved on this phone: its own copy wins, even an emptied one.
    text0: 'Перший', name0: '', textId0: '1', syncState0: 'synced',
    text1: '', name1: '', textId1: '2', syncState1: 'synced'
  });
  sync.takeWatchSlots(storage, [
    {name: 'Інша', bytes: 10}, {name: 'Стара', bytes: 20}, {name: 'Нотатки', bytes: 30},
    {name: 'Порожній', bytes: 0}, {name: '', bytes: 0}
  ]);
  assert.deepStrictEqual(sync.pageSlots(storage), [
    {text: 'Перший', name: '', state: 'synced'},
    {text: '', name: '', state: 'empty'},
    {text: '', name: '', state: 'watch', watchName: 'Нотатки'},
    {text: '', name: '', state: 'empty'},
    {text: '', name: '', state: 'empty'}
  ]);
});

test('stateFromPayload reads the names and sizes of the texts on the watch', function() {
  var payload = {SlotId0: 1, SlotId1: 0, SlotId2: 0, SlotId3: 0, SlotId4: 0};
  assert.strictEqual(sync.stateFromPayload(payload).watchSlots, null);
  for (var slot = 0; slot < sync.SLOT_COUNT; slot++) {
    payload['SlotName' + slot] = slot === 0 ? 'Назва' : '';
    payload['SlotSize' + slot] = slot === 0 ? 1234 : 0;
  }
  var watchSlots = sync.stateFromPayload(payload).watchSlots;
  assert.deepStrictEqual(watchSlots[0], {name: 'Назва', bytes: 1234});
  assert.deepStrictEqual(watchSlots[4], {name: '', bytes: 0});
  var declared = require('../package.json').pebble.messageKeys;
  Object.keys(payload).forEach(function(key) {
    assert.ok(declared.indexOf(key) >= 0, key);
  });
});

test('selectedSlot opens the slot saved last, 0 by default', function() {
  assert.strictEqual(sync.selectedSlot(fakeStorage({})), 0);
  assert.strictEqual(sync.selectedSlot(fakeStorage({lastSlot: '3'})), 3);
  assert.strictEqual(sync.selectedSlot(fakeStorage({lastSlot: '7'})), 0);
  assert.strictEqual(sync.selectedSlot(fakeStorage({lastSlot: 'x'})), 0);
});

test('buildTransfer normalizes the text and splits it into chunks', function() {
  var saved = 'Перший рядок\r\n\r\n\r\n\r\nДругий ' + 'ї'.repeat(600);
  var storage = fakeStorage({text2: saved, name2: '', textId2: '777'});
  var transfer = sync.buildTransfer(storage, 2);
  var normalized = text.normalizeText(saved);
  assert.strictEqual(transfer.slot, 2);
  assert.strictEqual(transfer.id, 777);
  assert.strictEqual(transfer.name, 'Перший рядок');
  assert.strictEqual(transfer.chunks.join(''), normalized);
  assert.strictEqual(transfer.totalBytes, Buffer.byteLength(normalized, 'utf8'));
  assert.strictEqual(transfer.chunks.length, 2);
});

test('buildTransfer uses the typed name when there is one', function() {
  var storage = fakeStorage({text0: 'Текст', name0: '  Моя назва ', textId0: '1'});
  assert.strictEqual(sync.buildTransfer(storage, 0).name, 'Моя назва');
});

test('buildTransfer of an emptied slot is one empty chunk', function() {
  var storage = fakeStorage({text1: '', name1: '', textId1: '9'});
  var transfer = sync.buildTransfer(storage, 1);
  assert.deepStrictEqual(transfer.chunks, ['']);
  assert.strictEqual(transfer.totalBytes, 0);
  assert.strictEqual(transfer.name, '');
});

test('chunkMessage carries the slot in every chunk and the name in the first', function() {
  var transfer = {slot: 3, id: 42, name: 'Назва', chunks: ['aa', 'bb', 'c'], totalBytes: 5};
  assert.deepStrictEqual(sync.chunkMessage(transfer, 0), {
    TransferId: 42, Slot: 3, ChunkIndex: 0, ChunkCount: 3, TotalBytes: 5, ChunkData: 'aa',
    Name: 'Назва'
  });
  assert.deepStrictEqual(sync.chunkMessage(transfer, 2), {
    TransferId: 42, Slot: 3, ChunkIndex: 2, ChunkCount: 3, TotalBytes: 5, ChunkData: 'c'
  });
});

test('chunkMessage uses only keys declared in package.json', function() {
  var declared = require('../package.json').pebble.messageKeys;
  var transfer = {slot: 0, id: 1, name: 'n', chunks: ['a'], totalBytes: 1};
  Object.keys(sync.chunkMessage(transfer, 0)).forEach(function(key) {
    assert.ok(declared.indexOf(key) >= 0, key);
  });
  for (var slot = 0; slot < sync.SLOT_COUNT; slot++) {
    assert.ok(declared.indexOf('SlotId' + slot) >= 0);
  }
});

test('textFits measures the text as it will be sent', function() {
  assert.strictEqual(sync.textFits('ї'.repeat(text.MAX_TEXT_BYTES / 2)), true);
  assert.strictEqual(sync.textFits('ї'.repeat(text.MAX_TEXT_BYTES / 2) + 'a'), false);
  // Characters that normalization removes do not count.
  assert.strictEqual(sync.textFits('a'.repeat(text.MAX_TEXT_BYTES) + '́​'), true);
});
