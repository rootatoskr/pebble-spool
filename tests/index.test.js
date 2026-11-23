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
