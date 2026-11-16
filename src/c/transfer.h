#pragma once

#include <pebble.h>

typedef void (*TransferTextChangedHandler)(void);

// Opens AppMessage. ``handler`` is called after a new text has been stored.
void transfer_init(TransferTextChangedHandler handler);
