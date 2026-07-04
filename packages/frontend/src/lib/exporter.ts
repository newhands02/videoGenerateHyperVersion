/**
 * HyperFrames 项目导出器
 * 将前端 project 状态编译为可下载的 .zip 包
 * 
 * 生成文件：
 * - index.html          主视频编排页面（GSAP 动画）
 * - hyperframes.json    视频规格
 * - webframes.config.json 引擎/音色配置
 * - script.txt          纯文本脚本
 * - timeline.json       精确时间戳
 * - tts.py              双引擎 TTS 脚本
 * - render.sh           一键渲染
 * - package.json        npm 脚本
 * - .env.example        凭据模板
 * - README.md           使用说明
 */

import type { ScriptSegment, Project, VoiceEntry } from '@webframes/shared-types';

// ==================== JSZip 动态加载 ====================

/** 动态从 CDN 加载 JSZip（避免 pnpm install 限制） */
async function loadJSZip(): Promise<any> {
  // 使用 Function 构造器避免 TypeScript 对动态 import URL 的检查
  const dynamicImport = new Function('url', 'return import(url)');
  const mod = await dynamicImport('https://esm.sh/jszip@3.10.1');
  return mod.default || mod;
}

// ==================== 文件生成器 ====================

/** 生成 index.html */
function generateIndexHtml(project: Project, segments: ScriptSegment[]): string {
  const subtitles = generateSubtitles(segments);
  const scenes = segments.map((seg, i) => {
    const id = `s${i + 1}`;
    return `
    <!-- 场景 ${i + 1}：${seg.text.slice(0, 30)}... -->
    <section id="${id}" class="scene" style="background: ${getSceneBg(seg)}">
      <div class="${id}-text" style="font-size: 48px; color: #fff; text-align: center; max-width: 1400px; padding: 0 60px; line-height: 1.5; opacity: 0;">
        ${escapeHtml(seg.text)}
      </div>
    </section>`;
  }).join('\n');

  const animations = segments.map((seg, i) => {
    const id = `s${i + 1}`;
    const start = getSegmentStart(segments, i);
    const dur = seg.audioDuration ?? Math.ceil(seg.text.length / 3.8);
    return `
    // 场景 ${i + 1}
    master.set("#${id}", { display: "flex" }, ${start});
    master.fromTo("#${id} .${id}-text",
      { opacity: 0, y: 30 },
      { opacity: 1, y: 0, duration: 0.8, ease: "power2.out" },
      ${start + 0.3}
    );
    master.set("#${id}", { display: "none" }, ${start + dur});`;
  }).join('\n');

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(project.name)}</title>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/gsap.min.js"><\/script>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body {
      width: ${project.resolution.width}px; height: ${project.resolution.height}px;
      overflow: hidden;
      font-family: "PingFang SC", "Noto Sans SC", "Microsoft YaHei", sans-serif;
    }
    #subtitle-bar {
      position: absolute;
      bottom: 56px; left: 50%; transform: translateX(-50%);
      background: rgba(0, 0, 0, 0.75);
      backdrop-filter: blur(8px);
      padding: 16px 44px;
      border-radius: 14px;
      max-width: 1400px;
      text-align: center;
      font-size: 38px;
      color: #FFFFFF;
      letter-spacing: 0.06em;
      line-height: 1.6;
      opacity: 0;
      z-index: 100;
    }
    .scene {
      position: absolute; inset: 0;
      display: none;
      align-items: center; justify-content: center;
      flex-direction: column;
    }
  </style>
</head>
<body>
  <div data-composition-id="main" data-width="${project.resolution.width}" data-height="${project.resolution.height}" data-start="0">
    <audio id="narration" src="narration.wav" data-start="0"></audio>
    <div id="subtitle-bar"></div>
${scenes}
  </div>

  <script>
    var SUBTITLES = ${JSON.stringify(subtitles, null, 2)};

    window.__timelines = {};
    var master = gsap.timeline({ paused: true });
    var subBar = document.getElementById("subtitle-bar");
