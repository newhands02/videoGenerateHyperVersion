import type { TtsRequest, TtsResponse } from '@webframes/shared-types';
import { apiPost } from './client';

export function synthTts(req: TtsRequest) {
  return apiPost<TtsResponse>('/tts', req);
}
