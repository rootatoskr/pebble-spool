#pragma once

#include <pebble.h>

void text_window_push(void);
void text_window_destroy(void);

// Shows the text that is currently in storage, at the place where reading stopped.
void text_window_reload(void);
// Reloads if ``text`` is the one on screen.
void text_window_handle_text_changed(int text);