${animations}

    SUBTITLES.forEach(function(sub) {
      master.call(function() {
        subBar.textContent = sub.text;
        subBar.style.opacity = "1";
      }, [], sub.start);
      master.call(function() {
        subBar.style.opacity = "0";
      }, [], sub.end);
    });

    window.__timelines["main"] = master;

    if (typeof window.__hf_rendering === "undefined") {
      (function() {
        var scaleX = window.innerWidth / ${project.resolution.width};
        var scaleY = window.innerHeight / ${project.resolution.height};
        var scale = Math.min(scaleX, scaleY);
        var comp = document.querySelector("[data-composition-id]");
        comp.style.transform = "scale(" + scale + ")";
        comp.style.transformOrigin = "top left";
        comp.style.position = "absolute";
        comp.style.left = (window.innerWidth - ${project.resolution.width} * scale) / 2 + "px";
        comp.style.top = (window.innerHeight - ${project.resolution.height} * scale) / 2 + "px";

        var ctrl = document.createElement("div");
        ctrl.id = "preview-ctrl";
        ctrl.innerHTML = [
          '<button id="btn-play" style="padding:8px 18px;border:none;border-radius:8px;',
          'font-size:14px;cursor:pointer;background:rgba(0,0,0,0.75);color:#fff;">',
          '⏸ 暂停</button>',
          '<button id="btn-restart" style="padding:8px 18px;border:none;border-radius:8px;',
          'font-size:14px;cursor:pointer;background:rgba(0,0,0,0.75);color:#fff;">',
          '↺ 重播</button>',
          '<span id="time-display" style="color:#fff;font-size:13px;font-family:monospace;">0:00</span>'
        ].join("");
        ctrl.style.cssText = "position:fixed;bottom:16px;right:16px;z-index:9999;display:flex;gap:10px;align-items:center;";
        document.body.appendChild(ctrl);

        var narrationAudio = new Audio("narration.wav");
        var playing = true;
        master.play();
        narrationAudio.play().catch(function(){});

        document.getElementById("btn-play").addEventListener("click", function() {
          if (playing) {
            master.pause(); narrationAudio.pause();
            this.textContent = "▶ 播放";
          } else {
            master.play(); narrationAudio.play().catch(function(){});
            this.textContent = "⏸ 暂停";
          }
          playing = !playing;
        });

        document.getElementById("btn-restart").addEventListener("click", function() {
          master.restart();
          narrationAudio.currentTime = 0;
          narrationAudio.play().catch(function(){});
          playing = true;
          document.getElementById("btn-play").textContent = "⏸ 暂停";
        });

        gsap.ticker.add(function() {
          var t = master.time();
          var m = Math.floor(t / 60);
          var s = Math.floor(t % 60);
          document.getElementById("time-display").textContent =
            m + ":" + (s < 10 ? "0" : "") + s;
        });
      })();
    }
  <\/script>
