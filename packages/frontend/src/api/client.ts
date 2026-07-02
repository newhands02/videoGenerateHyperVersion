/**
 * 后端 API 客户端
 * 所有请求都走 fetch，类型来自 @webframes/shared-types
 */
import type { ApiResponse } from '@webframes/shared-types';

const BASE = '/api';

export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`);
  const data = (await res.json()) as ApiResponse<T>;
  if (!data.ok) throw new Error(data.error.message);
  return data.data;
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as ApiResponse<T>;
  if (!data.ok) throw new Error(data.error.message);
  return data.data;
}
