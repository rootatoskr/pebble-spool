var assert = require('node:assert');
var test = require('node:test');

var text = require('../src/pkjs/text');

function fakeStorage() {
  var values = {};
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

// Loads ``index.js`` afresh with a stand-in for the Pebble runtime. Every message sent
// waits in ``sent`` until the test acknowledges or rejects it.
function loadApp() {
  var pebble = {
    handlers: {},
    sent: [],
    addEventListener: function(name, handler) {
      this.handlers[name] = handler;
    },
    sendAppMessage: function(message, onSuccess, onFailure) {
      this.sent.push({message: message, ack: onSuccess, nack: onFailure});
    },
    openURL: function() {}
  };
  global.Pebble = pebble;
  global.localStorage = fakeStorage();
  global.console = {log: function() {}};
  delete require.cache[require.resolve('../src/pkjs/index')];
  require('../src/pkjs/index');
  return pebble;
}

// Encodes a result the way the settings page does before it closes.
function pageResult(value) {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

test('a text over the limit after normalization is neither saved nor sent', function() {
  var pebble = loadApp();
  pebble.handlers.webviewclosed({response: pageResult({slot: 0, name: '', text: 'a'.repeat(text.MAX_TEXT_BYTES + 1)})});
  assert.strictEqual(localStorage.getItem('text0'), null);
  assert.strictEqual(pebble.sent.length, 0);
  // Exactly at the limit, and over it only before normalization, is fine.
  pebble.handlers.webviewclosed({response: pageResult({slot: 1, name: '', text: 'a'.repeat(text.MAX_TEXT_BYTES) + '​​'})});
  assert.strictEqual(pebble.sent.length, 1);
  assert.strictEqual(pebble.sent[0].message.TotalBytes, text.MAX_TEXT_BYTES);
});

// Saves two short texts. The second save interrupts the first one: slot 0 goes now,
// slot 1 waits in the queue. Returns the message of slot 0.
function saveTwo(pebble) {
  pebble.handlers.webviewclosed({response: pageResult({slot: 1, name: '', text: 'second'})});
  pebble.handlers.webviewclosed({response: pageResult({slot: 0, name: '', text: 'first'})});
  var first = pebble.sent[pebble.sent.length - 1];
  assert.strictEqual(first.message.Slot, 0);
  return first;
}

function watchState(ids) {
  var payload = {};
  ids.forEach(function(id, slot) {
    payload['SlotId' + slot] = id;
  });
  return {payload: payload};
}

function phoneIds() {
  return [0, 1, 2, 3, 4].map(function(slot) {
    var id = localStorage.getItem('textId' + slot);
    return id === null ? 0 : Number(id);
  });
}

function lastMessage(pebble) {
  return pebble.sent[pebble.sent.length - 1].message;
}

test('a lost result: the watch state shows the text arrived, the queue goes on', function(t) {
  t.mock.timers.enable({apis: ['setTimeout']});
  var pebble = loadApp();
  saveTwo(pebble).ack();
  t.mock.timers.tick(10000);
  assert.deepStrictEqual(lastMessage(pebble), {Hello: 1});
  pebble.sent[pebble.sent.length - 1].ack();
  pebble.handlers.appmessage(watchState(phoneIds()));
  assert.strictEqual(localStorage.getItem('syncState0'), 'synced');
  // The second text starts right after.
  assert.strictEqual(lastMessage(pebble).Slot, 1);
});

test('a lost result: the watch state shows the text did not arrive, it is sent again', function(t) {
  t.mock.timers.enable({apis: ['setTimeout']});
  var pebble = loadApp();
  saveTwo(pebble).ack();
  t.mock.timers.tick(10000);
  pebble.sent[pebble.sent.length - 1].ack();
  var ids = phoneIds();
  ids[0] = 0;
  pebble.handlers.appmessage(watchState(ids));
  // Slot 1 was waiting already and goes first; slot 0 follows it.
  var second = pebble.sent[pebble.sent.length - 1];
  assert.strictEqual(second.message.Slot, 1);
  second.ack();
  pebble.handlers.appmessage({payload: {ResultId: second.message.TransferId, ResultOk: 1}});
  assert.strictEqual(lastMessage(pebble).Slot, 0);
  assert.strictEqual(lastMessage(pebble).ChunkIndex, 0);
});

test('no state after three Hellos: the text is marked failed and the queue goes on', function(t) {
  t.mock.timers.enable({apis: ['setTimeout']});
  var pebble = loadApp();
  saveTwo(pebble).ack();
  t.mock.timers.tick(10000);
  for (var attempt = 1; attempt <= 3; attempt++) {
    assert.deepStrictEqual(lastMessage(pebble), {Hello: 1}, 'Hello ' + attempt);
    pebble.sent[pebble.sent.length - 1].ack();
    t.mock.timers.tick(10000);
  }
  assert.strictEqual(localStorage.getItem('syncState0'), 'failed');
  assert.strictEqual(lastMessage(pebble).Slot, 1);
});

test('Hellos that the watch never acknowledges do not stop the queue', function(t) {
  t.mock.timers.enable({apis: ['setTimeout']});
  var pebble = loadApp();
  saveTwo(pebble).ack();
  t.mock.timers.tick(10000);
  // Every message from here on fails: each Hello is retried, then the next attempt starts.
  for (var i = 0; i < 20 && lastMessage(pebble).Slot !== 1; i++) {
    pebble.sent[pebble.sent.length - 1].nack();
    t.mock.timers.tick(1000);
  }
  assert.strictEqual(localStorage.getItem('syncState0'), 'failed');
  assert.strictEqual(lastMessage(pebble).Slot, 1);
});

test('a result that comes late, while the phone asks, still counts', function(t) {
  t.mock.timers.enable({apis: ['setTimeout']});
  var pebble = loadApp();
  var first = saveTwo(pebble);
  var id = first.message.TransferId;
  first.ack();
  t.mock.timers.tick(10000);
  pebble.handlers.appmessage({payload: {ResultId: id, ResultOk: 1}});
  assert.strictEqual(localStorage.getItem('syncState0'), 'synced');
  assert.strictEqual(lastMessage(pebble).Slot, 1);
  // The timers of the finished transfer do nothing later.
  var count = pebble.sent.length;
  t.mock.timers.tick(60000);
  assert.strictEqual(pebble.sent.length, count);
});
