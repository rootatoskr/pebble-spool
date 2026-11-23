var assert = require('node:assert');
var test = require('node:test');

var text = require('../src/pkjs/text');
var sync = require('../src/pkjs/sync');

var fonts = require('../package.json').pebble.resources.media.filter(function(media) {
  return media.type === 'font';
});
var inFont = new RegExp('^(?:\\n|' + fonts[0].characterRegex + ')*$');

// A small deterministic generator, so that a failure can be repeated.
function generator(seed) {
  var state = seed >>> 0;
  return function(limit) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state % limit;
  };
}

// Ranges that the normalization has to deal with: ASCII and controls, Latin-1,
// combining marks, Cyrillic, Hebrew and Arabic (RTL), typographic spaces and zero-width
// characters, bidi controls, CJK, private use, lone surrogates and emoji.
var RANGES = [
  [0x00, 0x7f], [0x80, 0xff], [0x300, 0x36f], [0x400, 0x4ff], [0x590, 0x6ff],
  [0x2000, 0x206f], [0x20a0, 0x20cf], [0x2100, 0x214f], [0x4e00, 0x4e80], [0xe000, 0xe010],
  [0xfe00, 0xfe0f], [0xfeff, 0xfeff], [0xd800, 0xdfff]
];

function randomString(next, maxLength) {
  var length = next(maxLength + 1);
  var result = '';
  for (var i = 0; i < length; i++) {
    var kind = next(RANGES.length + 3);
    if (kind === RANGES.length) {
      result += '\n';
    } else if (kind === RANGES.length + 1) {
      result += ' ';
    } else if (kind === RANGES.length + 2) {
      // An emoji: a surrogate pair.
      result += String.fromCodePoint(0x1f300 + next(0x300));
    } else {
      var range = RANGES[kind];
      result += String.fromCharCode(range[0] + next(range[1] - range[0] + 1));
    }
  }
  return result;
}

test('normalizeText on random Unicode keeps only font characters and is stable', function() {
  var next = generator(1);
  for (var run = 0; run < 5000; run++) {
    var input = randomString(next, 200);
    var output = text.normalizeText(input);
    assert.ok(inFont.test(output), JSON.stringify(input));
    assert.ok(!/ \n/.test(output), JSON.stringify(input));
    assert.ok(!/\n{3}/.test(output), JSON.stringify(input));
    assert.ok(output === '' || /\S/.test(output), JSON.stringify(input));
    // The page counts the normalized draft and the phone normalizes it again before sending.
    assert.strictEqual(text.normalizeText(output), output, JSON.stringify(input));
    assert.strictEqual(text.utf8Length(output), Buffer.byteLength(output, 'utf8'));
  }
});

test('splitIntoChunks on random normalized text up to the limit loses nothing', function() {
  var next = generator(2);
  for (var run = 0; run < 2000; run++) {
    var normalized = text.normalizeText(randomString(next, 6000));
    var chunks = text.splitIntoChunks(normalized);
    assert.strictEqual(chunks.join(''), normalized);
    chunks.forEach(function(chunk, index) {
      var bytes = Buffer.byteLength(chunk, 'utf8');
      assert.ok(bytes <= text.CHUNK_MAX_BYTES, String(bytes));
      // Only the last chunk may be short by more than one character.
      if (index + 1 < chunks.length) {
        assert.ok(bytes > text.CHUNK_MAX_BYTES - 3, String(bytes));
      }
      // A chunk that cut a character would not survive a round trip through UTF-8.
      assert.strictEqual(Buffer.from(chunk, 'utf8').toString('utf8'), chunk);
    });
  }
});

test('the largest allowed texts split into chunks within the limit', function() {
  [
    'a'.repeat(text.MAX_TEXT_BYTES),
    'ї'.repeat(text.MAX_TEXT_BYTES / 2),
    '€'.repeat(Math.floor(text.MAX_TEXT_BYTES / 3)) + 'ab',
    'ab\n'.repeat(text.MAX_TEXT_BYTES / 3) + 'ab'
  ].forEach(function(sample) {
    var normalized = text.normalizeText(sample);
    assert.strictEqual(text.utf8Length(normalized), text.MAX_TEXT_BYTES);
    var chunks = text.splitIntoChunks(normalized);
    chunks.forEach(function(chunk) {
      assert.ok(Buffer.byteLength(chunk, 'utf8') <= text.CHUNK_MAX_BYTES);
    });
    assert.strictEqual(chunks.join(''), normalized);
  });
});

