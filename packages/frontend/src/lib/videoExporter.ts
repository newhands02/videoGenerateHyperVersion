/**
 * 浏览器内视频导出器
 * 使用 Canvas + MediaRecorder + AudioContext 在浏览器中直接渲染 MP4/WebM 视频
 *
 * 工作原理：
 * 1. 创建 Canvas（按项目分辨率），使用 animationEngine 绘制电影感场景
 * 2. canvas.captureStream(fps) 获取视频流
 * 3. AudioContext 播放分段音频，MediaStreamAudioDestinationNode 捕获音频流
 * 4. 合并视频+音频流，MediaRecorder 录制为视频文件
 *
 * 注意：录制是实时的（60s 视频 = 60s 录制），需保持标签页在前台
 */

import type { ScriptSegment, Project, SegmentRole } from '@webframes/shared-types';
import {
  renderFrame,
  drawSegmentBadge,
  drawProgressBar,
  drawTransitionOverlay,
  getSceneGradient,
  seedFor,
  type FrameContext,
} from './animationEngine';

// ==================== 类型 ====================

export interface VideoExportOptions {
  project: Project;
  segments: ScriptSegment[];
  onProgress?: (current: number, total: number, phase: string) => void;
  /** 动画风格：cinematic=完整电影感（默认），minimal=轻度动效，static=静态 */
  animationStyle?: 'cinematic' | 'minimal' | 'static';
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
const START_OFFSET = 0.5;   // 开头黑屏静默
const GAP = 0.45;            // 段间过渡（比之前更长，给动画时间）
const END_PADDING = 0.6;     // 结尾黑屏余量
const MIN_SEG_DUR = 1.0;     // 每段最小时长（秒）

/** 动画风格 -> intensity 映射
 * static  : 0.0  - 完全无动效，纯静态
 * minimal : 0.4  - 整段淡入淡出（主文字），无装饰
 * cinematic: 1.0 - 逐字飞入 + 呼吸 + 装饰 + 段间过渡
 */
const STYLE_INTENSITY = {
  cinematic: 1.0,
  minimal: 0.4,
  static: 0.0,
} as const;

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

function drawBlack(ctx: CanvasRenderingContext2D, width: number, height: number) {
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, width, height);
}

function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ==================== 主导出函数 ====================

