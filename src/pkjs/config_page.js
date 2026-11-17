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
  '--tab-bg:#f2f2f2;--accent:#0a58ca;--danger:#b3261e;--danger-bg:#fdecea}',
  '@media(prefers-color-scheme:dark){:root{--bg:#121212;--fg:#eee;--muted:#aaa;',
  '--border:#555;--tab-bg:#1e1e1e;--accent:#3d7fe0;--danger:#ff8a80;--danger-bg:#3a1c1c}}',
  'body{margin:0;padding:16px;background:var(--bg);color:var(--fg);',
  'font:16px/1.4 -apple-system,system-ui,sans-serif}',
  'h1{font-size:20px;margin:0 0 12px}',
  'label{display:block;margin:12px 0 4px;color:var(--muted);font-size:14px}',
  'textarea{display:block;width:100%;box-sizing:border-box;padding:10px;',
  'font:inherit;color:inherit;background:transparent;border:1px solid var(--border);',
  'border-radius:8px}',
  '#text{height:40vh}',
  '#name{height:auto;resize:none}',
  '#counter{margin:8px 0;color:var(--muted)}',
  '#counter.over{color:var(--danger);font-weight:600}',
  '.message{margin:8px 0;padding:10px 12px;border-radius:8px;background:var(--danger-bg);',
  'color:var(--danger)}',
  '.hint{margin:4px 0 8px;color:var(--muted);font-size:14px}',
  'button{display:block;width:100%;margin-top:12px;padding:14px;font:inherit;',
  'font-weight:600;color:#fff;background:var(--accent);border:0;border-radius:8px}',
  'button:disabled{opacity:.4}',
  'button.secondary{color:var(--danger);background:transparent;border:1px solid var(--danger)}',
  'button.danger{color:var(--bg);background:var(--danger)}',
  '.tabs{display:flex;gap:6px}',
  '.tabs button{flex:1 1 0;min-width:0;width:auto;margin:0;padding:6px 4px;font-size:13px;',
  'font-weight:400;color:var(--fg);background:var(--tab-bg);border:1px solid var(--border)}',
  '.tabs button.active{color:#fff;background:var(--accent);border-color:var(--accent)}',
  '.tabs span{display:block;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}',
  '.tabs b{display:block;font-size:15px}',
  '.row{display:flex;gap:8px}',
  '.row button{flex:1 1 0}',
  'h2{font-size:17px;margin:24px 0 4px}',
  '.choice{display:inline-flex;align-items:center;gap:6px;margin:6px 16px 6px 0;',
  'color:var(--fg);font-size:16px}',
  '.choice input{width:20px;height:20px;margin:0}'
].join('');

var BODY = [
  '<h1>Тексти для годинника</h1>',
  '<div id="tabs" class="tabs"></div>',
  '<div id="failed" class="message" hidden>Цей текст ще не дійшов до годинника. ',
  'Відкрий pebble-spool на годиннику – текст надішлеться сам. ',
  'Якщо ні, натисни «Зберегти» ще раз.</div>',
  '<label for="name">Назва</label>',
  // A one-line textarea, not an input: an input drops pasted line breaks and glues
  // the words together, a textarea keeps them and makeName turns them into spaces.
  '<textarea id="name" rows="1" placeholder="Перший рядок тексту"></textarea>',
  '<div id="name-hint" class="hint"></div>',
  '<label for="text">Текст</label>',
  '<textarea id="text" placeholder="Встав текст сюди"></textarea>',
  '<div id="counter"></div>',
  '<div id="warning" class="message" hidden></div>',
  '<p class="hint">Емодзі та символи, яких немає у шрифті годинника, ',
  'буде замінено на «?». Зберігається лише вибраний текст.</p>',
  '<h2>Вигляд</h2>',
  '<div id="settings-failed" class="message" hidden>Налаштування вигляду ще не дійшли ',
  'до годинника. Відкрий pebble-spool на годиннику – вони надішлються самі.</div>',
  '<label class="choice"><input type="checkbox" id="show-time">Показувати час</label>',
  '<label>Розміри тексту, між якими перемикає утримання Select</label>',
  '<div id="sizes"></div>',
  '<div id="text-size" class="hint"></div>',
  '<label>Розмір назв у меню</label>',
  '<div id="menu-sizes"></div>',
  '<button id="save">Зберегти</button>',
  '<button id="clear" class="secondary">Очистити</button>',
  '<div id="confirm" class="message" hidden><div id="confirm-text"></div>',
  '<div class="row"><button id="confirm-yes" class="danger">Очистити</button>',
  '<button id="confirm-no" class="secondary">Скасувати</button></div></div>'
].join('');

