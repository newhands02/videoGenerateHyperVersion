import type { Request, Response } from 'express';
import type { ApiResponse, VoiceEntry } from '@webframes/shared-types';
import { PRESET_VOICES } from '../config/voices.js';

/**
 * GET /api/voices
 * 返回所有预置音色（MiMo 9 + edge 10 中文子集）
 */
export function listVoicesHandler(_req: Request, res: Response) {
  const voices: VoiceEntry[] = PRESET_VOICES;

  const response: ApiResponse<VoiceEntry[]> = {
    ok: true,
    data: voices,
  };
  res.json(response);
}
