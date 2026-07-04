import type { Request, Response } from 'express';
import type { ApiResponse, TtsResponse, TTSEngine } from '@webframes/shared-types';
import { env } from '../config/env.js';
import { findNativeVoiceId } from '../config/voices.js';

/**
 * POST /api/tts
 * TTS 合成 —— 真正调用 MiMo v2.5 或 edge-tts
 */
export async function ttsHandler(req: Request, res: Response) {
  const {
    text,
    engine = 'mimo',
    voiceId = '冰糖',
    voiceType = 'preset',
    voiceDescription,
    voiceSampleBase64,
    speed = 'normal',
  } = req.body as {
    text?: string;
    engine?: TTSEngine;
    voiceId?: string;
    voiceType?: 'preset' | 'design' | 'clone';
    voiceDescription?: string;
    voiceSampleBase64?: string; // "data:audio/mpeg;base64,..."
    speed?: 'slow' | 'normal' | 'fast';
  };

  if (!text || text.trim().length === 0) {
    return res.status(400).json({
      ok: false,
      error: { code: 'EMPTY_TEXT', message: '请输入要合成的文本' },
    } as ApiResponse<never>);
  }

  if (engine === 'mimo') {
    return handleMimo(req, res, { text, voiceId, voiceType, voiceDescription, voiceSampleBase64, speed });
  }

  if (engine === 'edge') {
    return handleEdge(req, res, { text, voiceId, speed });
  }

  return res.status(400).json({
    ok: false,
    error: { code: 'INVALID_ENGINE', message: `不支持的引擎: ${engine}` },
  } as ApiResponse<never>);
}

// ==================== MiMo v2.5 ====================

interface MimoParams {
  text: string;
  voiceId: string;
  voiceType: 'preset' | 'design' | 'clone';
  voiceDescription?: string;
  voiceSampleBase64?: string;
  speed: 'slow' | 'normal' | 'fast';
}

async function handleMimo(
  _req: Request,
  res: Response,
  params: MimoParams,
) {
  if (!env.mimo.apiKey) {
    return res.status(503).json({
      ok: false,
      error: {
        code: 'MIMO_KEY_MISSING',
        message: '后端未配置 MIMO_API_KEY，请在 backend/.env 中配置',
      },
    } as ApiResponse<never>);
  }

  const { text, voiceId, voiceType, voiceDescription, voiceSampleBase64, speed } = params;

  // 构建 speed 控制指令（MiMo 不支持数字参数，用自然语言）
  const speedHint =
    speed === 'slow' ? '语速缓慢，' : speed === 'fast' ? '语速稍快，' : '';

  // 根据 voiceType 选择 model 和 messages
  let model: string;
  let messages: Array<{ role: string; content: string }>;
  let voice: string | undefined;
  let optimizeTextPreview = false;

  if (voiceType === 'design') {
    // 音色设计：用 mimo-v2.5-tts-voicedesign
    // - user 消息 = 音色描述（必填）
    // - assistant 消息 = 要合成的文本
    // - 不传 audio.voice，改用 optimize_text_preview
    model = 'mimo-v2.5-tts-voicedesign';
    messages = [
      { role: 'user', content: voiceDescription || '自然清亮的女声' },
      { role: 'assistant', content: text },
    ];
    voice = undefined;
    optimizeTextPreview = true;
  } else if (voiceType === 'clone') {
    // 音色复刻：用 mimo-v2.5-tts-voiceclone
    // - audio.voice = 样本音频的 Base64 data URI
    // - user 消息可选，传空字符串即可
    model = 'mimo-v2.5-tts-voiceclone';
    messages = [
      { role: 'user', content: speedHint },
      { role: 'assistant', content: text },
    ];
    voice = voiceSampleBase64; // "data:audio/mpeg;base64,..."
  } else {
    // 预置音色：用 mimo-v2.5-tts
    // - audio.voice = 预置音色的 nativeId（如 "冰糖"），不是内部 ID（如 "mimo-冰糖"）
    // - user 消息可选，仅在需要语速控制时传入
    model = 'mimo-v2.5-tts';
    // 查找 nativeId：voiceId 可能是 "mimo-冰糖"，需要映射为 "冰糖"
    const nativeId = findNativeVoiceId(voiceId) ?? voiceId;
    voice = nativeId;
    // 仅在 speedHint 非空时才加 user 消息，避免空内容导致 Param Incorrect
    if (speedHint) {
      messages = [
        { role: 'user', content: speedHint },
        { role: 'assistant', content: text },
      ];
    } else {
      messages = [
        { role: 'assistant', content: text },
      ];
    }
  }

  try {
    const body: any = {
      model,
      messages,
      audio: { format: 'wav' },
    };
    if (voice !== undefined) {
      body.audio.voice = voice;
    }
    if (optimizeTextPreview) {
      body.audio.optimize_text_preview = true;
    }

    const httpRes = await fetch('https://api.xiaomimimo.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'api-key': env.mimo.apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!httpRes.ok) {
      const errText = await httpRes.text();
      let detail = errText;
      try { detail = JSON.parse(errText)?.error?.message ?? errText; } catch {}
      return res.status(httpRes.status).json({
        ok: false,
        error: { code: 'MIMO_API_ERROR', message: `MiMo 错误: ${detail}` },
      } as ApiResponse<never>);
    }

    const data = await httpRes.json();
    const base64Audio = data?.choices?.[0]?.message?.audio?.data ?? '';

    if (!base64Audio) {
      return res.status(502).json({
        ok: false,
        error: { code: 'MIMO_NO_AUDIO', message: 'MiMo 返回了空音频，请重试' },
      } as ApiResponse<never>);
    }

    // 时长由前端从 AudioContext / <audio> 元素获取，后端不计算
    const dataUrl = `data:audio/wav;base64,${base64Audio}`;
    const response: ApiResponse<TtsResponse> = {
      ok: true,
      data: {
        audioUrl: dataUrl,
        duration: 0, // 前端回填
        mime: 'audio/wav',
        engine: 'mimo',
        voiceId,
      },
    };
    res.json(response);
  } catch (err: any) {
    return res.status(500).json({
      ok: false,
      error: { code: 'MIMO_CALL_FAILED', message: `MiMo 调用失败: ${err.message}` },
    } as ApiResponse<never>);
  }
}

