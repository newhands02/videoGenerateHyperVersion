import type { Request, Response } from 'express';
import { getServicesStatus } from '../config/env.js';

/**
 * GET /api/health
 * 健康检查 + 外部服务就绪状态
 */
export function healthHandler(_req: Request, res: Response) {
  res.json({
    ok: true,
    data: {
      status: 'ok',
      timestamp: new Date().toISOString(),
      services: getServicesStatus(),
    },
  });
}
