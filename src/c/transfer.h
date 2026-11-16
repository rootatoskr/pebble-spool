#pragma once

#include <pebble.h>

// Called with the index of the text after a new version of it has been stored.
typedef void (*TransferTextChangedHandler)(int text);

// Opens AppMessage.
void transfer_init(TransferTextChangedHandler handler);
