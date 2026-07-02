import type { SplitScriptResponse } from '@webframes/shared-types';
import { apiPost } from './client';

export function splitScript(text: string) {
  return apiPost<SplitScriptResponse>('/split-script', { text });
}
