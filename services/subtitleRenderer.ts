import { StyleConfig } from '../types';

/**
 * Helper to draw a rounded rectangle on any HTML5 2D canvas context
 */
function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
) {
  ctx.beginPath();
  if (typeof (ctx as any).roundRect === 'function') {
    (ctx as any).roundRect(x, y, width, height, radius);
  } else {
    const r = Math.min(radius, width / 2, height / 2);
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + width - r, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + r);
    ctx.lineTo(x + width, y + height - r);
    ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
    ctx.lineTo(x + r, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }
}

/**
 * Splits text into 3 balanced parts (or respects existing \n lines)
 * Designed for viral 3-tier captions (Line 1 Serif, Line 2 Serif Blue, Line 3 Sans All-Caps)
 */
export function splitInto3Parts(text: string): string[] {
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
    // Like "Waxaan waa inaad istaaga ka kacdo" -> "Waxaan", "Waa inaad", "ISTAAGA KA KACDO"
    return [words[0], words.slice(1, 3).join(' '), words.slice(3).join(' ')];
  }
  // 7+ words: split into 3 parts
  const p1 = Math.max(1, Math.floor(words.length * 0.28));
  const p2 = Math.max(p1 + 1, Math.floor(words.length * 0.60));
  return [
    words.slice(0, p1).join(' '),
    words.slice(p1, p2).join(' '),
    words.slice(p2).join(' ')
  ];
}

/**
 * Normalizes background color to ensure black subtitle backgrounds are
 * semi-transparent within the professional 25%–35% opacity range (default 30% = rgba(0, 0, 0, 0.30)).
 */
export function getCleanSubtitleBgColor(style: StyleConfig): string {
  const bg = style.backgroundColor;
  if (!bg || bg === 'transparent' || bg === 'none') {
    return 'transparent';
  }

  const trimmed = bg.trim().toLowerCase();
  const isBlack =
    trimmed === '#000' ||
    trimmed === '#000000' ||
    trimmed === 'black' ||
    trimmed.startsWith('rgba(0, 0, 0') ||
    trimmed.startsWith('rgba(0,0,0') ||
    trimmed.startsWith('rgb(0, 0, 0') ||
    trimmed.startsWith('rgb(0,0,0');

  if (isBlack) {
    if (typeof style.backgroundOpacity === 'number' && style.backgroundOpacity >= 20 && style.backgroundOpacity <= 38) {
      return `rgba(0, 0, 0, ${(style.backgroundOpacity / 100).toFixed(2)})`;
    }
    const match = trimmed.match(/rgba\(\s*0\s*,\s*0\s*,\s*0\s*,\s*([0-9.]+)\s*\)/);
    if (match) {
      const alpha = parseFloat(match[1]);
      if (alpha >= 0.22 && alpha <= 0.38) {
        return `rgba(0, 0, 0, ${alpha.toFixed(2)})`;
      }
    }
    return 'rgba(0, 0, 0, 0.30)';
  }

  return bg;
}

/**
 * Draws professional, styled captions onto any HTML5 2D Canvas.
 * Supports:
 * - 3-tier staggered reveal (Preset 6: Line 1 White Serif, Line 2 Blue Serif, Line 3 White All-Caps Sans)
 * - Progressive sequential appearance (earlier words/lines appear first, followed by second and third)
 * - Dynamic font scaling, rounded pill backgrounds, strokes/outlines, and shadows.
 */
