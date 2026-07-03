import type { Request, Response } from 'express';
import type { ApiResponse, SplitScriptResponse, AISegmentProposal } from '@webframes/shared-types';
import { env } from '../config/env.js';

/**
 * DeepSeek V4 Pro 系统提示（来自设计文档 v0.1.3）
 */
const SYSTEM_PROMPT = `你是一名资深短视频编导，擅长把长文改写成适合 90-180 秒口播的脚本。
规则：
1. 按叙事节奏切分：开场（钩子）→ 痛点 → 反转 → 高潮 → CTA
2. 每段 10-18 秒（约 38-68 个中文字）
3. 短句、口语化、避免长定语
4. 输出严格 JSON 数组，每段含 { "text", "role", "confidence", "notes" }
5. role 取值：hook / pain / turn / climax / cta / transition
6. confidence 为 0-1 的数值，表示分段置信度
7. notes 为分段理由（10 字以内）
8. 保留原文关键信息和语气，不要瞎编
9. 只输出 JSON，不要输出任何其他文字`;

/**
 * POST /api/split-script
 * AI 智能分段（调用 DeepSeek V4 Pro）
 */
export async function splitScriptHandler(req: Request, res: Response) {
  const { text } = req.body as { text?: string };

  if (!text || text.trim().length === 0) {
    const error: ApiResponse<never> = {
      ok: false,
      error: { code: 'EMPTY_TEXT', message: '请输入文案内容' },
    };
    return res.status(400).json(error);
  }

  // 检查 API Key
  if (!env.deepseek.apiKey) {
    const error: ApiResponse<never> = {
      ok: false,
      error: {
        code: 'DEEPSEEK_KEY_MISSING',
        message: '后端未配置 DEEPSEEK_API_KEY，AI 分段不可用',
      },
    };
    return res.status(503).json(error);
  }

  try {
    // 调用 DeepSeek V4 Pro
    const deepseekRes = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.deepseek.apiKey}`,
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: text },
        ],
        response_format: { type: 'json_object' },
        temperature: 1.3,
      }),
    });

    if (!deepseekRes.ok) {
      const errText = await deepseekRes.text();
      const error: ApiResponse<never> = {
        ok: false,
        error: {
          code: 'DEEPSEEK_ERROR',
          message: `DeepSeek API 错误: ${deepseekRes.status} ${errText}`,
        },
      };
      return res.status(502).json(error);
    }

    const deepseekData = await deepseekRes.json();
    const content = deepseekData.choices?.[0]?.message?.content ?? '';

    // 解析 JSON（DeepSeek 可能返回 markdown 代码块）
    let parsed: { segments?: AISegmentProposal[]; proposals?: AISegmentProposal[] };
    try {
      const cleaned = content
        .replace(/^```json\s*/i, '')
        .replace(/```$/, '')
        .trim();
      parsed = JSON.parse(cleaned);
    } catch {
      // 降级：按句号分段
      const sentences = text
        .split(/[。！？\n]+/)
        .map((s: string) => s.trim())
        .filter((s: string) => s.length > 0);
      const fallback: ApiResponse<SplitScriptResponse> = {
        ok: true,
        data: {
          proposals: sentences.map((s: string, i: number) => ({
            text: s,
            role: (i === 0 ? 'hook' : 'transition') as AISegmentProposal['role'],
            confidence: 0.3,
            suggestedVoice: 'female-warm' as const,
            notes: '降级分段',
          })),
          raw: content,
        },
      };
      return res.json(fallback);
    }

    const proposals = parsed.segments ?? parsed.proposals ?? [];
    if (!Array.isArray(proposals) || proposals.length === 0) {
      const error: ApiResponse<never> = {
        ok: false,
        error: {
          code: 'INVALID_RESPONSE',
          message: 'AI 返回格式异常，请重试',
        },
      };
      return res.status(502).json(error);
    }

    // 验证并规范化 proposals
    const validProposals = proposals.map((p: any) => ({
      text: String(p.text ?? ''),
      role: isValidRole(p.role) ? p.role : 'transition',
      confidence: typeof p.confidence === 'number' ? Math.max(0, Math.min(1, p.confidence)) : 0.5,
      suggestedVoice: p.suggestedVoice ?? 'female-warm',
      notes: String(p.notes ?? ''),
    }));

    const response: ApiResponse<SplitScriptResponse> = {
      ok: true,
      data: {
        proposals: validProposals,
        usage: deepseekData.usage,
        raw: content,
      },
    };
    res.json(response);
  } catch (err: any) {
    const error: ApiResponse<never> = {
      ok: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: err.message ?? '内部错误',
      },
    };
    res.status(500).json(error);
  }
}

function isValidRole(role: string): role is AISegmentProposal['role'] {
  return ['hook', 'pain', 'turn', 'climax', 'cta', 'transition'].includes(role);
}