// ==================== edge-tts ====================

interface EdgeParams {
  text: string;
  voiceId: string;
  speed: 'slow' | 'normal' | 'fast';
}

/**
 * edge-tts 通过调用 Python edge-tts 包实现
 * 需要环境里安装：pip install edge-tts
 * 如果不可用，返回明确错误提示
 */
async function handleEdge(
  _req: Request,
  res: Response,
  params: EdgeParams,
) {
  const { text, voiceId, speed } = params;

  // 查找 nativeId：voiceId 可能是 "edge-Xiaoxiao"，需要映射为 "zh-CN-XiaoxiaoNeural"
  const nativeVoiceId = findNativeVoiceId(voiceId) ?? voiceId;

  // 用 Node.js 子进程调用 Python edge-tts CLI
  // edge-tts --text "..." --voice zh-CN-XiaoxiaoNeural --write-media - 2>/dev/null
  const { execFile } = await import('child_process');
  const { tmpdir } = await import('os');
  const { join } = await import('path');
  const { writeFileSync, readFileSync, unlinkSync } = await import('fs');

  const tmpFile = join(tmpdir(), `edge-tts-${Date.now()}.mp3`);

  // edge-tts 速度参数：--rate 支持 "+20%" / "-20%" / "0%"
  const rateMap = { slow: '-20%', normal: '0%', fast: '+20%' } as const;
  const rate = rateMap[speed] ?? '0%';

  return new Promise<void>((resolve) => {
    execFile(
      'edge-tts',
      ['--text', text, '--voice', nativeVoiceId, '--rate', rate, '--write-media', tmpFile],
      { timeout: 30_000 },
      (err, _stdout, stderr) => {
        if (err) {
          // edge-tts 未安装或调用失败
          if (stderr?.includes('not found') || (err as any)?.code === 'ENOENT') {
            res.status(503).json({
              ok: false,
              error: {
                code: 'EDGE_TTS_UNAVAILABLE',
                message: 'edge-tts 不可用，请安装：pip install edge-tts，或在设置中切换到 MiMo 引擎',
              },
            } as ApiResponse<never>);
          } else {
            res.status(500).json({
              ok: false,
              error: { code: 'EDGE_TTS_ERROR', message: `edge-tts 错误: ${stderr || err.message}` },
            } as ApiResponse<never>);
          }
          resolve();
          return;
        }

        try {
          const audioBytes = readFileSync(tmpFile);
          const base64Audio = audioBytes.toString('base64');
          unlinkSync(tmpFile);

          const dataUrl = `data:audio/mpeg;base64,${base64Audio}`;
          const response: ApiResponse<TtsResponse> = {
            ok: true,
            data: {
              audioUrl: dataUrl,
              duration: 0,
              mime: 'audio/mpeg',
              engine: 'edge',
              voiceId,
            },
          };
          res.json(response);
        } catch (readErr: any) {
          res.status(500).json({
            ok: false,
            error: { code: 'EDGE_TTS_READ_ERROR', message: `读取 edge-tts 输出失败: ${readErr.message}` },
          } as ApiResponse<never>);
        }
        resolve();
      },
    );
  });
}