</body>
</html>`;
}

/** 生成 hyperframes.json */
function generateHyperframesJson(project: Project, segments: ScriptSegment[]): string {
  const duration = segments.reduce(
    (sum, s) => sum + (s.audioDuration ?? Math.ceil(s.text.length / 3.8)),
    0,
  );
  return JSON.stringify({
    entryFile: 'index.html',
    width: project.resolution.width,
    height: project.resolution.height,
    fps: 30,
    duration: Math.ceil(duration),
    outputFormat: 'mp4',
    audioSources: [{ src: 'narration.wav', mix: true }],
  }, null, 2);
}

/** 生成 webframes.config.json */
function generateWebframesConfig(project: Project, segments: ScriptSegment[], voicesData?: VoiceEntry[]): string {
  const voiceMap = new Map<string, VoiceEntry>();
  if (voicesData) {
    for (const v of voicesData) voiceMap.set(v.id, v);
  }

  const voices = segments.reduce((map, seg) => {
    if (seg.tts.voiceId && !map[seg.tts.voiceId]) {
      const v = voiceMap.get(seg.tts.voiceId);
      const entry: Record<string, any> = {
        id: seg.tts.voiceId,
        engine: seg.tts.engine ?? project.ttsEngine,
        type: v?.kind ?? 'preset',
      };
      if (v?.kind === 'preset') {
        entry.nativeVoiceId = v.nativeId;
      } else if (v?.kind === 'design') {
        entry.description = v.promptText;
      } else if (v?.kind === 'clone') {
        entry.sampleAudioId = v.sampleAudioId;
      }
      map[seg.tts.voiceId] = entry;
    }
    return map;
  }, {} as Record<string, any>);

  return JSON.stringify({
    ttsEngine: project.ttsEngine,
    defaultSpeed: 'normal',
    defaultStyle: 'neutral',
    voices: Object.values(voices),
    segments: segments.map(s => ({
      id: s.id,
      text: s.text.slice(0, 50),
      voiceId: s.tts.voiceId,
      engine: s.tts.engine ?? project.ttsEngine,
      speed: s.tts.speed,
    })),
  }, null, 2);
}

/** 生成 script.txt */
function generateScriptTxt(segments: ScriptSegment[]): string {
  return segments.map(s => s.text).join('\n\n') + '\n';
}

/** 生成 timeline.json */
function generateTimelineJson(segments: ScriptSegment[]): string {
  let startTime = 0.5;
  const gap = 0.35;
  const entries = segments.map((seg, i) => {
    const dur = seg.audioDuration ?? Math.ceil(seg.text.length / 3.8);
    const entry = {
      index: i + 1,
      start: Math.round(startTime * 10) / 10,
      end: Math.round((startTime + dur) * 10) / 10,
      text: seg.text,
    };
    startTime += dur + gap;
    return entry;
  });
  return JSON.stringify(entries, null, 2);
}

/** 生成 tts.py（双引擎路由） */
function generateTtsPy(): string {
  return `#!/usr/bin/env python3
"""
WebFrames TTS 配音生成器（双引擎路由）
=====================================
自动读取 webframes.config.json 的 ttsEngine 字段路由到对应 SDK。

用法:
  python3 tts.py                          # 生成 narration.wav
  python3 tts.py --timed                  # 精确计时模式（推荐）
  python3 tts.py --timed --output-timestamps timeline.json

引擎:
  mimo  → 小米 MiMo TTS v2.5（需 MIMO_API_KEY）
  edge  → edge-tts（免费，无需 Key）

依赖:
  pip install edge-tts openai
  (MiMo 引擎需要 openai 包，base_url 指向小米 API)
"""

import json, os, sys, argparse, tempfile, wave, subprocess
from pathlib import Path

# ---- 加载配置 ----
CONFIG_PATH = Path(__file__).parent / "webframes.config.json"
if not CONFIG_PATH.exists():
    print("❌ webframes.config.json 不存在"); sys.exit(1)

CONFIG = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
ENGINE = CONFIG.get("ttsEngine", "mimo")
GAP = 0.35
START_OFFSET = 0.5

# ---- 加载 .env ----
ENV_PATH = Path(__file__).parent / ".env"
if ENV_PATH.exists():
    for line in ENV_PATH.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip())

MIMO_API_KEY = os.environ.get("MIMO_API_KEY", "")

# ---- 解析脚本 ----
def parse_script(filepath):
    segs = []
    for line in open(filepath, encoding="utf-8"):
        line = line.strip()
        if line and not line.startswith("#"):
            dur = max(2.5, len(line) / 3.8)
            segs.append({"text": line, "dur_est": dur})
    return segs

