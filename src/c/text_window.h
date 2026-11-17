#pragma once

#include <pebble.h>

// Opens stored text number ``text`` at the place where reading stopped. The window
// destroys itself when it is closed.
void text_window_push(int text);

// Reloads the open window if it shows ``text``.
void text_window_handle_text_changed(int text);
// Shows the open window with the stored appearance settings.
void text_window_apply_settings(void);