// Runs inside the page. ``state`` and the helper functions are defined before it.
function pageMain() {
  var tabs = document.getElementById('tabs');
  var failed = document.getElementById('failed');
  var nameField = document.getElementById('name');
  var nameHint = document.getElementById('name-hint');
  var field = document.getElementById('text');
  var counter = document.getElementById('counter');
  var warning = document.getElementById('warning');
  var save = document.getElementById('save');
  var clear = document.getElementById('clear');
  var confirmBox = document.getElementById('confirm');
  var confirmText = document.getElementById('confirm-text');

  // Edits of every text are kept while the page is open, but only the selected
  // text is saved.
  var drafts = state.slots.map(function(slot) {
    return {name: slot.name, text: slot.text};
  });
  var selected = state.selected;
  var settings = JSON.parse(JSON.stringify(state.appearance.settings));
  var sizeBoxes = [];

  function settingsChanged() {
    return JSON.stringify(settings) !== JSON.stringify(state.appearance.settings);
  }

  // Builds the size choices once. Unchecking the last checked size is not possible:
  // holding Select needs at least one size.
  function renderAppearance() {
    var showTime = document.getElementById('show-time');
    var sizes = document.getElementById('sizes');
    var menuSizes = document.getElementById('menu-sizes');
    document.getElementById('settings-failed').hidden = !state.appearance.failed;
    showTime.checked = settings.showTime;
    showTime.addEventListener('change', function() {
      settings.showTime = showTime.checked;
    });
    state.sizes.forEach(function(size) {
      var label = document.createElement('label');
      var box = document.createElement('input');
      label.className = 'choice';
      box.type = 'checkbox';
      box.checked = settings.sizes.indexOf(size) >= 0;
      box.addEventListener('change', function() {
        settings.sizes = state.sizes.filter(function(other, index) {
          return sizeBoxes[index].checked;
        });
        updateSizeBoxes();
      });
      sizeBoxes.push(box);
      label.appendChild(box);
      label.appendChild(document.createTextNode(String(size)));
      sizes.appendChild(label);

      var menuLabel = document.createElement('label');
      var radio = document.createElement('input');
      menuLabel.className = 'choice';
      radio.type = 'radio';
      radio.name = 'menu-size';
      radio.checked = settings.menuSize === size;
      radio.addEventListener('change', function() {
        settings.menuSize = size;
      });
      menuLabel.appendChild(radio);
      menuLabel.appendChild(document.createTextNode(String(size)));
      menuSizes.appendChild(menuLabel);
    });
    document.getElementById('text-size').textContent = state.appearance.textSize ?
      'Зараз на годиннику: ' + state.appearance.textSize : '';
    updateSizeBoxes();
  }

  function updateSizeBoxes() {
    sizeBoxes.forEach(function(box) {
      box.disabled = box.checked && settings.sizes.length === 1;
    });
  }

  function isTextChanged() {
    return isEdited(selected);
  }

  function isEdited(index) {
    return drafts[index].name !== state.slots[index].name ||
      drafts[index].text !== state.slots[index].text;
  }

  function isUndelivered(index) {
    return state.slots[index].state === 'failed' || state.slots[index].state === 'pending';
  }

  function renderTabs() {
    tabs.textContent = '';
    drafts.forEach(function(draft, index) {
      var button = document.createElement('button');
      var number = document.createElement('b');
      var label = document.createElement('span');
      // "*" marks unsaved edits, "!" a text that has not reached the watch.
      number.textContent = (index + 1) + (isEdited(index) ? '*' : '') +
        (isUndelivered(index) ? '!' : '');
      label.textContent = makeName(draft.name, normalizeText(draft.text)) || 'порожньо';
      button.appendChild(number);
      button.appendChild(label);
      button.className = index === selected ? 'active' : '';
      button.addEventListener('click', function() {
        select(index);
      });
      tabs.appendChild(button);
    });
  }

  function update() {
    var draft = drafts[selected];
    var normalized = normalizeText(draft.text);
    var bytes = utf8Length(normalized);
    var over = bytes > state.maxBytes;
    counter.textContent = 'Байтів: ' + bytes + ' з ' + state.maxBytes;
    counter.className = over ? 'over' : '';
    warning.hidden = !over;
    warning.textContent = 'Текст задовгий. Зайвих байтів: ' + (bytes - state.maxBytes) +
      '. Скороти його, щоб зберегти.';
    nameHint.textContent = 'На годиннику: ' + (makeName(draft.name, normalized) || '–');
    failed.hidden = !isUndelivered(selected);
    save.disabled = over;
    clear.disabled = state.slots[selected].state === 'empty';
    renderTabs();
  }

  function hideConfirm() {
    confirmBox.hidden = true;
  }

  function select(index) {
    selected = index;
    hideConfirm();
    nameField.value = drafts[index].name;
    field.value = drafts[index].text;
    update();
  }

  // Closes the page and hands the result to PebbleKit JS: the text only if it is
  // given (it changed or is being cleared), the settings only if they changed.
  function finish(name, value) {
    // The emulator passes the address to return to, the phone app uses a fixed one.
    var match = location.search.match(/[?&]return_to=([^&]*)/);
    var target = match ? decodeURIComponent(match[1]) : 'pebblejs://close#';
    var result = {slot: selected};
    if (value !== null) {
      result.name = name;
      result.text = value;
    }
    if (settingsChanged()) {
      result.settings = settings;
    }
    var encoded = utf8ToBase64(JSON.stringify(result), state.alphabet);
    location.href = target + encoded.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  }

  // Saving an empty text clears the slot too, so it asks first as well.
  function askToClear() {
    confirmText.textContent = 'Очистити текст ' + (selected + 1) + '? Він зникне з годинника.';
    confirmBox.hidden = false;
  }

  nameField.addEventListener('input', function() {
    drafts[selected].name = nameField.value;
    update();
  });
  field.addEventListener('input', function() {
    drafts[selected].text = field.value;
    hideConfirm();
    update();
  });
  save.addEventListener('click', function() {
    var draft = drafts[selected];
    if (!isTextChanged()) {
      finish(null, null);
    } else if (normalizeText(draft.text)) {
      finish(draft.name, draft.text);
    } else {
      askToClear();
    }
  });
  clear.addEventListener('click', askToClear);
  document.getElementById('confirm-yes').addEventListener('click', function() {
    finish('', '');
  });
  document.getElementById('confirm-no').addEventListener('click', hideConfirm);

  renderAppearance();
  select(selected);
}

