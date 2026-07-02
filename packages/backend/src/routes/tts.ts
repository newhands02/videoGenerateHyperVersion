import type { Request, Response } from 'express';
import type { ApiResponse, TtsResponse } from '@webframes/shared-types';
import { env } from '../config/env.js';

/**
 * POST /api/tts
 * TTS 合成（Phase A 占位，Phase C 接入 MiMo + edge-tts）
 */
export async function ttsHandler(req: Request, res: Response) {
  const { text, voiceId, engine } = req.body as {
    text?: string;
    voiceId?: string;
    engine?: 'mimo' | 'edge';
  };

  if (!text || text.trim().length === 0) {
    const error: ApiResponse<never> = {
      ok: false,
      error: { code: 'EMPTY_TEXT', message: '请输入要合成的文本' },
    };
    return res.status(400).json(error);
  }

  // MiMo 引擎时检查 Key
  if (engine === 'mimo' && !env.mimo.apiKey) {
    const error: ApiResponse<never> = {
      ok: false,
      error: {
        code: 'MIMO_KEY_MISSING',
        message: '后端未配置 MIMO_API_KEY，MiMo 引擎不可用，请切换到 edge-tts',
      },
    };
    return res.status(503).json(error);
  }

  // Phase A 占位：返回模拟数据
  const response: ApiResponse<TtsResponse> = {
    ok: true,
    data: {
      audioUrl: '',
      duration: 0,
      mime: 'audio/wav',
      engine: engine ?? 'mimo',
      voiceId: voiceId ?? '',
    },
  };
  res.json(response);
}
