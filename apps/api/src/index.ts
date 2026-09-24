import { createApp, disconnectDatabase } from './app.js';

const port = Number(process.env.API_PORT ?? 3000);
const app = createApp();
const server = app.listen(port, '0.0.0.0', () => {
  console.log(`Worknoon API listening on port ${port}`);
});

let shuttingDown = false;
function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`Received ${signal}; closing API server.`);
  server.close((error) => {
    if (error) console.error('Error closing API server:', error.name);
    void disconnectDatabase().catch((disconnectError: unknown) => {
      console.error('Error disconnecting database:', disconnectError instanceof Error ? disconnectError.name : 'UnknownError');
      process.exitCode = 1;
    });
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
