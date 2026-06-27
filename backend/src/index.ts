import { startServer } from './server';
import { PROJECT_ROOT, MODEL, HAS_API_KEY } from './config';

// CLI entry point (npm run dev / npm run start). The desktop app imports
// `startServer` directly instead of going through this file.
startServer({ staticDir: process.env.FRONTEND_DIST })
  .then(({ port }) => {
    console.log('\nJakIDE backend');
    console.log(`  URL:                 http://localhost:${port}`);
    console.log(`  Project root:        ${PROJECT_ROOT}`);
    console.log(`  Model:               ${MODEL}`);
    console.log(`  ANTHROPIC_API_KEY:   ${HAS_API_KEY ? 'set' : 'NOT set (AI chat disabled until you add it)'}\n`);
  })
  .catch((err) => {
    console.error('Failed to start JakIDE backend:', err);
    process.exit(1);
  });
