/**
 * 浏览器内视频导出器
 * 使用 Canvas + MediaRecorder + AudioContext 在浏览器中直接渲染 MP4/WebM 视频
 *
 * 工作原理：
 * 1. 创建 Canvas，按项目分辨率绘制场景（渐变背景 + 字幕文字动画）
 * 2. canvas.captureStream(fps) 获取视频流
 * 3. AudioContext 播放分段音频，MediaStreamAudioDestinationNode 捕获音频流
 * 4. 合并视频+音频流，MediaRecorder 录制为视频文件
 *
 * 注意：录制是实时的（60s 视频 = 60s 录制），需保持标签页在前台
 */

import type { ScriptSegment, Project, SegmentRole } from '@webframes/shared-types';

// ==================== 类型 ====================

export interface VideoExportOptions {
  project: Project;
  segments: ScriptSegment[];
  onProgress?: (current: number, total: number, phase: string) => void;
}

export interface VideoExportResult {
  blob: Blob;
  filename: string;
  mimeType: string;
  duration: number;
  ext: string;
}

// ==================== 常量 ====================

const FPS = 30;
const START_OFFSET = 0.5; // 开头黑屏静默
const GAP = 0.35; // 段间黑屏静默
const END_PADDING = 0.5; // 结尾黑屏余量
const FADE_IN = 0.3; // 文字淡入时长
const FADE_OUT = 0.3; // 文字淡出时长
const MIN_SEG_DUR = 1.0; // 每段最小时长（秒）

/** 场景渐变色（与 exporter.ts / Step4Timeline.vue 一致） */
const SCENE_GRADIENTS: Record<string, [string, string]> = {
  hook: ['#0f0c29', '#302b63'],
  pain: ['#232526', '#414345'],
  turn: ['#1a2a6c', '#b21f1f'],
  climax: ['#f12711', '#f5af19'],
  cta: ['#134e5e', '#71b280'],
  transition: ['#2c3e50', '#3498db'],
};
const DEFAULT_GRADIENT: [string, string] = ['#1a1a2e', '#16213e'];

// ==================== 工具函数 ====================

/** 估算视频总时长（秒） */
export function estimateVideoDuration(segments: ScriptSegment[]): number {
  const segDur = segments.reduce(
    (sum, s) => sum + (s.audioDuration ?? Math.ceil(s.text.length / 3.8)),
    0,
  );
  const gaps = segments.length > 1 ? GAP * (segments.length - 1) : 0;
  return START_OFFSET + segDur + gaps + END_PADDING;
}

/** 统计有音频的段数 */
export function countAudioSegments(segments: ScriptSegment[]): number {
  return segments.filter(s => s.audioUrl).length;
}

/** 检测浏览器支持的最佳 MIME 类型 */
function getSupportedMimeType(): string {
  const types = [
    'video/mp4;codecs=h264,aac',
    'video/mp4;codecs=h264',
    'video/mp4',
    'video/webm;codecs=h264,opus',
    'video/webm;codecs=h264',
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
  ];
  for (const type of types) {
    if (MediaRecorder.isTypeSupported(type)) return type;
  }
  return 'video/webm';
}

function getSceneGradient(role?: SegmentRole): [string, string] {
  return (role && SCENE_GRADIENTS[role]) || DEFAULT_GRADIENT;
}

/** 绘制渐变背景 */
function drawGradientBg(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  colors: [string, string],
) {
  const grad = ctx.createLinearGradient(0, 0, width, height);
  grad.addColorStop(0, colors[0]);
  grad.addColorStop(1, colors[1]);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, height);
}

/** 绘制纯黑背景 */
function drawBlack(ctx: CanvasRenderingContext2D, width: number, height: number) {
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, width, height);
}

/** Canvas 文字换行（按字符，适配中英文混合） */
function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string[] {
  const lines: string[] = [];
  let current = '';

  for (const char of text) {
    if (char === '\n') {
      lines.push(current);
      current = '';
      continue;
    }
    const test = current + char;
    if (ctx.measureText(test).width > maxWidth && current) {
      lines.push(current);
      current = char;
    } else {
      current = test;
    }
  }
  if (current) lines.push(current);
  return lines;
}

/** 手动绘制圆角矩形路径（兼容所有浏览器） */
function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number, y: number,
  w: number, h: number,
  r: number,
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

