/**
 * 电影感动画引擎
 * 为浏览器内视频导出提供完整的动效系统：
 * 1. 动态渐变背景（漂移光斑 + 底部光晕呼吸）
 * 2. 文字入场/出场（缩放+位移+模糊清晰化）
 * 3. 角色装饰元素（hook/pain/turn/climax/cta 各自不同的氛围）
 * 4. 字幕逐字显现 + 字幕条从底部滑入
 * 5. 段间溶解/擦除过渡（取代死黑屏）
 *
 * 调用方按帧传入 FrameContext，模块本身无状态
 */

import type { ScriptSegment, SegmentRole, SceneVisual } from '@webframes/shared-types';

// ==================== 类型 ====================

export interface FrameContext {
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  /** 当前段内已播放时间（秒） */
  segTime: number;
  /** 当前段总时长（秒） */
  segDur: number;
  /** 当前段在所有段中的索引（0-based） */
  segIndex: number;
  /** 当前段角色 */
  role?: SegmentRole;
  /** 当前段文字（已分行） */
  text: string;
  /** 稳定随机种子（让装饰元素位置可复现） */
  seed: number;
  /** 动画强度：0=静态，1=完整电影感（默认1） */
  intensity: number;
  /** 段间过渡进度（0=上段结尾，1=下段开始），undefined 表示非过渡 */
  transitionProgress?: number;
  /** 上一段的渐变色（用于段间过渡） */
  prevColors?: [string, string];
  /** 场景视觉描述（由 LLM 生成，驱动场景画面渲染） */
  visual?: SceneVisual;
}

// ==================== 常量 ====================

/** 动画时长（秒） */
const T_ENTRANCE = 0.6; // 文字入场
const T_EXIT = 0.5;     // 文字出场
const T_BG_DRIFT_PERIOD = 18; // 背景光斑漂移周期

const SCENE_GRADIENTS: Record<string, [string, string]> = {
  hook: ['#0f0c29', '#302b63'],
  pain: ['#1c1c1c', '#3a3a3a'],
  turn: ['#1a2a6c', '#b21f1f'],
  climax: ['#f12711', '#f5af19'],
  cta: ['#134e5e', '#71b280'],
  transition: ['#2c3e50', '#3498db'],
};
const DEFAULT_GRADIENT: [string, string] = ['#1a1a2e', '#16213e'];

/** Phase E: palette → 渐变色映射（由 LLM 选择，比 role 更精细） */
const PALETTE_GRADIENTS: Record<string, [string, string]> = {
  indigo:  ['#0f0c29', '#302b63'],
  ember:   ['#1c1c1c', '#3a3a3a'],
  ocean:   ['#1a2a6c', '#0d4f5c'],
  forest:  ['#134e5e', '#71b280'],
  violet:  ['#2c1810', '#6b2d5c'],
  amber:   ['#f12711', '#f5af19'],
};

// ==================== 工具函数 ====================

/** 基于字符串生成稳定 hash */
function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0);
}

/** 简易伪随机（mulberry32） */
function mulberry32(seed: number) {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6D2B79F5) >>> 0;
    let r = t;
    r = Math.imul(r ^ (r >>> 15), r | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/** 缓动函数 */
const ease = {
  outCubic: (t: number) => 1 - Math.pow(1 - t, 3),
  inOutCubic: (t: number) => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2,
  outBack: (t: number) => {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  },
  outExpo: (t: number) => t === 1 ? 1 : 1 - Math.pow(2, -10 * t),
};

function clamp(v: number, lo = 0, hi = 1): number {
  return Math.max(lo, Math.min(hi, v));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpColor(c1: string, c2: string, t: number): string {
  const p1 = parseColor(c1);
  const p2 = parseColor(c2);
  const r = Math.round(lerp(p1[0], p2[0], t));
  const g = Math.round(lerp(p1[1], p2[1], t));
  const b = Math.round(lerp(p1[2], p2[2], t));
  return `rgb(${r},${g},${b})`;
}

/**
 * 解析颜色字符串为 [r, g, b]（0-255）。
 * 支持 #hex、#rgb、rgb(r,g,b)、rgba(r,g,b,a) 格式。
 * 解析失败时返回 [0,0,0]（黑色），避免 NaN 传播。
 */
function parseColor(color: string): [number, number, number] {
  const c = color.trim();
  // hex 格式: #rgb 或 #rrggbb
  if (c.startsWith('#')) {
    const h = c.slice(1);
    if (h.length === 3) {
      return [
        parseInt(h[0] + h[0], 16),
        parseInt(h[1] + h[1], 16),
        parseInt(h[2] + h[2], 16),
      ];
    }
    return [
      parseInt(h.slice(0, 2), 16) || 0,
      parseInt(h.slice(2, 4), 16) || 0,
      parseInt(h.slice(4, 6), 16) || 0,
    ];
  }
  // rgb / rgba 格式
  const m = c.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (m) {
    return [parseInt(m[1]), parseInt(m[2]), parseInt(m[3])];
  }
  // 兜底：黑色，避免 NaN
  return [0, 0, 0];
}

function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number, r: number,
) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string[] {
  const lines: string[] = [];
  let current = '';
  for (const ch of text) {
    if (ch === '\n') { lines.push(current); current = ''; continue; }
    const test = current + ch;
    if (ctx.measureText(test).width > maxWidth && current) {
      lines.push(current);
      current = ch;
    } else {
      current = test;
    }
  }
  if (current) lines.push(current);
  return lines;
}

export function getSceneGradient(role?: SegmentRole, visual?: SceneVisual): [string, string] {
  // Phase E: 优先使用 visual.palette（LLM 精选配色）
  if (visual?.palette && PALETTE_GRADIENTS[visual.palette]) {
    return PALETTE_GRADIENTS[visual.palette];
  }
  return (role && SCENE_GRADIENTS[role]) || DEFAULT_GRADIENT;
}

// ==================== 1. 动态背景 ====================

/**
 * 绘制电影感动态背景：
 * - 基础渐变（按角色配色）
 * - 2-3 个缓慢漂移的彩色光斑（kinetic gradient）
 * - 底部光晕呼吸
 * - 顶部到底部的轻微 vignette
 */
export function drawKineticBackground(fc: FrameContext) {
  const { ctx, width, height, segTime, segIndex, seed, intensity, transitionProgress, prevColors, role, visual } = fc;
  const currentGradient = getSceneGradient(role, visual);
  const colors = transitionProgress !== undefined && prevColors
    ? [
        lerpColor(prevColors[0], currentGradient[0], transitionProgress),
        lerpColor(prevColors[1], currentGradient[1], transitionProgress),
      ] as [string, string]
    : currentGradient;

  // 基础渐变
  const baseGrad = ctx.createLinearGradient(0, 0, width * 0.5, height);
  baseGrad.addColorStop(0, colors[0]);
  baseGrad.addColorStop(1, colors[1]);
  ctx.fillStyle = baseGrad;
  ctx.fillRect(0, 0, width, height);

  if (intensity <= 0) return;

  const driftT = ((segTime + segIndex * 1.7) % T_BG_DRIFT_PERIOD) / T_BG_DRIFT_PERIOD;
  const rand = mulberry32(seed);

  // 光斑 1（左上，向右下漂移）
  const blob1X = lerp(-width * 0.2, width * 1.1, ease.outCubic(driftT));
  const blob1Y = lerp(-height * 0.1, height * 0.6, driftT);
  const blob1R = Math.max(width, height) * 0.55;
  const blob1Grad = ctx.createRadialGradient(blob1X, blob1Y, 0, blob1X, blob1Y, blob1R);
  blob1Grad.addColorStop(0, `rgba(255, 255, 255, ${0.12 * intensity})`);
  blob1Grad.addColorStop(0.4, `rgba(255, 255, 255, ${0.04 * intensity})`);
  blob1Grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
  ctx.fillStyle = blob1Grad;
  ctx.fillRect(0, 0, width, height);

  // 光斑 2（右下，反向漂移）
  const driftT2 = 1 - driftT;
  const blob2X = lerp(width * 1.2, -width * 0.1, ease.outCubic(driftT2));
  const blob2Y = lerp(height * 1.1, height * 0.3, driftT2);
  const blob2R = Math.max(width, height) * 0.6;
  const blob2Grad = ctx.createRadialGradient(blob2X, blob2Y, 0, blob2X, blob2Y, blob2R);
  // 选用对比色
  const accentColor = colors[1];
  blob2Grad.addColorStop(0, hexToRgba(accentColor, 0.15 * intensity));
  blob2Grad.addColorStop(0.5, hexToRgba(accentColor, 0.04 * intensity));
  blob2Grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
  ctx.fillStyle = blob2Grad;
  ctx.fillRect(0, 0, width, height);

  // 底部光晕呼吸
  const breathe = 0.5 + 0.5 * Math.sin(segTime * 1.3 + seed);
  const glowR = height * 0.55;
  const glowY = height * 0.85;
  const glowGrad = ctx.createRadialGradient(width / 2, glowY, 0, width / 2, glowY, glowR);
  glowGrad.addColorStop(0, `rgba(255, 255, 255, ${0.18 * intensity * breathe})`);
  glowGrad.addColorStop(1, 'rgba(255, 255, 255, 0)');
  ctx.fillStyle = glowGrad;
  ctx.fillRect(0, 0, width, height);

  // 顶部 vignette 暗角
  const vg = ctx.createLinearGradient(0, 0, 0, height);
  vg.addColorStop(0, 'rgba(0, 0, 0, 0.35)');
  vg.addColorStop(0.3, 'rgba(0, 0, 0, 0)');
  vg.addColorStop(0.7, 'rgba(0, 0, 0, 0)');
  vg.addColorStop(1, 'rgba(0, 0, 0, 0.45)');
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, width, height);
}

