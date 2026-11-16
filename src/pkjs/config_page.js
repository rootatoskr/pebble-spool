var text = require('./text');

var BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

// The page travels to the phone app inside a data URI and returns the text in the
// close URL. Base64 keeps both short: percent-encoding takes 6 characters per
// Cyrillic letter, base64 of UTF-8 takes under 3. The codec is written out here
// because ``btoa`` and ``atob`` are not available in every PebbleKit JS runtime.
// This function is also copied into the page, so it must not use anything
// defined outside of it except the ``alphabet`` argument.
function utf8ToBase64(string, alphabet) {
  var bytes = [];
  for (var i = 0; i < string.length; i++) {
    var code = string.charCodeAt(i);
    if (code >= 0xD800 && code <= 0xDBFF && i + 1 < string.length) {
      code = 0x10000 + ((code - 0xD800) << 10) + (string.charCodeAt(++i) - 0xDC00);
    }
    if (code < 0x80) {
      bytes.push(code);
    } else if (code < 0x800) {
      bytes.push(0xC0 | (code >> 6), 0x80 | (code & 63));
    } else if (code < 0x10000) {
      bytes.push(0xE0 | (code >> 12), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63));
    } else {
      bytes.push(0xF0 | (code >> 18), 0x80 | ((code >> 12) & 63), 0x80 | ((code >> 6) & 63),
                 0x80 | (code & 63));
    }
  }
  var result = '';
  for (var j = 0; j < bytes.length; j += 3) {
    var a = bytes[j];
    var b = bytes[j + 1];
    var c = bytes[j + 2];
    result += alphabet.charAt(a >> 2) + alphabet.charAt(((a & 3) << 4) | (b >> 4)) +
      (j + 1 < bytes.length ? alphabet.charAt(((b & 15) << 2) | (c >> 6)) : '=') +
      (j + 2 < bytes.length ? alphabet.charAt(c & 63) : '=');
  }
  return result;
}

// Decodes what the page sends back: base64 with "-" and "_" and without padding.
function urlSafeBase64ToUtf8(encoded) {
  var bytes = [];
  var buffer = 0;
  var bits = 0;
  for (var i = 0; i < encoded.length; i++) {
    var value = BASE64_ALPHABET.indexOf(encoded.charAt(i).replace('-', '+').replace('_', '/'));
    if (value < 0) {
      continue;
    }
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xFF);
    }
  }
  var result = '';
  for (var j = 0; j < bytes.length;) {
    var first = bytes[j++];
    var code;
    if (first < 0x80) {
      code = first;
    } else if (first < 0xE0) {
      code = ((first & 31) << 6) | (bytes[j++] & 63);
    } else if (first < 0xF0) {
      code = ((first & 15) << 12) | ((bytes[j++] & 63) << 6) | (bytes[j++] & 63);
    } else {
      code = ((first & 7) << 18) | ((bytes[j++] & 63) << 12) | ((bytes[j++] & 63) << 6) |
        (bytes[j++] & 63);
    }
    if (code < 0x10000) {
      result += String.fromCharCode(code);
    } else {
      code -= 0x10000;
      result += String.fromCharCode(0xD800 + (code >> 10), 0xDC00 + (code & 0x3FF));
    }
  }
  return result;
}

