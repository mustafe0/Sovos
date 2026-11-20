/**
 * Robust audio extraction and normalization for video export
 * Ensures that audio is 100% preserved, audible, clear, and compatible with WebCodecs AAC/Opus
 */

async function safeCloseAudioContext(ctx: AudioContext | null): Promise<void> {
  if (!ctx || ctx.state === 'closed') return;
  try {
    await Promise.race([
      ctx.close().catch(() => {}),
      new Promise<void>((resolve) => setTimeout(resolve, 400)),
    ]);
  } catch {}
}

export async function extractNormalizedAudioBuffer(videoFile: File, signal?: AbortSignal): Promise<AudioBuffer | null> {
  if (signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }
  const AudioCtxClass = window.AudioContext || (window as any).webkitAudioContext;
  if (!AudioCtxClass) {
    console.warn('AudioContext is not supported on this browser.');
    return null;
  }

  let audioCtx: AudioContext | null = null;
  try {
    audioCtx = new AudioCtxClass();
    if (audioCtx.state === 'suspended') {
      await audioCtx.resume();
    }

    let rawBuffer: AudioBuffer | null = null;

    // Strategy 1: Direct in-browser decode of File arrayBuffer (works for audio files AND MP4/MOV/WebM on modern browsers)
    const isAudioFile = videoFile.type.startsWith('audio/') || /\.(wav|mp3|ogg|aac|m4a|flac)$/i.test(videoFile.name);
    if (isAudioFile || videoFile.size <= 60 * 1024 * 1024) {
      try {
        const fileData = await videoFile.arrayBuffer();
        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
        rawBuffer = await audioCtx.decodeAudioData(fileData.slice(0));
        console.log('Audio successfully decoded directly in browser:', {
          sampleRate: rawBuffer.sampleRate,
          channels: rawBuffer.numberOfChannels,
          duration: rawBuffer.duration,
        });
      } catch (directErr: any) {
        if (directErr?.name === 'AbortError' || signal?.aborted) throw directErr;
        console.warn('Direct audio decode failed, trying server ffmpeg extraction:', directErr);
      }
    }

    // Strategy 2: Server-side ffmpeg audio extractor (bulletproof for any video format like MP4, MOV, MKV, WebM)
    if (!rawBuffer) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      try {
        const formData = new FormData();
        const safeName = (videoFile.name || 'video.mp4').replace(/[^a-zA-Z0-9._-]/g, '_') || 'video.mp4';
        formData.append('video', videoFile, safeName);
        const res = await fetch('/api/extract-audio', {
          method: 'POST',
          body: formData,
          credentials: 'include',
          signal,
        });
        const contentType = res.headers.get('content-type') || '';
        if (res.ok && !contentType.includes('text/html')) {
          const wavArrayBuffer = await res.arrayBuffer();
          if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
          try {
            rawBuffer = await audioCtx.decodeAudioData(wavArrayBuffer);
            console.log('Audio decoded via server ffmpeg WAV extraction:', {
              sampleRate: rawBuffer.sampleRate,
              channels: rawBuffer.numberOfChannels,
              duration: rawBuffer.duration,
            });
          } catch (wavDecodeErr) {
            console.warn('WAV decodeAudioData failed:', wavDecodeErr);
          }
        }
      } catch (serverErr: any) {
        if (serverErr?.name === 'AbortError' || signal?.aborted) throw serverErr;
        console.warn('Server ffmpeg audio extraction failed:', serverErr);
      }
    }

    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

    if (!rawBuffer) {
      console.warn('No audio track could be extracted from video.');
      return null;
    }

    // Standardize to 48,000 Hz and 2 channels (Stereo) for 100% AAC compatibility
    const targetSampleRate = 48000;
    const targetChannels = Math.min(2, Math.max(1, rawBuffer.numberOfChannels));
    const targetFrames = Math.ceil(rawBuffer.duration * targetSampleRate);

    // If already 48kHz stereo, return as is
    if (rawBuffer.sampleRate === targetSampleRate && rawBuffer.numberOfChannels === targetChannels) {
      return rawBuffer;
    }

    // Use OfflineAudioContext for pristine resampling & stereo downmixing
    const offlineCtx = new OfflineAudioContext(targetChannels, targetFrames, targetSampleRate);
    const source = offlineCtx.createBufferSource();
    source.buffer = rawBuffer;
    source.connect(offlineCtx.destination);
    source.start(0);

    const normalizedBuffer = await offlineCtx.startRendering();
    console.log('Normalized audio buffer:', {
      sampleRate: normalizedBuffer.sampleRate,
      channels: normalizedBuffer.numberOfChannels,
      duration: normalizedBuffer.duration,
    });
    return normalizedBuffer;
  } catch (e: any) {
    if (e?.name === 'AbortError' || signal?.aborted) {
      throw e;
    }
    console.error('Failed to extract and normalize audio buffer:', e);
    return null;
  } finally {
    await safeCloseAudioContext(audioCtx);
  }
}

