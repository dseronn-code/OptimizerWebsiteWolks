import { migrate } from './db/migrate.js';
import { startWorker } from './sync/scheduler.js';

// Processo dedicado de sincronização/jobs (use com RUN_WORKER_IN_PROCESS=false no servidor web).
await migrate();
startWorker((msg, err) => console.error(msg, err ?? ''));
console.log('worker iniciado');