# ---- MiMo TTS ----
def tts_mimo(segs, output_file, timed=False):
    if not MIMO_API_KEY:
        print("❌ MIMO_API_KEY 未设置，请在 .env 中配置"); sys.exit(1)
    
    try:
        from openai import OpenAI
    except ImportError:
        print("请安装: pip install openai"); sys.exit(1)
    
    client = OpenAI(api_key=MIMO_API_KEY, base_url="https://api.xiaomimimo.com/v1")
    voices_map = {v["id"]: v for v in CONFIG.get("voices", [])}
    default_voice_id = CONFIG.get("defaultVoice", {}).get("id", "冰糖")
    
    seg_wavs = []
    seg_durations = []
    
    for i, s in enumerate(segs):
        seg_config = CONFIG.get("segments", [])
        voice_id = seg_config[i]["voiceId"] if i < len(seg_config) else default_voice_id
        voice = voices_map.get(voice_id, {})
        speed = seg_config[i].get("speed", "normal") if i < len(seg_config) else "normal"
        
        speed_hint = {"slow": "语速缓慢", "fast": "语速稍快", "normal": ""}.get(speed, "")
        
        print(f"  [{i+1}/{len(segs)}] {s['text'][:50]}")
        
        # 根据音色类型选择模型
        voice_type = voice.get("type", "preset")
        if voice_type == "design":
            model = "mimo-v2.5-tts-voicedesign"
            user_msg = voice.get("description", "自然清亮的女声")
            voice_param = None
            optimize_preview = True
        elif voice_type == "clone":
            model = "mimo-v2.5-tts-voiceclone"
            user_msg = speed_hint
            voice_param = voice.get("sampleBase64", "")
            optimize_preview = False
        else:
            model = "mimo-v2.5-tts"
            # 使用 nativeVoiceId（如 "冰糖"），而非内部 ID（如 "mimo-冰糖"）
            voice_param = voice.get("nativeVoiceId", voice.get("voiceId", "mimo_default"))
            optimize_preview = False
            # 仅在 speedHint 非空时才加 user 消息
            if speed_hint:
                user_msg = speed_hint
            else:
                user_msg = None
        
        # 构建 messages
        msgs = []
        if user_msg is not None:
            msgs.append({"role": "user", "content": user_msg})
        msgs.append({"role": "assistant", "content": s["text"]})
        
        kwargs = {
            "model": model,
            "messages": msgs,
            "audio": {"format": "wav"},
        }
        if voice_param:
            kwargs["audio"]["voice"] = voice_param
        if optimize_preview:
            kwargs["audio"]["optimize_text_preview"] = True
        
        resp = client.chat.completions.create(**kwargs)
        wav_b64 = resp.choices[0].message.audio.data
        wav_bytes = __import__("base64").b64decode(wav_b64)
        
        tmp = tempfile.mktemp(suffix=".wav")
        with open(tmp, "wb") as f:
            f.write(wav_bytes)
        
        with wave.open(tmp, "rb") as wf:
            actual_dur = wf.getnframes() / wf.getframerate()
        
        seg_durations.append(actual_dur)
        seg_wavs.append(tmp)
        print(f"       ⏱ {actual_dur:.1f}s")
    
    # 拼接
    concat_wavs(seg_wavs, output_file)
    for wf in seg_wavs:
        os.unlink(wf)
    
    for i, d in enumerate(seg_durations):
        segs[i]["dur_actual"] = d
    
    return segs