function hexToRgba(color: string, a: number): string {
  const [r, g, b] = parseColor(color);
  return `rgba(${r},${g},${b},${a})`;
}

// ==================== 2. 文字入场/出场动画 ====================

/**
 * 绘制主文字：三层动效
 * - intensity = 0 (static)   : 静态文字，无任何动效
 * - intensity ≈ 0.4 (minimal): 整段淡入 + 整段淡出
 * - intensity = 1.0 (cinematic): 真正的 kinetic typography
 *                                  · 逐字延迟飞入（ty 从下方 + scale 0.4→1 + blur 6→0）
 *                                  · 持续呼吸（轻微 scale 1±0.03 正弦）
 *                                  · 整段出场：scale 1→0.92 + 整段上移 + 渐隐
 *                                  · 文字描边+投影（高级感）
 */
export function drawAnimatedMainText(fc: FrameContext): { alpha: number } {
  const { ctx, width, height, segTime, segDur, text, intensity, role, seed } = fc;

  if (intensity <= 0) {
    // static: 直接画，不动
    return drawPlainText(fc, 1);
  }

  const fontSize = Math.round(height / 18);
  const maxWidth = width * 0.78;

  ctx.save();
  ctx.font = `bold ${fontSize}px "PingFang SC", "Noto Sans SC", "Microsoft YaHei", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const lines = wrapText(ctx, text, maxWidth);
  const lineHeight = fontSize * 1.5;
  const cx = width / 2;
  const cy = height / 2;

  // 文本总宽（用于逐字定位）
  // 先把字体设回普通大小测量
  ctx.font = `bold ${fontSize}px "PingFang SC", "Noto Sans SC", "Microsoft YaHei", sans-serif`;

  // 段内整体 progress
  let progress: number;
  let globalTy: number;
  let globalScale: number;
  if (segTime < T_ENTRANCE) {
    const t = segTime / T_ENTRANCE;
    progress = ease.outCubic(t);
    globalTy = lerp(20 * intensity, 0, progress);
    globalScale = lerp(0.96, 1.0, progress);
  } else if (segTime > segDur - T_EXIT) {
    const t = (segTime - (segDur - T_EXIT)) / T_EXIT;
    const e = ease.outCubic(t);
    progress = 1 - e;
    globalTy = lerp(0, -25 * intensity, e);
    globalScale = lerp(1.0, 0.93, e);
  } else {
    progress = 1;
    globalTy = 0;
    globalScale = 1.0;
  }

  if (progress <= 0) {
    ctx.restore();
    return { alpha: 0 };
  }

  // 呼吸效果（仅 cinematic）
  let breathe = 0;
  if (intensity >= 0.9) {
    breathe = Math.sin(segTime * 1.6) * 0.025 * intensity;
  }

  // 逐字延迟入场（仅 cinematic）
  // 每字延迟 = T_ENTRANCE / 总字数 * intensity 比例
  let charDelay = 0;
  if (intensity >= 0.9) {
    const totalChars = text.replace(/\n/g, '').length;
    // 每字最多 0.06s 延迟，强度越大字越紧凑
    charDelay = Math.min(0.06, T_ENTRANCE / Math.max(8, totalChars)) * intensity;
  }

  // 整段文字的渐显 alpha
  ctx.globalAlpha = progress;

  // 装饰：cinematic 模式下绘制高亮描边 + 投影
  ctx.shadowColor = 'rgba(0, 0, 0, 0.85)';
  ctx.shadowBlur = 18 + 12 * intensity;
  ctx.shadowOffsetY = 3;
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = `rgba(0, 0, 0, ${0.3 + 0.1 * intensity})`;
  ctx.lineWidth = Math.max(1, fontSize / 60);

  // 计算所有行宽（用于水平居中）
  // 把所有字符展平，计算每个字的位置
  const allChars: Array<{ ch: string; line: number; xInLine: number; w: number }> = [];
  lines.forEach((line, lineIdx) => {
    let xInLine = 0;
    for (const ch of line) {
      const w = ctx.measureText(ch).width;
      allChars.push({ ch, line: lineIdx, xInLine, w });
      xInLine += w;
    }
  });

  // 用随机数决定每个字的入场方向（cinematic 模式）
  // 让一部分字从左飞入、一部分从右飞入、一部分从下飞入
  const dirRand = mulberry32(seed * 7 + 13);

  // 计算每行宽度（用于水平居中）
  const lineWidths = lines.map(l => ctx.measureText(l).width);

  // 整体缩放基准
  const baseScale = globalScale + breathe;

  // 逐字绘制
  let charIdx = 0;
  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx];
    const lineW = lineWidths[lineIdx];
    const lineXStart = cx - lineW / 2; // 这一行第一个字的 x 起点
    const y = cy - (lines.length * lineHeight) / 2 + lineIdx * lineHeight + lineHeight / 2 + globalTy;

    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      const charInfo = allChars[charIdx];
      const cxCh = lineXStart + charInfo.xInLine + charInfo.w / 2;

      // 单字延迟入场
      const localSegTime = segTime - charIdx * charDelay;
      let chScale = 1.0;
      let chAlpha = progress;
      let chTy = 0;
      let chBlur = 0;
      let chRot = 0;

      if (intensity >= 0.9 && localSegTime < T_ENTRANCE) {
        // cinematic: 逐字入场
        const t = clamp(localSegTime / T_ENTRANCE, 0, 1);
        const e = ease.outBack(t);
        chScale = lerp(0.4, 1.0, e);
        chAlpha = clamp(progress * e, 0, 1);
        chBlur = lerp(6, 0, e);
        // 随机方向飞入
        const r = dirRand();
        if (r < 0.33) {
          // 从左飞入
          chTy = lerp(-60, 0, e);
        } else if (r < 0.66) {
          // 从下飞入
          chTy = lerp(60, 0, e);
        } else {
          // 从右飞入（轻微旋转）
          chTy = lerp(40, 0, e);
          chRot = lerp(0.3, 0, e);
        }
      } else if (intensity < 0.9) {
        // minimal: 整段淡入，不做逐字
        chScale = baseScale;
        chBlur = lerp(4 * intensity, 0, progress);
      } else {
        // cinematic 保持阶段：带呼吸
        chScale = baseScale;
      }

      if (chAlpha <= 0.001) {
        charIdx++;
        continue;
      }

      ctx.save();
      ctx.globalAlpha = chAlpha;
      if (chBlur > 0.1) {
        ctx.filter = `blur(${chBlur.toFixed(1)}px)`;
      }
      // 文字位置 = 整体位移 + 单字位移
      const drawX = cxCh;
      const drawY = y + chTy;

      // 缩放 + 旋转（围绕字中心）
      if (Math.abs(chScale - 1) > 0.001 || Math.abs(chRot) > 0.001) {
        ctx.translate(drawX, drawY);
        ctx.rotate(chRot);
        ctx.scale(chScale, chScale);
        ctx.translate(-drawX, -drawY);
      }

      // 描边
      if (ctx.lineWidth > 0) {
        ctx.strokeText(ch, drawX, drawY);
      }
      ctx.fillText(ch, drawX, drawY);
      ctx.restore();

      charIdx++;
    }
  }

  ctx.restore();
  return { alpha: progress };
}

/** 静态文本绘制（intensity=0 时） */
function drawPlainText(fc: FrameContext, alpha: number): { alpha: number } {
  const { ctx, width, height, text } = fc;
  const fontSize = Math.round(height / 18);
  const maxWidth = width * 0.78;

  ctx.save();
  ctx.font = `bold ${fontSize}px "PingFang SC", "Noto Sans SC", "Microsoft YaHei", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const lines = wrapText(ctx, text, maxWidth);
  const lineHeight = fontSize * 1.5;
  const cx = width / 2;
  const cy = height / 2;

  ctx.globalAlpha = alpha;
  ctx.shadowColor = 'rgba(0, 0, 0, 0.85)';
  ctx.shadowBlur = 24;
  ctx.shadowOffsetY = 4;
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.4)';
  ctx.lineWidth = Math.max(1, fontSize / 60);

  lines.forEach((line, i) => {
    const y = cy - (lines.length * lineHeight) / 2 + i * lineHeight + lineHeight / 2;
    if (ctx.lineWidth > 0) ctx.strokeText(line, cx, y);
    ctx.fillText(line, cx, y);
  });
  ctx.restore();
  return { alpha };
}

