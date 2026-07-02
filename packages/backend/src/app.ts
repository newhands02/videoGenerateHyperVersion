import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import { env } from './config/env.js';
import { healthHandler } from './routes/health.js';
import { listVoicesHandler } from './routes/voices.js';
import { splitScriptHandler } from './routes/split-script.js';
import { ttsHandler } from './routes/tts.js';

const app = express();

// ===== 中间件 =====
app.use(cors({ origin: env.frontendOrigin, credentials: true }));
app.use(express.json({ limit: '5mb' }));
app.use(morgan('dev'));

// ===== 路由 =====
app.get('/api/health', healthHandler);
app.get('/api/voices', listVoicesHandler);
app.post('/api/split-script', splitScriptHandler);
app.post('/api/tts', ttsHandler);

// ===== 404 =====
app.use((_req, res) => {
  res.status(404).json({
    ok: false,
    error: { code: 'NOT_FOUND', message: '端点不存在' },
  });
});

export default app;