export function drawStyledCaption(
  ctx: CanvasRenderingContext2D,
  rawText: string,
  style: StyleConfig,
  width: number,
  height: number,
  refWidth: number = width,
  currentTime?: number,
  captionStartTime?: number,
  captionEndTime?: number
) {
  if (!rawText || rawText.trim() === '') return;

  const isPresetViral = style.presetId === 'preset-viral' || style.presetId === 'preset-6-waxaan-waa-inaad';
  const scale = width / Math.max(1, refWidth);
  let fontSize = Math.max(16, (style.fontSize || (isPresetViral ? 52 : 42)) * scale);

  ctx.save();

  // Primary font configuration
  const primaryFontFamily = style.fontFamily || (isPresetViral ? 'Playfair Display' : 'Plus Jakarta Sans');
  const tertiaryFontFamily = style.tier3FontFamily || 'Outfit';
  const fontWeight = style.fontWeight || '800';
  const fontStyle = style.fontStyle || 'normal';

  const applyPrimaryFont = (size: number) => {
    ctx.font = `${fontStyle} ${fontWeight} ${size}px "${primaryFontFamily}", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`;
  };

  const applyTertiaryFont = (size: number) => {
    ctx.font = `normal 900 ${size}px "${tertiaryFontFamily}", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`;
  };

  applyPrimaryFont(fontSize);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // Position calculation
  const x = width / 2;
  const defaultY = isPresetViral ? 78 : 84;
  const yPercentage = typeof style.yPosition === 'number' ? style.yPosition : defaultY;
  const y = height * (yPercentage / 100);

  // Determine lines
  let lines: string[] = [];

  if (isPresetViral) {
    // 3-Part viral structure: Line 1, Line 2, Line 3
    lines = splitInto3Parts(rawText);
  } else {
    // Standard multi-line wrapping
    const text = style.isUppercase ? rawText.toUpperCase() : rawText;
    const maxLineWidth = width * 0.84;

    const getWrappedLines = (testFontSize: number): string[] => {
      applyPrimaryFont(testFontSize);
      const rawParagraphs = text.trim().split(/\r?\n/);
      const wrapped: string[] = [];

      for (const paragraph of rawParagraphs) {
        const words = paragraph.trim().split(/\s+/).filter(Boolean);
        let currentLine = '';

        for (let n = 0; n < words.length; n++) {
          const testLine = currentLine ? `${currentLine} ${words[n]}` : words[n];
          const metrics = ctx.measureText(testLine);
          if (metrics.width > maxLineWidth && currentLine) {
            wrapped.push(currentLine);
            currentLine = words[n];
          } else {
            currentLine = testLine;
          }
        }
        if (currentLine) {
          wrapped.push(currentLine);
        }
      }
      return wrapped;
    };

    lines = getWrappedLines(fontSize);

    const minAllowedFontSize = Math.max(14, fontSize * 0.65);
    while (lines.length > 2 && fontSize > minAllowedFontSize) {
      fontSize = Math.max(minAllowedFontSize, fontSize - 2);
      lines = getWrappedLines(fontSize);
    }

    if (lines.length > 2) {
      const allWords = text.trim().split(/\s+/).filter(Boolean);
      const half = Math.ceil(allWords.length / 2);
      lines = [allWords.slice(0, half).join(' '), allWords.slice(half).join(' ')];
      applyPrimaryFont(fontSize);
    }
  }

  // Calculate progressive sequential reveal count (Kala Horeyn)
  let visibleCount = lines.length;
  const isProgressive = style.progressiveReveal ?? isPresetViral;

  if (
    isProgressive &&
    typeof currentTime === 'number' &&
    typeof captionStartTime === 'number' &&
    typeof captionEndTime === 'number' &&
    captionEndTime > captionStartTime
  ) {
    const duration = captionEndTime - captionStartTime;
    const progress = Math.max(0, Math.min(1, (currentTime - captionStartTime) / duration));

    if (lines.length === 3) {
      if (progress < 0.30) {
        visibleCount = 1;
      } else if (progress < 0.62) {
        visibleCount = 2;
      } else {
        visibleCount = 3;
      }
    } else if (lines.length === 2) {
      if (progress < 0.45) {
        visibleCount = 1;
      } else {
        visibleCount = 2;
      }
    } else {
      visibleCount = 1;
    }
  }

  const lineHeight = fontSize * (isPresetViral ? 1.22 : 1.28);
  const totalTextHeight = lines.length * lineHeight;

  const getLineCenterY = (i: number): number => {
    if (isPresetViral) {
      if (lines.length === 3) {
        if (i === 0) return y - fontSize * 1.08;
        if (i === 1) return y + fontSize * 0.08;
        return y + fontSize * 1.05;
      } else if (lines.length === 2) {
        if (i === 0) return y - fontSize * 0.58;
        return y + fontSize * 0.58;
      } else {
        return y;
      }
    } else {
      return y - (totalTextHeight / 2) + (i + 0.5) * lineHeight;
    }
  };

  // Measure exact width and vertical center for each line
  const lineMetrics: Array<{ text: string; width: number; y: number }> = [];
  lines.forEach((l, idx) => {
    let w = 0;
    if (isPresetViral) {
      if (idx === 0) {
        applyPrimaryFont(fontSize * 1.25);
        w = ctx.measureText(l).width;
      } else if (idx === 1) {
        applyPrimaryFont(fontSize * 1.00);
        w = ctx.measureText(l).width;
      } else if (idx === 2) {
        applyTertiaryFont(fontSize * 0.72);
        w = ctx.measureText(l.toUpperCase()).width;
      }
      applyPrimaryFont(fontSize);
    } else {
      applyPrimaryFont(fontSize);
      const txt = style.isUppercase ? l.toUpperCase() : l;
      w = ctx.measureText(txt).width;
    }
    lineMetrics.push({ text: l, width: w, y: getLineCenterY(idx) });
  });

  // Clean, tight padding around the text (strictly hugs the caption size without covering excessive video)
  const padX = Math.round(Math.max(8, Math.min(22 * scale, (style.padding ? style.padding * 0.85 : 12) * scale)));
  const padY = Math.round(Math.max(4, Math.min(12 * scale, (style.padding ? style.padding * 0.40 : 6) * scale)));
  const cornerRadius = Math.round(Math.max(6, Math.min(16 * scale, (style.cornerRadius ? style.cornerRadius * 0.75 : 10) * scale)));

  // Draw background pill if configured
  const activeBgColor = getCleanSubtitleBgColor(style);
  if (activeBgColor && activeBgColor !== 'transparent') {
    ctx.save();
    ctx.fillStyle = activeBgColor;

    if (style.backgroundType === 'glass') {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
      ctx.lineWidth = 1.2 * scale;
      const maxW = Math.max(...lineMetrics.slice(0, visibleCount).map((m) => m.width));
      const boxW = Math.min(width * 0.94, maxW + padX * 2);
      const boxH = visibleCount * lineHeight + padY * 2;
      const boxX = x - boxW / 2;
      const boxY = lineMetrics[0].y - fontSize * 0.6 - padY;
      drawRoundedRect(ctx, boxX, boxY, boxW, boxH, cornerRadius);
      ctx.fill();
      ctx.stroke();
    } else {
      // Modern professional rounded capsule:
      // Strictly follows the width of the text so it never forms an oversized box
      ctx.beginPath();
      for (let i = 0; i < visibleCount; i++) {
        const m = lineMetrics[i];
        const lineBoxW = Math.min(width * 0.94, m.width + padX * 2);
        const lineBoxH = fontSize * 1.18 + padY * 2;
        const lineBoxX = x - lineBoxW / 2;
        const lineBoxY = m.y - lineBoxH / 2;
        drawRoundedRect(ctx, lineBoxX, lineBoxY, lineBoxW, lineBoxH, cornerRadius);
      }
      ctx.fill();
    }
    ctx.restore();
  }

  // Draw shadow / glow
  const hasShadow = style.shadowBlur !== 0;
  if (hasShadow) {
    ctx.shadowColor = 'rgba(0, 0, 0, 0.92)';
    ctx.shadowBlur = (style.shadowBlur || (isPresetViral ? 8 : 4)) * scale;
    ctx.shadowOffsetX = 1.4 * scale;
    ctx.shadowOffsetY = 2.4 * scale;
  } else {
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
  }

  // Check if karaoke / word-by-word animation is active
  const isKaraoke = style.animation === 'karaoke' || style.animation === 'word-by-word' || style.presetId === 'preset-karaoke';
  let totalWordCount = 0;
  const linesWords = lines.map(l => l.split(/\s+/).filter(Boolean));
  linesWords.forEach(w => { totalWordCount += w.length; });

  let globalActiveWordIndex = -1;
  if (
    isKaraoke &&
    typeof currentTime === 'number' &&
    typeof captionStartTime === 'number' &&
    typeof captionEndTime === 'number' &&
    captionEndTime > captionStartTime &&
    totalWordCount > 0
  ) {
    const elapsed = Math.max(0, currentTime - captionStartTime);
    const duration = captionEndTime - captionStartTime;
    const progress = Math.min(1, Math.max(0, elapsed / duration));
    globalActiveWordIndex = Math.min(totalWordCount - 1, Math.floor(progress * totalWordCount));
  }

  let currentWordCounter = 0;

  // Render each line in its dedicated slot (stable position, sequential reveal)
  lines.forEach((rawLineText, i) => {
    // Only render lines up to visibleCount (progressive reveal)
    if (i >= visibleCount) return;

    const lineY = lineMetrics[i]?.y ?? getLineCenterY(i);

    let lineFont = primaryFontFamily;
    let lineSize = fontSize;
    let lineTextColor = style.textColor || '#FFFFFF';
    let lineText = rawLineText;

    if (isPresetViral) {
      if (i === 0) {
        // Line 1: Largest size, Color Madow (Black)
        lineFont = style.fontFamily || 'Playfair Display';
        lineSize = fontSize * 1.25;
        lineTextColor = style.textColor || '#000000';
        lineText = rawLineText;
        applyPrimaryFont(lineSize);
      } else if (i === 1) {
        // Line 2: Medium size, Color Blue / Buluug
        lineFont = style.fontFamily || 'Playfair Display';
        lineSize = fontSize * 1.00;
        lineTextColor = style.secondaryTextColor || '#0084FF';
        lineText = rawLineText;
        applyPrimaryFont(lineSize);
      } else if (i === 2) {
        // Line 3: Smallest size, Color Madow (Black) All-Caps
        lineFont = tertiaryFontFamily;
        lineSize = fontSize * 0.72;
        lineTextColor = style.tier3TextColor || '#000000';
        lineText = rawLineText.toUpperCase();
        applyTertiaryFont(lineSize);
      }
    } else {
      // Standard styles
      if (i === 1 && style.secondaryTextColor && style.secondaryTextColor !== 'transparent') {
        lineTextColor = style.secondaryTextColor;
      }
      applyPrimaryFont(fontSize);
    }

    // High contrast stroke outline
    const strokeW = style.textStrokeWidth ?? (isPresetViral ? 5.0 : 2);
    const strokeColor = style.textStrokeColor || (isPresetViral ? '#FFFFFF' : '#000000');

    if (isKaraoke && !isPresetViral) {
      // Word-by-word / Karaoke rendering: compute word positions and highlight active word
      const words = linesWords[i] || [];
      const spaceWidth = ctx.measureText(' ').width;
      const wordMetrics = words.map(w => ({ word: w, width: ctx.measureText(w).width }));
      const totalLineWidth = wordMetrics.reduce((acc, curr) => acc + curr.width, 0) + (words.length - 1) * spaceWidth;
      let startWordX = x - totalLineWidth / 2;

      words.forEach((word, wIdx) => {
        const isCurrentActive = currentWordCounter === globalActiveWordIndex;
        const wordWidth = wordMetrics[wIdx].width;
        const wordCenterX = startWordX + wordWidth / 2;
        const wordColor = isCurrentActive ? (style.highlightColor || '#FFE600') : lineTextColor;

        if (strokeW > 0 && strokeColor !== 'transparent') {
          ctx.save();
          ctx.strokeStyle = strokeColor;
          ctx.lineWidth = Math.max(2.5, strokeW * scale * 1.85);
          ctx.lineJoin = 'round';
          ctx.lineCap = 'round';
          ctx.miterLimit = 2;
          ctx.strokeText(word, wordCenterX, lineY);
          ctx.restore();
        }

        ctx.save();
        ctx.fillStyle = wordColor;
        ctx.fillText(word, wordCenterX, lineY);
        ctx.restore();

        startWordX += wordWidth + spaceWidth;
        currentWordCounter++;
      });
    } else {
      // Standard full line rendering
      if (strokeW > 0 && strokeColor !== 'transparent') {
        ctx.save();
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = Math.max(2.5, strokeW * scale * 1.85);
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.miterLimit = 2;
        ctx.strokeText(lineText, x, lineY);
        ctx.restore();
      }

      // Fill crisp text
      ctx.fillStyle = lineTextColor;
      ctx.fillText(lineText, x, lineY);
    }
  });

  ctx.restore();
}

