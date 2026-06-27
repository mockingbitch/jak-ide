// Copy the built frontend (frontend/dist) into the desktop app bundle.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.resolve(here, '../../frontend/dist');
const dest = path.resolve(here, '../app/renderer');

if (!fs.existsSync(src)) {
  console.error('frontend/dist not found — build the frontend first (npm run build:renderer).');
  process.exit(1);
}

fs.rmSync(dest, { recursive: true, force: true });
fs.cpSync(src, dest, { recursive: true });
console.log('Copied renderer ->', dest);