# ---- edge-tts ----
def tts_edge(segs, output_file, timed=False):
    try:
        import edge_tts
    except ImportError:
        print("请安装: pip install edge-tts"); sys.exit(1)
    
    import asyncio
    voice = os.environ.get("TTS_VOICE", "zh-CN-XiaoxiaoNeural")
    rate = os.environ.get("TTS_RATE", "+5%")
    
    print(f"🎙️  edge-tts | {voice} | {len(segs)}段")
    
    async def _gen():
        seg_wavs = []
        seg_durations = []
        
        for i, s in enumerate(segs):
            print(f"  [{i+1}/{len(segs)}] {s['text'][:50]}")
            comm = edge_tts.Communicate(s["text"], voice, rate=rate)
            mp3_data = b""
            async for chunk in comm.stream():
                if chunk["type"] == "audio":
                    mp3_data += chunk["data"]
            
            tmp_mp3 = tempfile.mktemp(suffix=".mp3")
            with open(tmp_mp3, "wb") as f:
                f.write(mp3_data)
            
            tmp_wav = tempfile.mktemp(suffix=".wav")
            subprocess.run(["ffmpeg", "-y", "-i", tmp_mp3, "-acodec", "pcm_s16le",
                          "-ar", "16000", "-ac", "1", tmp_wav],
                         check=True, capture_output=True)
            os.unlink(tmp_mp3)
            
            with wave.open(tmp_wav, "rb") as wf:
                actual_dur = wf.getnframes() / wf.getframerate()
            
            seg_durations.append(actual_dur)
            seg_wavs.append(tmp_wav)
        
        concat_wavs(seg_wavs, output_file)
        for wf in seg_wavs:
            os.unlink(wf)
        
        for i, d in enumerate(seg_durations):
            segs[i]["dur_actual"] = d
        
        return segs
    
    return asyncio.run(_gen())

# ---- 工具函数 ----
def concat_wavs(wav_files, output_file):
    if len(wav_files) == 1:
        import shutil; shutil.copy2(wav_files[0], output_file); return
    with wave.open(wav_files[0], "rb") as w0:
        params = w0.getparams()
        combined = w0.readframes(w0.getnframes())
    for wf in wav_files[1:]:
        with wave.open(wf, "rb") as w:
            combined += w.readframes(w.getnframes())
    with wave.open(output_file, "wb") as out:
        out.setparams(params)
        out.writeframes(combined)

# ---- 主入口 ----
def main():
    parser = argparse.ArgumentParser(description="WebFrames TTS 配音生成器")
    parser.add_argument("script", nargs="?", default="script.txt", help="脚本文件")
    parser.add_argument("output", nargs="?", default="narration.wav", help="输出音频")
    parser.add_argument("--timed", action="store_true", help="精确计时模式")
    parser.add_argument("--output-timestamps", default="timeline.json", help="输出时间戳 JSON")
    args = parser.parse_args()
    
    segs = parse_script(args.script)
    if not segs:
        print("脚本为空"); sys.exit(1)
    
    print(f"📄 脚本: {args.script} → 🎵 {args.output}")
    print(f"🔧 引擎: {ENGINE}")
    
    if ENGINE == "mimo":
        segs = tts_mimo(segs, args.output, timed=args.timed)
    else:
        segs = tts_edge(segs, args.output, timed=args.timed)
    
    # 输出时间戳
    t = START_OFFSET
    entries = []
    for s in segs:
        dur = s.get("dur_actual", s["dur_est"])
        entries.append({"start": round(t, 1), "end": round(t + dur, 1), "text": s["text"]})
        t += dur + GAP
    
    with open(args.output_timestamps, "w", encoding="utf-8") as f:
        json.dump(entries, f, ensure_ascii=False, indent=2)
    
    print(f"\\n✅ {args.output} ({os.path.getsize(args.output) / 1024 / 1024:.1f} MB)")
    print(f"📋 时间戳: {args.output_timestamps}")

if __name__ == "__main__":
    main()
