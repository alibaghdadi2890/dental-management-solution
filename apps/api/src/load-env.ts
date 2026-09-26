import { existsSync } from 'node:fs';

// Local development convenience: deployed environments inject variables directly.
if (existsSync('.env')) {
  process.loadEnvFile('.env');
}