/**
 * 计算文字动效参数（供其他元素使用以保持同步）
 * 三种强度的不同表现：
 * - 0.0 : static, progress 始终 1
 * - 0.4 : minimal, 平滑淡入淡出
 * - 1.0 : cinematic, 强烈弹性
 */
export function computeTextMotion(
  segTime: number,
  segDur: number,
  intensity: number,
  _role?: SegmentRole,
) {
  if (intensity <= 0.01) {
    return { alpha: 1, scale: 1.0, ty: 0, blur: 0, opacity: 1 };
  }

  let progress: number;
  let scale: number;
  let ty: number;
  let blur: number;

  if (segTime < T_ENTRANCE) {
    const t = segTime / T_ENTRANCE;
    // cinematic 用 outBack（弹性），minimal 用 outCubic（平滑）
    const e = intensity >= 0.9 ? ease.outBack(t) : ease.outCubic(t);
    progress = e;
    scale = intensity >= 0.9 ? lerp(1.25, 1.0, e) : lerp(1.05, 1.0, e);
    ty = lerp(35 * intensity, 0, e);
    blur = lerp(6 * intensity, 0, e);
  } else if (segTime > segDur - T_EXIT) {
    const t = (segTime - (segDur - T_EXIT)) / T_EXIT;
    const e = ease.outCubic(t);
    progress = 1 - e;
    scale = lerp(1.0, 0.94, e);
    ty = lerp(0, -25 * intensity, e);
    blur = 0;
  } else {
    progress = 1;
    scale = 1.0;
    ty = 0;
    blur = 0;
  }

  const alpha = clamp(progress, 0, 1);
  const opacity = clamp(progress, 0, 1);
  return { alpha, scale, ty, blur, opacity };
}

// ==================== 3. 角色装饰元素 ====================