`;
}

/** 生成 render.sh */
function generateRenderSh(): string {
  return [
    '#!/usr/bin/env bash',
    '# WebFrames 一键渲染脚本',
    'set -euo pipefail',
    'cd "$(dirname "$0")"',
    '',
    'HF_VERSION="${HF_VERSION:-0.6.56}"',
    '',
    '# 检测 Python 命令',
    'if command -v python3 &>/dev/null; then',
    '  PYTHON=python3',
    'elif command -v python &>/dev/null; then',
    '  PYTHON=python',
    'else',
    '  echo "❌ 未找到 Python，请安装 Python 3"',
    '  exit 1',
    'fi',
    '',
    'echo "════════════════════════════════════════"',
    'echo "  Step 1: 准备配音音频"',
    'echo "════════════════════════════════════════"',
    'if [ -f narration.wav ]; then',
    '  echo "⚠️  narration.wav 已存在，跳过。如需重新生成: rm narration.wav"',
    'elif [ -d segments ] && ls segments/*.wav 1>/dev/null 2>&1; then',
    '  echo "📦 发现预合成音频，拼接为 narration.wav..."',
    '  "$PYTHON" concat_audio.py',
    'else',
    '  echo "🎙️  调用 TTS 生成配音..."',
    '  "$PYTHON" tts.py --timed --output-timestamps timeline.json script.txt narration.wav',
    'fi',
    '',
    'echo ""',
    'echo "════════════════════════════════════════"',
    'echo "  Step 2: Lint 检查"',
    'echo "════════════════════════════════════════"',
    'npx --yes "hyperframes@${HF_VERSION}" lint',
    '',
    'echo ""',
    'echo "════════════════════════════════════════"',
    'echo "  Step 3: 渲染出片"',
    'echo "════════════════════════════════════════"',
    'mkdir -p renders',
    'npx --yes "hyperframes@${HF_VERSION}" render',
    'echo ""',
    'echo "✅ 渲染完成！输出: renders/"',
    'ls -lh renders/*.mp4 2>/dev/null || echo "  (检查日志)"',
    '',
  ].join('\n');
}

/** 生成 concat_audio.py — 拼接预合成的 segments/*.wav 为 narration.wav */
function generateConcatAudioPy(): string {
  return `#!/usr/bin/env python3
"""
WebFrames 音频拼接器
====================
将 segments/ 目录下的预合成音频拼接为 narration.wav
同时生成带静默间隔的 timeline.json

用法:
  python3 concat_audio.py

如果 segments/ 目录不存在或为空，会提示使用 tts.py 代替。
"""

import wave, glob, os, json, struct
from pathlib import Path

SCRIPT_DIR = Path(__file__).parent
SEGMENTS_DIR = SCRIPT_DIR / "segments"
OUTPUT_FILE = SCRIPT_DIR / "narration.wav"
TIMELINE_FILE = SCRIPT_DIR / "timeline.json"
CONFIG_FILE = SCRIPT_DIR / "webframes.config.json"

# 时间参数
START_OFFSET = 0.5   # 开头静默 0.5s
GAP = 0.35           # 段间静默 0.35s

