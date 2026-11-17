// Keep in sync with ``CHUNK_MAX_BYTES`` in ``src/c/transfer.c``.
var CHUNK_MAX_BYTES = 1000;
// Keep in sync with ``STORAGE_MAX_TEXT_BYTES`` in ``src/c/storage.h``.
// With the largest font, 8000 bytes of Latin text is about 26500 pixels high,
// and a layer on the watch cannot be taller than 32767.
var MAX_TEXT_BYTES = 8000;
// Keep in sync with ``STORAGE_NAME_MAX_BYTES`` in ``src/c/storage.h``.
var NAME_MAX_BYTES = 32;

// Turns pasted text into what the watch can show. The characters it keeps must be
// exactly those of ``characterRegex`` of the fonts in ``package.json``; a test checks that.
// The function is also copied into the settings page, so it must not use
// anything defined outside of it.
function normalizeText(text) {
  var result = text
    // Windows, old Mac and Unicode line breaks.
    .replace(/\r\n?|[\u2028\u2029]/g, '\n')
    // Tabs and typographic spaces.
    .replace(/[\t\u2000-\u200a\u202f]/g, ' ')
    // Invisible characters: controls, combining marks (stress marks), soft hyphen,
    // zero-width characters, variation selectors.
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u0300-\u036f\u00ad\u200b-\u200f\u2060\ufeff\ufe00-\ufe0f]/g, '')
    // Spaces at the end of a line, so that a line of spaces counts as empty.
    .replace(/ +\n/g, '\n')
    // Three or more line breaks in a row: at most one empty line stays. Hundreds of
    // empty lines would make the text taller than a layer on the watch can be.
    .replace(/\n{3,}/g, '\n\n')
    // Characters outside the BMP (emoji) are a pair of UTF-16 units: one "?" for the pair.
    .replace(/[\ud800-\udbff][\udc00-\udfff]/g, '?')
    // Everything else that the font does not have.
    .replace(/[^\n -~\u00a0-\u00ff\u0400-\u045f\u0490\u0491\u2010-\u2027\u2030-\u203a\u20ac\u2116\u2212]/g, '?');
  // A text of spaces and line breaks only counts as no text.
  return /\S/.test(result) ? result : '';
}

// The name of a text as the watch stores it: the name the user typed or, without one,
// the first line of the text. Line breaks become spaces and the result is cut to
// NAME_MAX_BYTES without cutting a character. ``text`` must be normalized already.
// The function is also copied into the settings page, where ``NAME_MAX_BYTES``,
// ``normalizeText`` and ``utf8Length`` are defined next to it.
function makeName(name, text) {
  var source = normalizeText(name).replace(/\n/g, ' ').replace(/^ +| +$/g, '');
  if (!source) {
    source = text.replace(/^[ \n]+/, '').split('\n')[0];
  }
  var result = '';
  var bytes = 0;
  for (var i = 0; i < source.length; i++) {
    var character = source.charAt(i);
    bytes += utf8Length(character);
    if (bytes > NAME_MAX_BYTES) {
      break;
    }
    result += character;
  }
  return result.replace(/ +$/, '');
}

// Byte length of normalized text, which has no characters outside the BMP.
function utf8Length(text) {
  var bytes = 0;
  for (var i = 0; i < text.length; i++) {
    var code = text.charCodeAt(i);
    bytes += code < 0x80 ? 1 : (code < 0x800 ? 2 : 3);
  }
  return bytes;
}

// Splits normalized text into chunks of at most CHUNK_MAX_BYTES without cutting
// a character. An empty text gives one empty chunk, which clears the text on the watch.
function splitIntoChunks(text) {
  var chunks = [];
  var current = '';
  var currentBytes = 0;
  for (var i = 0; i < text.length; i++) {
    var character = text.charAt(i);
    var bytes = utf8Length(character);
    if (currentBytes + bytes > CHUNK_MAX_BYTES) {
      chunks.push(current);
      current = '';
      currentBytes = 0;
    }
    current += character;
    currentBytes += bytes;
  }
  chunks.push(current);
  return chunks;
}

module.exports = {
  CHUNK_MAX_BYTES: CHUNK_MAX_BYTES,
  MAX_TEXT_BYTES: MAX_TEXT_BYTES,
  NAME_MAX_BYTES: NAME_MAX_BYTES,
  normalizeText: normalizeText,
  makeName: makeName,
  utf8Length: utf8Length,
  splitIntoChunks: splitIntoChunks
};
