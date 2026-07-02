import 'dotenv/config';

/**
 * 环境变量统一入口
 * 启动时校验必填项，缺失时降级而非崩溃
 */
export const env = {
  port: Number(process.env.PORT ?? 4000),
  frontendOrigin: process.env.FRONTEND_ORIGIN ?? 'http://localhost:5173',
  nodeEnv: process.env.NODE_ENV ?? 'development',
  logLevel: process.env.LOG_LEVEL ?? 'info',

  deepseek: {
    apiKey: process.env.DEEPSEEK_API_KEY ?? '',
    model: process.env.DEEPSEEK_MODEL ?? 'deepseek-v4-pro',
    baseUrl: process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com/v1',
  },

  mimo: {
    apiKey: process.env.MIMO_API_KEY ?? '',
    baseUrl: process.env.MIMO_BASE_URL ?? 'https://api.mimo.mi.com/v1',
  },
} as const;

/**
 * 检查外部服务是否就绪
 * 返回每个服务是否可用的状态（前端可据此降级）
 */
export function getServicesStatus() {
  return {
    deepseek: Boolean(env.deepseek.apiKey),
    mimo: Boolean(env.mimo.apiKey),
    edge: true, // edge-tts 免 key
  };
}
