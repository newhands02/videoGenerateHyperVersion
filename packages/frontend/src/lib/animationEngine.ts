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

import type { ScriptSegment, SegmentRole } from '@webframes/shared-types';

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
  const p1 = parseHexColor(c1);
  const p2 = parseHexColor(c2);
  const r = Math.round(lerp(p1[0], p2[0], t));
  const g = Math.round(lerp(p1[1], p2[1], t));
  const b = Math.round(lerp(p1[2], p2[2], t));
  return `rgb(${r},${g},${b})`;
}

function parseHexColor(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
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

export function getSceneGradient(role?: SegmentRole): [string, string] {
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
  const { ctx, width, height, segTime, segIndex, seed, intensity, transitionProgress, prevColors } = fc;
  const colors = transitionProgress !== undefined && prevColors
    ? [
        lerpColor(prevColors[0], getSceneGradient(fc.role)[0], transitionProgress),
        lerpColor(prevColors[1], getSceneGradient(fc.role)[1], transitionProgress),
      ] as [string, string]
    : getSceneGradient(fc.role);

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

function hexToRgba(hex: string, a: number): string {
  const [r, g, b] = parseHexColor(hex);
  return `rgba(${r},${g},${b},${a})`;
}

// ==================== 2. 文字入场/出场动画 ====================

/**
 * 绘制主文字：入场缩放+位移+模糊清晰化
 * t ∈ [0, T_ENTRANCE] 入场
 * t ∈ [T_ENTRANCE, segDur - T_EXIT] 保持
 * t ∈ [segDur - T_EXIT, segDur] 出场
 */
export function drawAnimatedMainText(fc: FrameContext): { alpha: number } {
  const { ctx, width, height, segTime, segDur, text, intensity, role } = fc;
  const { alpha, scale, ty, blur, opacity } = computeTextMotion(segTime, segDur, intensity, role);

  if (opacity <= 0) return { alpha: 0 };

  const fontSize = Math.round(height / 18);
  ctx.save();
  ctx.font = `bold ${fontSize}px "PingFang SC", "Noto Sans SC", "Microsoft YaHei", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // Canvas 2D 的 filter 性能较差但可用
  if (blur > 0.1) {
    ctx.filter = `blur(${blur.toFixed(1)}px)`;
  }

  const maxWidth = width * 0.78;
  const lines = wrapText(ctx, text, maxWidth);
  const lineHeight = fontSize * 1.5;
  const totalH = lines.length * lineHeight;
  const cx = width / 2;
  const cy = height / 2 + ty;

  // 文字描边（让字在任何背景下都清晰）
  ctx.globalAlpha = alpha;
  ctx.shadowColor = 'rgba(0, 0, 0, 0.85)';
  ctx.shadowBlur = 24;
  ctx.shadowOffsetY = 4;
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.4)';
  ctx.lineWidth = Math.max(1, fontSize / 60);

  const scaledFont = `bold ${Math.round(fontSize * scale)}px "PingFang SC", "Noto Sans SC", "Microsoft YaHei", sans-serif`;
  ctx.font = scaledFont;

  lines.forEach((line, i) => {
    const y = cy - totalH / 2 + i * lineHeight + lineHeight / 2;
    if (ctx.lineWidth > 0) ctx.strokeText(line, cx, y);
    ctx.fillText(line, cx, y);
  });

  ctx.restore();
  return { alpha: opacity };
}

/** 计算文字动效参数（供其他元素使用以保持同步） */
export function computeTextMotion(
  segTime: number,
  segDur: number,
  intensity: number,
  _role?: SegmentRole,
) {
  let progress: number;
  let scale: number;
  let ty: number;
  let blur: number;

  if (segTime < T_ENTRANCE) {
    // 入场
    const t = segTime / T_ENTRANCE;
    const e = ease.outBack(t);
    progress = e;
    scale = lerp(1.3, 1.0, e);
    ty = lerp(40 * intensity, 0, e);
    blur = lerp(8 * intensity, 0, e);
  } else if (segTime > segDur - T_EXIT) {
    // 出场
    const t = (segTime - (segDur - T_EXIT)) / T_EXIT;
    const e = ease.outCubic(t);
    progress = 1 - e;
    scale = lerp(1.0, 0.94, e);
    ty = lerp(0, -30 * intensity, e);
    blur = 0;
  } else {
    progress = 1;
    scale = 1.0;
    ty = 0;
    blur = 0;
  }

  // 整体透明度（alpha 用于 shadow，opacity 用于 fill）
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

// ==================== 主渲染入口 ====================

/**
 * 单帧主渲染：把上面所有层组合起来
 */
export function renderFrame(fc: FrameContext, totalDuration: number, currentTime: number) {
  const { ctx, width, height } = fc;

  // 1. 背景
  drawKineticBackground(fc);

  // 2. 角色装饰
  drawRoleDecorations(fc);

  // 3. 字幕条（在文字下方）
  // 计算字幕文字显现进度：从入场到出场均匀铺开
  const T_SUBTITLE_DELAY = 0.3;
  const T_SUBTITLE_END = fc.segDur - T_EXIT - 0.1;
  const reveal = clamp(
    (fc.segTime - T_SUBTITLE_DELAY) / Math.max(0.1, T_SUBTITLE_END - T_SUBTITLE_DELAY),
    0, 1,
  );
  drawAnimatedSubtitle(fc, reveal);

  // 4. 主文字
  drawAnimatedMainText(fc);

  // 5. 段标签
  // （index/total 由调用方传入 drawSegmentBadge）
}

// ==================== 辅助：根据段文本生成稳定 seed ====================
export function seedFor(segIndex: number, text: string): number {
  return hashStr(`${segIndex}:${text}`);
}