def main():
    if not SEGMENTS_DIR.exists():
        print("❌ segments/ 目录不存在，请使用 tts.py 生成配音")
        return False

    wav_files = sorted(glob.glob(str(SEGMENTS_DIR / "*.wav")))
    if not wav_files:
        print("❌ segments/ 目录中没有 WAV 文件，请使用 tts.py 生成配音")
        return False

    print(f"📂 找到 {len(wav_files)} 个音频文件")

    # 读取配置获取段文本
    seg_texts = []
    if CONFIG_FILE.exists():
        config = json.loads(CONFIG_FILE.read_text(encoding="utf-8"))
        seg_texts = [s.get("text", "") for s in config.get("segments", [])]

    # 读取第一个文件获取参数
    with wave.open(wav_files[0], "rb") as w0:
        params = w0.getparams()
        framerate = w0.getframerate()
        nchannels = w0.getnchannels()
        sampwidth = w0.getsampwidth()

    # 生成静默帧
    def silence(duration_sec):
        nframes = int(framerate * duration_sec)
        return b'\\x00' * (nframes * sampwidth * nchannels)

    # 拼接：开头静默 + 段1 + 静默 + 段2 + ...
    durations = []
    combined = silence(START_OFFSET)

    for i, wf_path in enumerate(wav_files):
        with wave.open(wf_path, "rb") as w:
            durations.append(w.getnframes() / w.getframerate())
            combined += w.readframes(w.getnframes())
        if i < len(wav_files) - 1:
            combined += silence(GAP)

    # 写入 narration.wav
    with wave.open(str(OUTPUT_FILE), "wb") as out:
        out.setparams(params)
        out.writeframes(combined)

    size_mb = os.path.getsize(OUTPUT_FILE) / 1024 / 1024
    total_dur = len(durations) and sum(durations) + START_OFFSET + GAP * (len(durations) - 1)
    print(f"✅ narration.wav 已生成 ({size_mb:.1f} MB, {total_dur:.1f}s)")

    # 生成 timeline.json
    t = START_OFFSET
    entries = []
    for i, dur in enumerate(durations):
        entries.append({
            "index": i + 1,
            "start": round(t, 1),
            "end": round(t + dur, 1),
            "text": seg_texts[i] if i < len(seg_texts) else f"Segment {i+1}",
        })
        t += dur + GAP

    TIMELINE_FILE.write_text(
        json.dumps(entries, ensure_ascii=False, indent=2),
        encoding="utf-8"
    )
    print(f"📋 timeline.json 已更新（{len(entries)} 段）")

    # 更新 hyperframes.json 的 duration
    hf_path = SCRIPT_DIR / "hyperframes.json"
    if hf_path.exists():
        hf = json.loads(hf_path.read_text(encoding="utf-8"))
        total_with_gaps = sum(durations) + START_OFFSET + GAP * (len(durations) - 1)
        hf["duration"] = int(total_with_gaps) + 2  # +2s 余量
        hf_path.write_text(json.dumps(hf, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"hyperframes.json duration 已更新: {hf['duration']}s")

    return True

if __name__ == "__main__":
    if not main():
        exit(1)
`;
}

/** 生成 package.json */
function generatePackageJson(): string {
  return JSON.stringify({
    name: 'webframes-export',
    version: '1.0.0',
    private: true,
    scripts: {
      lint: 'npx --yes hyperframes@0.6.56 lint',
      render: 'npx --yes hyperframes@0.6.56 render',
      tts: 'python3 tts.py --timed --output-timestamps timeline.json script.txt narration.wav',
    },
  }, null, 2);
}

/** 生成 .env.example */
function generateEnvExample(): string {
  return `# WebFrames TTS 配置
# 复制为 .env 并填写凭据（.env 不会被提交）

# 引擎: mimo | edge
TTS_ENGINE=mimo

# MiMo API Key（仅 mimo 引擎需要）
# 获取: https://mimo.mi.com
MIMO_API_KEY=your_mimo_api_key_here

# edge-tts 音色（仅 edge 引擎）
TTS_VOICE=zh-CN-XiaoxiaoNeural
TTS_RATE=+5%
`;
}

/** 生成 README.md */
function generateReadme(project: Project, segments: ScriptSegment[]): string {
  const totalDur = segments.reduce(
    (sum, s) => sum + (s.audioDuration ?? Math.ceil(s.text.length / 3.8)),
    0,
  );
  return `# ${project.name}

> 由 WebFrames 生成

## 项目信息

- 分辨率: ${project.resolution.width}×${project.resolution.height}
- 总段数: ${segments.length}
- 预估时长: ${Math.ceil(totalDur)} 秒
- TTS 引擎: ${project.ttsEngine}

## 快速开始

\`\`\`bash
# 1. 安装依赖（如需 TTS 重新生成配音）
pip install edge-tts openai

# 2. 配置凭据（仅 MiMo 引擎需要重新生成时）
cp .env.example .env
# 编辑 .env 填入 MIMO_API_KEY

# 3. 一键渲染（已合成音频会自动拼接，无需 API Key）
bash render.sh

# 或分步执行:
# 3a. 如果 segments/ 目录有音频：拼接为 narration.wav
python3 concat_audio.py
# 3b. 如果没有预合成音频：用 TTS 生成
python3 tts.py --timed --output-timestamps timeline.json script.txt narration.wav
# 3c. 渲染
npx hyperframes lint
npx hyperframes render
\`\`\`

## 文件说明

| 文件 | 说明 |
|------|------|
| index.html | 主视频编排页面（GSAP 动画） |
| hyperframes.json | HyperFrames 视频规格 |
| webframes.config.json | 引擎/音色配置 |
| script.txt | 纯文本脚本 |
| timeline.json | 精确时间戳 |
| tts.py | TTS 配音脚本（双引擎） |
| concat_audio.py | 拼接预合成音频为 narration.wav |
| render.sh | 一键渲染脚本 |
| .env.example | 凭据模板 |

## 输出

渲染完成后，视频文件在 \`renders/\` 目录下。
`;
}

