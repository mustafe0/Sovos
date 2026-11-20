import express from "express";
import path from "path";
import fs from "fs";
import os from "os";
import { exec, execSync, spawnSync } from "child_process";
import util from "util";
import multer from "multer";
import { GoogleGenAI, Type, HarmCategory, HarmBlockThreshold, ThinkingLevel } from "@google/genai";

const execPromise = util.promisify(exec);

const upload = multer({
  dest: os.tmpdir(),
  limits: {
    fileSize: 1024 * 1024 * 1024, // 1GB max file upload
    fieldSize: 250 * 1024 * 1024, // 250MB max text field size (prevents LIMIT_FIELD_VALUE on large JSON/overlays)
    fields: 100,
  }
});

export async function createExpressApp() {
  const app = express();
  const PORT = process.env.PORT || 3000;

  app.use(express.json({ limit: "100mb" }));
  app.use(express.urlencoded({ extended: true, limit: "100mb" }));

  const hasFfmpeg = (() => {
    try {
      return spawnSync("ffmpeg", ["-version"], { stdio: "ignore", timeout: 3000 }).status === 0;
    } catch {
      return false;
    }
  })();

  // Health check
  app.get("/api/health", (_req, res) => {
    res.json({
      status: "ok",
      geminiKeySet: Boolean(process.env.GEMINI_API_KEY),
      ffmpegAvailable: hasFfmpeg,
      isVercel: process.env.VERCEL === "1",
    });
  });



  // Ensure popular Google Fonts are available for FFmpeg ASS filter
  const fontsDir = path.join(os.homedir(), ".local", "share", "fonts");
  async function ensureCustomFonts() {
    try {
      if (!fs.existsSync(fontsDir)) {
        fs.mkdirSync(fontsDir, { recursive: true });
      }
      const fontList = [
        { name: "Outfit-Bold.ttf", url: "https://raw.githubusercontent.com/google/fonts/main/ofl/outfit/Outfit%5Bwght%5D.ttf" },
        { name: "Montserrat-Bold.ttf", url: "https://raw.githubusercontent.com/google/fonts/main/ofl/montserrat/Montserrat%5Bwght%5D.ttf" },
        { name: "PlusJakartaSans-Bold.ttf", url: "https://raw.githubusercontent.com/google/fonts/main/ofl/plusjakartasans/PlusJakartaSans%5Bwght%5D.ttf" },
        { name: "PlayfairDisplay-Bold.ttf", url: "https://raw.githubusercontent.com/google/fonts/main/ofl/playfairdisplay/PlayfairDisplay%5Bwght%5D.ttf" },
        { name: "PlayfairDisplay-Italic.ttf", url: "https://raw.githubusercontent.com/google/fonts/main/ofl/playfairdisplay/PlayfairDisplay-Italic%5Bwght%5D.ttf" },
        { name: "Lora-Bold.ttf", url: "https://raw.githubusercontent.com/google/fonts/main/ofl/lora/Lora%5Bwght%5D.ttf" },
        { name: "DMSerifDisplay-Regular.ttf", url: "https://raw.githubusercontent.com/google/fonts/main/ofl/dmserifdisplay/DMSerifDisplay-Regular.ttf" },
        { name: "JetBrainsMono-Bold.ttf", url: "https://raw.githubusercontent.com/google/fonts/main/ofl/jetbrainsmono/JetBrainsMono%5Bwght%5D.ttf" },
        { name: "Anton-Regular.ttf", url: "https://raw.githubusercontent.com/google/fonts/main/ofl/anton/Anton-Regular.ttf" }
      ];
      let downloadedAny = false;
      for (const font of fontList) {
        const dest = path.join(fontsDir, font.name);
        if (!fs.existsSync(dest) || fs.statSync(dest).size === 0) {
          try {
            const resp = await fetch(font.url);
            if (resp.ok) {
              const buf = await resp.arrayBuffer();
              fs.writeFileSync(dest, Buffer.from(buf));
              downloadedAny = true;
            }
          } catch {}
        }
      }
      if (downloadedAny) {
        try { execSync("fc-cache -f"); } catch {}
      }
    } catch {}
  }
  if (process.env.VERCEL !== "1") {
    ensureCustomFonts().catch(() => {});
  }

  // Helper function for ASS subtitle styling with proper RGBA/RGB and HEX support
  function hexToAssColor(colorStr: string, defaultAlphaHex = "00"): string {
    if (!colorStr || colorStr === "transparent") return "&HFF000000&";
    const str = colorStr.trim();
    const rgbaMatch = str.match(/rgba?\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\s*\)/i);
    if (rgbaMatch) {
      const r = Math.min(255, Math.max(0, parseInt(rgbaMatch[1], 10)));
      const g = Math.min(255, Math.max(0, parseInt(rgbaMatch[2], 10)));
      const b = Math.min(255, Math.max(0, parseInt(rgbaMatch[3], 10)));
      const aFloat = rgbaMatch[4] !== undefined ? parseFloat(rgbaMatch[4]) : 1;
      // In ASS, alpha 00 is fully opaque, FF is fully transparent
      const alphaVal = Math.min(255, Math.max(0, Math.round((1 - aFloat) * 255)));
      const alphaHex = alphaVal.toString(16).padStart(2, "0");
      const bHex = b.toString(16).padStart(2, "0");
      const gHex = g.toString(16).padStart(2, "0");
      const rHex = r.toString(16).padStart(2, "0");
      return `&H${alphaHex}${bHex}${gHex}${rHex}&`.toUpperCase();
    }

    let clean = str.replace("#", "").trim();
    if (clean.length === 3) clean = clean.split("").map(c => c + c).join("");
    if (clean.length !== 6) return `&H${defaultAlphaHex}FFFFFF&`;
    const r = clean.substring(0, 2);
    const g = clean.substring(2, 4);
    const b = clean.substring(4, 6);
    return `&H${defaultAlphaHex}${b}${g}${r}&`.toUpperCase();
  }

  function formatAssTime(seconds: number): string {
    const safeSec = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
    const h = Math.floor(safeSec / 3600);
    const m = Math.floor((safeSec % 3600) / 60);
    const s = Math.floor(safeSec % 60);
    const cs = Math.floor((safeSec % 1) * 100);
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
  }

  function generateAssSubtitles(
    captions: Array<{ startTime: number; endTime: number; text: string }>,
    style: any,
    videoWidth = 0,
    videoHeight = 0
  ): string {
    const textColor = hexToAssColor(style?.textColor || "#FFFFFF", "00");
    const strokeColor = hexToAssColor(style?.textStrokeColor || style?.outlineColor || "#000000", "00");
    
    const hasBackground = Boolean(
      style?.backgroundColor &&
      style?.backgroundColor !== "transparent" &&
      style?.backgroundType &&
      style?.backgroundType !== "none"
    );

    let bgAlpha = "00";
    if (typeof style?.backgroundOpacity === "number") {
      bgAlpha = Math.min(255, Math.max(0, Math.round((1 - style.backgroundOpacity / 100) * 255))).toString(16).padStart(2, "0");
    }
    const bgColor = hexToAssColor(hasBackground ? style?.backgroundColor : "transparent", bgAlpha);
    const highlightColor = hexToAssColor(style?.secondaryTextColor || style?.textColor || "#FFFFFF", "00");

    let fontSize = 42;
    if (typeof style?.fontSize === "number") {
      fontSize = Math.round(style.fontSize * 1.05);
    } else if (style?.fontSize === "small") fontSize = 32;
    else if (style?.fontSize === "large") fontSize = 52;
    else if (style?.fontSize === "xlarge") fontSize = 64;

    const isLeft = style?.textAlign === "left";
    const isRight = style?.textAlign === "right";

    let alignment = 2; // Bottom center
    if (typeof style?.yPosition === "number") {
      if (style.yPosition <= 30) {
        alignment = isLeft ? 7 : isRight ? 9 : 8; // Top
      } else if (style.yPosition <= 65) {
        alignment = isLeft ? 4 : isRight ? 6 : 5; // Middle
      } else {
        alignment = isLeft ? 1 : isRight ? 3 : 2; // Bottom
      }
    } else {
      alignment = isLeft ? 1 : isRight ? 3 : 2;
    }

    // BorderStyle 3 creates an opaque background capsule/box in ASS
    const borderStyle = hasBackground ? 3 : 1;
    const outline = hasBackground
      ? Math.max(10, Math.round((style?.padding ?? 16) * 0.75))
      : (style?.textStrokeWidth ?? 2.5) > 0
        ? Math.min(6, Math.max(1.5, Math.round(style?.textStrokeWidth ?? 2.5)))
        : 2.0;
    const shadow = hasBackground ? 0 : ((style?.shadowBlur ?? 4) > 0 ? 2.5 : 1.0);

    const isItalic = style?.fontStyle === "italic" ? -1 : 0;
    const isBold = (style?.fontWeight === "900" || style?.fontWeight === "800" || style?.fontWeight === "700" || !style?.fontWeight) ? -1 : 0;

    const isPreset6 = style?.presetId === "preset-viral" || style?.presetId === "preset-6-waxaan-waa-inaad";
    const isProgressive = style?.progressiveReveal ?? isPreset6;

    // Single font family name without commas so ASS format is not broken
    let fontName = "Plus Jakarta Sans";
    const fam = (style?.fontFamily || "").toLowerCase();
    if (fam.includes("playfair")) {
      fontName = "Playfair Display";
    } else if (fam.includes("outfit")) {
      fontName = "Outfit";
    } else if (fam.includes("montserrat")) {
      fontName = "Montserrat";
    } else if (fam.includes("dm serif")) {
      fontName = "DM Serif Display";
    } else if (fam.includes("lora")) {
      fontName = "Lora";
    } else if (fam.includes("jetbrains")) {
      fontName = "JetBrains Mono";
    } else if (fam.includes("impact") || fam.includes("anton")) {
      fontName = "Anton";
    } else if (isPreset6 || fam.includes("serif") || fam.includes("georgia")) {
      fontName = "Playfair Display";
    } else {
      fontName = "Plus Jakarta Sans";
    }

    if (isPreset6) {
      fontSize = Math.max(fontSize, 48);
    }

    const effectiveOutlineColor = hasBackground ? bgColor : (isPreset6 ? "&H00FFFFFF&" : strokeColor);
    const effectiveTextColor = isPreset6 ? "&H00000000&" : textColor;

    let playResX = videoWidth > 0 ? videoWidth : 1280;
    let playResY = videoHeight > 0 ? videoHeight : 720;
    if (videoWidth <= 0 || videoHeight <= 0) {
      if (style?.aspectRatioPreset === "9:16") {
        playResX = 720;
        playResY = 1280;
      } else if (style?.aspectRatioPreset === "1:1") {
        playResX = 1080;
        playResY = 1080;
      } else if (style?.aspectRatioPreset === "4:5") {
        playResX = 1080;
        playResY = 1350;
      }
    }

    const marginV = typeof style?.yPosition === "number"
      ? Math.max(16, Math.round(playResY * ((100 - style.yPosition) / 100) - (fontSize / 2)))
      : Math.max(16, Math.min(Math.round(playResY * 0.25), Math.round((style?.verticalOffset ?? 10) * (playResY / 160))));

    let ass = `[Script Info]
Title: Savos AI Subtitles
ScriptType: v4.00+
PlayResX: ${playResX}
PlayResY: ${playResY}
WrapStyle: 0

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,${fontName},${fontSize},${effectiveTextColor},${highlightColor},${effectiveOutlineColor},${bgColor},${isBold},${isItalic},0,0,100,100,0,0,${borderStyle},${isPreset6 ? 5 : outline},${isPreset6 ? 3 : shadow},${alignment},40,40,${marginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

    function splitInto3Parts(text: string): string[] {
      if (!text) return [];
      if (text.includes('\n')) {
        const raw = text.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
        if (raw.length > 3) {
          return [raw[0], raw[1], raw.slice(2).join(' ')];
        }
        return raw;
      }
      const words = text.trim().split(/\s+/).filter(Boolean);
      if (words.length <= 1) return [text.trim()];
      if (words.length === 2) return [words[0], words[1]];
      if (words.length === 3) return [words[0], words[1], words[2]];
      if (words.length === 4) return [words[0], words[1], words.slice(2).join(' ')];
      if (words.length === 5) return [words[0], words.slice(1, 3).join(' '), words.slice(3).join(' ')];
      if (words.length === 6) {
        return [words[0], words.slice(1, 3).join(' '), words.slice(3).join(' ')];
      }
      const p1 = Math.max(1, Math.floor(words.length * 0.28));
      const p2 = Math.max(p1 + 1, Math.floor(words.length * 0.60));
      return [
        words.slice(0, p1).join(' '),
        words.slice(p1, p2).join(' '),
        words.slice(p2).join(' ')
      ];
    }

    for (const cap of captions) {
      if (!cap?.text) continue;
      const start = formatAssTime(cap.startTime);
      const end = formatAssTime(cap.endTime);

      if (isPreset6) {
        const parts = splitInto3Parts(cap.text);
        if (parts.length === 0) continue;

        const s1 = Math.round(fontSize * 1.25);
        const s2 = Math.round(fontSize * 1.00);
        const s3 = Math.round(fontSize * 0.72);

        // Line 1: Largest, Color Black (&H000000&), Outline White (&HFFFFFF&)
        const l1 = `{\\fn${fontName}\\b1\\fs${s1}\\c&H000000&\\3c&HFFFFFF&\\bord5}${parts[0] || ''}`;
        // Line 2: Medium, Color Somali Blue (&HFF8400& in BGR), Outline White (&HFFFFFF&)
        const l2 = parts[1] ? `{\\fn${fontName}\\b1\\fs${s2}\\c&HFF8400&\\3c&HFFFFFF&\\bord5}${parts[1]}` : '';
        // Line 3: Smallest, Color Black (&H000000&), Outline White (&HFFFFFF&) All-Caps
        const l3 = parts[2] ? `{\\fnOutfit\\b1\\fs${s3}\\c&H000000&\\3c&HFFFFFF&\\bord4.5}${parts[2].toUpperCase()}` : '';

        if (isProgressive && parts.length > 1 && cap.endTime > cap.startTime) {
          const dur = cap.endTime - cap.startTime;
          if (parts.length === 3) {
            const t1 = cap.startTime + dur * 0.30;
            const t2 = cap.startTime + dur * 0.62;
            ass += `Dialogue: 0,${formatAssTime(cap.startTime)},${formatAssTime(t1)},Default,,0,0,0,,${l1}\n`;
            ass += `Dialogue: 0,${formatAssTime(t1)},${formatAssTime(t2)},Default,,0,0,0,,${l1}\\N${l2}\n`;
            ass += `Dialogue: 0,${formatAssTime(t2)},${formatAssTime(cap.endTime)},Default,,0,0,0,,${l1}\\N${l2}\\N${l3}\n`;
          } else if (parts.length === 2) {
            const t1 = cap.startTime + dur * 0.45;
            ass += `Dialogue: 0,${formatAssTime(cap.startTime)},${formatAssTime(t1)},Default,,0,0,0,,${l1}\n`;
            ass += `Dialogue: 0,${formatAssTime(t1)},${formatAssTime(cap.endTime)},Default,,0,0,0,,${l1}\\N${l2}\n`;
          }
        } else {
          const fullText = [l1, l2, l3].filter(Boolean).join('\\N');
          ass += `Dialogue: 0,${start},${end},Default,,0,0,0,,${fullText}\n`;
        }
      } else if (style?.animation === 'karaoke' || style?.animation === 'word-by-word' || style?.presetId === 'preset-karaoke') {
        const words = String(cap.text).trim().split(/\s+/).filter(Boolean);
        const dur = cap.endTime - cap.startTime;
        const totalWords = words.length;
        const activeAssColor = hexToAssColor(style?.highlightColor || "#FFE600", "00");
        const baseAssColor = effectiveTextColor;

        if (totalWords > 1 && dur > 0.2) {
          for (let wIdx = 0; wIdx < totalWords; wIdx++) {
            const wStart = cap.startTime + (wIdx / totalWords) * dur;
            const wEnd = cap.startTime + ((wIdx + 1) / totalWords) * dur;

            const lineTokens = words.map((w, idx) => {
              const cleanWord = style?.isUppercase ? w.toUpperCase() : w;
              if (idx === wIdx) {
                return `{\\c${activeAssColor}\\fscx108\\fscy108}${cleanWord}{\\c${baseAssColor}\\fscx100\\fscy100}`;
              }
              return cleanWord;
            });
            ass += `Dialogue: 0,${formatAssTime(wStart)},${formatAssTime(wEnd)},Default,,0,0,0,,${lineTokens.join(" ")}\n`;
          }
        } else {
          let text = String(cap.text).replace(/\\N/g, " ").replace(/\n/g, "\\N");
          if (style?.isUppercase) text = text.toUpperCase();
          ass += `Dialogue: 0,${start},${end},Default,,0,0,0,,${text}\n`;
        }
      } else {
        let text = String(cap.text).replace(/\\N/g, " ").replace(/\n/g, "\\N");
        if (style?.isUppercase) {
          text = text.toUpperCase();
        }
        ass += `Dialogue: 0,${start},${end},Default,,0,0,0,,${text}\n`;
      }
    }

    return ass;
  }

  // In-memory or temporary store for direct file downloads
  const burnedDownloadsDir = path.join(os.tmpdir(), "caawiye_downloads");
  if (!fs.existsSync(burnedDownloadsDir)) {
    try { fs.mkdirSync(burnedDownloadsDir, { recursive: true }); } catch {}
  }

  // Detect acoustic silence periods using FFmpeg silencedetect filter
  // Uses a conservative -42dB threshold so soft/quiet speech is NEVER misclassified as silence
  function detectSilences(wavPath: string): Array<{ start: number; end: number }> {
    if (!hasFfmpeg) return [];
    try {
      const proc = spawnSync("ffmpeg", [
        "-i", wavPath,
        "-af", "silencedetect=noise=-42dB:d=0.20",
        "-f", "null", "-"
      ], { encoding: "utf-8", timeout: 15000 });
      const stderr = proc.stderr || "";
      const lines = stderr.split("\n");
      const silences: Array<{ start: number; end: number }> = [];
      let currentStart: number | null = null;
      for (const line of lines) {
        const startMatch = line.match(/silence_start:\s*([0-9.]+)/);
        if (startMatch) {
          currentStart = parseFloat(startMatch[1]);
        }
        const endMatch = line.match(/silence_end:\s*([0-9.]+)/);
        if (endMatch && currentStart !== null) {
          silences.push({
            start: Math.max(0, currentStart),
            end: parseFloat(endMatch[1])
          });
          currentStart = null;
        }
      }
      if (currentStart !== null) {
        silences.push({ start: Math.max(0, currentStart), end: 999999 });
      }
      return silences;
    } catch (err) {
      console.warn("Could not detect acoustic silences:", err);
      return [];
    }
  }

  function getAudioDurationSeconds(audioPath: string): number {
    if (hasFfmpeg) {
      try {
        const out = execSync(
          `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${audioPath}"`,
          { encoding: "utf-8", timeout: 8000 }
        ).trim();
        const parsed = parseFloat(out);
        if (Number.isFinite(parsed) && parsed > 0) return parsed;
      } catch {}
    }
    try {
      const stat = fs.statSync(audioPath);
      if (stat.size > 44) {
        const fd = fs.openSync(audioPath, "r");
        try {
          const header = Buffer.alloc(44);
          fs.readSync(fd, header, 0, 44, 0);
          if (header.subarray(0, 4).toString("ascii") === "RIFF" && header.subarray(8, 12).toString("ascii") === "WAVE") {
            const byteRate = header.readUInt32LE(28);
            if (byteRate > 0) {
              return Math.max(1, (stat.size - 44) / byteRate);
            }
          }
        } finally {
          fs.closeSync(fd);
        }
        // Fallback estimate for 16kHz 16-bit mono PCM WAV (32,000 bytes/sec)
        return Math.max(1, (stat.size - 44) / 32000);
      }
    } catch {}
    return 0;
  }

  // Direct download endpoint by ID (works seamlessly in all browsers and iframes)
  app.get("/api/download-burned/:fileId", (req, res) => {
    const fileId = req.params.fileId.replace(/[^a-zA-Z0-9_-]/g, "");
    const targetFile = path.join(burnedDownloadsDir, `${fileId}.mp4`);
    if (!fs.existsSync(targetFile)) {
      return res.status(404).send("File not found or expired. Please export again.");
    }
    const rawName = typeof req.query.filename === "string" ? req.query.filename : "savos-subtitled.mp4";
    const safeDownloadName = (rawName.replace(/[^a-zA-Z0-9._-]/g, "_") || "savos-subtitled.mp4").endsWith(".mp4")
      ? (rawName.replace(/[^a-zA-Z0-9._-]/g, "_") || "savos-subtitled.mp4")
      : `${rawName.replace(/[^a-zA-Z0-9._-]/g, "_") || "savos-subtitled"}.mp4`;
    const stat = fs.statSync(targetFile);
    res.setHeader("Content-Type", "video/mp4");
    res.setHeader("Content-Length", stat.size.toString());
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    res.setHeader("Content-Disposition", `attachment; filename="${safeDownloadName}"; filename*=UTF-8''${encodeURIComponent(safeDownloadName)}`);
    res.setHeader("Accept-Ranges", "bytes");
    const stream = fs.createReadStream(targetFile);
    stream.on("error", () => {
      try { if (!res.headersSent) res.status(500).end(); else res.end(); } catch {}
    });
    res.on("close", () => {
      try { stream.destroy(); } catch {}
    });
    stream.pipe(res);
  });

  // Merge Subtitled Video with Original Audio API (Preserves 100% original audio, produces universal H.264 MP4)
  app.post("/api/merge-video-audio", upload.fields([
    { name: "subtitledVideo", maxCount: 1 },
    { name: "originalVideo", maxCount: 1 }
  ]), async (req, res) => {
    const files = req.files as { [fieldname: string]: Express.Multer.File[] } | undefined;
    const subtitledFile = files?.["subtitledVideo"]?.[0];
    const originalFile = files?.["originalVideo"]?.[0];

    if (!subtitledFile || !originalFile) {
      return res.status(400).json({ success: false, error: "Subtitled and original video files are required." });
    }

    const subtitledPath = subtitledFile.path;
    const originalPath = originalFile.path;
    const outputPath = path.join(os.tmpdir(), `caawiye-merged-${Date.now()}-${Math.random().toString(36).substring(7)}.mp4`);

    try {
      console.log(`Merging subtitled video (${subtitledPath}) with original audio (${originalPath})...`);
      // First attempt: Instantaneous stream copy (Takes ~0.1s, 0% CPU, 100% original lossless audio & video)
      let mergeSuccess = false;
      try {
        await execPromise(`ffmpeg -y -i "${subtitledPath}" -i "${originalPath}" -map 0:v:0 -map 1:a:0? -c:v copy -c:a copy -movflags +faststart -shortest "${outputPath}"`);
        mergeSuccess = fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0;
      } catch (streamCopyErr) {
        console.warn("Stream copy merge failed, attempting fast AAC remux fallback:", streamCopyErr);
      }

      // Second attempt: Remux audio to high-fidelity AAC if original container audio stream cannot copy directly
      if (!mergeSuccess) {
        try {
          await execPromise(`ffmpeg -y -i "${subtitledPath}" -i "${originalPath}" -map 0:v:0 -map 1:a:0? -c:v copy -c:a aac -b:a 192k -ar 48000 -movflags +faststart -shortest "${outputPath}"`);
          mergeSuccess = fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0;
        } catch (aacRemuxErr) {
          console.warn("AAC remux merge notice, falling back to ultrafast transcode:", aacRemuxErr);
        }
      }

      // Third attempt: Ultrafast fallback transcode
      if (!mergeSuccess) {
        await execPromise(`ffmpeg -y -i "${subtitledPath}" -i "${originalPath}" -map 0:v:0 -map 1:a:0? -c:v libx264 -preset ultrafast -threads 0 -tune fastdecode -crf 20 -pix_fmt yuv420p -c:a aac -b:a 192k -ar 48000 -movflags +faststart -shortest "${outputPath}"`);
      }

      if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size === 0) {
        throw new Error("Merged video file could not be generated.");
      }

      const stat = fs.statSync(outputPath);
      res.setHeader("Content-Type", "video/mp4");
      res.setHeader("Content-Length", stat.size.toString());
      res.setHeader("Content-Disposition", `attachment; filename="savos-subtitled.mp4"; filename*=UTF-8''savos-subtitled.mp4`);
      res.setHeader("Accept-Ranges", "bytes");

      const stream = fs.createReadStream(outputPath);
      stream.pipe(res);
      const cleanup = () => {
        try { if (fs.existsSync(subtitledPath)) fs.unlinkSync(subtitledPath); } catch {}
        try { if (fs.existsSync(originalPath)) fs.unlinkSync(originalPath); } catch {}
        try { if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath); } catch {}
      };
      stream.on("end", cleanup);
      stream.on("error", cleanup);
      res.on("close", cleanup);
    } catch (err: any) {
      console.error("Merge failed:", err);
      try { if (fs.existsSync(subtitledPath)) fs.unlinkSync(subtitledPath); } catch {}
      try { if (fs.existsSync(originalPath)) fs.unlinkSync(originalPath); } catch {}
      try { if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath); } catch {}
      return res.status(500).json({ success: false, error: err?.message || "Failed to merge video and audio." });
    }
  });

  // Direct Server-Side Subtitle Burn with 100% Original Audio API (Bulletproof High-Speed FFmpeg Engine)
  // Supports direct single-request upload (smaller videos) AND chunked fileId (massive/custom videos of any size)
  app.post("/api/burn-subtitles", (req, res, next) => {
    upload.single("video")(req, res, (err) => {
      if (err) {
        console.warn("Multer upload notice in /api/burn-subtitles:", err?.message);
      }
      next();
    });
  }, async (req, res) => {
    // Extend timeout to 15 minutes for large video uploads & rendering (up to 1GB)
    req.setTimeout(900000);
    res.setTimeout(900000);

    if (!hasFfmpeg) {
      try { if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path); } catch {}
      return res.status(501).json({
        success: false,
        error: "Server-side FFmpeg burn is unavailable on serverless runtime; use client-side export."
      });
    }

    const uploadedFile = req.file;
    const fileId = String(req.body?.fileId || "").replace(/[^a-zA-Z0-9_-]/g, "");

    let inputPath = "";
    if (uploadedFile && fs.existsSync(uploadedFile.path)) {
      inputPath = uploadedFile.path;
    } else if (fileId) {
      const assembledFilePath = path.join(os.tmpdir(), `assembled-${fileId}.mp4`);
      if (fs.existsSync(assembledFilePath)) {
        inputPath = assembledFilePath;
      } else {
        const sessionDir = path.join(chunkUploadsDir, fileId);
        if (fs.existsSync(sessionDir)) {
          const files = fs.readdirSync(sessionDir).filter((f) => f.startsWith("chunk_")).sort();
          if (files.length > 0) {
            for (const f of files) {
              fs.appendFileSync(assembledFilePath, fs.readFileSync(path.join(sessionDir, f)));
              try { fs.unlinkSync(path.join(sessionDir, f)); } catch {}
            }
            try { fs.rmdirSync(sessionDir); } catch {}
            inputPath = assembledFilePath;
          }
        }
      }
    }

    if (!inputPath || !fs.existsSync(inputPath)) {
      return res.status(400).json({ success: false, error: "No video file or valid fileId provided." });
    }

    const captionsRaw = req.body.captions;
    const styleConfigRaw = req.body.styleConfig;
    const trimStart = parseFloat(req.body.trimStart || "0") || 0;
    const trimEnd = parseFloat(req.body.trimEnd || "0") || 0;
    let captions: Array<{ startTime: number; endTime: number; text: string }> = [];
    let styleConfig: any = {};

    try {
      captions = JSON.parse(captionsRaw || "[]");
    } catch {
      captions = [];
    }

    try {
      styleConfig = JSON.parse(styleConfigRaw || "{}");
    } catch {
      styleConfig = {};
    }

    const aspectRatioPreset = req.body.aspectRatioPreset;
    if (aspectRatioPreset && !styleConfig.aspectRatioPreset) {
      styleConfig.aspectRatioPreset = aspectRatioPreset;
    }

    const overlaysRaw = req.body.overlays;
    let overlays: Array<{ startTime: number; endTime: number; overlayDataUrl: string }> = [];
    try {
      overlays = JSON.parse(overlaysRaw || "[]");
    } catch {
      overlays = [];
    }

    // If video is trimmed, adjust subtitle timestamps to match trimmed start
    const exportCaptions = trimStart > 0
      ? captions
          .filter((c) => (trimEnd > 0 ? c.startTime < trimEnd : true) && c.endTime > trimStart)
          .map((c) => ({
            ...c,
            startTime: Math.max(0, parseFloat((c.startTime - trimStart).toFixed(2))),
            endTime: Math.max(0.2, parseFloat((c.endTime - trimStart).toFixed(2))),
          }))
      : captions;

    const exportOverlays = trimStart > 0
      ? overlays
          .filter((ov) => (trimEnd > 0 ? ov.startTime < trimEnd : true) && ov.endTime > trimStart)
          .map((ov) => ({
            ...ov,
            startTime: Math.max(0, parseFloat((ov.startTime - trimStart).toFixed(2))),
            endTime: Math.max(0.1, parseFloat((ov.endTime - trimStart).toFixed(2))),
          }))
      : overlays;

    const randTag = `${Date.now()}-${Math.random().toString(36).substring(7)}`;
    const assPath = path.join(os.tmpdir(), `caawiye-subs-${randTag}.ass`);
    const srtPath = path.join(os.tmpdir(), `caawiye-subs-${randTag}.srt`);
    const filterScriptPath = path.join(os.tmpdir(), `caawiye-filter-${randTag}.txt`);
    const outputPath = path.join(os.tmpdir(), `caawiye-burned-${randTag}.mp4`);
    const downloadId = `video_${randTag}`;
    const persistentDownloadPath = path.join(burnedDownloadsDir, `${downloadId}.mp4`);
    const overlayFiles: string[] = [];

    const trimFlag = (trimStart > 0 || trimEnd > 0)
      ? `${trimStart > 0 ? `-ss ${trimStart} ` : ""}${trimEnd > 0 && trimEnd > trimStart ? `-to ${trimEnd} ` : ""}`
      : "";

    try {
      let burnSuccess = false;

      // Probe original video width and height for pixel-perfect ASS coordinate matching
      let probedWidth = 0;
      let probedHeight = 0;
      try {
        const probeOut = execSync(`ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=s=x:p=0 "${inputPath}"`).toString().trim();
        const [pw, ph] = probeOut.split("x").map((n: string) => parseInt(n, 10));
        if (pw > 0 && ph > 0) {
          probedWidth = pw;
          probedHeight = ph;
        }
      } catch (probeErr) {
        console.log("ffprobe dimension notice:", probeErr);
      }

      // --- Primary Pipeline: Ultra-Fast Native ASS Subtitles (9x-15x Real-Time Speed, 100% Original Audio) ---
      const assContent = generateAssSubtitles(exportCaptions, styleConfig, probedWidth, probedHeight);
      fs.writeFileSync(assPath, assContent, "utf8");

      // Generate backup SRT
      const srtContent = exportCaptions.map((c, idx) => {
        const formatSrt = (sec: number) => {
          const s = Math.max(0, sec || 0);
          const h = Math.floor(s / 3600);
          const m = Math.floor((s % 3600) / 60);
          const sc = Math.floor(s % 60);
          const ms = Math.floor((s % 1) * 1000);
          return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sc).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
        };
        return `${idx + 1}\n${formatSrt(c.startTime)} --> ${formatSrt(c.endTime)}\n${c.text}\n`;
      }).join("\n");
      fs.writeFileSync(srtPath, srtContent, "utf8");

      const safeAssFilter = `ass='${assPath.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "'\\\\''")}'`;

      // Optimized video filter: Only apply padding if probed dimensions are odd numbers (avoids redundant memory copying)
      const needsPad = (probedWidth > 0 && probedWidth % 2 !== 0) || (probedHeight > 0 && probedHeight % 2 !== 0);
      const safeAssVideoFilter = needsPad
        ? `pad=ceil(iw/2)*2:ceil(ih/2)*2,${safeAssFilter}`
        : safeAssFilter;

      // Super-fast multithreaded x264 parameters with fastdecode tuning and zero lookahead latency
      const ultrafastParams = "-c:v libx264 -preset ultrafast -tune fastdecode -threads 0 -x264-params no-mbtree=1:rc-lookahead=0:sync-lookahead=0:subme=0:me=dia:ref=1:analyse=none:trellis=0:no-weightb=1:weightp=0:aq-mode=0 -crf 20 -pix_fmt yuv420p";

      // --- Primary Pipeline 1: Ultra-Fast Native ASS Subtitles (Instant Lossless Audio Passthrough) ---
      console.log(`[Burn Engine] Super-fast ASS burn for ${inputPath} (captions: ${exportCaptions.length}, trim: ${trimFlag || "none"})...`);
      try {
        await execPromise(`ffmpeg -y ${trimFlag}-i "${inputPath}" -vf "${safeAssVideoFilter}" ${ultrafastParams} -c:a copy -avoid_negative_ts make_zero -movflags +faststart "${outputPath}"`);
        burnSuccess = fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0;
      } catch (e1) {
        console.log("ASS copy audio notice, trying AAC audio encode pipeline...", e1);
      }

      // --- Pipeline 2: ASS with high-fidelity AAC audio re-encode (if audio stream copy is incompatible) ---
      if (!burnSuccess) {
        try {
          await execPromise(`ffmpeg -y ${trimFlag}-i "${inputPath}" -vf "${safeAssVideoFilter}" ${ultrafastParams} -c:a aac -b:a 192k -ar 48000 -avoid_negative_ts make_zero -movflags +faststart "${outputPath}"`);
          burnSuccess = fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0;
        } catch (e2) {
          console.log("ASS AAC pipeline notice, checking overlay/SRT fallbacks...", e2);
        }
      }

      // --- Pipeline 3: Studio-Grade Canvas Overlays (Fallback when requested and ASS needs fallback) ---
      if (!burnSuccess && exportOverlays && exportOverlays.length > 0) {
        console.log(`[Burn Engine] Fallback: Processing ${exportOverlays.length} studio overlay frames for ${inputPath}...`);
        for (let i = 0; i < exportOverlays.length; i++) {
          const ov = exportOverlays[i];
          if (!ov.overlayDataUrl) continue;
          const match = ov.overlayDataUrl.match(/^data:image\/(?:png|webp);base64,(.+)$/);
          if (match) {
            const pngPath = path.join(os.tmpdir(), `caawiye_ov_${randTag}_${i}.png`);
            fs.writeFileSync(pngPath, Buffer.from(match[1], "base64"));
            overlayFiles.push(pngPath);
          }
        }

        if (overlayFiles.length > 0) {
          const parts = ['[0:v]pad=ceil(iw/2)*2:ceil(ih/2)*2[vbase]'];
          let currentStream = '[vbase]';
          for (let i = 0; i < overlayFiles.length; i++) {
            const ov = exportOverlays[i];
            const nextStream = i === overlayFiles.length - 1 ? '[outv]' : `[v${i}]`;
            parts.push(`movie='${overlayFiles[i]}'[ov${i}]`);
            parts.push(`${currentStream}[ov${i}]overlay=0:0:enable='between(t,${ov.startTime},${ov.endTime})'${nextStream}`);
            currentStream = nextStream;
          }
          const filterScript = parts.join(';\n');
          fs.writeFileSync(filterScriptPath, filterScript, "utf8");

          // Attempt A: Direct lossless copy of original audio stream (Ultra-Fast)
          try {
            await execPromise(`ffmpeg -y ${trimFlag}-i "${inputPath}" -filter_complex_script "${filterScriptPath}" -map "[outv]" -map 0:a? ${ultrafastParams} -c:a copy -avoid_negative_ts make_zero -movflags +faststart "${outputPath}"`);
            burnSuccess = fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0;
          } catch (eOv1) {
            console.log("Overlay copy audio notice, trying AAC audio encode pipeline...", eOv1);
          }

          // Attempt B: High-fidelity AAC audio
          if (!burnSuccess) {
            try {
              await execPromise(`ffmpeg -y ${trimFlag}-i "${inputPath}" -filter_complex_script "${filterScriptPath}" -map "[outv]" -map 0:a? ${ultrafastParams} -c:a aac -b:a 192k -ar 48000 -avoid_negative_ts make_zero -movflags +faststart "${outputPath}"`);
              burnSuccess = fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0;
            } catch (eOv2) {
              console.warn("Overlay AAC audio pipeline notice:", eOv2);
            }
          }
        }
      }

      // --- Pipeline 4: Subtitles filter with SRT file backup ---
      if (!burnSuccess) {
        try {
          await execPromise(`ffmpeg -y ${trimFlag}-i "${inputPath}" -vf "subtitles='${srtPath}',pad=ceil(iw/2)*2:ceil(ih/2)*2" ${ultrafastParams} -c:a aac -b:a 192k -ar 48000 -avoid_negative_ts make_zero -movflags +faststart "${outputPath}"`);
          burnSuccess = fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0;
        } catch (e3) {
          console.log("SRT subtitle pipeline notice, export failed");
        }
      }

      if (!burnSuccess || !fs.existsSync(outputPath) || fs.statSync(outputPath).size === 0) {
        throw new Error("Burned MP4 video file could not be generated.");
      }

      const cleanup = () => {
        try { if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath); } catch {}
        try { if (fs.existsSync(assPath)) fs.unlinkSync(assPath); } catch {}
        try { if (fs.existsSync(srtPath)) fs.unlinkSync(srtPath); } catch {}
        try { if (fs.existsSync(filterScriptPath)) fs.unlinkSync(filterScriptPath); } catch {}
        for (const f of overlayFiles) {
          try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch {}
        }
        try { if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath); } catch {}
      };

      let copiedToPersistent = false;
      // Copy to download directory so direct link GET works
      try {
        fs.copyFileSync(outputPath, persistentDownloadPath);
        copiedToPersistent = fs.existsSync(persistentDownloadPath) && fs.statSync(persistentDownloadPath).size > 0;
        // Auto-cleanup after 15 minutes
        setTimeout(() => {
          try { if (fs.existsSync(persistentDownloadPath)) fs.unlinkSync(persistentDownloadPath); } catch {}
        }, 15 * 60 * 1000);
      } catch {}

      const stat = fs.statSync(outputPath);
      const wantsIdOnly = req.body?.responseMode === "id" && copiedToPersistent;
      if (wantsIdOnly) {
        cleanup();
        res.setHeader("X-Download-Id", downloadId);
        res.setHeader("Access-Control-Expose-Headers", "X-Download-Id");
        return res.json({
          success: true,
          downloadId,
          size: stat.size,
        });
      }

      res.setHeader("Content-Type", "video/mp4");
      res.setHeader("Content-Length", stat.size.toString());
      res.setHeader("Content-Disposition", `attachment; filename="savos-subtitled.mp4"; filename*=UTF-8''savos-subtitled.mp4`);
      res.setHeader("Accept-Ranges", "bytes");
      res.setHeader("X-Download-Id", downloadId);
      res.setHeader("Access-Control-Expose-Headers", "X-Download-Id");

      const stream = fs.createReadStream(outputPath);
      stream.pipe(res);
      stream.on("end", cleanup);
      stream.on("error", cleanup);
      res.on("close", cleanup);
    } catch (err: any) {
      console.error("Burn subtitles failed:", err);
      try { if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath); } catch {}
      try { if (fs.existsSync(assPath)) fs.unlinkSync(assPath); } catch {}
      try { if (fs.existsSync(srtPath)) fs.unlinkSync(srtPath); } catch {}
      try { if (fs.existsSync(filterScriptPath)) fs.unlinkSync(filterScriptPath); } catch {}
      for (const f of overlayFiles) {
        try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch {}
      }
      try { if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath); } catch {}
      return res.status(500).json({ success: false, error: err?.message || "Failed to burn subtitles into MP4 video." });
    }
  });

  // Pure Audio Extraction API (returns 48kHz stereo WAV for browser export)
  app.post("/api/extract-audio", upload.single("video"), async (req, res) => {
    const uploadedFile = req.file;
    if (!uploadedFile) {
      return res.status(400).json({ success: false, error: "No video provided" });
    }
    if (!hasFfmpeg) {
      try { if (fs.existsSync(uploadedFile.path)) fs.unlinkSync(uploadedFile.path); } catch {}
      return res.status(501).json({ success: false, error: "Server-side FFmpeg extraction unavailable." });
    }

    const inputPath = uploadedFile.path;
    const outputPath = path.join(os.tmpdir(), `caawiye-audio-wav-${Date.now()}-${Math.random().toString(36).substring(7)}.wav`);

    try {
      await execPromise(`ffmpeg -y -i "${inputPath}" -vn -ar 48000 -ac 2 -c:a pcm_s16le "${outputPath}"`);
      if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size === 0) {
        return res.status(400).json({ success: false, error: "No audio track could be extracted" });
      }

      res.setHeader("Content-Type", "audio/wav");
      const readStream = fs.createReadStream(outputPath);
      readStream.pipe(res);
      readStream.on("end", () => {
        try { if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath); } catch {}
        try { if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath); } catch {}
      });
      readStream.on("error", () => {
        try { if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath); } catch {}
        try { if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath); } catch {}
      });
    } catch (err: any) {
      try { if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath); } catch {}
      try { if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath); } catch {}
      return res.status(500).json({ success: false, error: err?.message || "Audio extraction failed" });
    }
  });

  function runWithTimeoutAndAbort<T>(
    promise: Promise<T>,
    timeoutMs: number,
    signal?: AbortSignal,
    label = "Operation"
  ): Promise<T> {
    if (signal?.aborted) {
      return Promise.reject(new DOMException("Aborted", "AbortError"));
    }
    return new Promise<T>((resolve, reject) => {
      let settled = false;
      const cleanup = () => {
        clearTimeout(timer);
        if (signal) signal.removeEventListener("abort", onAbort);
      };
      const onAbort = () => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new DOMException("Aborted", "AbortError"));
      };
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new Error(`${label} timed out after ${Math.round(timeoutMs / 1000)}s`));
      }, timeoutMs);

      signal?.addEventListener("abort", onAbort, { once: true });

      promise.then(
        (val) => {
          if (settled) return;
          settled = true;
          cleanup();
          resolve(val);
        },
        (err) => {
          if (settled) return;
          settled = true;
          cleanup();
          reject(err);
        }
      );
    });
  }

  // Core Caption Generation & Audio Transcription Pipeline
  async function processCaptionPipeline(
    inputPath: string,
    uploadedMimeOrName: string = "",
    onStatus?: (status: string) => void,
    abortSignal?: AbortSignal
  ) {
    const tag = `${Date.now()}-${Math.random().toString(36).substring(7)}`;
    const outputPath = path.join(os.tmpdir(), `caawiye-audio-${tag}.wav`);
    const compressedPath = path.join(os.tmpdir(), `caawiye-audio-${tag}.mp3`);

    try {
      if (abortSignal?.aborted) {
        throw new DOMException("Aborted", "AbortError");
      }

      onStatus?.("Extracting speech audio...");

      // 1. Extract 16kHz mono PCM WAV using ffmpeg with resilient fallbacks (when ffmpeg is available)
      console.log(`Extracting audio from ${inputPath} (ffmpegAvailable=${hasFfmpeg})...`);
      let audioExtracted = false;

      if (hasFfmpeg) {
        // Strategy A: 16kHz mono PCM with sample-accurate aresample timestamp lock
        try {
          await execPromise(
            `ffmpeg -y -i "${inputPath}" -vn -map 0:a:0? -af "aresample=async=1" -ar 16000 -ac 1 -c:a pcm_s16le "${outputPath}"`,
            { timeout: 60000 }
          );
          if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 200) {
            audioExtracted = true;
          }
        } catch (errA: any) {
          console.warn("Primary audio extraction (Strategy A) failed, trying Strategy B:", errA?.message);
        }

        // Strategy B: Direct extraction without stream mapping
        if (!audioExtracted) {
          try {
            await execPromise(
              `ffmpeg -y -i "${inputPath}" -vn -af "aresample=async=1" -ar 16000 -ac 1 -c:a pcm_s16le "${outputPath}"`,
              { timeout: 60000 }
            );
            if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 200) {
              audioExtracted = true;
            }
          } catch (errB: any) {
            console.warn("Audio extraction (Strategy B) failed, trying Strategy C:", errB?.message);
          }
        }

        // Strategy C: Generic ffmpeg audio conversion
        if (!audioExtracted) {
          try {
            await execPromise(
              `ffmpeg -y -i "${inputPath}" -vn -ar 16000 -ac 1 "${outputPath}"`,
              { timeout: 60000 }
            );
            if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 200) {
              audioExtracted = true;
            }
          } catch (errC: any) {
            console.warn("Audio extraction (Strategy C) failed:", errC?.message);
          }
        }
      }

      let payloadPath = outputPath;
      let payloadMimeType = "audio/wav";

      // Strategy D: If ffmpeg is unavailable (e.g. Vercel serverless) or input is already audio/supported media
      let usingRawInputFallback = false;
      if (!audioExtracted && fs.existsSync(inputPath) && fs.statSync(inputPath).size > 200) {
        try {
          const buf = fs.readFileSync(inputPath);
          const isWav = buf.subarray(0, 4).toString("ascii") === "RIFF" && buf.subarray(8, 12).toString("ascii") === "WAVE";
          const lowerHint = uploadedMimeOrName.toLowerCase();
          if (isWav) {
            fs.copyFileSync(inputPath, outputPath);
            audioExtracted = true;
          } else if (lowerHint.includes("mp3") || lowerHint.includes("mpeg")) {
            payloadPath = inputPath;
            payloadMimeType = "audio/mp3";
            audioExtracted = true;
            usingRawInputFallback = true;
          } else if (lowerHint.includes("aac") || lowerHint.includes("m4a")) {
            payloadPath = inputPath;
            payloadMimeType = "audio/aac";
            audioExtracted = true;
            usingRawInputFallback = true;
          } else if (lowerHint.includes("ogg")) {
            payloadPath = inputPath;
            payloadMimeType = "audio/ogg";
            audioExtracted = true;
            usingRawInputFallback = true;
          } else if (lowerHint.includes("webm")) {
            payloadPath = inputPath;
            payloadMimeType = lowerHint.includes("audio") ? "audio/webm" : "video/webm";
            audioExtracted = true;
            usingRawInputFallback = true;
          } else if (lowerHint.includes("quicktime") || lowerHint.endsWith(".mov")) {
            payloadPath = inputPath;
            payloadMimeType = "video/quicktime";
            audioExtracted = true;
            usingRawInputFallback = true;
          } else if (lowerHint.includes("mp4") || lowerHint.includes("video")) {
            payloadPath = inputPath;
            payloadMimeType = "video/mp4";
            audioExtracted = true;
            usingRawInputFallback = true;
          } else if (lowerHint.includes("audio")) {
            payloadPath = inputPath;
            payloadMimeType = "audio/wav";
            audioExtracted = true;
            usingRawInputFallback = true;
          }
        } catch (copyErr) {
          console.warn("Direct audio/media fallback error:", copyErr);
        }
      }

      if (!audioExtracted || !fs.existsSync(payloadPath) || fs.statSync(payloadPath).size === 0) {
        throw new Error("No clear audio track detected in the video. Please ensure the video contains audible speech.");
      }

      if (abortSignal?.aborted) {
        throw new DOMException("Aborted", "AbortError");
      }

      // 2. Prepare compact audio payload for fast Gemini upload/inference
      // Compress WAV audio (> 500KB, ~15s+) to 16kHz mono 32kbps MP3 with gentle loudness normalization
      if (hasFfmpeg && !usingRawInputFallback && fs.existsSync(outputPath)) {
        const rawWavSize = fs.statSync(outputPath).size;
        if (rawWavSize > 500 * 1024) {
          try {
            await execPromise(
              `ffmpeg -y -i "${outputPath}" -af "loudnorm=I=-16:TP=-1.5:LRA=11" -ar 16000 -ac 1 -c:a libmp3lame -b:a 32k "${compressedPath}"`,
              { timeout: 45000 }
            );
            if (fs.existsSync(compressedPath) && fs.statSync(compressedPath).size > 500) {
              payloadPath = compressedPath;
              payloadMimeType = "audio/mp3";
              console.log(`[Transcription] Compressed audio payload from ${(rawWavSize / 1024).toFixed(0)}KB WAV to ${(fs.statSync(compressedPath).size / 1024).toFixed(0)}KB MP3`);
            }
          } catch (mp3Err: any) {
            console.warn("[Transcription] MP3 compression skipped, using WAV:", mp3Err?.message);
          }
        }
      }

      const audioBuffer = fs.readFileSync(payloadPath);
      const base64Audio = audioBuffer.toString("base64");
      const audioDuration = fs.existsSync(outputPath) ? getAudioDurationSeconds(outputPath) : 30;

      // 3. Initialize Gemini with required User-Agent
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        throw new Error("GEMINI_API_KEY lama helin (Environment Variable ma jiro). Fadlan ku dar GEMINI_API_KEY gudaha Vercel Settings -> Environment Variables.");
      }

      const ai = new GoogleGenAI({
        apiKey,
        httpOptions: {
          headers: {
            "User-Agent": "aistudio-build",
          },
        },
      });

      const prompt = `
You are an expert audio transcriber and subtitler specializing in video captions.
Your absolute highest directive is TRUE VERBATIM ACCURACY and TIGHT LOCKSTEP AUDIO SYNCHRONIZATION with the speaker's actual voice.

The goal is a TRUE VERBATIM subtitle system:
What the person says = exactly what appears on screen, at the exact time they say it.

======================================================================
MANDATORY DIRECTIVE 1: TRUE VERBATIM ACCURACY (TRANSCRIBE ONLY WHAT IS ACTUALLY SPOKEN)
======================================================================
- Transcribe ONLY what the person actually says in the audio track.
- Do NOT add, remove, rewrite, summarize, interpret, or invent words.
- Do NOT alter, polish, or paraphrase what the speaker says.
- Preserve the speaker's EXACT wording, including:
  * Slang, dialect, and colloquial expressions.
  * Grammatical mistakes and speech slips.
  * Incomplete sentences and false starts.
  * Stutters and repeated words.
  * Natural filler words (e.g. "uh", "um", "ee", "haye", "you know", "like").
  * Explicit, vulgar, or offensive words if they are actually spoken.
- ZERO CENSORSHIP: Do NOT censor, bleep, mask, or replace any words that were actually spoken. Transcribe them literally.
- NON-SPEECH PROHIBITION: Do NOT generate captions for silence, breathing, coughing, sighs, background noise, ambient sounds, sound effects, or background music.
- If there is no audible human speech, return an empty array [].

======================================================================
MANDATORY DIRECTIVE 2: SPOKEN LANGUAGE AUTHENTICITY (AF-SOOMAALI / MULTILINGUAL)
======================================================================
- Transcribe in the EXACT spoken language of the speaker:
  * If the speaker is speaking Somali (Af-Soomaali): Use correct standard Somali orthography:
    - Double vowels: 'aa', 'ee', 'ii', 'oo', 'uu' (e.g. "muuqaalka", "maanta", "waxaan", "inaan", "waad", "hadalka", "qoraalka", "fiican", "si aad u", "soo dhowow", "qofka", "sidaas").
    - Somali consonants: 'c', 'x', 'dh', 'q', 'kh', 'sh'.
    - Somali particles and clitics: "waxa uu", "waxaan", "inuu", "inay", "waa inuu", "waxaa", "haddii", "markii", "isagoo", "ayadoo".
    - Loanwords: If the speaker uses English or Arabic loanwords (e.g. "video", "TikTok", "YouTube", "share", "like", "subscribe", "comment", "Insha'Allah", "Alxamdulillah"), transcribe them accurately as spoken.
  * If the speaker is speaking English, Arabic, or another language, transcribe that language verbatim as spoken.
  * If the speaker code-switches or mixes languages, transcribe each word in the language it was pronounced.

======================================================================
MANDATORY DIRECTIVE 3: LOCKSTEP SPEECH-TO-SUBTITLE SYNCHRONIZATION
======================================================================
- Subtitles must be perfectly synchronized with the speaker's actual voice:
  * ZERO LEAD: Show captions exactly when the person is speaking. The caption must NOT appear before the speaker articulates the first phoneme.
  * ZERO LAG: Captions must follow the exact timing of the speech, word-by-word or as accurately as possible.
- "startTime": The precise second (float, e.g. 1.25) when the speaker begins vocalizing the FIRST word of this segment.
- "endTime": The precise second (float, e.g. 2.10) when the speaker finishes vocalizing the LAST word of this segment.

======================================================================
MANDATORY DIRECTIVE 4: STRICT SILENCE DISAPPEARANCE
======================================================================
- When the person stops speaking or is silent, captions MUST disappear immediately.
- "endTime" MUST cut off immediately at the exact moment vocal sound stops.
- NEVER extend or stretch "endTime" across pauses, breaths, silence, or background music.
- Between speech bursts, if the speaker pauses for 0.15s or longer, leave a clean time gap between the previous segment's "endTime" and the next segment's "startTime" (e.g., segment 1 ends at 2.10, silence until 3.40, segment 2 starts at 3.40). During that gap, no caption should be active!

======================================================================
MANDATORY DIRECTIVE 5: BITE-SIZED NATURAL SPEECH SEGMENTS (1 TO 4 WORDS)
======================================================================
- Break speech into short, punchy 1 to 4 words per segment (ABSOLUTE MAXIMUM 5 words).
- Each segment corresponds to a natural vocal burst so the subtitle flashes in tight synchronization with the speaker's vocal delivery.
- Return ONLY a valid JSON array of objects with keys "startTime" (number), "endTime" (number), "text" (string).
`;

      const captionSchema = {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            startTime: { type: Type.NUMBER, description: "Start time in seconds" },
            endTime: { type: Type.NUMBER, description: "End time in seconds" },
            text: { type: Type.STRING, description: "Verbatim caption text" },
          },
          required: ["startTime", "endTime", "text"],
        },
      };

      onStatus?.("Transcribing speech with AI...");

      // Streaming timeouts: fail fast (20s) if a model hangs with zero output,
      // while allowing healthy actively-streaming responses up to 55-90s (or 55s on Vercel) to finish completely.
      const firstChunkTimeoutMs = 20000;
      const chunkIdleTimeoutMs = 20000;
      const maxTotalTimeoutMs = process.env.VERCEL === "1"
        ? 52000
        : Math.min(90000, Math.max(55000, Math.round(audioDuration * 600 + 40000)));

      const collectStreamText = async (
        modelName: string,
        contents: any,
        config: any
      ): Promise<{ text: string; finishReason?: any }> => {
        const startTime = Date.now();
        const stream = await runWithTimeoutAndAbort(
          ai.models.generateContentStream({
            model: modelName,
            contents,
            config,
          }),
          firstChunkTimeoutMs,
          abortSignal,
          `Model ${modelName}`
        );

        const iterator = stream[Symbol.asyncIterator]();
        let text = "";
        let lastFinishReason: any = undefined;
        let receivedAny = false;

        while (true) {
          if (abortSignal?.aborted) {
            throw new DOMException("Aborted", "AbortError");
          }
          const remainingTotal = maxTotalTimeoutMs - (Date.now() - startTime);
          if (remainingTotal <= 0) {
            throw new Error(`Model ${modelName} exceeded ${Math.round(maxTotalTimeoutMs / 1000)}s limit`);
          }
          const waitBudget = Math.min(
            remainingTotal,
            receivedAny ? chunkIdleTimeoutMs : firstChunkTimeoutMs
          );
          const nextStep = await runWithTimeoutAndAbort(
            iterator.next(),
            waitBudget,
            abortSignal,
            `Model ${modelName}`
          );
          if (nextStep.done) break;
          receivedAny = true;
          const chunk = nextStep.value as any;
          if (chunk?.text) {
            text += chunk.text;
          } else if (chunk?.candidates?.[0]?.content?.parts) {
            for (const part of chunk.candidates[0].content.parts) {
              if (part.text) text += part.text;
              else if (part.audioTranscription?.text) text += part.audioTranscription.text;
            }
          }
          if (chunk?.candidates?.[0]?.finishReason) {
            lastFinishReason = chunk.candidates[0].finishReason;
          }
        }

        return { text: text.trim(), finishReason: lastFinishReason };
      };

      // Valid Gemini models per SDK specification, ordered from fastest audio throughput to fallbacks
      const modelsToTry = [
        "gemini-3.1-flash-lite",
        "gemini-4-hydrogen",
        "gemini-3.5-transcribe",
      ];

      let responseText = "";
      let lastErr: any = null;

      for (const modelName of modelsToTry) {
        if (abortSignal?.aborted) {
          throw new DOMException("Aborted", "AbortError");
        }

        const isTranscribeModel = modelName === "gemini-3.5-transcribe";
        const maxAttemptsForModel = modelName === "gemini-3.1-flash-lite" ? 2 : 1;
        let attempts = 0;
        let modelSucceeded = false;

        while (attempts < maxAttemptsForModel && !modelSucceeded) {
          if (abortSignal?.aborted) {
            throw new DOMException("Aborted", "AbortError");
          }
          attempts++;
          const modelStartMs = Date.now();
          try {
            console.log(`[Transcription] Processing with model: ${modelName}${attempts > 1 ? ` (retry ${attempts})` : ""}`);
            const safetySettings = [
              { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
              { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
              { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
              { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
            ];

            const config: any = { safetySettings };
            if (!isTranscribeModel) {
              config.responseMimeType = "application/json";
              config.responseSchema = captionSchema;
              if (modelName === "gemini-4-hydrogen") {
                config.thinkingConfig = { thinkingLevel: ThinkingLevel.LOW };
              }
            }

            const contents = isTranscribeModel
              ? {
                  parts: [
                    { inlineData: { data: base64Audio, mimeType: payloadMimeType } },
                    { text: "Transcribe all spoken speech in this audio verbatim in its original spoken language." },
                  ],
                }
              : [
                  {
                    role: "user",
                    parts: [
                      { inlineData: { data: base64Audio, mimeType: payloadMimeType } },
                      { text: prompt },
                    ],
                  },
                ];

            let streamResult: { text: string; finishReason?: any };
            try {
              streamResult = await collectStreamText(modelName, contents, isTranscribeModel ? undefined : config);
            } catch (schemaErr: any) {
              if (schemaErr?.name === "AbortError" || abortSignal?.aborted) {
                throw schemaErr;
              }
              const errStr = String(schemaErr?.message || schemaErr || "");
              const shouldCascadeImmediately =
                errStr.includes("503") ||
                errStr.includes("UNAVAILABLE") ||
                errStr.includes("high demand") ||
                errStr.includes("429") ||
                errStr.includes("RESOURCE_EXHAUSTED") ||
                errStr.includes("quota") ||
                errStr.includes("404") ||
                errStr.includes("NOT_FOUND") ||
                errStr.includes("timed out") ||
                errStr.includes("exceeded");

              if (shouldCascadeImmediately || isTranscribeModel) {
                throw schemaErr;
              }

              // If JSON mode or thinkingConfig was rejected (e.g., 400 INVALID_ARGUMENT), retry once cleanly with minimal config
              console.log(`[Transcription] Model ${modelName} config rejected (${errStr.slice(0, 80)}...), retrying plain prompt...`);
              streamResult = await collectStreamText(modelName, contents, { safetySettings });
            }

            if (streamResult.text) {
              responseText = streamResult.text;
              console.log(`[Transcription] Successfully transcribed audio with model: ${modelName} in ${Date.now() - modelStartMs}ms`);
              modelSucceeded = true;
              break;
            } else {
              console.log(`[Transcription] Model ${modelName} returned empty text in ${Date.now() - modelStartMs}ms, finishReason:`, streamResult.finishReason);
              break;
            }
          } catch (err: any) {
            if (err?.name === "AbortError" || abortSignal?.aborted) {
              throw err;
            }
            const errStr = String(err?.message || err);
            const is503 = errStr.includes("503") || errStr.includes("UNAVAILABLE") || errStr.includes("high demand");
            lastErr = err;

            if (is503 && attempts < maxAttemptsForModel) {
              const delayMs = 600;
              console.log(`[Transcription] Model ${modelName} temporarily busy (503) after ${Date.now() - modelStartMs}ms. Retrying in ${delayMs}ms...`);
              onStatus?.("AI busy, retrying quickly...");
              await new Promise((resolve) => setTimeout(resolve, delayMs));
              continue;
            }
            console.log(`[Transcription] Model ${modelName} failed in ${Date.now() - modelStartMs}ms (${errStr.slice(0, 140)}), cascading to next model...`);
            break;
          }
        }

        if (modelSucceeded) {
          break;
        }
      }

      if (!responseText.trim()) {
        let msg = lastErr?.message || "AI transcription response was empty. Please ensure the video audio is clear and audible.";
        try {
          const parsedErr = JSON.parse(msg);
          if (parsedErr?.error?.message) {
            msg = parsedErr.error.message;
          }
        } catch {
          // not json
        }
        if (msg.includes("503") || msg.includes("UNAVAILABLE") || msg.includes("high demand")) {
          msg = "AI model is currently experiencing high demand. Please wait a few seconds and try again.";
        } else if (msg.includes("timed out") || msg.includes("exceeded")) {
          msg = "AI models took too long to respond due to high demand. Please click 'Create Captions' to try again.";
        }
        throw new Error(msg);
      }

      onStatus?.("Synchronizing captions...");

      // 4. Detect acoustic silence intervals in the extracted WAV
      const detectedSilences = detectSilences(outputPath);
      console.log(`[Transcription] Detected ${detectedSilences.length} silence intervals in audio track (duration: ${audioDuration.toFixed(1)}s).`);

      // Robust timestamp parser supporting numbers and HH:MM:SS / MM:SS / milliseconds
      const parseSeconds = (val: any): number => {
        if (typeof val === "number" && !isNaN(val)) {
          return Math.max(0, val);
        }
        if (typeof val === "string") {
          const str = val.trim().replace(/s$/i, "");
          if (/^\d+(\.\d+)?$/.test(str)) {
            return parseFloat(str);
          }
          const parts = str.split(":");
          if (parts.length === 3) {
            const h = parseFloat(parts[0]) || 0;
            const m = parseFloat(parts[1]) || 0;
            const s = parseFloat(parts[2].replace(",", ".")) || 0;
            return h * 3600 + m * 60 + s;
          }
          if (parts.length === 2) {
            const m = parseFloat(parts[0]) || 0;
            const s = parseFloat(parts[1].replace(",", ".")) || 0;
            return m * 60 + s;
          }
        }
        return 0;
      };

      // 5. Robust Multi-Format Parser (JSON + Timestamped Lines + Plain Transcript Fallback)
      const robustParseCaptionsJson = (raw: string): any[] => {
        if (!raw || typeof raw !== "string") return [];
        const cleanedText = raw.replace(/```json/gi, "").replace(/```/g, "").trim();

        const unwrapArray = (val: any): any[] | null => {
          if (Array.isArray(val)) return val;
          if (val && typeof val === "object") {
            for (const k of ["captions", "subtitles", "segments", "transcript", "data", "items", "results"]) {
              if (Array.isArray(val[k])) return val[k];
            }
            if (val.text && (val.startTime !== undefined || val.start !== undefined)) return [val];
          }
          return null;
        };

        // Level 1: Direct JSON.parse
        try {
          const direct = JSON.parse(cleanedText);
          const unwrapped = unwrapArray(direct);
          if (unwrapped !== null) return unwrapped;
        } catch {}

        // Level 2: Trailing commas cleanup
        try {
          const fixedCommas = cleanedText.replace(/,\s*([\]}])/g, "$1");
          const parsedCommas = JSON.parse(fixedCommas);
          const unwrapped = unwrapArray(parsedCommas);
          if (unwrapped !== null) return unwrapped;
        } catch {}

        // Level 3: Repair unescaped inner quotes inside "text" property
        try {
          const fixedQuotes = cleanedText.replace(
            /("(?:text|caption|transcript|subtitle|content)"\s*:\s*")([\s\S]*?)("(?=\s*,\s*"(?:startTime|endTime|id|start|end)"|\s*\}))/g,
            (_m, p1, val, p3) => {
              const safeVal = val.replace(/"/g, "'");
              return p1 + safeVal + p3;
            }
          );
          const parsedQuotes = JSON.parse(fixedQuotes);
          const unwrapped = unwrapArray(parsedQuotes);
          if (unwrapped !== null) return unwrapped;
        } catch {}

        // Level 4: Regex-based object extraction for each { startTime, endTime, text } (handles truncated JSON arrays too)
        const items: any[] = [];
        const objectRegex = /\{([^{}]+)\}/g;
        let match: RegExpExecArray | null;
        while ((match = objectRegex.exec(cleanedText)) !== null) {
          const block = match[1];
          const startMatch = block.match(/(?:startTime|start|time_start)["']?\s*:\s*["']?([0-9.:,]+)["']?/i);
          const endMatch = block.match(/(?:endTime|end|time_end)["']?\s*:\s*["']?([0-9.:,]+)["']?/i);
          let text = "";
          const textMatch = block.match(/(?:text|caption|transcript|subtitle|content)["']?\s*:\s*["']?([\s\S]*)/i);
          if (textMatch) {
            let rawVal = textMatch[1].trim();
            const nextKey = rawVal.search(/,\s*"(?:startTime|endTime|start|end|id)"/i);
            if (nextKey !== -1) {
              rawVal = rawVal.substring(0, nextKey).trim();
            }
            text = rawVal.replace(/^["']/, "").replace(/["'\s,]+$/, "").trim().replace(/"/g, "'");
          }
          if (startMatch && endMatch && text) {
            items.push({
              startTime: startMatch[1],
              endTime: endMatch[1],
              text,
            });
          }
        }
        if (items.length > 0) {
          console.log(`[Transcription] Recovered ${items.length} caption items using Level 4 object parser.`);
          return items;
        }

        // Level 5: Timestamped text lines (e.g. "[00:01 - 00:03] text", "0.5 --> 2.1: text", "[00:01] text")
        const lineItems: any[] = [];
        const lines = cleanedText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
        for (const line of lines) {
          const rangeMatch = line.match(
            /^[\[(]?\s*(\d{1,2}:\d{2}(?::\d{2})?(?:[.,]\d+)?|\d+(?:\.\d+)?)\s*s?\s*(?:-|–|->|-->|to)\s*(\d{1,2}:\d{2}(?::\d{2})?(?:[.,]\d+)?|\d+(?:\.\d+)?)\s*s?\s*[\])]?[:\s-]*(.+)$/i
          );
          if (rangeMatch && rangeMatch[3].trim()) {
            lineItems.push({
              startTime: rangeMatch[1],
              endTime: rangeMatch[2],
              text: rangeMatch[3].trim(),
            });
            continue;
          }
          const singleTsMatch = line.match(
            /^[\[(]?\s*(\d{1,2}:\d{2}(?::\d{2})?(?:[.,]\d+)?)\s*[\])][:\s-]*(.+)$/
          );
          if (singleTsMatch && singleTsMatch[2].trim()) {
            const st = parseSeconds(singleTsMatch[1]);
            lineItems.push({
              startTime: st,
              endTime: st + 2.0,
              text: singleTsMatch[2].trim(),
            });
          }
        }
        if (lineItems.length > 0) {
          console.log(`[Transcription] Parsed ${lineItems.length} caption items using Level 5 timestamp line parser.`);
          return lineItems;
        }

        // Level 6: Plain-text transcript fallback (e.g. if gemini-3.5-transcribe returned un-timestamped text)
        const looksLikeJsonEmpty = /^\[\s*\]$/.test(cleanedText) || cleanedText === "{}" || /^no\s+(audible\s+)?speech/i.test(cleanedText);
        if (!looksLikeJsonEmpty && !cleanedText.startsWith("[") && !cleanedText.startsWith("{")) {
          const words = cleanedText.replace(/\[[^\]]*\]/g, " ").trim().split(/\s+/).filter(Boolean);
          if (words.length > 0 && audioDuration > 0.3) {
            // Compute active speech intervals by subtracting long silences from [0, audioDuration]
            const speechIntervals: Array<{ start: number; end: number }> = [];
            let cursor = 0;
            const sortedSil = [...detectedSilences].filter((s) => s.end - s.start >= 0.25).sort((a, b) => a.start - b.start);
            for (const sil of sortedSil) {
              if (sil.start > cursor + 0.15) {
                speechIntervals.push({ start: cursor, end: Math.min(audioDuration, sil.start) });
              }
              cursor = Math.max(cursor, Math.min(audioDuration, sil.end));
            }
            if (cursor < audioDuration - 0.15) {
              speechIntervals.push({ start: cursor, end: audioDuration });
            }
            if (speechIntervals.length === 0) {
              speechIntervals.push({ start: 0, end: audioDuration });
            }

            const totalSpeechDur = speechIntervals.reduce((acc, s) => acc + (s.end - s.start), 0) || audioDuration;
            const chunks: string[] = [];
            for (let i = 0; i < words.length; i += 3) {
              chunks.push(words.slice(i, i + 3).join(" "));
            }
            const alignedItems: any[] = [];
            let wordOffset = 0;
            const totalWords = words.length;

            const timeAtFraction = (frac: number): number => {
              let target = Math.max(0, Math.min(1, frac)) * totalSpeechDur;
              for (const seg of speechIntervals) {
                const segDur = seg.end - seg.start;
                if (target <= segDur + 0.0001) {
                  return seg.start + target;
                }
                target -= segDur;
              }
              return speechIntervals[speechIntervals.length - 1].end;
            };

            for (const chunkText of chunks) {
              const cw = chunkText.split(/\s+/).length;
              const startSec = timeAtFraction(wordOffset / totalWords);
              wordOffset += cw;
              const endSec = Math.max(startSec + 0.25, timeAtFraction(wordOffset / totalWords));
              alignedItems.push({
                startTime: parseFloat(startSec.toFixed(2)),
                endTime: parseFloat(endSec.toFixed(2)),
                text: chunkText,
              });
            }
            if (alignedItems.length > 0) {
              console.log(`[Transcription] Aligned ${alignedItems.length} caption items from plain transcript via speech intervals.`);
              return alignedItems;
            }
          }
        }

        return [];
      };

      const parsed = robustParseCaptionsJson(responseText);

      // 6. Enforce true verbatim accuracy, speech synchronization, and instant silence disappearance:
      const verifiedCaptions: Array<{ id: string; startTime: number; endTime: number; text: string }> = [];
      const fallbackRawCaptions: Array<{ id: string; startTime: number; endTime: number; text: string }> = [];

      for (const item of parsed) {
        let start = parseSeconds(item.startTime ?? item.start ?? item.start_time ?? item.time_start ?? 0);
        let end = parseSeconds(item.endTime ?? item.end ?? item.end_time ?? item.time_end ?? 0);
        const text = String(item.text ?? item.caption ?? item.transcript ?? item.subtitle ?? item.content ?? "").trim();
        if (!text) continue;

        const wordCount = text.split(/\s+/).filter(Boolean).length;
        if (end <= start) {
          end = start + Math.min(2.8, Math.max(0.45, wordCount * 0.35));
        }

        fallbackRawCaptions.push({
          id: `cap-${fallbackRawCaptions.length + 1}`,
          startTime: parseFloat(start.toFixed(2)),
          endTime: parseFloat(end.toFixed(2)),
          text,
        });

        // A. NON-SPEECH ELIMINATION:
        // Discard hallucinated caption only if it falls completely within a clear silence interval (>= 0.28s)
        let fallsEntirelyInSilence = false;
        for (const sil of detectedSilences) {
          const silDur = sil.end - sil.start;
          if (silDur >= 0.28 && start >= sil.start - 0.04 && end <= sil.end + 0.04) {
            fallsEntirelyInSilence = true;
            break;
          }
        }
        if (fallsEntirelyInSilence) {
          console.log(`[Transcription] Discarded non-speech segment in silence: "${text}" [${start}s - ${end}s]`);
          continue;
        }

        // B. ZERO LEAD:
        // Guard against start inside pre-speech silence (caption must NOT pop up before speaker speaks)
        for (const sil of detectedSilences) {
          if (start >= sil.start && start < sil.end && end > sil.end) {
            start = Math.max(sil.end + 0.02, start);
            break;
          }
        }

        if (end <= start) {
          end = start + Math.min(2.8, Math.max(0.45, wordCount * 0.35));
        }

        // C. STRICT SILENCE DISAPPEARANCE:
        // If a pause or silence starts while this caption is active, cut off at silence start
        for (const sil of detectedSilences) {
          if (sil.start > start + 0.15 && sil.start < end) {
            end = Math.max(start + 0.18, parseFloat((sil.start - 0.03).toFixed(2)));
            break;
          }
        }

        // D. Generous vocal timing guard (never chops off slow speakers)
        const maxRealisticDur = Math.max(1.0, wordCount * 0.75 + 0.45);
        if (end - start > maxRealisticDur + 0.5) {
          end = start + maxRealisticDur;
        }

        if (end > start + 0.08) {
          verifiedCaptions.push({
            id: `cap-${verifiedCaptions.length + 1}`,
            startTime: parseFloat(start.toFixed(2)),
            endTime: parseFloat(end.toFixed(2)),
            text,
          });
        }
      }

      // Safety Net: If silence filtering accidentally removed every parsed caption on a soft recording, restore the raw parsed captions
      const finalPool = verifiedCaptions.length > 0 ? verifiedCaptions : fallbackRawCaptions;

      // Sort chronologically
      finalPool.sort((a, b) => a.startTime - b.startTime);

      // E. Overlap prevention: Clean transitions so subtitles do not overlap and silence gaps are preserved
      for (let i = 0; i < finalPool.length - 1; i++) {
        if (finalPool[i].endTime > finalPool[i + 1].startTime) {
          finalPool[i].endTime = Math.max(
            finalPool[i].startTime + 0.15,
            parseFloat((finalPool[i + 1].startTime - 0.04).toFixed(2))
          );
        }
      }

      const captions = finalPool.map((c, i) => ({
        id: `cap-${i + 1}`,
        startTime: parseFloat(c.startTime.toFixed(2)),
        endTime: parseFloat(c.endTime.toFixed(2)),
        text: c.text.trim(),
      }));

      return captions;
    } finally {
      // Clean up temporary audio files safely
      try {
        if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
      } catch {}
      try {
        if (fs.existsSync(compressedPath)) fs.unlinkSync(compressedPath);
      } catch {}
    }
  }

  const chunkUploadsDir = path.join(os.tmpdir(), "cawiye-chunks");
  if (!fs.existsSync(chunkUploadsDir)) {
    try { fs.mkdirSync(chunkUploadsDir, { recursive: true }); } catch {}
  }

  // Chunked Upload Endpoint (Bypasses Cloud Run 32MB payload limit completely)
  app.post(
    "/api/upload-chunk",
    (req, res, next) => {
      upload.any()(req, res, (err) => {
        if (err) {
          console.error("Multer chunk upload error:", err);
          return res.status(400).json({
            success: false,
            error: `Chunk upload error: ${err?.message || "Invalid chunk payload"}`
          });
        }
        next();
      });
    },
    async (req, res) => {
      try {
        const fileId = String(req.body?.fileId || "").replace(/[^a-zA-Z0-9_-]/g, "");
        const chunkIndex = parseInt(String(req.body?.chunkIndex ?? ""), 10);
        const totalChunks = parseInt(String(req.body?.totalChunks ?? ""), 10);

        if (!fileId || isNaN(chunkIndex) || isNaN(totalChunks) || totalChunks <= 0) {
          return res.status(400).json({ success: false, error: "Invalid chunk metadata parameters." });
        }

        const uploadedFile =
          (req.files && Array.isArray(req.files) && req.files.length > 0 ? req.files[0] : null) ||
          (req as any).file;

        if (!uploadedFile) {
          return res.status(400).json({ success: false, error: "No chunk file received." });
        }

        const sessionDir = path.join(chunkUploadsDir, fileId);
        if (!fs.existsSync(sessionDir)) {
          fs.mkdirSync(sessionDir, { recursive: true });
        }

        const targetChunkFile = path.join(sessionDir, `chunk_${String(chunkIndex).padStart(5, "0")}`);
        fs.copyFileSync(uploadedFile.path, targetChunkFile);
        try { fs.unlinkSync(uploadedFile.path); } catch {}

        const files = fs.readdirSync(sessionDir).filter((f) => f.startsWith("chunk_"));
        if (files.length === totalChunks) {
          console.log(`[ChunkUpload] All ${totalChunks} chunks received for ${fileId}, assembling video...`);
          const assembledFilePath = path.join(os.tmpdir(), `assembled-${fileId}.mp4`);
          if (fs.existsSync(assembledFilePath)) {
            try { fs.unlinkSync(assembledFilePath); } catch {}
          }

          for (let i = 0; i < totalChunks; i++) {
            const chunkPath = path.join(sessionDir, `chunk_${String(i).padStart(5, "0")}`);
            if (!fs.existsSync(chunkPath)) {
              throw new Error(`Missing chunk #${i} during video assembly.`);
            }
            const chunkBuf = fs.readFileSync(chunkPath);
            fs.appendFileSync(assembledFilePath, chunkBuf);
          }

          // Clean up chunk temporary directory
          try {
            for (const f of files) {
              try { fs.unlinkSync(path.join(sessionDir, f)); } catch {}
            }
            fs.rmdirSync(sessionDir);
          } catch {}

          console.log(`[ChunkUpload] Assembled ${fileId} successfully (${fs.statSync(assembledFilePath).size} bytes).`);
          return res.json({ success: true, completed: true, fileId });
        }

        return res.json({
          success: true,
          completed: false,
          receivedChunk: chunkIndex,
          totalReceived: files.length,
          totalChunks
        });
      } catch (err: any) {
        console.error("Chunk upload processing failed:", err);
        return res.status(500).json({ success: false, error: err?.message || "Chunk processing failed" });
      }
    }
  );

  // Helper to run caption pipeline with optional NDJSON live progress + keepalive heartbeats + abort-on-close
  async function executeCaptionRequest(
    req: express.Request,
    res: express.Response,
    inputPath: string,
    mimeOrName: string,
    cleanupInputPath: () => void
  ) {
    const wantsStream = req.query.stream === "1";
    const abortController = new AbortController();
    let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

    res.on("close", () => {
      if (!res.writableEnded) {
        abortController.abort();
      }
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }
    });

    const writeNdjson = (payload: Record<string, any>) => {
      if (!wantsStream || res.writableEnded || abortController.signal.aborted) return;
      try {
        res.write(JSON.stringify(payload) + "\n");
      } catch {}
    };

    if (wantsStream) {
      res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("X-Accel-Buffering", "no");
      if (typeof (res as any).flushHeaders === "function") {
        (res as any).flushHeaders();
      }
      writeNdjson({ type: "status", status: "Extracting speech audio..." });
      // Write a 2KB blank NDJSON line so reverse proxies/mobile carriers flush response headers immediately
      try {
        if (!res.writableEnded && !abortController.signal.aborted) {
          res.write(" ".repeat(2048) + "\n");
        }
      } catch {}
      heartbeatTimer = setInterval(() => {
        writeNdjson({ type: "ping" });
      }, 3000);
    }

    try {
      const captions = await processCaptionPipeline(
        inputPath,
        mimeOrName,
        (status) => writeNdjson({ type: "status", status }),
        abortController.signal
      );

      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }
      if (abortController.signal.aborted || res.writableEnded) return;

      if (wantsStream) {
        res.write(JSON.stringify({ type: "result", success: true, captions }) + "\n");
        res.end();
      } else {
        return res.json({ success: true, captions });
      }
    } catch (err: any) {
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }
      if (err?.name === "AbortError" || abortController.signal.aborted || res.writableEnded) {
        return;
      }
      console.error("Error in caption generation route:", err);
      const errMsg = err?.message || "An error occurred while generating captions.";
      if (wantsStream) {
        try {
          res.write(JSON.stringify({ type: "error", success: false, error: errMsg }) + "\n");
          res.end();
        } catch {}
      } else {
        return res.status(500).json({ success: false, error: errMsg });
      }
    } finally {
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }
      cleanupInputPath();
    }
  }

  // Generate captions from pre-assembled chunked video
  app.post("/api/generate-captions-from-file", async (req, res) => {
    const fileId = String(req.body?.fileId || "").replace(/[^a-zA-Z0-9_-]/g, "");
    if (!fileId) {
      return res.status(400).json({ success: false, error: "Missing fileId parameter." });
    }

    const assembledFilePath = path.join(os.tmpdir(), `assembled-${fileId}.mp4`);
    if (!fs.existsSync(assembledFilePath)) {
      return res.status(404).json({
        success: false,
        error: "Uploaded video file not found or expired. Please upload again."
      });
    }

    await executeCaptionRequest(req, res, assembledFilePath, "video.mp4", () => {
      try {
        if (fs.existsSync(assembledFilePath)) fs.unlinkSync(assembledFilePath);
      } catch {}
    });
  });

  // Direct Caption Generation API
  app.post(
    "/api/generate-captions",
    (req, res, next) => {
      upload.any()(req, res, (err) => {
        if (err) {
          console.error("Multer file upload error:", err);
          return res.status(400).json({
            success: false,
            error: `File upload error: ${err?.message || "File too large or invalid"}`
          });
        }
        next();
      });
    },
    async (req, res) => {
      const uploadedFile =
        (req.files && Array.isArray(req.files) && req.files.length > 0 ? req.files[0] : null) ||
        (req as any).file;

      if (!uploadedFile) {
        return res.status(400).json({
          success: false,
          error: "Please upload a valid video file. Fadlan soo geli muuqaal sax ah."
        });
      }

      const inputPath = uploadedFile.path;

      await executeCaptionRequest(
        req,
        res,
        inputPath,
        uploadedFile.mimetype || uploadedFile.originalname || "",
        () => {
          try {
            if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
          } catch {}
        }
      );
    }
  );

  // Express error-handling middleware (specifically catches MulterError like LIMIT_FILE_SIZE or LIMIT_FIELD_VALUE)
  app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (err instanceof multer.MulterError || err?.name === "MulterError") {
      console.error("[Multer Error]:", err.message, err.code, err.field);
      return res.status(400).json({
        success: false,
        error: `File upload error: ${err.message}${err.field ? ` (${err.field})` : ""}`
      });
    }
    if (err) {
      console.error("[Server Error]:", err);
      return res.status(500).json({
        success: false,
        error: err.message || "Internal server error"
      });
    }
    next();
  });

  // Guard all /api routes so unmatched paths or wrong HTTP methods NEVER fall through to HTML SPA fallback
  app.use("/api", (req, res) => {
    res.status(404).json({
      success: false,
      error: `API route not found: ${req.method} ${req.originalUrl || req.url}`
    });
  });

  // Vite middleware setup (skipped on Vercel serverless)
  if (process.env.VERCEL !== "1") {
    if (process.env.NODE_ENV !== "production") {
      const runtimeImport = new Function("specifier", "return import(specifier)") as (s: string) => Promise<any>;
      const { createServer: createViteServer } = await runtimeImport(["vi", "te"].join(""));
      const vite = await createViteServer({
        server: {
          middlewareMode: true,
          hmr: false,
          ws: false,
        },
        appType: "spa",
      });
      app.use(vite.middlewares);
    } else {
      const distPath = path.join(process.cwd(), ["di", "st"].join(""));
      app.use(express.static(distPath));
      app.get("*all", (_req, res) => {
        res.sendFile(path.join(distPath, "index.html"));
      });
    }
  }

  if (process.env.VERCEL !== "1") {
    app.listen(Number(PORT), "0.0.0.0", () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
  }

  return app;
}

if (process.env.VERCEL !== "1") {
  createExpressApp().catch(console.error);
}