var STYLE = [
  ':root{color-scheme:light dark;--bg:#fff;--fg:#111;--muted:#666;--border:#bbb;',
  '--accent:#0a58ca;--danger:#b3261e;--danger-bg:#fdecea}',
  '@media(prefers-color-scheme:dark){:root{--bg:#121212;--fg:#eee;--muted:#aaa;',
  '--border:#555;--accent:#3d7fe0;--danger:#ff8a80;--danger-bg:#3a1c1c}}',
  'body{margin:0;padding:16px;background:var(--bg);color:var(--fg);',
  'font:16px/1.4 -apple-system,system-ui,sans-serif}',
  'h1{font-size:20px;margin:0 0 12px}',
  'textarea{display:block;width:100%;box-sizing:border-box;height:45vh;padding:10px;',
  'font:inherit;color:inherit;background:transparent;border:1px solid var(--border);',
  'border-radius:8px}',
  '#counter{margin:8px 0;color:var(--muted)}',
  '#counter.over{color:var(--danger);font-weight:600}',
  '.message{margin:8px 0;padding:10px 12px;border-radius:8px;background:var(--danger-bg);',
  'color:var(--danger)}',
  '.hint{margin:8px 0;color:var(--muted);font-size:14px}',
  'button{display:block;width:100%;margin-top:12px;padding:14px;font:inherit;',
  'font-weight:600;color:#fff;background:var(--accent);border:0;border-radius:8px}',
  'button:disabled{opacity:.4}'
].join('');

var BODY = [
  '<h1>Текст для годинника</h1>',
  '<div id="failed" class="message" hidden>Останнє збереження не дійшло до годинника. ',
  'Відкрий pebble-spool на годиннику – текст надішлеться сам. ',
  'Якщо ні, натисни «Зберегти» ще раз.</div>',
  '<textarea id="text" placeholder="Встав текст сюди"></textarea>',
  '<div id="counter"></div>',
  '<div id="warning" class="message" hidden></div>',
  '<p class="hint">Емодзі та символи, яких немає у шрифті годинника, ',
  'буде замінено на «?».</p>',
  '<button id="save">Зберегти</button>'
].join('');

// Runs inside the page. ``state`` and the helper functions are defined before it.
function pageMain() {
  var field = document.getElementById('text');
  var counter = document.getElementById('counter');
  var warning = document.getElementById('warning');
  var save = document.getElementById('save');

  function update() {
    var bytes = utf8Length(normalizeText(field.value));
    var over = bytes > state.maxBytes;
    counter.textContent = 'Байтів: ' + bytes + ' з ' + state.maxBytes;
    counter.className = over ? 'over' : '';
    warning.hidden = !over;
    warning.textContent = 'Текст задовгий. Зайвих байтів: ' + (bytes - state.maxBytes) +
      '. Скороти його, щоб зберегти.';
    save.disabled = over;
  }

  document.getElementById('failed').hidden = !state.failed;
  field.value = state.text;
  field.addEventListener('input', update);
  update();

  save.addEventListener('click', function() {
    // The emulator passes the address to return to, the phone app uses a fixed one.
    var match = location.search.match(/[?&]return_to=([^&]*)/);
    var target = match ? decodeURIComponent(match[1]) : 'pebblejs://close#';
    var encoded = utf8ToBase64(JSON.stringify({text: field.value}), state.alphabet);
    location.href = target + encoded.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  });
}

// ``state``: ``text`` to put into the field, ``maxBytes`` and ``failed``
// (true if the last save did not reach the watch).
function buildUrl(state) {
  state.alphabet = BASE64_ALPHABET;
  // "<" must not appear in the inline script, and U+2028/U+2029 break string literals.
  var stateJson = JSON.stringify(state).replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  var html = '<!DOCTYPE html><html lang="uk"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>pebble-spool</title><style>' + STYLE + '</style></head><body>' + BODY +
    '<script>var state=' + stateJson + ';' +
    'var normalizeText=' + text.normalizeText.toString() + ';' +
    'var utf8Length=' + text.utf8Length.toString() + ';' +
    'var utf8ToBase64=' + utf8ToBase64.toString() + ';' +
    '(' + pageMain.toString() + ')();</script></body></html>';
  return 'data:text/html;charset=utf-8;base64,' + utf8ToBase64(html, BASE64_ALPHABET);
}

// Returns the text from the page's close URL, or null if the page was closed without saving.
function parseResponse(response) {
  if (!response) {
    return null;
  }
  return JSON.parse(urlSafeBase64ToUtf8(response)).text;
}

module.exports = {
  buildUrl: buildUrl,
  parseResponse: parseResponse
};