/**
 * 按角色绘制不同氛围的装饰元素
 * - hook: 闪烁星点
 * - pain: 下落细雨线
 * - turn: 旋转方块
 * - climax: 放射光线
 * - cta: 上箭头脉冲
 */
export function drawRoleDecorations(fc: FrameContext) {
  const { ctx, width, height, segTime, role, seed, intensity } = fc;
  if (intensity <= 0) return;

  const rand = mulberry32(seed);
  const t = segTime;

  ctx.save();

  switch (role) {
    case 'hook':
      drawStars(ctx, width, height, t, rand, intensity);
      break;
    case 'pain':
      drawRain(ctx, width, height, t, rand, intensity);
      break;
    case 'turn':
      drawOrbitingSquares(ctx, width, height, t, rand, intensity);
      break;
    case 'climax':
      drawSunRays(ctx, width, height, t, rand, intensity);
      break;
    case 'cta':
      drawUpwardArrows(ctx, width, height, t, rand, intensity);
      break;
    default:
      drawStars(ctx, width, height, t, rand, intensity * 0.5);
      break;
  }

  ctx.restore();
}

function drawStars(
  ctx: CanvasRenderingContext2D, w: number, h: number, t: number,
  rand: () => number, intensity: number,
) {
  const count = 60;
  for (let i = 0; i < count; i++) {
    const sx = rand() * w;
    const sy = rand() * h;
    const size = rand() * 2 + 0.5;
    const phase = rand() * Math.PI * 2;
    const twinkle = 0.5 + 0.5 * Math.sin(t * 2.5 + phase);
    const a = twinkle * 0.9 * intensity;
    if (a < 0.05) continue;

    ctx.fillStyle = `rgba(255, 255, 255, ${a})`;
    ctx.beginPath();
    ctx.arc(sx, sy, size, 0, Math.PI * 2);
    ctx.fill();

    // 4 道光芒
    if (size > 1.5 && twinkle > 0.6) {
      const gl = size * 4;
      ctx.strokeStyle = `rgba(255, 255, 255, ${a * 0.5})`;
      ctx.lineWidth = 0.6;
      ctx.beginPath();
      ctx.moveTo(sx - gl, sy); ctx.lineTo(sx + gl, sy);
      ctx.moveTo(sx, sy - gl); ctx.lineTo(sx, sy + gl);
      ctx.stroke();
    }
  }
}

function drawRain(
  ctx: CanvasRenderingContext2D, w: number, h: number, t: number,
  rand: () => number, intensity: number,
) {
  const count = 50;
  for (let i = 0; i < count; i++) {
    const speed = 1 + rand() * 1.5;
    const offset = rand() * 1000;
    const y = ((t * speed * 80 + offset) % (h * 1.3)) - h * 0.15;
    const x = rand() * w;
    const len = 12 + rand() * 22;
    const a = (0.3 + rand() * 0.4) * intensity;
    ctx.strokeStyle = `rgba(180, 200, 255, ${a})`;
    ctx.lineWidth = 0.8 + rand() * 0.6;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x - 2, y + len);
    ctx.stroke();
  }
}

function drawOrbitingSquares(
  ctx: CanvasRenderingContext2D, w: number, h: number, t: number,
  rand: () => number, intensity: number,
) {
  const cx = w / 2;
  const cy = h / 2;
  const count = 8;
  for (let i = 0; i < count; i++) {
    const radius = Math.min(w, h) * (0.22 + i * 0.025);
    const angle = t * 0.4 + (i / count) * Math.PI * 2;
    const x = cx + Math.cos(angle) * radius;
    const y = cy + Math.sin(angle) * radius;
    const size = 8 + i * 1.5;
    const rot = t * 0.8 + i;
    const a = (0.25 + (i / count) * 0.4) * intensity;

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.strokeStyle = `rgba(255, 255, 255, ${a})`;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(-size / 2, -size / 2, size, size);
    ctx.restore();
  }
}

function drawSunRays(
  ctx: CanvasRenderingContext2D, w: number, h: number, t: number,
  rand: () => number, intensity: number,
) {
  const cx = w / 2;
  const cy = h * 0.4;
  const rayCount = 24;
  for (let i = 0; i < rayCount; i++) {
    const angle = (i / rayCount) * Math.PI * 2;
    const lengthOsc = 0.8 + 0.2 * Math.sin(t * 3 + i * 0.5);
    const inner = Math.min(w, h) * 0.18;
    const outer = Math.min(w, h) * (0.45 + 0.1 * lengthOsc);
    const x1 = cx + Math.cos(angle) * inner;
    const y1 = cy + Math.sin(angle) * inner;
    const x2 = cx + Math.cos(angle) * outer;
    const y2 = cy + Math.sin(angle) * outer;
    const a = (0.15 + 0.25 * (0.5 + 0.5 * Math.sin(t * 2 + i))) * intensity;

    ctx.strokeStyle = `rgba(255, 230, 150, ${a})`;
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }
  // 中心光球
  const pulse = 1 + 0.1 * Math.sin(t * 4);
  const ballR = Math.min(w, h) * 0.12 * pulse;
  const ballGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, ballR * 2);
  ballGrad.addColorStop(0, `rgba(255, 255, 220, ${0.6 * intensity})`);
  ballGrad.addColorStop(0.5, `rgba(255, 200, 100, ${0.2 * intensity})`);
  ballGrad.addColorStop(1, 'rgba(255, 200, 100, 0)');
  ctx.fillStyle = ballGrad;
  ctx.fillRect(cx - ballR * 2, cy - ballR * 2, ballR * 4, ballR * 4);
}