export async function exportVideo(options: VideoExportOptions): Promise<VideoExportResult> {
  const { project, segments, onProgress, animationStyle = 'cinematic' } = options;

  if (segments.length === 0) {
    throw new Error('没有分段可导出');
  }

  if (typeof MediaRecorder === 'undefined') {
    throw new Error('当前浏览器不支持 MediaRecorder，无法导出视频');
  }

  const width = project.resolution.width;
  const height = project.resolution.height;
  const intensity = STYLE_INTENSITY[animationStyle];

  onProgress?.(0, segments.length, '初始化渲染环境...');

  // 1. 创建 Canvas
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

  // 3. 视频流 + 音频流
  const canvasStream = canvas.captureStream(FPS);
  const combinedStream = new MediaStream([
    ...canvasStream.getVideoTracks(),
    ...audioDestination.stream.getAudioTracks(),
  ]);

  // 4. MediaRecorder
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

  recorder.start(1000);
  onProgress?.(0, segments.length, '开始录制...');

  // 5. 累计时间（用于底部进度条）
  let elapsed = 0;
  const totalDuration = estimateVideoDuration(segments);

  // 6. 开头黑屏
  drawBlack(ctx, width, height);
  const startStart = performance.now();
  await new Promise<void>((resolve) => {
    const render = () => {
      const t = (performance.now() - startStart) / 1000;
      drawBlack(ctx, width, height);
      drawProgressBar(
        {
          ctx, width, height, segTime: t, segDur: START_OFFSET,
          segIndex: 0, text: '', seed: 0, intensity,
        },
        totalDuration, elapsed + t,
      );
      if (t < START_OFFSET) {
        requestAnimationFrame(render);
      } else {
        resolve();
      }
    };
    requestAnimationFrame(render);
  });
  elapsed += START_OFFSET;

  // 7. 逐段渲染
  let prevColors: [string, string] | undefined;

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    onProgress?.(i, segments.length, `渲染第 ${i + 1}/${segments.length} 段...`);

    const estDuration = seg.audioDuration ?? Math.ceil(seg.text.length / 3.8);

    // 解码音频
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

    const segDuration = Math.max(audioBuffer?.duration ?? estDuration, MIN_SEG_DUR);
    const segStart = performance.now();
    const seed = seedFor(i, seg.text);

    // 播放音频
    let sourceNode: AudioBufferSourceNode | null = null;
    if (audioBuffer) {
      sourceNode = audioContext.createBufferSource();
      sourceNode.buffer = audioBuffer;
      sourceNode.connect(audioDestination);
      sourceNode.connect(audioContext.destination);
      sourceNode.start();
    }

    // 单段渲染循环
    await new Promise<void>((resolve) => {
      const render = () => {
        const segTime = (performance.now() - segStart) / 1000;
        if (segTime >= segDuration) {
          resolve();
          return;
        }

        const fc: FrameContext = {
          ctx, width, height,
          segTime, segDur: segDuration,
          segIndex: i,
          role: seg.role,
          text: seg.text,
          seed,
          intensity,
          visual: seg.visual,
          prevColors: i === 0 ? undefined : prevColors,
        };

        // 主场景（背景 + 装饰 + 字幕 + 主文字）
        renderFrame(fc, totalDuration, elapsed + segTime);

        // 段标签
        drawSegmentBadge(fc, `段 ${i + 1} / ${segments.length}`);

        // 底部进度条
        drawProgressBar(fc, totalDuration, elapsed + segTime);

        requestAnimationFrame(render);
      };
      requestAnimationFrame(render);
    });

    elapsed += segDuration;

    if (sourceNode) {
      try { sourceNode.stop(); } catch {}
    }

    // 段间过渡（用动画引擎的过渡逻辑取代死黑屏）
    if (i < segments.length - 1) {
      prevColors = getSceneGradient(seg.role, seg.visual);
      const nextColors = getSceneGradient(segments[i + 1].role, segments[i + 1].visual);
      const transStart = performance.now();
      await new Promise<void>((resolve) => {
        const render = () => {
          const tp = (performance.now() - transStart) / 1000 / GAP;
          if (tp >= 1) { resolve(); return; }

          // 渲染下一段的"初始帧"（前 0.4s 渐入）
          const nextFc: FrameContext = {
            ctx, width, height,
            segTime: 0, segDur: GAP,
            segIndex: i + 1,
            role: segments[i + 1].role,
            text: '',
            seed: seedFor(i + 1, segments[i + 1].text),
            intensity,
            visual: segments[i + 1].visual,
            transitionProgress: tp,
            prevColors,
          };

          // 背景层（用过渡插值后的颜色）
          renderFrame(nextFc, totalDuration, elapsed + tp * GAP);

          // 过渡光效
          drawTransitionOverlay(ctx, width, height, tp, intensity);

          // 进度条
          drawProgressBar(nextFc, totalDuration, elapsed + tp * GAP);

          requestAnimationFrame(render);
        };
        requestAnimationFrame(render);
      });
      elapsed += GAP;
      // 静默使用 prevColors（避免下一段重复）
      void nextColors;
    }
  }

  // 8. 结尾黑屏
  onProgress?.(segments.length, segments.length, '正在编码视频...');
  const endStart = performance.now();
  await new Promise<void>((resolve) => {
    const render = () => {
      const t = (performance.now() - endStart) / 1000;
      drawBlack(ctx, width, height);
      drawProgressBar(
        {
          ctx, width, height, segTime: t, segDur: END_PADDING,
          segIndex: segments.length, text: '', seed: 0, intensity,
        },
        totalDuration, elapsed + t,
      );
      if (t < END_PADDING) {
        requestAnimationFrame(render);
      } else {
        resolve();
      }
    };
    requestAnimationFrame(render);
  });
  elapsed += END_PADDING;

  // 9. 停止录制
  recorder.stop();
  await recordingDone;

  // 10. 清理
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
