#pragma once

#include <pebble.h>

// Called with the index of the text after a new version of it has been stored.
typedef void (*TransferTextChangedHandler)(int text);
// Called after new appearance settings from the phone have been stored.
typedef void (*TransferSettingsChangedHandler)(void);

// Opens AppMessage.
void transfer_init(TransferTextChangedHandler text_handler,
                   TransferSettingsChangedHandler settings_handler);

// Tells the phone the stored text ids, the settings and the text size. Best effort:
// skipped while a text is being received or the outbox is busy, because the phone
// asks for the state again on the next launch.
void transfer_send_state(void);