function drawUpwardArrows(
  ctx: CanvasRenderingContext2D, w: number, h: number, t: number,
  rand: () => number, intensity: number,
) {
  const count = 12;
  for (let i = 0; i < count; i++) {
    const baseX = (i / count) * w + rand() * 40 - 20;
    const period = 1.5 + rand() * 1.0;
    const phase = (t / period + rand()) % 1;
    const y = h * (1 - phase) - 50;
    const size = 18 + rand() * 14;
    const a = (1 - phase) * 0.6 * intensity;

    ctx.fillStyle = `rgba(180, 255, 200, ${a})`;
    ctx.strokeStyle = `rgba(180, 255, 200, ${a * 0.8})`;
    ctx.lineWidth = 2;

    // 箭头主体（三角形 + 矩形）
    ctx.beginPath();
    ctx.moveTo(baseX, y);
    ctx.lineTo(baseX - size / 2, y + size);
    ctx.lineTo(baseX - size / 6, y + size);
    ctx.lineTo(baseX - size / 6, y + size * 1.8);
    ctx.lineTo(baseX + size / 6, y + size * 1.8);
    ctx.lineTo(baseX + size / 6, y + size);
    ctx.lineTo(baseX + size / 2, y + size);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
}

// ==================== 4. 字幕条 ====================

/**
 * 字幕条从底部滑入 + 文字逐字显现
 * 始终显示完整文字（避免观感割裂），但有"打字机"风格的高亮进度
 */
export function drawAnimatedSubtitle(
  fc: FrameContext,
  revealProgress: number, // 0~1，文字显现比例
) {
  const { ctx, width, height, segTime, segDur, text, intensity } = fc;

  // 字幕条入场时间点（0.15s 延迟）
  const T_BAR_IN = 0.15;
  const T_BAR_DUR = 0.4;

  let barY: number;
  let barAlpha: number;

  if (segTime < T_BAR_IN) {
    barY = height;
    barAlpha = 0;
  } else if (segTime < T_BAR_IN + T_BAR_DUR) {
    const t = (segTime - T_BAR_IN) / T_BAR_DUR;
    const e = ease.outCubic(t);
    barY = lerp(height, height - height * 0.12, e);
    barAlpha = e;
  } else if (segTime > segDur - T_EXIT) {
    const t = (segTime - (segDur - T_EXIT)) / T_EXIT;
    const e = ease.outCubic(t);
    barY = lerp(height - height * 0.12, height, e);
    barAlpha = 1 - e;
  } else {
    barY = height - height * 0.12;
    barAlpha = 1;
  }

  if (barAlpha <= 0) return;

  const fontSize = Math.round(height / 30);
  const lineHeight = fontSize * 1.4;
  const paddingH = fontSize * 1.4;
  const paddingV = fontSize * 0.7;
  const maxTextWidth = width * 0.72;

  ctx.font = `500 ${fontSize}px "PingFang SC", "Noto Sans SC", "Microsoft YaHei", sans-serif`;
  const lines = wrapText(ctx, text, maxTextWidth);
  const barWidth = Math.min(width * 0.88, maxTextWidth + paddingH * 2);
  const barHeight = lines.length * lineHeight + paddingV * 2;
  const barX = (width - barWidth) / 2;

  // 字幕条背景
  ctx.save();
  ctx.globalAlpha = barAlpha * 0.85;
  const barGrad = ctx.createLinearGradient(0, barY, 0, barY + barHeight);
  barGrad.addColorStop(0, 'rgba(0, 0, 0, 0.85)');
  barGrad.addColorStop(1, 'rgba(0, 0, 0, 0.7)');
  ctx.fillStyle = barGrad;
  roundRectPath(ctx, barX, barY, barWidth, barHeight, fontSize * 0.3);
  ctx.fill();

  // 顶部高光（让条有"立体感"）
  ctx.globalAlpha = barAlpha * 0.3;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
  ctx.lineWidth = 1;
  roundRectPath(ctx, barX, barY, barWidth, barHeight, fontSize * 0.3);
  ctx.stroke();
  ctx.restore();

  // 文字（带逐字显现效果）
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffffff';
  ctx.shadowColor = 'rgba(0, 0, 0, 0.6)';
  ctx.shadowBlur = 6;

  const textStartY = barY + paddingV + lineHeight / 2;
  // 计算所有字符总数
  const allChars = text.replace(/\n/g, '');
  const totalChars = allChars.length;
  const visibleChars = Math.floor(totalChars * clamp(revealProgress, 0, 1));

  let charCount = 0;
  lines.forEach((line, li) => {
    let displayLine = '';
    for (const ch of line) {
      if (charCount < visibleChars) {
        displayLine += ch;
        charCount++;
      } else {
        break;
      }
    }
    if (displayLine) {
      ctx.globalAlpha = barAlpha;
      ctx.fillText(displayLine, width / 2, textStartY + li * lineHeight);
    }
  });

  ctx.restore();
}

// ==================== 5. 段标签（左上） ====================

export function drawSegmentBadge(
  fc: FrameContext,
  text: string,
) {
  const { ctx, width, height, segTime, segDur, intensity } = fc;
  let alpha = 1;
  if (segTime > segDur - T_EXIT) {
    alpha = clamp(1 - (segTime - (segDur - T_EXIT)) / T_EXIT, 0, 1);
  }
  if (alpha <= 0) return;

  const fontSize = Math.round(height / 45);
  const padding = fontSize * 0.6;
  ctx.font = `500 ${fontSize}px "PingFang SC", "Microsoft YaHei", sans-serif`;
  const textWidth = ctx.measureText(text).width;
  const badgeW = textWidth + padding * 2;
  const badgeH = fontSize + padding * 1.6;
  const badgeX = Math.round(width * 0.03);
  const badgeY = Math.round(height * 0.03);
  const radius = badgeH / 2;

  ctx.save();
  ctx.globalAlpha = alpha * 0.85;
  ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
  roundRectPath(ctx, badgeX, badgeY, badgeW, badgeH, radius);
  ctx.fill();

  ctx.globalAlpha = alpha;
  ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, badgeX + padding, badgeY + badgeH / 2);
  ctx.restore();
}

// ==================== 6. 进度条（底部小条） ====================

export function drawProgressBar(fc: FrameContext, totalDuration: number, currentTime: number) {
  const { ctx, width, height } = fc;
  const barH = 3;
  const barW = width * 0.6;
  const barX = (width - barW) / 2;
  const barY = height - 8;

  ctx.save();
  ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
  ctx.fillRect(barX, barY, barW, barH);

  const progress = clamp(currentTime / totalDuration, 0, 1);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
  ctx.fillRect(barX, barY, barW * progress, barH);
  ctx.restore();
}

// ==================== 7. 段间过渡 ====================

/**
 * 段间过渡：交叉淡入 + 滑动擦除
 * transitionProgress 0→1 表示从上段完全切换到下段
 */
export function drawTransitionOverlay(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  progress: number,
  intensity: number,
) {
  if (intensity <= 0 || progress >= 1 || progress <= 0) return;

  // 整体光斑闪烁（切换瞬间一个白色闪烁）
  const flash = Math.max(0, 1 - progress * 4) * 0.4 * intensity;
  if (flash > 0) {
    ctx.save();
    ctx.fillStyle = `rgba(255, 255, 255, ${flash})`;
    ctx.fillRect(0, 0, width, height);
    ctx.restore();
  }

  // 上方擦除条（一条从上往下扫过，给"翻页"感）
  const wipeY = height * progress;
  ctx.save();
  ctx.globalAlpha = 0.3 * intensity;
  ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
  ctx.fillRect(0, wipeY - 1, width, 2);
  ctx.restore();
}

// ==================== 8. 场景视觉（Phase E） ====================