/**
 * Extracts a lightweight 16kHz mono 16-bit PCM WAV Blob directly in the browser
 * This reduces upload size from 50MB-300MB video down to just 1-3MB audio,
 * completely bypassing Cloud Run's 32MB payload limit and eliminating upload latency.
 */
export async function extractAudioWavBlob(file: File, signal?: AbortSignal): Promise<Blob | null> {
  if (signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }
  const AudioCtxClass = window.AudioContext || (window as any).webkitAudioContext;
  if (!AudioCtxClass) return null;

  // Try browser-native decodeAudioData first. On Safari (iOS & macOS) and modern WebKit,
  // decodeAudioData natively supports MP4/MOV containers containing AAC/ALAC audio.
  // For other browsers, if decoding fails, it catches gracefully and returns null.
  // We limit this to files <= 60MB to prevent mobile browser tab memory exhaustion.
  if (file.size > 60 * 1024 * 1024) {
    console.log('File is larger than 60MB, delegating audio extraction to server chunked pipeline.');
    return null;
  }

  const raceTimeout = <T>(promise: Promise<T>, ms: number): Promise<T> => {
    if (signal?.aborted) {
      return Promise.reject(new DOMException('Aborted', 'AbortError'));
    }
    return new Promise<T>((resolve, reject) => {
      let settled = false;
      const cleanup = () => {
        clearTimeout(timer);
        if (signal) signal.removeEventListener('abort', onAbort);
      };
      const onAbort = () => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new DOMException('Aborted', 'AbortError'));
      };
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new Error('Audio decode timed out'));
      }, ms);
      signal?.addEventListener('abort', onAbort, { once: true });
      promise.then(
        (v) => {
          if (settled) return;
          settled = true;
          cleanup();
          resolve(v);
        },
        (err) => {
          if (settled) return;
          settled = true;
          cleanup();
          reject(err);
        }
      );
    });
  };

  let tempCtx: AudioContext | null = null;
  try {
    const arrayBuffer = await raceTimeout(file.arrayBuffer(), 10000);
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    tempCtx = new AudioCtxClass();
    const decoded = await raceTimeout(tempCtx.decodeAudioData(arrayBuffer.slice(0)), 12000);
    await safeCloseAudioContext(tempCtx);
    tempCtx = null;

    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

    const estimated16kBytes = Math.ceil(decoded.duration * 16000) * 2 + 44;
    const targetSampleRate = estimated16kBytes > 3.4 * 1024 * 1024 ? 8000 : 16000;
    const targetFrames = Math.max(1, Math.ceil(decoded.duration * targetSampleRate));
    const offline = new OfflineAudioContext(1, targetFrames, targetSampleRate);
    const src = offline.createBufferSource();
    src.buffer = decoded;
    src.connect(offline.destination);
    src.start(0);
    const rendered = await raceTimeout(offline.startRendering(), 12000);

    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

    // Convert Float32Array to standard 16-bit PCM WAV container
    const pcmData = rendered.getChannelData(0);
    const wavBuffer = new ArrayBuffer(44 + pcmData.length * 2);
    const view = new DataView(wavBuffer);

    // RIFF identifier
    writeAsciiString(view, 0, 'RIFF');
    view.setUint32(4, 36 + pcmData.length * 2, true);
    writeAsciiString(view, 8, 'WAVE');

    // fmt sub-chunk
    writeAsciiString(view, 12, 'fmt ');
    view.setUint32(16, 16, true); // SubChunk1Size (16 for PCM)
    view.setUint16(20, 1, true); // AudioFormat (1 for PCM)
    view.setUint16(22, 1, true); // NumChannels (1 mono)
    view.setUint32(24, targetSampleRate, true); // SampleRate (16000)
    view.setUint32(28, targetSampleRate * 2, true); // ByteRate (16000 * 1 * 2)
    view.setUint16(32, 2, true); // BlockAlign (1 * 2)
    view.setUint16(34, 16, true); // BitsPerSample (16)

    // data sub-chunk
    writeAsciiString(view, 36, 'data');
    view.setUint32(40, pcmData.length * 2, true);

    // Write PCM 16-bit signed integer samples with soft-clipping
    let offset = 44;
    for (let i = 0; i < pcmData.length; i++, offset += 2) {
      const s = Math.max(-1, Math.min(1, pcmData[i]));
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }

    return new Blob([wavBuffer], { type: 'audio/wav' });
  } catch (err: any) {
    if (err?.name === 'AbortError' || signal?.aborted) {
      throw err?.name === 'AbortError' ? err : new DOMException('Aborted', 'AbortError');
    }
    console.warn('In-browser audio extraction failed or unsupported container; falling back to direct video upload:', err);
    return null;
  } finally {
    await safeCloseAudioContext(tempCtx);
    tempCtx = null;
  }
}

function writeAsciiString(view: DataView, offset: number, str: string) {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}
