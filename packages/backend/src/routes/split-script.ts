import type { Request, Response } from 'express';
import type { ApiResponse, SplitScriptResponse } from '@webframes/shared-types';
import { env } from '../config/env.js';

/**
 * POST /api/split-script
 * AI 智能分段（Phase A 占位，Phase B 接入 DeepSeek V4 Pro）
 */
export async function splitScriptHandler(
  req: Request,
  res: Response,
) {
  const { text } = req.body as { text?: string };

  if (!text || text.trim().length === 0) {
    const error: ApiResponse<never> = {
      ok: false,
      error: { code: 'EMPTY_TEXT', message: '请输入文案内容' },
    };
    return res.status(400).json(error);
  }

  // Phase A：未配置 Key 时降级提示
  if (!env.deepseek.apiKey) {
    const error: ApiResponse<never> = {
      ok: false,
      error: {
        code: 'DEEPSEEK_KEY_MISSING',
        message: '后端未配置 DEEPSEEK_API_KEY，AI 分段不可用，请手动分段或联系管理员',
      },
    };
    return res.status(503).json(error);
  }

  // Phase B 占位：返回简单按句号分段的结果
  const sentences = text
    .split(/[。！？\n]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  const response: ApiResponse<SplitScriptResponse> = {
    ok: true,
    data: {
      proposals: sentences.map((s, i) => ({
        text: s,
        role: i === 0 ? 'hook' : 'transition',
        confidence: 0.5,
        suggestedVoice: 'female-warm',
        notes: 'Phase A 占位实现',
      })),
      raw: 'Phase A placeholder — Phase B will call DeepSeek V4 Pro',
    },
  };
  res.json(response);
}