/**
 * 场景视觉主入口：根据 visual.mode 分发到具体渲染函数
 * 每个 mode 都有独特的排版方式，让画面"根据文字内容生成"
 */
export function drawSceneVisual(fc: FrameContext) {
  const { visual, segTime, segDur, intensity } = fc;
  if (!visual) return;

  // 入场/出场 alpha（与主文字动画同步）
  let alpha = 1;
  if (segTime < T_ENTRANCE) {
    alpha = ease.outCubic(segTime / T_ENTRANCE);
  } else if (segTime > segDur - T_EXIT) {
    alpha = 1 - ease.outCubic((segTime - (segDur - T_EXIT)) / T_EXIT);
  }
  if (alpha <= 0.001) return;

  switch (visual.mode) {
    case 'era-card':
      if (visual.era?.year) {
        drawEraCard(fc, alpha);
      } else {
        drawVisualPlaceholder(fc, alpha, '年代卡', '缺少 year 字段');
      }
      break;
    case 'versus':
      if (visual.versus?.left?.label && visual.versus?.right?.label) {
        drawVersus(fc, alpha);
      } else {
        drawVisualPlaceholder(fc, alpha, '对照式', '缺少 left/right label');
      }
      break;
    case 'formula':
      if (visual.formula?.title || visual.formula?.expression) {
        drawFormula(fc, alpha);
      } else {
        drawVisualPlaceholder(fc, alpha, '公式卡', '缺少 title/expression');
      }
      break;
    case 'quote':
      if (visual.quote?.text) {
        drawQuote(fc, alpha);
      } else {
        drawVisualPlaceholder(fc, alpha, '引言卡', '缺少 text');
      }
      break;
    case 'timeline-marker':
      if (visual.timeline?.year) {
        drawTimelineMarker(fc, alpha);
      } else {
        drawVisualPlaceholder(fc, alpha, '时间线', '缺少 year');
      }
      break;
    case 'plain':
    default:
      // visual.mode === 'plain' 或未知：走原有主文字路径（renderFrame 已分流）
      drawAnimatedMainText(fc);
      break;
  }

  // 底部 caption（如果有）
  if (visual.caption) {
    drawSceneCaption(fc, visual.caption, alpha);
  }
}

/**
 * 当 LLM 返回了 visual.mode 但缺少必要子字段时的占位画面
 * 比 fallback 到 drawAnimatedMainText 干净，避免和字幕条叠加
 */
function drawVisualPlaceholder(fc: FrameContext, alpha: number, title: string, hint: string) {
  const { ctx, width, height, intensity } = fc;
  ctx.save();
  ctx.globalAlpha = alpha;

  const cx = width / 2;
  const cy = height / 2;

  // 半透明白色卡片
  const cardW = width * 0.5;
  const cardH = height * 0.22;
  const cardX = cx - cardW / 2;
  const cardY = cy - cardH / 2;
  ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
  ctx.lineWidth = 2;
  roundRectPath(ctx, cardX, cardY, cardW, cardH, 16);
  ctx.fill();
  ctx.stroke();

  // 模式名
  const titleSize = Math.max(28, Math.min(width, height) * 0.05);
  ctx.fillStyle = '#ffffff';
  ctx.font = `bold ${titleSize}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(0, 0, 0, 0.6)';
  ctx.shadowBlur = 8;
  ctx.fillText(`🎬 ${title}`, cx, cy - titleSize * 0.3);

  // 提示
  const hintSize = Math.max(14, Math.min(width, height) * 0.022);
  ctx.font = `${hintSize}px sans-serif`;
  ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
  ctx.fillText(hint, cx, cy + titleSize * 0.5);

  ctx.restore();
}

/**
 * era-card: 年代卡片
 * 画面中央显示一个巨大的年份，下方是人物/事件名
 * 适合"1950 · 阿兰·图灵"这种里程碑式画面
 */
function drawEraCard(fc: FrameContext, alpha: number) {
  const { ctx, width, height, segTime, intensity, visual } = fc;
  if (!visual?.era) { drawAnimatedMainText(fc); return; }

  const cx = width / 2;
  const cy = height / 2;

  // 年份：超大字号，居中偏上
  const yearFontSize = Math.round(height / 5.5);
  const subtitleFontSize = Math.round(height / 22);

  ctx.save();
  ctx.globalAlpha = alpha;

  // 入场动画：从下方滑入 + 缩放
  let slideY = 0;
  let scale = 1.0;
  if (segTime < T_ENTRANCE && intensity > 0.1) {
    const t = segTime / T_ENTRANCE;
    const e = ease.outBack(t);
    slideY = lerp(60, 0, e);
    scale = lerp(0.85, 1.0, e);
  }

  ctx.translate(cx, cy + slideY);
  ctx.scale(scale, scale);

  // 年份描边+填充
  ctx.font = `900 ${yearFontSize}px "PingFang SC", "Noto Sans SC", "Microsoft YaHei", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
  ctx.shadowBlur = 30;
  ctx.shadowOffsetY = 6;
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.3)';
  ctx.lineWidth = Math.max(2, yearFontSize / 50);
  if (ctx.lineWidth > 0) ctx.strokeText(visual.era.year, 0, -yearFontSize * 0.35);
  ctx.fillText(visual.era.year, 0, -yearFontSize * 0.35);

  // 分隔线
  ctx.shadowBlur = 10;
  const lineW = yearFontSize * 1.8;
  const lineGrad = ctx.createLinearGradient(-lineW / 2, 0, lineW / 2, 0);
  lineGrad.addColorStop(0, 'rgba(255, 255, 255, 0)');
  lineGrad.addColorStop(0.5, 'rgba(255, 255, 255, 0.6)');
  lineGrad.addColorStop(1, 'rgba(255, 255, 255, 0)');
  ctx.fillStyle = lineGrad;
  ctx.fillRect(-lineW / 2, yearFontSize * 0.05, lineW, 2);

  // 副标题（人物/事件名）
  ctx.font = `400 ${subtitleFontSize}px "PingFang SC", "Noto Sans SC", "Microsoft YaHei", sans-serif`;
  ctx.shadowBlur = 12;
  ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
  ctx.fillText(visual.era.subtitle, 0, yearFontSize * 0.25);

  ctx.restore();
}

/**
 * versus: 左右对照式
 * 画面分为左右两半，各放一个标签，中间有连接词
 * 适合"机器 vs 人类"、"莎士比亚 vs 词频统计"
 */
