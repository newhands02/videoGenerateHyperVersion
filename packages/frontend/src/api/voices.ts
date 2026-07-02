import type { VoiceEntry } from '@webframes/shared-types';
import { apiGet } from './client';

export function fetchVoices() {
  return apiGet<VoiceEntry[]>('/voices');
}

export function fetchHealth() {
  return apiGet<{
    status: 'ok';
    timestamp: string;
    services: { deepseek: boolean; mimo: boolean; edge: boolean };
  }>('/health');
}
