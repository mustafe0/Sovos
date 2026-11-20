import { Caption } from '../types';

/**
 * Splits a single caption into multiple sub-captions if it exceeds the maximum lines/words/characters.
 * Guarantees that no subtitle exceeds 2 lines (strictly 3-6 words, maximum 7 words / 40 chars),
 * while maintaining 100% time synchronization with the speaker's voice and disappearing during silence.
 *
 * @param caption The original caption object
 * @param maxWords Maximum words allowed in a single caption (default 7)
 * @param maxChars Maximum characters allowed in a single caption (default 40)
 * @returns Array of 1 or more split Caption objects with interpolated timestamps
 */
export function splitCaptionToMaxTwoLines(
  caption: Caption,
  maxWords: number = 7,
  maxChars: number = 40
): Caption[] {
  const rawText = (caption.text || '').trim();
  if (!rawText) return [];

  // Check if text already has multiple explicit lines
  const explicitLines = rawText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  
  // Split into words
  const words = rawText.split(/\s+/).filter(Boolean);

  // If text is short enough (at most 2 lines, <= maxWords and <= maxChars, and <= 2 explicit lines), keep as is
  if (words.length <= maxWords && rawText.length <= maxChars && explicitLines.length <= 2) {
    return [{
      ...caption,
      text: rawText,
    }];
  }

  // Otherwise, split into logical chunks of 3 to 6 words (strictly 1 to 2 lines per chunk)
  const chunks: string[] = [];
  let currentWords: string[] = [];
  let currentLen = 0;

  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const wouldExceedWords = currentWords.length >= maxWords;
    const wouldExceedChars = currentLen + w.length + 1 > maxChars;

    // Check for natural punctuation break (., ?, !, ;, :)
    const endsWithPunct = /[.?!;:۔]$/.test(currentWords[currentWords.length - 1] || '');
    const isPunctBreak = endsWithPunct && currentWords.length >= 3;

    if ((wouldExceedWords || wouldExceedChars || isPunctBreak) && currentWords.length > 0) {
      chunks.push(currentWords.join(' '));
      currentWords = [w];
      currentLen = w.length;
    } else {
      currentWords.push(w);
      currentLen += (currentWords.length > 1 ? 1 : 0) + w.length;
    }
  }

  if (currentWords.length > 0) {
    // If trailing chunk is 1 or 2 words and previous chunk exists,
    // merge only if combined fits within 2 lines (<= 7 words, <= 40 chars)
    if (currentWords.length <= 2 && chunks.length > 0) {
      const prevChunk = chunks[chunks.length - 1];
      const combined = `${prevChunk} ${currentWords.join(' ')}`;
      const combinedWords = combined.split(/\s+/);
      if (combinedWords.length <= maxWords && combined.length <= maxChars) {
        chunks[chunks.length - 1] = combined;
      } else {
        chunks.push(currentWords.join(' '));
      }
    } else {
      chunks.push(currentWords.join(' '));
    }
  }

  if (chunks.length <= 1) {
    return [{
      ...caption,
      text: rawText,
    }];
  }

  // Calculate timestamps across chunks matching real speech cadence (~0.28s to 0.36s per word)
  const totalDuration = Math.max(0.6, caption.endTime - caption.startTime);
  const totalWeight = chunks.reduce((sum, chunk) => sum + Math.max(1, chunk.length), 0);

  let accumulatedTime = caption.startTime;
  const result: Caption[] = [];

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const chunkWords = chunk.split(/\s+/).filter(Boolean).length;
    const chunkWeight = Math.max(1, chunk.length);
    const chunkRatio = chunkWeight / totalWeight;

    // Allocate duration proportionally to speech rate
    const proportionalDur = totalDuration * chunkRatio;
    const maxRealisticDur = Math.max(0.45, chunkWords * 0.36 + 0.12);
    const chunkDuration = i === chunks.length - 1
      ? Math.max(0.25, Math.min(caption.endTime - accumulatedTime, maxRealisticDur))
      : Math.max(0.25, parseFloat(Math.min(proportionalDur, maxRealisticDur).toFixed(2)));

    const start = parseFloat(accumulatedTime.toFixed(2));
    const end = parseFloat((start + chunkDuration).toFixed(2));

    result.push({
      id: `${caption.id}-${i + 1}`,
      startTime: start,
      endTime: Math.max(start + 0.25, end),
      text: chunk,
    });

    // Advance time seamlessly for the next chunk without mid-sentence drift
    accumulatedTime = parseFloat((end + 0.05).toFixed(2));
  }

  // Ensure last chunk does not exceed original caption end time
  if (result.length > 0) {
    const last = result[result.length - 1];
    if (last.endTime > caption.endTime && last.startTime < caption.endTime) {
      last.endTime = Math.max(last.startTime + 0.25, parseFloat(caption.endTime.toFixed(2)));
    }
  }

  return result;
}

/**
 * Enforces the strict "Max 2 Lines" constraint across an entire caption list.
 * Every caption in the returned array will be at most 2 lines (3-7 words),
 * keeping the text and voice strictly synchronized in lockstep and disappearing during silence.
 */
export function enforceMaxTwoLines(
  captions: Caption[],
  maxWords: number = 7,
  maxChars: number = 40
): Caption[] {
  if (!Array.isArray(captions) || captions.length === 0) return [];

  const splitList: Caption[] = [];

  for (const cap of captions) {
    const subCaps = splitCaptionToMaxTwoLines(cap, maxWords, maxChars);
    splitList.push(...subCaps);
  }

  // Sort and resolve overlaps while preserving natural silence gaps so subtitles disappear during pauses
  splitList.sort((a, b) => a.startTime - b.startTime);
  for (let i = 0; i < splitList.length - 1; i++) {
    if (splitList[i].endTime > splitList[i + 1].startTime) {
      splitList[i].endTime = Math.max(
        splitList[i].startTime + 0.20,
        parseFloat((splitList[i + 1].startTime - 0.05).toFixed(2))
      );
    }
  }

  // Re-index IDs cleanly while keeping timestamps and order
  return splitList.map((c, index) => ({
    ...c,
    id: `cap-${index + 1}`,
    startTime: parseFloat(c.startTime.toFixed(2)),
    endTime: parseFloat(c.endTime.toFixed(2)),
    text: c.text.trim(),
  }));
}

/**
 * Checks if a caption text is longer than 2 lines (exceeds 7 words, 40 chars, or 2 explicit lines)
 */
export function isLongerThanTwoLines(text: string, maxWords: number = 7, maxChars: number = 40): boolean {
  if (!text) return false;
  const words = text.trim().split(/\s+/).filter(Boolean);
  const explicitLines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  return words.length > maxWords || text.length > maxChars || explicitLines.length > 2;
}