function drawVersus(fc: FrameContext, alpha: number) {
  const { ctx, width, height, segTime, intensity, visual } = fc;
  if (!visual?.versus) { drawAnimatedMainText(fc); return; }

  const cx = width / 2;
  const cy = height / 2;
  const labelFontSize = Math.round(height / 12);
  const centerFontSize = Math.round(height / 20);

  ctx.save();
  ctx.globalAlpha = alpha;

  // 入场：左右两边分别从外侧滑入
  let leftX = width * 0.25;
  let rightX = width * 0.75;
  let centerAlpha = 1;

  if (segTime < T_ENTRANCE && intensity > 0.1) {
    const t = segTime / T_ENTRANCE;
    const e = ease.outCubic(t);
    leftX = lerp(width * 0.05, width * 0.25, e);
    rightX = lerp(width * 0.95, width * 0.75, e);
    centerAlpha = t > 0.6 ? ease.outCubic((t - 0.6) / 0.4) : 0;
  }

  const { left, right, center = 'vs' } = visual.versus;

  // 左侧标签
  ctx.font = `bold ${labelFontSize}px "PingFang SC", "Noto Sans SC", "Microsoft YaHei", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(0, 0, 0, 0.7)';
  ctx.shadowBlur = 16;
  ctx.shadowOffsetY = 3;

  // 左侧用冷色调（蓝/青），右侧用暖色调（橙/红）
  const leftColor = left.tone === 'warm' ? 'rgba(255, 200, 150, 0.95)' : 'rgba(150, 200, 255, 0.95)';
  const rightColor = right.tone === 'warm' ? 'rgba(255, 200, 150, 0.95)' : 'rgba(150, 200, 255, 0.95)';

  ctx.fillStyle = leftColor;
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.3)';
  ctx.lineWidth = Math.max(1, labelFontSize / 60);

  const leftLabel = wrapText(ctx, left.label, width * 0.35);
  leftLabel.forEach((line, i) => {
    const ly = cy - (leftLabel.length - 1) * labelFontSize * 0.75 + i * labelFontSize * 1.5;
    if (ctx.lineWidth > 0) ctx.strokeText(line, leftX, ly);
    ctx.fillText(line, leftX, ly);
  });

  // 右侧标签
  ctx.fillStyle = rightColor;
  const rightLabel = wrapText(ctx, right.label, width * 0.35);
  rightLabel.forEach((line, i) => {
    const ly = cy - (rightLabel.length - 1) * labelFontSize * 0.75 + i * labelFontSize * 1.5;
    if (ctx.lineWidth > 0) ctx.strokeText(line, rightX, ly);
    ctx.fillText(line, rightX, ly);
  });

  // 中间连接词
  if (centerAlpha > 0.01) {
    ctx.globalAlpha = alpha * centerAlpha;
    ctx.font = `300 ${centerFontSize}px "PingFang SC", "Microsoft YaHei", sans-serif`;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
    ctx.shadowBlur = 8;
    ctx.fillText(center, cx, cy);
  }

  // 中间竖线分隔
  ctx.globalAlpha = alpha * 0.15;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(cx, cy - height * 0.15);
  ctx.lineTo(cx, cy + height * 0.15);
  ctx.stroke();

  ctx.restore();
}

/**
 * formula: 概念/公式卡片
 * 顶部显示概念名（大字），下方显示公式或简短描述（等宽字体）
 */
function drawFormula(fc: FrameContext, alpha: number) {
  const { ctx, width, height, segTime, intensity, visual } = fc;
  if (!visual?.formula) { drawAnimatedMainText(fc); return; }

  const cx = width / 2;
  const cy = height / 2;
  const titleFontSize = Math.round(height / 11);
  const exprFontSize = Math.round(height / 26);

  ctx.save();
  ctx.globalAlpha = alpha;

  // 入场：缩放+淡入
  let scale = 1.0;
  if (segTime < T_ENTRANCE && intensity > 0.1) {
    const t = segTime / T_ENTRANCE;
    scale = lerp(0.9, 1.0, ease.outBack(t));
  }

  ctx.translate(cx, cy);
  ctx.scale(scale, scale);

  // 背景卡片（半透明圆角矩形）
  const cardW = width * 0.6;
  const cardH = height * 0.3;
  ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
  roundRectPath(ctx, -cardW / 2, -cardH / 2, cardW, cardH, 16);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
  ctx.lineWidth = 1;
  roundRectPath(ctx, -cardW / 2, -cardH / 2, cardW, cardH, 16);
  ctx.stroke();

  // 概念名
  ctx.font = `bold ${titleFontSize}px "PingFang SC", "Noto Sans SC", "Microsoft YaHei", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(0, 0, 0, 0.6)';
  ctx.shadowBlur = 14;
  ctx.fillStyle = '#ffffff';
  ctx.fillText(visual.formula.title, 0, -cardH * 0.15);

  // 公式/描述（等宽字体）
  if (visual.formula.expression) {
    ctx.font = `400 ${exprFontSize}px "JetBrains Mono", "Fira Code", "Consolas", monospace`;
    ctx.fillStyle = 'rgba(180, 220, 255, 0.9)';
    ctx.shadowBlur = 6;
    ctx.fillText(visual.formula.expression, 0, cardH * 0.2);
  }

  ctx.restore();
}

/**
 * quote: 引文卡片
 * 居中大引号 + 引文文字 + 底部作者署名
 */