// ==================== 辅助函数 ====================

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function getSceneBg(seg: ScriptSegment): string {
  const bgs: Record<string, string> = {
    hook: 'linear-gradient(135deg, #0f0c29, #302b63)',
    pain: 'linear-gradient(135deg, #232526, #414345)',
    turn: 'linear-gradient(135deg, #1a2a6c, #b21f1f)',
    climax: 'linear-gradient(135deg, #f12711, #f5af19)',
    cta: 'linear-gradient(135deg, #134e5e, #71b280)',
    transition: 'linear-gradient(135deg, #2c3e50, #3498db)',
  };
  return bgs[seg.role ?? ''] ?? 'linear-gradient(135deg, #1a1a2e, #16213e)';
}

function getSegmentStart(segments: ScriptSegment[], index: number): number {
  let start = 0.5;
  for (let i = 0; i < index; i++) {
    start += (segments[i].audioDuration ?? Math.ceil(segments[i].text.length / 3.8)) + 0.35;
  }
  return Math.round(start * 10) / 10;
}

function generateSubtitles(segments: ScriptSegment[]) {
  let startTime = 0.5;
  const gap = 0.35;
  return segments.map((seg, i) => {
    const dur = seg.audioDuration ?? Math.ceil(seg.text.length / 3.8);
    const entry = {
      index: i + 1,
      start: Math.round(startTime * 10) / 10,
      end: Math.round((startTime + dur) * 10) / 10,
      text: seg.text,
    };
    startTime += dur + gap;
    return entry;
  });
}

// ==================== 导出主函数 ====================

export interface ExportResult {
  blob: Blob;
  filename: string;
  fileCount: number;
}

export async function exportProject(
  project: Project,
  segments: ScriptSegment[],
  voicesData?: VoiceEntry[],
): Promise<ExportResult> {
  const JSZip = await loadJSZip();
  const zip = new JSZip();

  // 生成所有文件
  zip.file('index.html', generateIndexHtml(project, segments));
  zip.file('hyperframes.json', generateHyperframesJson(project, segments));
  zip.file('webframes.config.json', generateWebframesConfig(project, segments, voicesData));
  zip.file('script.txt', generateScriptTxt(segments));
  zip.file('timeline.json', generateTimelineJson(segments));
  zip.file('tts.py', generateTtsPy());
  zip.file('concat_audio.py', generateConcatAudioPy());
  zip.file('render.sh', generateRenderSh());
  zip.file('package.json', generatePackageJson());
  zip.file('.env.example', generateEnvExample());
  zip.file('README.md', generateReadme(project, segments));

  // 如果有已合成的音频，打包到 segments/
  let audioCount = 0;
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (seg.audioUrl) {
      try {
        const response = await fetch(seg.audioUrl);
        const blob = await response.blob();
        const ext = blob.type.includes('mpeg') ? 'mp3' : 'wav';
        zip.file(`segments/${String(i + 1).padStart(3, '0')}.${ext}`, blob);
        audioCount++;
      } catch {
        // 跳过无法获取的音频
      }
    }
  }

  const timestamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '');
  const filename = `webframes-export-${timestamp}.zip`;

  const blob = await zip.generateAsync({
    type: 'blob',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });

  return {
    blob,
    filename,
    fileCount: 11 + audioCount,
  };
}

/** 触发浏览器下载 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
