// Keep in sync with ``CHUNK_MAX_BYTES`` in ``src/c/transfer.c``.
var CHUNK_MAX_BYTES = 1000;

function utf8Length(text) {
  var bytes = 0;
  for (var i = 0; i < text.length; i++) {
    var code = text.charCodeAt(i);
    if (code < 0x80) {
      bytes += 1;
    } else if (code < 0x800) {
      bytes += 2;
    } else if (code >= 0xD800 && code <= 0xDBFF) {
      // A surrogate pair is one 4-byte character.
      bytes += 4;
      i++;
    } else {
      bytes += 3;
    }
  }
  return bytes;
}

// Splits text into chunks of at most CHUNK_MAX_BYTES without cutting a character.
// An empty text gives one empty chunk, which clears the text on the watch.
function splitIntoChunks(text) {
  var chunks = [];
  var current = '';
  var currentBytes = 0;
  for (var i = 0; i < text.length; i++) {
    var code = text.charCodeAt(i);
    var character = text.charAt(i);
    if (code >= 0xD800 && code <= 0xDBFF) {
      character += text.charAt(++i);
    }
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
  utf8Length: utf8Length,
  splitIntoChunks: splitIntoChunks
};
