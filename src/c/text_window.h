#pragma once

#include <pebble.h>

void text_window_push(void);
void text_window_destroy(void);

// Shows the text that is currently in storage, at the place where reading stopped.
void text_window_reload(void);
