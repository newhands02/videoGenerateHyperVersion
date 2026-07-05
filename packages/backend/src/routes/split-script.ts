import type { Request, Response } from 'express';
import type { ApiResponse, SplitScriptResponse, AISegmentProposal, SceneVisual } from '@webframes/shared-types';
import { env } from '../config/env.js';

/**
 * DeepSeek V4 Pro 系统提示（Phase E1+E2：带场景视觉描述）
 */
const SYSTEM_PROMPT = `你是一名资深短视频编导兼视觉设计师，擅长把长文改写成适合 90-180 秒口播的脚本，并为每段设计场景画面。

## 分段规则
1. 按叙事节奏切分：开场（钩子 hook）→ 痛点 pain → 反转 turn → 高潮 climax → CTA cta
2. 每段 10-18 秒（约 38-68 个中文字）
3. 短句、口语化、避免长定语
4. role 取值：hook / pain / turn / climax / cta / transition
5. confidence 为 0-1 的数值（分段置信度）
6. notes 为分段理由（10 字以内）
7. 保留原文关键信息和语气，不要瞎编

## 场景视觉（visual 字段必填）
每段必须输出 visual 对象，按本段语义选合适 mode：

### mode 选择规则
- **era-card**: 介绍历史人物/事件/年代/里程碑时用。填 era.year（年代或日期）和 era.subtitle（人物名或事件名）
- **versus**: 两件事物对比/对仗/竞争时用。填 versus.left.label、versus.right.label、versus.center（"vs"/"对话"/"PK" 等）
- **formula**: 解释原理/概念/公式/定义时用。填 formula.title（概念名）和 formula.expression（公式或简短描述）
- **quote**: 引用名言/格言/经典语句时用。填 quote.author 和 quote.source
- **timeline-marker**: 标记时间线节点/发展阶段时用。era.year 填节点名
- **plain**: 纯叙述/过渡，无特殊视觉元素

### palette 配色规则（按情绪选）
- **indigo**: 科技/未来/AI/理性/冷峻（深蓝紫渐变）
- **violet**: 神秘/创意/艺术/想象（紫红渐变）
- **ember**: 情感/温暖/回忆/人文（暗灰暖色）
- **amber**: 激情/警示/高潮/能量（红橙渐变）
- **ocean**: 海洋/探索/未知/深邃（蓝绿渐变）
- **forest**: 自然/成长/希望/生机（青绿渐变）

### caption
底部 takeaway 一句话（15-25 字），提炼本段核心观点。

## 输出格式
严格输出 JSON 对象：{ "proposals": [{ "text", "role", "confidence", "notes", "visual" }] }
visual 结构：{ "mode", "palette", "era"?, "versus"?, "formula"?, "quote"?, "caption"? }

## 示例
输入："1950年，阿兰·图灵提出了一个问题：机器能思考吗？他相信，如果你无法分辨屏幕后面是机器还是人，那机器就算有智能了。"
输出：
{"proposals":[
  {"text":"1950年，阿兰·图灵抛出一个问题：机器能思考吗？","role":"hook","confidence":0.95,"notes":"时代起点","visual":{"mode":"era-card","palette":"indigo","era":{"year":"1950","subtitle":"阿兰·图灵"},"caption":"一个改变人类文明的问题诞生了"}},
  {"text":"图灵设计了一场游戏：机器和人类对话，你能分辨吗？","role":"turn","confidence":0.9,"notes":"核心概念","visual":{"mode":"versus","palette":"indigo","versus":{"left":{"label":"机器","tone":"cool"},"right":{"label":"人类","tone":"warm"},"center":"对话"},"caption":"分辨不清的那一刻，智能就诞生了"}}
]}

输入："莎士比亚的十四行诗充满了情感和隐喻，而词频统计只是冰冷的数字。但当AI用概率预测下一个词时，它写出的诗竟然也能打动人。"
输出：
{"proposals":[
  {"text":"莎士比亚的十四行诗，是情感与灵感的结晶。","role":"pain","confidence":0.85,"notes":"对比铺垫","visual":{"mode":"quote","palette":"ember","quote":{"author":"莎士比亚","source":"十四行诗"},"caption":"人类最引以为傲的文字创造力"}},
  {"text":"而词频统计只是冰冷的数字——直到AI学会了用概率写诗。","role":"climax","confidence":0.9,"notes":"反转高潮","visual":{"mode":"versus","palette":"violet","versus":{"left":{"label":"词频统计","tone":"cool"},"right":{"label":"AI写诗","tone":"warm"},"center":"→"},"caption":"冰冷的数字竟然写出了动人的诗句"}}
]}

只输出 JSON，不要输出任何其他文字。`;

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
            visual: { mode: 'plain' as const, palette: 'indigo' as const },
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
      visual: normalizeVisual(p.visual),
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

/** 合法 palette 值 */
const VALID_PALETTES = ['indigo', 'ember', 'ocean', 'forest', 'violet', 'amber'];
const VALID_MODES = ['era-card', 'versus', 'formula', 'quote', 'timeline-marker', 'plain'];

/** 规范化 LLM 返回的 visual 字段，保证类型安全 */
function normalizeVisual(v: any): SceneVisual {
  const mode = VALID_MODES.includes(v?.mode) ? v.mode : 'plain';
  const palette = VALID_PALETTES.includes(v?.palette) ? v.palette : 'indigo';

  const visual: SceneVisual = { mode, palette };

  if (mode === 'era-card' || mode === 'timeline-marker') {
    if (v?.era && typeof v.era === 'object') {
      visual.era = {
        year: String(v.era.year ?? ''),
        subtitle: String(v.era.subtitle ?? ''),
      };
    }
  }

  if (mode === 'versus' && v?.versus && typeof v.versus === 'object') {
    visual.versus = {
      left: {
        label: String(v.versus.left?.label ?? ''),
        tone: v.versus.left?.tone === 'warm' ? 'warm' : 'cool',
      },
      right: {
        label: String(v.versus.right?.label ?? ''),
        tone: v.versus.right?.tone === 'warm' ? 'warm' : 'cool',
      },
      center: v.versus.center ? String(v.versus.center) : 'vs',
    };
  }

  if (mode === 'formula' && v?.formula && typeof v.formula === 'object') {
    visual.formula = {
      title: String(v.formula.title ?? ''),
      expression: v.formula.expression ? String(v.formula.expression) : undefined,
    };
  }

  if (mode === 'quote' && v?.quote && typeof v.quote === 'object') {
    visual.quote = {
      author: v.quote.author ? String(v.quote.author) : undefined,
      source: v.quote.source ? String(v.quote.source) : undefined,
    };
  }

  if (v?.caption && typeof v.caption === 'string') {
    visual.caption = v.caption;
  }

  return visual;
}
