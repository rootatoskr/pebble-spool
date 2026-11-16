#pragma once

#include <pebble.h>

void text_window_push(void);
void text_window_destroy(void);

// Shows the text that is currently in storage, scrolled to the top.
void text_window_reload(void);
