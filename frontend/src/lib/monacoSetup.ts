import type { BeforeMount } from '@monaco-editor/react';
import { defineJakIDETheme } from './monacoTheme';
import { useStore } from '../store';

// Define the 'jakide' theme before any editor paints (covers the case where the
// editor mounts before the global theme effect has run). Shared by every tab.
export const beforeMountTheme: BeforeMount = (m) => defineJakIDETheme(m, useStore.getState().theme);

// Monaco reserves 5 characters' width for the line-numbers gutter by default
// (~40px at the IDE's default font size); 3 halves that to ~20px. Shared by
// every editor/diff/merge view so the gutter width is consistent app-wide.
export const LINE_NUMBERS_MIN_CHARS = 3;

// Render overlay widgets (autocomplete, hover, find/replace) as fixed-position
// elements attached to <body> instead of positioned inside the editor's own DOM.
// This lets .ide-editor safely clip its corners (border-radius + overflow:hidden,
// for the rounded-card look) without ever cutting off a popup that needs to
// extend past the editor's bounds. Spread into every Editor/DiffEditor's options.
export const OVERFLOW_WIDGETS_OPTIONS = { fixedOverflowWidgets: true } as const;