// ``state``: ``slots`` (for every slot its ``text``, ``name`` and ``state``: 'empty',
// 'synced', 'pending' or 'failed'), ``selected`` (the slot to open with), ``maxBytes``,
// ``sizes`` (the text sizes) and ``appearance`` (``settings``, the watch's ``textSize``
// or null, and ``failed``).
function buildUrl(state) {
  state.alphabet = BASE64_ALPHABET;
  // "<" must not appear in the inline script, and U+2028/U+2029 break string literals.
  var stateJson = JSON.stringify(state).replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  var html = '<!DOCTYPE html><html lang="uk"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>pebble-spool</title><style>' + STYLE + '</style></head><body>' + BODY +
    '<script>var state=' + stateJson + ';' +
    'var NAME_MAX_BYTES=' + text.NAME_MAX_BYTES + ';' +
    'var normalizeText=' + text.normalizeText.toString() + ';' +
    'var utf8Length=' + text.utf8Length.toString() + ';' +
    'var makeName=' + text.makeName.toString() + ';' +
    'var utf8ToBase64=' + utf8ToBase64.toString() + ';' +
    '(' + pageMain.toString() + ')();</script></body></html>';
  return 'data:text/html;charset=utf-8;base64,' + utf8ToBase64(html, BASE64_ALPHABET);
}

// Returns ``{slot, name, text, settings}`` from the page's close URL, or null if the
// page was closed without saving or the result is not one this page produces. ``text``
// and ``name`` are null when the text did not change, ``settings`` is null when the
// settings did not change.
function parseResponse(response, slotCount) {
  if (!response) {
    return null;
  }
  var result;
  try {
    result = JSON.parse(urlSafeBase64ToUtf8(response));
  } catch (e) {
    return null;
  }
  if (!result || result.slot !== Math.floor(result.slot) || result.slot < 0 ||
      result.slot >= slotCount) {
    return null;
  }
  var hasText = result.text !== undefined;
  if (hasText && (typeof result.text !== 'string' || typeof result.name !== 'string')) {
    return null;
  }
  var settings = result.settings;
  if (settings !== undefined && (!settings || typeof settings.showTime !== 'boolean' ||
      !Array.isArray(settings.sizes) || typeof settings.menuSize !== 'number')) {
    return null;
  }
  return {
    slot: result.slot,
    name: hasText ? result.name : null,
    text: hasText ? result.text : null,
    settings: settings === undefined ? null : settings
  };
}

module.exports = {
  buildUrl: buildUrl,
  parseResponse: parseResponse
};
