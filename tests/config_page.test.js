var assert = require('node:assert');
var test = require('node:test');
var vm = require('node:vm');

var page = require('../src/pkjs/config_page');
var text = require('../src/pkjs/text');

var PREFIX = 'data:text/html;charset=utf-8;base64,';

// Encodes a result the way the page does before it closes.
function encodeResult(value) {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function emptySlots() {
  var slots = [];
  for (var i = 0; i < 5; i++) {
    slots.push({text: '', name: '', state: 'empty'});
  }
  return slots;
}

test('parseResponse returns the slot, the name and the text', function() {
  var value = {slot: 3, name: 'Назва', text: 'Ґава\r\nїсть \u2028 ' + String.fromCharCode(0xD83D, 0xDE00)};
  assert.deepStrictEqual(page.parseResponse(encodeResult(value), 5), value);
});

test('parseResponse accepts an empty text, which clears the slot', function() {
  var value = {slot: 0, name: '', text: ''};
  assert.deepStrictEqual(page.parseResponse(encodeResult(value), 5), value);
});

test('parseResponse rejects what the page does not produce', function() {
  assert.strictEqual(page.parseResponse('', 5), null);
  assert.strictEqual(page.parseResponse(undefined, 5), null);
  assert.strictEqual(page.parseResponse('not base64 json', 5), null);
  assert.strictEqual(page.parseResponse(encodeResult({text: 'only text'}), 5), null);
  assert.strictEqual(page.parseResponse(encodeResult({slot: 5, name: '', text: 'a'}), 5), null);
  assert.strictEqual(page.parseResponse(encodeResult({slot: -1, name: '', text: 'a'}), 5), null);
  assert.strictEqual(page.parseResponse(encodeResult({slot: 1.5, name: '', text: 'a'}), 5), null);
  assert.strictEqual(page.parseResponse(encodeResult({slot: '1', name: '', text: 'a'}), 5), null);
  assert.strictEqual(page.parseResponse(encodeResult({slot: 1, name: 2, text: 'a'}), 5), null);
});

test('buildUrl puts the slots into the page and keeps the script intact', function() {
  var slots = emptySlots();
  slots[2] = {text: 'Текст </script><script>alert(1)</script> \u2028', name: 'N', state: 'synced'};
  var url = page.buildUrl({slots: slots, selected: 2, maxBytes: text.MAX_TEXT_BYTES});
  assert.ok(url.indexOf(PREFIX) === 0);
  var html = Buffer.from(url.slice(PREFIX.length), 'base64').toString('utf8');
  // Only the page's own script tag may appear: the text must not close it.
  assert.strictEqual(html.split('</script>').length, 2);
  var stateJson = html.match(/var state=(\{.*?\});var NAME_MAX_BYTES=/)[1];
  var state = JSON.parse(stateJson);
  assert.deepStrictEqual(state.slots, slots);
  assert.strictEqual(state.selected, 2);
});

test('makeName works in the page with only its declared neighbours', function() {
  var context = vm.createContext({});
  vm.runInContext('var NAME_MAX_BYTES=' + text.NAME_MAX_BYTES + ';' +
    'var normalizeText=' + text.normalizeText.toString() + ';' +
    'var utf8Length=' + text.utf8Length.toString() + ';' +
    'var makeName=' + text.makeName.toString() + ';', context);
  var samples = [
    ['', 'Перший рядок\nдругий'],
    ['  Моя\nназва ', 'x'],
    ['ї'.repeat(20), ''],
    ['', '\n  Після порожнього']
  ];
  samples.forEach(function(sample) {
    assert.strictEqual(context.makeName(sample[0], sample[1]), text.makeName(sample[0], sample[1]));
  });
});