test('makeName on random input fits the byte limit and has no line breaks', function() {
  var next = generator(3);
  for (var run = 0; run < 5000; run++) {
    var name = randomString(next, 60);
    var body = text.normalizeText(randomString(next, 100));
    var result = text.makeName(name, body);
    assert.ok(Buffer.byteLength(result, 'utf8') <= text.NAME_MAX_BYTES, JSON.stringify(name));
    assert.ok(!/\n/.test(result));
    assert.ok(!/^ | $/.test(result), JSON.stringify(result));
    assert.ok(inFont.test(result));
  }
});

test('makeName at the 32-byte limit with two- and three-byte characters', function() {
  // 31 bytes of ASCII and a two-byte letter: the letter does not fit and goes as a whole.
  assert.strictEqual(text.makeName('a'.repeat(31) + 'ї', ''), 'a'.repeat(31));
  assert.strictEqual(text.makeName('a'.repeat(30) + 'ї', ''), 'a'.repeat(30) + 'ї');
  assert.strictEqual(text.makeName('a'.repeat(30) + '€', ''), 'a'.repeat(30));
  assert.strictEqual(text.makeName('', ''), '');
  assert.strictEqual(text.makeName(' \n \t ', 'Text'), 'Text');
  assert.strictEqual(text.makeName(String.fromCodePoint(0x1f600).repeat(40), ''), '?'.repeat(32));
});

test('stateFromPayload of broken or foreign states', function() {
  var ids = {SlotId0: 1, SlotId1: 2, SlotId2: 3, SlotId3: 4, SlotId4: 5};
  // Version 1.2: ids only.
  assert.deepStrictEqual(sync.stateFromPayload(ids),
    {ids: [1, 2, 3, 4, 5], settings: null, textSize: null, watchSlots: null});
  // An id missing: not a state.
  assert.strictEqual(sync.stateFromPayload({SlotId0: 1, SlotId1: 2}), null);
  // A slot the phone does not know about is ignored.
  var extra = Object.assign({SlotId5: 6, SlotName5: 'x', SlotSize5: 1}, ids);
  assert.deepStrictEqual(sync.stateFromPayload(extra).ids, [1, 2, 3, 4, 5]);
  // Names without sizes for one slot: no slot information at all.
  var partial = Object.assign({}, ids);
  for (var slot = 0; slot < 5; slot++) {
    partial['SlotName' + slot] = 'n';
    if (slot !== 3) {
      partial['SlotSize' + slot] = 1;
    }
  }
  assert.strictEqual(sync.stateFromPayload(partial).watchSlots, null);
  // A size mask that enables nothing and an unknown menu size fall back to defaults.
  var odd = Object.assign({ShowTime: 7, SizeMask: 0, MenuSize: 99, TextSize: 99}, ids);
  var state = sync.stateFromPayload(odd);
  assert.deepStrictEqual(state.settings.sizes, sync.SIZES);
  assert.strictEqual(state.settings.menuSize, 18);
  assert.strictEqual(state.textSize, null);
});

function fakeStorage(initial) {
  var values = Object.assign({}, initial);
  return {
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

test('broken settings in localStorage fall back to the watch settings or defaults', function() {
  var storage = fakeStorage({settings: '{"showTime":', watchSettings: 'null'});
  assert.strictEqual(sync.readSettings(storage, 'settings'), null);
  var page = sync.pageSettings(storage);
  assert.deepStrictEqual(page.settings.sizes, sync.SIZES);
});

test('pageSlots with data of version 1.2 (no watchSlots) and incomplete slots', function() {
  var storage = fakeStorage({text0: 'A', textId0: '1', syncState0: 'synced', text2: 'C', textId2: '3'});
  var slots = sync.pageSlots(storage);
  assert.strictEqual(slots[0].state, 'synced');
  // A slot with a text but no sync state counts as not delivered.
  assert.strictEqual(slots[2].state, 'pending');
  assert.strictEqual(slots[1].state, 'empty');
});

test('pageSlots with watchSlots of the wrong shape', function() {
  ['{}', '5', '[null, 1, "x"]', '[{"name": 1}]'].forEach(function(value) {
    var slots = sync.pageSlots(fakeStorage({watchSlots: value}));
    assert.strictEqual(slots.length, 5);
  });
});

test('pageSlots with broken watchSlots JSON still opens the page', {todo: 'reproduces a found bug'}, function() {
  var slots = sync.pageSlots(fakeStorage({watchSlots: '[{"name":'}));
  assert.strictEqual(slots.length, 5);
});