export interface SubtitleOverlayFrame {
  id?: string;
  startTime: number;
  endTime: number;
  overlayDataUrl: string;
}

/**
 * Generates transparent high-resolution PNG overlay frames for each subtitle,
 * rendered using the exact same canvas drawStyledCaption engine as the in-app preview.
 * This guarantees 100% visual parity (rounded corner pills, subtle rgba background,
 * custom Google fonts, outlines, and drop shadows) between the app preview and downloaded video.
 */
export async function generateSubtitleOverlays(
  captions: Array<{ id?: string; startTime: number; endTime: number; text: string }>,
  style: StyleConfig,
  targetWidth: number,
  targetHeight: number
): Promise<SubtitleOverlayFrame[]> {
  if (!captions || captions.length === 0) return [];

  // Wait for Google Fonts to ensure typography is loaded before drawing
  if (typeof document !== 'undefined' && (document as any).fonts?.ready) {
    try {
      await (document as any).fonts.ready;
    } catch {}
  }

  let renderWidth = targetWidth || 1280;
  let renderHeight = targetHeight || 720;
  // Normalize resolution to prevent excessive memory on 4K videos while keeping crisp HD 1080p
  const maxDim = 1920;
  if (Math.max(renderWidth, renderHeight) > maxDim) {
    const scaleFactor = maxDim / Math.max(renderWidth, renderHeight);
    renderWidth = Math.round(renderWidth * scaleFactor);
    renderHeight = Math.round(renderHeight * scaleFactor);
  }
  renderWidth = Math.round(renderWidth / 2) * 2;
  renderHeight = Math.round(renderHeight / 2) * 2;

  const canvas = document.createElement('canvas');
  canvas.width = renderWidth;
  canvas.height = renderHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) return [];

  const overlays: SubtitleOverlayFrame[] = [];
  const isPresetViral = style.presetId === 'preset-viral' || style.presetId === 'preset-6-waxaan-waa-inaad';
  const isProgressive = style.progressiveReveal ?? isPresetViral;
  const isKaraoke = style.animation === 'karaoke' || style.animation === 'word-by-word' || style.presetId === 'preset-karaoke';

  for (const cap of captions) {
    if (!cap.text || cap.text.trim() === '') continue;
    const dur = cap.endTime - cap.startTime;
    if (dur <= 0) continue;

    const lines = isPresetViral ? splitInto3Parts(cap.text) : [cap.text];

    // Case 1: Karaoke / Word-by-word active highlight (Yellow active word moves with speech)
    if (isKaraoke) {
      const words = cap.text.trim().split(/\s+/).filter(Boolean);
      const totalWords = words.length;

      if (totalWords > 1) {
        for (let w = 0; w < totalWords; w++) {
          const wStart = parseFloat((cap.startTime + (w / totalWords) * dur).toFixed(3));
          const wEnd = parseFloat((cap.startTime + ((w + 1) / totalWords) * dur).toFixed(3));
          const midTime = (wStart + wEnd) / 2;

          ctx.clearRect(0, 0, renderWidth, renderHeight);
          drawStyledCaption(
            ctx,
            cap.text,
            style,
            renderWidth,
            renderHeight,
            renderWidth,
            midTime,
            cap.startTime,
            cap.endTime
          );
          overlays.push({
            id: `${cap.id || 'cap'}_w${w}`,
            startTime: wStart,
            endTime: wEnd,
            overlayDataUrl: canvas.toDataURL('image/png'),
          });
        }
      } else {
        // Single word caption
        ctx.clearRect(0, 0, renderWidth, renderHeight);
        drawStyledCaption(
          ctx,
          cap.text,
          style,
          renderWidth,
          renderHeight,
          renderWidth,
          (cap.startTime + cap.endTime) / 2,
          cap.startTime,
          cap.endTime
        );
        overlays.push({
          id: cap.id,
          startTime: cap.startTime,
          endTime: cap.endTime,
          overlayDataUrl: canvas.toDataURL('image/png'),
        });
      }
    } else if (isProgressive && lines.length > 1) {
      // Case 2: Progressive Reveal (e.g. Viral / Line-by-line)
      if (lines.length === 3) {
        // Step 1: Line 1
        const t1 = parseFloat((cap.startTime + dur * 0.30).toFixed(2));
        ctx.clearRect(0, 0, renderWidth, renderHeight);
        drawStyledCaption(ctx, cap.text, style, renderWidth, renderHeight, renderWidth, cap.startTime, cap.startTime, cap.endTime);
        overlays.push({
          id: `${cap.id}_s1`,
          startTime: cap.startTime,
          endTime: t1,
          overlayDataUrl: canvas.toDataURL('image/png'),
        });

        // Step 2: Lines 1 & 2
        const t2 = parseFloat((cap.startTime + dur * 0.62).toFixed(2));
        ctx.clearRect(0, 0, renderWidth, renderHeight);
        drawStyledCaption(ctx, cap.text, style, renderWidth, renderHeight, renderWidth, (t1 + t2) / 2, cap.startTime, cap.endTime);
        overlays.push({
          id: `${cap.id}_s2`,
          startTime: t1,
          endTime: t2,
          overlayDataUrl: canvas.toDataURL('image/png'),
        });

        // Step 3: Lines 1, 2 & 3
        ctx.clearRect(0, 0, renderWidth, renderHeight);
        drawStyledCaption(ctx, cap.text, style, renderWidth, renderHeight, renderWidth, cap.endTime - 0.05, cap.startTime, cap.endTime);
        overlays.push({
          id: `${cap.id}_s3`,
          startTime: t2,
          endTime: cap.endTime,
          overlayDataUrl: canvas.toDataURL('image/png'),
        });
      } else if (lines.length === 2) {
        const t1 = parseFloat((cap.startTime + dur * 0.45).toFixed(2));
        // Step 1: Line 1
        ctx.clearRect(0, 0, renderWidth, renderHeight);
        drawStyledCaption(ctx, cap.text, style, renderWidth, renderHeight, renderWidth, cap.startTime, cap.startTime, cap.endTime);
        overlays.push({
          id: `${cap.id}_s1`,
          startTime: cap.startTime,
          endTime: t1,
          overlayDataUrl: canvas.toDataURL('image/png'),
        });

        // Step 2: Line 1 & 2
        ctx.clearRect(0, 0, renderWidth, renderHeight);
        drawStyledCaption(ctx, cap.text, style, renderWidth, renderHeight, renderWidth, cap.endTime - 0.05, cap.startTime, cap.endTime);
        overlays.push({
          id: `${cap.id}_s2`,
          startTime: t1,
          endTime: cap.endTime,
          overlayDataUrl: canvas.toDataURL('image/png'),
        });
      }
    } else {
      // Case 3: Standard single state for full duration (Exact match for default & all styling presets)
      ctx.clearRect(0, 0, renderWidth, renderHeight);
      drawStyledCaption(
        ctx,
        cap.text,
        style,
        renderWidth,
        renderHeight,
        renderWidth,
        (cap.startTime + cap.endTime) / 2,
        cap.startTime,
        cap.endTime
      );
      overlays.push({
        id: cap.id,
        startTime: cap.startTime,
        endTime: cap.endTime,
        overlayDataUrl: canvas.toDataURL('image/png'),
      });
    }
  }

  return overlays;
}