function drawQuote(fc: FrameContext, alpha: number) {
  const { ctx, width, height, segTime, intensity, visual, text } = fc;
  if (!visual?.quote) { drawAnimatedMainText(fc); return; }

  const cx = width / 2;
  const cy = height / 2;
  const quoteFontSize = Math.round(height / 16);
  const authorFontSize = Math.round(height / 30);

  ctx.save();
  ctx.globalAlpha = alpha;

  // 入场：从下方淡入
  let slideY = 0;
  if (segTime < T_ENTRANCE && intensity > 0.1) {
    const t = segTime / T_ENTRANCE;
    slideY = lerp(30, 0, ease.outCubic(t));
  }

  // 巨大引号（装饰性）
  const quoteMarkSize = Math.round(height / 6);
  ctx.font = `700 ${quoteMarkSize}px Georgia, serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
  ctx.fillText('\u201C', cx - width * 0.28, cy - height * 0.12 + slideY);

  // 引文文字（使用段文字，不是 visual.caption）
  ctx.font = `500 ${quoteFontSize}px "PingFang SC", "Noto Sans SC", "Microsoft YaHei", serif`;
  ctx.shadowColor = 'rgba(0, 0, 0, 0.6)';
  ctx.shadowBlur = 12;
  ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
  const lines = wrapText(ctx, text, width * 0.7);
  const lineHeight = quoteFontSize * 1.6;
  lines.forEach((line, i) => {
    const ly = cy - (lines.length - 1) * lineHeight * 0.5 + i * lineHeight + slideY;
    ctx.fillText(line, cx, ly);
  });

  // 作者署名
  if (visual.quote.author) {
    const authorY = cy + lines.length * lineHeight * 0.5 + authorFontSize * 1.2 + slideY;
    ctx.font = `400 ${authorFontSize}px "PingFang SC", "Microsoft YaHei", sans-serif`;
    ctx.fillStyle = 'rgba(200, 200, 200, 0.7)';
    ctx.shadowBlur = 4;
    const authorText = visual.quote.source
      ? `\u2014 ${visual.quote.author} · ${visual.quote.source}`
      : `\u2014 ${visual.quote.author}`;
    ctx.fillText(authorText, cx, authorY);
  }

  ctx.restore();
}

/**
 * timeline-marker: 时间线节点
 * 左侧一个时间线竖线 + 圆点，右侧显示节点名和描述
 */
function drawTimelineMarker(fc: FrameContext, alpha: number) {
  const { ctx, width, height, segTime, intensity, visual } = fc;
  if (!visual?.era) { drawAnimatedMainText(fc); return; }

  const nodeX = width * 0.3;
  const textX = width * 0.42;
  const cy = height / 2;
  const yearFontSize = Math.round(height / 14);
  const subFontSize = Math.round(height / 28);

  ctx.save();
  ctx.globalAlpha = alpha;

  // 入场：圆点先出现，然后文字滑入
  let dotScale = 1.0;
  let textSlideX = 0;
  if (segTime < T_ENTRANCE && intensity > 0.1) {
    const t = segTime / T_ENTRANCE;
    if (t < 0.4) {
      dotScale = ease.outBack(t / 0.4);
      textSlideX = 40;
    } else {
      dotScale = 1.0;
      textSlideX = lerp(40, 0, ease.outCubic((t - 0.4) / 0.6));
    }
  }

  // 竖线（时间线主体）
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(nodeX, height * 0.2);
  ctx.lineTo(nodeX, height * 0.8);
  ctx.stroke();

  // 圆点（脉冲效果）
  const pulse = 1 + 0.1 * Math.sin(segTime * 3);
  const dotR = Math.round(height / 50) * dotScale * pulse;
  ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
  ctx.shadowColor = 'rgba(255, 255, 255, 0.5)';
  ctx.shadowBlur = 20;
  ctx.beginPath();
  ctx.arc(nodeX, cy, dotR, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;

  // 年份/节点名
  ctx.font = `bold ${yearFontSize}px "PingFang SC", "Noto Sans SC", "Microsoft YaHei", sans-serif`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(0, 0, 0, 0.6)';
  ctx.shadowBlur = 10;
  ctx.fillStyle = '#ffffff';
  ctx.fillText(visual.era.year, textX + textSlideX, cy - yearFontSize * 0.3);

  // 副标题
  ctx.font = `400 ${subFontSize}px "PingFang SC", "Noto Sans SC", "Microsoft YaHei", sans-serif`;
  ctx.fillStyle = 'rgba(200, 200, 200, 0.8)';
  ctx.shadowBlur = 4;
  ctx.fillText(visual.era.subtitle, textX + textSlideX, cy + yearFontSize * 0.5);

  ctx.restore();
}

/**
 * 底部 caption（不同于字幕条，这是 visual 提供的核心观点一句话）
 * 在画面底部中央，带半透明背景条
 */
function drawSceneCaption(fc: FrameContext, caption: string, alpha: number) {
  const { ctx, width, height, segTime, segDur } = fc;

  // caption 在段中段才出现（避免与入场动画冲突）
  const CAPTION_DELAY = T_ENTRANCE + 0.2;
  const CAPTION_END = segDur - T_EXIT;
  let capAlpha = 0;
  if (segTime < CAPTION_DELAY) {
    capAlpha = 0;
  } else if (segTime > CAPTION_END) {
    capAlpha = alpha * (1 - (segTime - CAPTION_END) / T_EXIT);
  } else {
    const t = (segTime - CAPTION_DELAY) / 0.4;
    capAlpha = alpha * ease.outCubic(Math.min(t, 1));
  }
  if (capAlpha <= 0.001) return;

  const fontSize = Math.round(height / 32);
  const paddingH = fontSize * 1.2;
  const paddingV = fontSize * 0.6;
  const maxWidth = width * 0.7;

  ctx.save();
  ctx.globalAlpha = capAlpha;
  ctx.font = `500 ${fontSize}px "PingFang SC", "Noto Sans SC", "Microsoft YaHei", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const lines = wrapText(ctx, caption, maxWidth);
  const lineHeight = fontSize * 1.4;
  const barW = Math.min(width * 0.8, maxWidth + paddingH * 2);
  const barH = lines.length * lineHeight + paddingV * 2;
  const barX = (width - barW) / 2;
  const barY = height * 0.82;

  // 背景条
  ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
  roundRectPath(ctx, barX, barY, barW, barH, fontSize * 0.3);
  ctx.fill();

  // 左侧强调条
  ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
  ctx.fillRect(barX, barY + paddingV * 0.5, 3, barH - paddingV);

  // 文字
  ctx.fillStyle = '#ffffff';
  ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
  ctx.shadowBlur = 4;
  lines.forEach((line, i) => {
    ctx.fillText(line, width / 2, barY + paddingV + lineHeight * (i + 0.5));
  });

  ctx.restore();
}

// ==================== 主渲染入口 ====================

/**
 * 单帧主渲染：把上面所有层组合起来
 * Phase E: 当 visual.mode != 'plain' 时，用 drawSceneVisual 替代 drawAnimatedMainText
 */
export function renderFrame(fc: FrameContext, totalDuration: number, currentTime: number) {
  const { ctx, width, height } = fc;

  // 1. 背景
  drawKineticBackground(fc);

  // 2. 角色装饰
  drawRoleDecorations(fc);

  // 3. 字幕条（仅在 plain 模式显示，避免和场景画面里的文字叠加）
  const useSceneVisual = fc.visual && fc.visual.mode !== 'plain';
  if (!useSceneVisual) {
    const T_SUBTITLE_DELAY = 0.3;
    const T_SUBTITLE_END = fc.segDur - T_EXIT - 0.1;
    const reveal = clamp(
      (fc.segTime - T_SUBTITLE_DELAY) / Math.max(0.1, T_SUBTITLE_END - T_SUBTITLE_DELAY),
      0, 1,
    );
    drawAnimatedSubtitle(fc, reveal);
  }

  // 4. 主画面：有 visual 时用场景画面，否则走纯文字
  if (useSceneVisual) {
    drawSceneVisual(fc);
  } else {
    drawAnimatedMainText(fc);
  }
}

// ==================== 辅助：根据段文本生成稳定 seed ====================
export function seedFor(segIndex: number, text: string): number {
  return hashStr(`${segIndex}:${text}`);
}
