var assert = require('node:assert');
var test = require('node:test');

var sync = require('../src/pkjs/sync');

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

var DEFAULTS = {showTime: true, sizes: [14, 18, 20, 24], menuSize: 18, invert: false,
  scrollMode: 'screen'};

// Full settings with the given fields changed.
function settingsWith(fields) {
  return Object.assign({}, DEFAULTS, fields);
}

test('the sizes match the fonts in package.json', function() {
  var fonts = require('../package.json').pebble.resources.media.filter(function(item) {
    return item.type === 'font';
  });
  assert.deepStrictEqual(fonts.map(function(font) {
    return Number(font.name.match(/_(\d+)$/)[1]);
  }), sync.SIZES);
});

test('encodeSizeMask and decodeSizeMask use one bit per size, smallest first', function() {
  assert.strictEqual(sync.encodeSizeMask([14]), 1);
  assert.strictEqual(sync.encodeSizeMask([24]), 8);
  assert.strictEqual(sync.encodeSizeMask([14, 18, 20, 24]), 15);
  assert.strictEqual(sync.encodeSizeMask([18, 24]), 10);
  assert.strictEqual(sync.encodeSizeMask([24, 18, 32]), 10);
  assert.deepStrictEqual(sync.decodeSizeMask(10), [18, 24]);
  assert.deepStrictEqual(sync.decodeSizeMask(15), [14, 18, 20, 24]);
  assert.deepStrictEqual(sync.decodeSizeMask(0), []);
  for (var mask = 1; mask < 16; mask++) {
    assert.strictEqual(sync.encodeSizeMask(sync.decodeSizeMask(mask)), mask);
  }
});

test('normalizeSettings fills in defaults and drops invalid values', function() {
  assert.deepStrictEqual(sync.normalizeSettings(null), DEFAULTS);
  assert.deepStrictEqual(sync.normalizeSettings({}), DEFAULTS);
  assert.deepStrictEqual(sync.normalizeSettings({showTime: false, sizes: [24, 14], menuSize: 20}),
    settingsWith({showTime: false, sizes: [14, 24], menuSize: 20}));
  // At least one size always stays.
  assert.deepStrictEqual(sync.normalizeSettings({sizes: []}).sizes, [14, 18, 20, 24]);
  assert.deepStrictEqual(sync.normalizeSettings({sizes: [32, 16]}).sizes, [14, 18, 20, 24]);
  assert.strictEqual(sync.normalizeSettings({menuSize: 32}).menuSize, 18);
});

test('settingsMessage encodes the settings with declared keys', function() {
  var message = sync.settingsMessage({showTime: false, sizes: [18, 20], menuSize: 24});
  assert.deepStrictEqual(message,
    {ShowTime: 0, SizeMask: 6, MenuSize: 24, Invert: 0, ScrollMode: 0});
  var declared = require('../package.json').pebble.messageKeys;
  Object.keys(message).concat(['TextSize']).forEach(function(key) {
    assert.ok(declared.indexOf(key) >= 0, key);
  });
});

test('stateFromPayload reads ids, settings and text size', function() {
  var payload = {SlotId0: 1, SlotId1: 0, SlotId2: 3, SlotId3: 0, SlotId4: 5,
    ShowTime: 0, SizeMask: 9, MenuSize: 20, Invert: 1, ScrollMode: 1, TextSize: 24};
  assert.deepStrictEqual(sync.stateFromPayload(payload), {
    ids: [1, 0, 3, 0, 5],
    settings: {showTime: false, sizes: [14, 24], menuSize: 20, invert: true, scrollMode: 'smooth'},
    textSize: 24,
    watchSlots: null
  });
});

test('stateFromPayload accepts a state without settings and rejects other messages', function() {
  var payload = {SlotId0: 1, SlotId1: 2, SlotId2: 3, SlotId3: 4, SlotId4: 5};
  assert.deepStrictEqual(sync.stateFromPayload(payload),
    {ids: [1, 2, 3, 4, 5], settings: null, textSize: null, watchSlots: null});
  assert.strictEqual(sync.stateFromPayload({ResultId: 1, ResultOk: 1}), null);
});

test('stateFromPayload ignores an unknown text size', function() {
  var payload = {SlotId0: 0, SlotId1: 0, SlotId2: 0, SlotId3: 0, SlotId4: 0,
    ShowTime: 1, SizeMask: 15, MenuSize: 18, TextSize: 32};
  assert.strictEqual(sync.stateFromPayload(payload).textSize, null);
});

test('takeWatchSettings adopts the watch settings without a pending change', function() {
  var storage = fakeStorage({});
  var watch = settingsWith({showTime: false, sizes: [18], menuSize: 14});
  assert.strictEqual(sync.takeWatchSettings(storage, watch, 18), false);
  assert.deepStrictEqual(sync.readSettings(storage, 'settings'), watch);
  assert.strictEqual(storage.getItem('settingsState'), 'synced');
  assert.strictEqual(storage.getItem('textSize'), '18');
});

