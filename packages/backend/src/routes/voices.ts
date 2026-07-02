import type { Request, Response } from 'express';
import type { ApiResponse, VoiceEntry } from '@webframes/shared-types';

/**
 * GET /api/voices
 * 返回所有预置音色（MiMo 9 + edge 10 中文子集）
 *
 * Phase A 仅返回静态定义，Phase C 接入实际拉取
 */
export function listVoicesHandler(_req: Request, res: Response) {
  const voices: VoiceEntry[] = [
    // === MiMo 预置 9 ===
    { id: 'mimo-冰糖', kind: 'preset', engine: 'mimo', nativeId: '冰糖', alias: '冰糖', lang: 'zh-CN', gender: 'female', description: '故事/情感/科技', createdAt: '2026-07-02', isPreset: true },
    { id: 'mimo-茉莉', kind: 'preset', engine: 'mimo', nativeId: '茉莉', alias: '茉莉', lang: 'zh-CN', gender: 'female', description: '活泼/年轻/时尚', createdAt: '2026-07-02', isPreset: true },
    { id: 'mimo-苏打', kind: 'preset', engine: 'mimo', nativeId: '苏打', alias: '苏打', lang: 'zh-CN', gender: 'male', description: '运动/激情/广告', createdAt: '2026-07-02', isPreset: true },
    { id: 'mimo-白桦', kind: 'preset', engine: 'mimo', nativeId: '白桦', alias: '白桦', lang: 'zh-CN', gender: 'male', description: '沉稳/纪录片/严肃', createdAt: '2026-07-02', isPreset: true },
    { id: 'mimo-Mia', kind: 'preset', engine: 'mimo', nativeId: 'Mia', alias: 'Mia', lang: 'en-US', gender: 'female', createdAt: '2026-07-02', isPreset: true },
    { id: 'mimo-Chloe', kind: 'preset', engine: 'mimo', nativeId: 'Chloe', alias: 'Chloe', lang: 'en-US', gender: 'female', createdAt: '2026-07-02', isPreset: true },
    { id: 'mimo-Milo', kind: 'preset', engine: 'mimo', nativeId: 'Milo', alias: 'Milo', lang: 'en-US', gender: 'male', createdAt: '2026-07-02', isPreset: true },
    { id: 'mimo-Dean', kind: 'preset', engine: 'mimo', nativeId: 'Dean', alias: 'Dean', lang: 'en-US', gender: 'male', createdAt: '2026-07-02', isPreset: true },
    { id: 'mimo-default', kind: 'preset', engine: 'mimo', nativeId: 'mimo_default', alias: 'MiMo-默认', lang: 'multi', description: '后备兜底', createdAt: '2026-07-02', isPreset: true },

    // === edge-tts 锁定 10 中文子集 ===
    { id: 'edge-Xiaoxiao', kind: 'preset', engine: 'edge', nativeId: 'zh-CN-XiaoxiaoNeural', alias: '晓晓', lang: 'zh-CN', gender: 'female', description: '女声默认', createdAt: '2026-07-02', isPreset: true },
    { id: 'edge-Xiaoyi', kind: 'preset', engine: 'edge', nativeId: 'zh-CN-XiaoyiNeural', alias: '晓伊', lang: 'zh-CN', gender: 'female', description: '女声活泼', createdAt: '2026-07-02', isPreset: true },
    { id: 'edge-Yunxi', kind: 'preset', engine: 'edge', nativeId: 'zh-CN-YunxiNeural', alias: '云希', lang: 'zh-CN', gender: 'male', description: '男声阳光', createdAt: '2026-07-02', isPreset: true },
    { id: 'edge-Yunjian', kind: 'preset', engine: 'edge', nativeId: 'zh-CN-YunjianNeural', alias: '云健', lang: 'zh-CN', gender: 'male', description: '男声体育解说', createdAt: '2026-07-02', isPreset: true },
    { id: 'edge-Yunyang', kind: 'preset', engine: 'edge', nativeId: 'zh-CN-YunyangNeural', alias: '云扬', lang: 'zh-CN', gender: 'male', description: '男声新闻主播', createdAt: '2026-07-02', isPreset: true },
    { id: 'edge-Yunxia', kind: 'preset', engine: 'edge', nativeId: 'zh-CN-YunxiaNeural', alias: '云夏', lang: 'zh-CN', gender: 'male', description: '男声文艺', createdAt: '2026-07-02', isPreset: true },
    { id: 'edge-Xiaobei', kind: 'preset', engine: 'edge', nativeId: 'zh-CN-liaoning-XiaobeiNeural', alias: '晓北', lang: 'zh-CN', gender: 'female', description: '女声东北口音', createdAt: '2026-07-02', isPreset: true },
    { id: 'edge-Xiaoni', kind: 'preset', engine: 'edge', nativeId: 'zh-CN-shaanxi-XiaoniNeural', alias: '晓妮', lang: 'zh-CN', gender: 'female', description: '女声陕西口音', createdAt: '2026-07-02', isPreset: true },
    { id: 'edge-HiuGaai', kind: 'preset', engine: 'edge', nativeId: 'zh-HK-HiuGaaiNeural', alias: '晓佳', lang: 'zh-HK', gender: 'female', description: '女声粤语', createdAt: '2026-07-02', isPreset: true },
    { id: 'edge-WanLung', kind: 'preset', engine: 'edge', nativeId: 'zh-HK-WanLungNeural', alias: '云朗', lang: 'zh-HK', gender: 'male', description: '男声粤语', createdAt: '2026-07-02', isPreset: true },
  ];

  const response: ApiResponse<VoiceEntry[]> = {
    ok: true,
    data: voices,
  };
  res.json(response);
}