/** 绘制场景大字（居中 + 阴影） */
function drawSceneText(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  text: string,
  opacity: number,
) {
  if (!text || opacity <= 0) return;

  const fontSize = Math.round(height / 22);
  ctx.font = `bold ${fontSize}px "PingFang SC", "Noto Sans SC", "Microsoft YaHei", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const maxWidth = width * 0.8;
  const lines = wrapText(ctx, text, maxWidth);
  const lineHeight = fontSize * 1.6;
  const totalHeight = lines.length * lineHeight;
  const startY = height / 2 - totalHeight / 2 + lineHeight / 2;

  ctx.globalAlpha = opacity;
  ctx.shadowColor = 'rgba(0, 0, 0, 0.7)';
  ctx.shadowBlur = 16;
  ctx.shadowOffsetY = 3;
  ctx.fillStyle = '#ffffff';

  lines.forEach((line, i) => {
    ctx.fillText(line, width / 2, startY + i * lineHeight);
  });

  // 重置
  ctx.globalAlpha = 1;
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
}

/** 绘制底部字幕条 */
function drawSubtitleBar(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  text: string,
  opacity: number,
) {
  if (!text || opacity <= 0) return;

  const fontSize = Math.round(height / 32);
  ctx.font = `${fontSize}px "PingFang SC", "Noto Sans SC", "Microsoft YaHei", sans-serif`;

  const maxTextWidth = width * 0.7;
  const lines = wrapText(ctx, text, maxTextWidth);
  const lineHeight = fontSize * 1.4;
  const paddingH = fontSize * 1.2;
  const paddingV = fontSize * 0.8;
  const barWidth = Math.min(width * 0.85, maxTextWidth + paddingH * 2);
  const barHeight = lines.length * lineHeight + paddingV * 2;
  const barX = (width - barWidth) / 2;
  const barY = height - barHeight - Math.round(height * 0.06);
  const radius = Math.round(height / 80);

  // 半透明背景
  ctx.globalAlpha = opacity * 0.8;
  ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
  roundRectPath(ctx, barX, barY, barWidth, barHeight, radius);
  ctx.fill();

  // 文字
  ctx.globalAlpha = opacity;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffffff';
  const textStartY = barY + paddingV + lineHeight / 2;
  lines.forEach((line, i) => {
    ctx.fillText(line, width / 2, textStartY + i * lineHeight);
  });

  ctx.globalAlpha = 1;
}

/** 绘制段索引标记（左上角小标签） */
function drawSegmentBadge(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  index: number,
  total: number,
  opacity: number,
) {
  if (opacity <= 0) return;

  const fontSize = Math.round(height / 45);
  const padding = fontSize * 0.6;
  const text = `段 ${index + 1} / ${total}`;
  ctx.font = `${fontSize}px "PingFang SC", "Microsoft YaHei", sans-serif`;
  const textWidth = ctx.measureText(text).width;
  const badgeW = textWidth + padding * 2;
  const badgeH = fontSize + padding * 2;
  const badgeX = Math.round(width * 0.03);
  const badgeY = Math.round(height * 0.03);
  const radius = badgeH / 2;

  ctx.globalAlpha = opacity * 0.7;
  ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
  roundRectPath(ctx, badgeX, badgeY, badgeW, badgeH, radius);
  ctx.fill();

  ctx.globalAlpha = opacity;
  ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, badgeX + padding, badgeY + badgeH / 2);

  ctx.globalAlpha = 1;
}

function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ==================== 主导出函数 ====================

export async function exportVideo(options: VideoExportOptions): Promise<VideoExportResult> {
  const { project, segments, onProgress } = options;

  if (segments.length === 0) {
    throw new Error('没有分段可导出');
  }

  if (typeof MediaRecorder === 'undefined') {
    throw new Error('当前浏览器不支持 MediaRecorder，无法导出视频');
  }

  const width = project.resolution.width;
  const height = project.resolution.height;

  onProgress?.(0, segments.length, '初始化渲染环境...');

  // 1. 创建 Canvas（加入 DOM 但隐藏，确保 captureStream 稳定）
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.style.position = 'fixed';
  canvas.style.left = '-99999px';
  canvas.style.top = '0';
  document.body.appendChild(canvas);

  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) {
    document.body.removeChild(canvas);
    throw new Error('无法创建 Canvas 2D 上下文');
  }

  // 初始黑屏
  drawBlack(ctx, width, height);

  // 2. 创建 AudioContext
  const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
  const audioContext: AudioContext = new AudioCtx();
  await audioContext.resume();
  const audioDestination = audioContext.createMediaStreamDestination();

  // 3. 获取视频流 + 合并音频流
  const canvasStream = canvas.captureStream(FPS);
  const combinedStream = new MediaStream([
    ...canvasStream.getVideoTracks(),
    ...audioDestination.stream.getAudioTracks(),
  ]);

  // 4. 创建 MediaRecorder
  const mimeType = getSupportedMimeType();
  const recorder = new MediaRecorder(combinedStream, {
    mimeType,
    videoBitsPerSecond: 8_000_000,
    audioBitsPerSecond: 128_000,
  });

  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };

  const recordingDone = new Promise<void>((resolve) => {
    recorder.onstop = () => resolve();
  });

  // 5. 开始录制
  recorder.start(1000);
  onProgress?.(0, segments.length, '开始录制...');

  // 6. 开头静默黑屏
  drawBlack(ctx, width, height);
  await wait(START_OFFSET * 1000);

  // 7. 逐段渲染
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    onProgress?.(i, segments.length, `渲染第 ${i + 1}/${segments.length} 段...`);

    const estDuration = seg.audioDuration ?? Math.ceil(seg.text.length / 3.8);

    // 解码音频（如果有）
    let audioBuffer: AudioBuffer | null = null;
    if (seg.audioUrl) {
      try {
        const resp = await fetch(seg.audioUrl);
        const arrBuf = await resp.arrayBuffer();
        audioBuffer = await audioContext.decodeAudioData(arrBuf);
      } catch {
        // 解码失败，静默处理
      }
    }

    const segDuration = Math.max(
      audioBuffer?.duration ?? estDuration,
      MIN_SEG_DUR,
    );
    const totalMs = segDuration * 1000;
    const colors = getSceneGradient(seg.role);

    // 播放音频
    let sourceNode: AudioBufferSourceNode | null = null;
    if (audioBuffer) {
      sourceNode = audioContext.createBufferSource();
      sourceNode.buffer = audioBuffer;
      sourceNode.connect(audioDestination);
      // 也连接到扬声器，让用户听到声音
      sourceNode.connect(audioContext.destination);
      sourceNode.start();
    }

    // 动画渲染循环
    const animStart = performance.now();

    await new Promise<void>((resolve) => {
      const render = () => {
        const elapsed = (performance.now() - animStart) / 1000;

        // 文字透明度（淡入 → 持续 → 淡出）
        let opacity = 1;
        if (elapsed < FADE_IN) {
          opacity = elapsed / FADE_IN;
        } else if (elapsed > segDuration - FADE_OUT) {
          opacity = Math.max(0, (segDuration - elapsed) / FADE_OUT);
        }
        opacity = Math.max(0, Math.min(1, opacity));

        // 绘制帧
        drawGradientBg(ctx, width, height, colors);
        drawSceneText(ctx, width, height, seg.text, opacity);
        drawSubtitleBar(ctx, width, height, seg.text, opacity);
        drawSegmentBadge(ctx, width, height, i, segments.length, opacity);

        if (elapsed < segDuration) {
          requestAnimationFrame(render);
        } else {
          resolve();
        }
      };
      requestAnimationFrame(render);
    });

    // 确保音频源已停止
    if (sourceNode) {
      try { sourceNode.stop(); } catch {}
    }

    // 段间黑屏静默
    if (i < segments.length - 1) {
      drawBlack(ctx, width, height);
      await wait(GAP * 1000);
    }
  }

  // 8. 结尾黑屏
  onProgress?.(segments.length, segments.length, '正在编码视频...');
  drawBlack(ctx, width, height);
  await wait(END_PADDING * 1000);

  // 9. 停止录制
  recorder.stop();
  await recordingDone;

  // 10. 清理资源
  audioContext.close();
  document.body.removeChild(canvas);

  // 11. 生成文件
  const ext = mimeType.includes('mp4') ? 'mp4' : 'webm';
  const timestamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '');
  const filename = `${project.name}-${timestamp}.${ext}`;
  const blob = new Blob(chunks, { type: mimeType });
  const duration = estimateVideoDuration(segments);

  onProgress?.(segments.length, segments.length, '导出完成！');

  return { blob, filename, mimeType, duration, ext };
}

/** 触发浏览器下载视频文件 */
export function downloadVideoBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}