test('takeWatchSettings asks to resend a change that has not arrived', function() {
  var wanted = settingsWith({showTime: false, sizes: [20, 24], menuSize: 24, invert: true});
  ['pending', 'failed'].forEach(function(state) {
    var storage = fakeStorage({settings: JSON.stringify(wanted), settingsState: state});
    assert.strictEqual(sync.takeWatchSettings(storage, DEFAULTS, 20), true);
    assert.deepStrictEqual(sync.readSettings(storage, 'settings'), wanted);
    assert.strictEqual(storage.getItem('settingsState'), state);
  });
});

test('takeWatchSettings marks a change as delivered when the watch has it', function() {
  var wanted = {showTime: false, sizes: [20, 24], menuSize: 24};
  var storage = fakeStorage({settings: JSON.stringify(wanted), settingsState: 'pending'});
  assert.strictEqual(sync.takeWatchSettings(storage, wanted, 20), false);
  assert.strictEqual(storage.getItem('settingsState'), 'synced');
});

test('pageSettings prefers the wanted settings, then the watch ones, then defaults', function() {
  assert.deepStrictEqual(sync.pageSettings(fakeStorage({})),
    {settings: DEFAULTS, textSize: null, failed: false});
  var watch = settingsWith({showTime: false, sizes: [14], menuSize: 14});
  var wanted = settingsWith({sizes: [24], menuSize: 24, scrollMode: 'smooth'});
  assert.deepStrictEqual(sync.pageSettings(fakeStorage({
    watchSettings: JSON.stringify(watch), textSize: '14'
  })), {settings: watch, textSize: 14, failed: false});
  assert.deepStrictEqual(sync.pageSettings(fakeStorage({
    watchSettings: JSON.stringify(watch), settings: JSON.stringify(wanted),
    settingsState: 'failed', textSize: '24'
  })), {settings: wanted, textSize: 24, failed: true});
});

test('the settings always go first in the queue, texts right after them', function() {
  var queue = [2, 4];
  sync.queueAdd(queue, sync.SETTINGS_ITEM, false);
  assert.deepStrictEqual(queue, ['settings', 2, 4]);
  sync.queueAdd(queue, 4, true);
  assert.deepStrictEqual(queue, ['settings', 4, 2]);
  sync.queueAdd(queue, 1, false);
  sync.queueAdd(queue, sync.SETTINGS_ITEM, true);
  assert.deepStrictEqual(queue, ['settings', 4, 2, 1]);
  var withoutSettings = [3];
  sync.queueAdd(withoutSettings, 0, true);
  assert.deepStrictEqual(withoutSettings, [0, 3]);
});

test('normalizeSettings gives invert and scrollMode their defaults', function() {
  var old = sync.normalizeSettings({showTime: false, sizes: [18], menuSize: 20});
  assert.strictEqual(old.invert, false);
  assert.strictEqual(old.scrollMode, 'screen');
  assert.strictEqual(sync.normalizeSettings({invert: 1}).invert, false);
  assert.strictEqual(sync.normalizeSettings({scrollMode: 'fast'}).scrollMode, 'screen');
  assert.strictEqual(sync.normalizeSettings({invert: true, scrollMode: 'smooth'}).invert, true);
  assert.strictEqual(sync.normalizeSettings({invert: true, scrollMode: 'smooth'}).scrollMode,
    'smooth');
});

test('settingsMessage encodes invert and scrollMode as 0 or 1', function() {
  var message = sync.settingsMessage({invert: true, scrollMode: 'smooth'});
  assert.strictEqual(message.Invert, 1);
  assert.strictEqual(message.ScrollMode, 1);
  var declared = require('../package.json').pebble.messageKeys;
  ['Invert', 'ScrollMode'].forEach(function(key) {
    assert.ok(declared.indexOf(key) >= 0, key);
  });
});

test('stateFromPayload of a watch without the new settings gives their defaults', function() {
  var payload = {SlotId0: 0, SlotId1: 0, SlotId2: 0, SlotId3: 0, SlotId4: 0,
    ShowTime: 1, SizeMask: 15, MenuSize: 18, TextSize: 20};
  var settings = sync.stateFromPayload(payload).settings;
  assert.strictEqual(settings.invert, false);
  assert.strictEqual(settings.scrollMode, 'screen');
});

test('settings saved by version 1.3 compare equal to the same settings with defaults', function() {
  var storage = fakeStorage({settings: JSON.stringify({showTime: false, sizes: [18], menuSize: 20})});
  var stored = sync.readSettings(storage, 'settings');
  assert.ok(sync.settingsEqual(stored, settingsWith({showTime: false, sizes: [18], menuSize: 20})));
  assert.ok(!sync.settingsEqual(stored,
    settingsWith({showTime: false, sizes: [18], menuSize: 20, invert: true})));
});
