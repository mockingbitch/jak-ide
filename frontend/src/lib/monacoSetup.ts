import type { BeforeMount } from '@monaco-editor/react';
import { defineJakIDETheme } from './monacoTheme';
import { useStore } from '../store';

// Define the 'jakide' theme before any editor paints (covers the case where the
// editor mounts before the global theme effect has run). Shared by every tab.
export const beforeMountTheme: BeforeMount = (m) => defineJakIDETheme(m, useStore.getState().theme);
