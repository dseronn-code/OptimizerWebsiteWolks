import { buildApp } from './app.js';
import { config } from './config.js';
import { migrate } from './db/migrate.js';
import { startWorker } from './sync/scheduler.js';

await migrate();
const app = await buildApp();
if (config.RUN_WORKER_IN_PROCESS) startWorker((msg, err) => app.log.error({ err }, msg));
await app.listen({ port: config.PORT, host: '0.0.0.0' });
