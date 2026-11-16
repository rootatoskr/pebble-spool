var assert = require('node:assert');
var test = require('node:test');
var vm = require('node:vm');

var text = require('../src/pkjs/text');

var normalizeText = text.normalizeText;
var utf8Length = text.utf8Length;
var splitIntoChunks = text.splitIntoChunks;

function byteLength(string) {
  return Buffer.byteLength(string, 'utf8');
}

test('normalizeText turns Windows and old Mac line breaks into \\n', function() {
  assert.strictEqual(normalizeText('a\r\nb\rc\nd'), 'a\nb\nc\nd');
});

test('normalizeText turns Unicode line and paragraph separators into \\n', function() {
  assert.strictEqual(normalizeText('a\u2028b\u2029c'), 'a\nb\nc');
});

test('normalizeText turns tabs and typographic spaces into a space', function() {
  assert.strictEqual(normalizeText('a\tb\u2003c\u2009d\u202fe'), 'a b c d e');
});

test('normalizeText removes control characters', function() {
  assert.strictEqual(normalizeText('a\u0000b\u0007c\u001fd\u007fe\u0085f'), 'abcdef');
});

test('normalizeText removes combining marks', function() {
  assert.strictEqual(normalizeText('за\u0301мок e\u0300\u036f'), 'замок e');
});

test('normalizeText removes the soft hyphen and zero-width characters', function() {
  assert.strictEqual(normalizeText('a\u00adb\u200bc\u200dd\u2060e\ufefff\ufe0fg'), 'abcdefg');
});

test('normalizeText replaces an emoji with one question mark', function() {
  assert.strictEqual(normalizeText('a\ud83d\ude00b'), 'a?b');
  // Thumbs up with a skin tone modifier is two characters outside the BMP.
  assert.strictEqual(normalizeText('\ud83d\udc4d\ud83c\udffd'), '??');
});

test('normalizeText replaces other characters that the font does not have', function() {
  assert.strictEqual(normalizeText('a\u65e5b\u2192c'), 'a?b?c');
});

test('normalizeText keeps Cyrillic, Latin, Norwegian letters and punctuation', function() {
  var samples = [
    'Ґава їсть єнота і ґудзик. ЇЄІ ёыэ ЁЫЭ ў',
    'The quick brown fox, 0123456789 ~!@#$%^&*()_+[]{}|;:\'"<>?/\\',
    'æøåÆØÅ',
    '«» – \u2014 \u2026 \u2116 \u20ac \u2212 \u2018\u2019 \u201c\u201d \u201e \u2030'
  ];
  samples.forEach(function(sample) {
    assert.strictEqual(normalizeText(sample), sample);
  });
});

test('normalizeText gives an empty string for spaces and line breaks only', function() {
  assert.strictEqual(normalizeText(' \n \r\n\t \u00a0 '), '');
  assert.strictEqual(normalizeText(''), '');
});

test('normalizeText removes spaces and tabs before a line break', function() {
  assert.strictEqual(normalizeText('a  \nb\t\nc \t \r\nd'), 'a\nb\nc\nd');
  assert.strictEqual(normalizeText('a b  c'), 'a b  c');
});

test('normalizeText reduces three or more line breaks to two', function() {
  assert.strictEqual(normalizeText('a\nb'), 'a\nb');
  assert.strictEqual(normalizeText('a\n\nb'), 'a\n\nb');
  assert.strictEqual(normalizeText('a\n\n\nb'), 'a\n\nb');
  assert.strictEqual(normalizeText('a' + '\n'.repeat(500) + 'b'), 'a\n\nb');
  assert.strictEqual(normalizeText('a\r\n\r\n\r\n\r\nb'), 'a\n\nb');
  assert.strictEqual(normalizeText('a\u2028\u2029\n\rb'), 'a\n\nb');
});

test('normalizeText treats lines of spaces and invisible characters as empty', function() {
  assert.strictEqual(normalizeText('a\n \n\t\n   \nb'), 'a\n\nb');
  assert.strictEqual(normalizeText('a\n\u200b\n\u00ad\n\nb'), 'a\n\nb');
  assert.strictEqual(normalizeText('a\n\u2003\n\u202f\nb'), 'a\n\nb');
});

test('utf8Length counts 1-, 2- and 3-byte characters', function() {
  assert.strictEqual(utf8Length(''), 0);
  assert.strictEqual(utf8Length('a'), 1);
  assert.strictEqual(utf8Length('æ'), 2);
  assert.strictEqual(utf8Length('ї'), 2);
  assert.strictEqual(utf8Length('\u20ac'), 3);
  var mixed = 'aї\u20ac\n \u2116';
  assert.strictEqual(utf8Length(mixed), byteLength(mixed));
});

test('splitIntoChunks keeps every chunk within the limit and loses nothing', function() {
  var source = '';
  for (var i = 0; source.length < 6000; i++) {
    source += i + ' Ґава їсть єнота \u20ac \u2116 abc\n';
  }
  var chunks = splitIntoChunks(source);
  assert.ok(chunks.length > 1);
  chunks.forEach(function(chunk) {
    assert.ok(byteLength(chunk) <= text.CHUNK_MAX_BYTES);
    assert.ok(chunk.length > 0);
    // A chunk that was cut inside a character would not survive a UTF-8 round trip.
    assert.strictEqual(Buffer.from(chunk, 'utf8').toString('utf8'), chunk);
  });
  assert.strictEqual(chunks.join(''), source);
});

test('splitIntoChunks gives one empty chunk for an empty text', function() {
  assert.deepStrictEqual(splitIntoChunks(''), ['']);
});

test('splitIntoChunks at the chunk boundary with two-byte characters', function() {
  assert.strictEqual(text.CHUNK_MAX_BYTES, 1000);
  var exact = 'ї'.repeat(500);
  assert.strictEqual(byteLength(exact), 1000);
  assert.deepStrictEqual(splitIntoChunks(exact), [exact]);

  // 1001 bytes: the last two-byte character does not fit and moves as a whole.
  var over = 'a' + exact;
  assert.strictEqual(byteLength(over), 1001);
  var chunks = splitIntoChunks(over);
  assert.deepStrictEqual(chunks.map(byteLength), [999, 2]);
  assert.strictEqual(chunks.join(''), over);

  var overAtEnd = exact + 'a';
  assert.deepStrictEqual(splitIntoChunks(overAtEnd).map(byteLength), [1000, 1]);
});

// The settings page gets these functions as source text, so they must work
// without anything else from the module.
test('normalizeText and utf8Length work when copied into an empty context', function() {
  var isolatedNormalize = vm.runInNewContext('(' + normalizeText.toString() + ')');
  var isolatedLength = vm.runInNewContext('(' + utf8Length.toString() + ')');
  var samples = [
    '',
    ' \n ',
    'a\r\nb\tc\u2028d',
    'a \n\t\n\n\n\nb  \nc',
    'Ґава \ud83d\ude00 за\u0301мок \u65e5 \u20ac',
    'æøå «»'
  ];
  samples.forEach(function(sample) {
    var expected = normalizeText(sample);
    assert.strictEqual(isolatedNormalize(sample), expected);
    assert.strictEqual(isolatedLength(expected), utf8Length(expected));
  });
});
