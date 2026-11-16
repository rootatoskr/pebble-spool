var CHUNK_BYTES = 1000;

var CONFIG_HTML = '<!DOCTYPE html><html><head><meta charset="utf-8">' +
  '<meta name="viewport" content="width=device-width,initial-scale=1">' +
  '<title>pebble-spool</title></head><body>' +
  '<textarea id="text" rows="15" style="width:100%;box-sizing:border-box"></textarea>' +
  '<p>Bytes: <span id="count">0</span></p>' +
  '<button id="save">Save</button>' +
  '<script>' +
  'var t=document.getElementById("text"),c=document.getElementById("count");' +
  'function bytes(s){return unescape(encodeURIComponent(s)).length;}' +
  't.addEventListener("input",function(){c.textContent=bytes(t.value);});' +
  'document.getElementById("save").addEventListener("click",function(){' +
  // The emulator appends "?return_to=..." to the URL; on the phone it is absent.
  'var m=location.search.match(/[?&]return_to=(.*)$/);' +
  'var r=m?decodeURIComponent(m[1]):"pebblejs://close#";' +
  'location.href=r+encodeURIComponent(JSON.stringify({text:t.value}));});' +
  '</script></body></html>';

function utf8Length(codePoint) {
  if (codePoint < 0x80) return 1;
  if (codePoint < 0x800) return 2;
  if (codePoint < 0x10000) return 3;
  return 4;
}

// Split by code points so that no UTF-8 sequence is cut in half.
function splitText(text) {
  var chunks = [];
  var current = '';
  var currentBytes = 0;
  var total = 0;
  for (var i = 0; i < text.length; i++) {
    var ch = text.charAt(i);
    var code = text.charCodeAt(i);
    if (code >= 0xD800 && code <= 0xDBFF && i + 1 < text.length) {
      ch += text.charAt(i + 1);
      code = 0x10000;
      i++;
    }
    var len = utf8Length(code);
    if (currentBytes + len > CHUNK_BYTES) {
      chunks.push(current);
      current = '';
      currentBytes = 0;
    }
    current += ch;
    currentBytes += len;
    total += len;
  }
  chunks.push(current);
  return { chunks: chunks, total: total };
}

function sendText(text) {
  var parts = splitText(text);
  var count = parts.chunks.length;
  console.log('Sending ' + parts.total + ' bytes in ' + count + ' chunks');

  function sendChunk(index) {
    Pebble.sendAppMessage({
      'ChunkIndex': index,
      'ChunkCount': count,
      'TotalBytes': parts.total,
      'ChunkData': parts.chunks[index]
    }, function() {
      console.log('Chunk ' + (index + 1) + '/' + count + ' acked');
      if (index + 1 < count) {
        sendChunk(index + 1);
      }
    }, function(e) {
      console.log('Chunk ' + (index + 1) + '/' + count + ' failed: ' + JSON.stringify(e));
    });
  }

  sendChunk(0);
}

Pebble.addEventListener('ready', function() {
  console.log('PebbleKit JS ready');
});

Pebble.addEventListener('showConfiguration', function() {
  Pebble.openURL('data:text/html;charset=utf-8,' + encodeURIComponent(CONFIG_HTML));
});

Pebble.addEventListener('webviewclosed', function(e) {
  if (!e || !e.response) {
    console.log('Config closed without data');
    return;
  }
  // iOS decodes the response once, the emulator passes it still encoded.
  var response = e.response;
  if (response.charAt(0) !== '{') {
    response = decodeURIComponent(response);
  }
  sendText(JSON.parse(response).text);
});
