#pragma once

#include <pebble.h>

void text_window_push(void);
void text_window_destroy(void);

// Takes ownership of ``text`` (allocated with ``malloc``). NULL shows the placeholder.
void text_window_set_text(char *text);
