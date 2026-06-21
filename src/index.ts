import 'dotenv/config';
import { initDb } from './db';
import { startPolling } from './telegram';
import { handleMessage } from './handlers';

async function main() {
  await initDb();
  startPolling(handleMessage);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
