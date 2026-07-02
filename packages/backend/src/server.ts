import app from './app.js';
import { env } from './config/env.js';

const server = app.listen(env.port, () => {
  // eslint-disable-next-line no-console
  console.log(`[WebFrames Backend] http://localhost:${env.port}`);
  // eslint-disable-next-line no-console
  console.log(`[WebFrames Backend] frontend origin: ${env.frontendOrigin}`);
  // eslint-disable-next-line no-console
  console.log(`[WebFrames Backend] env: ${env.nodeEnv}`);
});

// 优雅关闭
process.on('SIGTERM', () => {
  // eslint-disable-next-line no-console
  console.log('SIGTERM received, closing server...');
  server.close(() => process.exit(0));
});

process.on('SIGINT', () => {
  // eslint-disable-next-line no-console
  console.log('SIGINT received, closing server...');
  server.close(() => process.exit(0));
});
