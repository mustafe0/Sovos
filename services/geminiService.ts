import { Caption } from "../types";
import { extractAudioWavBlob } from "./audioHelper";
import { 
  appFetch, 
  ensureStorageAccess, 
  isCookieCheckHtml, 
  isCookieBlockedError, 
  isInIframe, 
  setClientTestCookie 
} from "./apiClient";

function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    return Promise.reject(new DOMException("Aborted", "AbortError"));
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (signal) signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

// Helper: Resilient fetch with factory-support, per-attempt timeout, and safe retries
async function resilientFetch(
  url: string,
  optionsFactory: RequestInit | (() => RequestInit | Promise<RequestInit>),
  retries = 2,
  delayMs = 800,
  signal?: AbortSignal,
  timeoutMs = 45000
): Promise<Response> {
  let lastError: any = null;
  for (let i = 0; i <= retries; i++) {
    if (signal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }

    const attemptController = new AbortController();
    let timedOut = false;
    const onExternalAbort = () => attemptController.abort();
    signal?.addEventListener("abort", onExternalAbort, { once: true });
    const attemptTimer = setTimeout(() => {
      timedOut = true;
      attemptController.abort();
    }, timeoutMs);

    try {
      setClientTestCookie();
      const rawOpts = typeof optionsFactory === "function" ? await optionsFactory() : optionsFactory;
      const opts: RequestInit = {
        ...rawOpts,
        signal: attemptController.signal,
      };

      const res = await fetch(url, opts);
      clearTimeout(attemptTimer);
      signal?.removeEventListener("abort", onExternalAbort);

      // Check if server redirected or returned an HTML page (API routes NEVER return HTML)
      const contentType = res.headers.get("content-type") || "";
      const isHtml = contentType.includes("text/html");
      const isCookieUrl = Boolean(res.url && (res.url.includes("cookie_check") || res.url.includes("__cookie_check.html")));

      if (isHtml || isCookieUrl) {
        const clone = res.clone();
        const htmlText = await clone.text().catch(() => "");
        const isCookieCheck = isCookieCheckHtml(htmlText, res.url) || /cookie\s*check/i.test(htmlText);

        if (isCookieCheck || isHtml) {
          console.warn(`[Network] Iframe cookie check detected on attempt ${i + 1}`);
          if (i < retries) {
            await ensureStorageAccess();
            await abortableDelay(delayMs, signal);
            delayMs = Math.round(delayMs * 1.5);
            continue;
          }
          const cookieErr = new Error(
            "Browser-kaagu wuxuu xannibayaa cookies-ka amniga ee preview-ga iframe-ka. Fadlan app-ka ku fur Daaqad Cusub (Open in New Tab) ama riix 'Oggolow Cookies'."
          );
          (cookieErr as any).isCookieBlocked = true;
          throw cookieErr;
        }
      }

      // Retry on temporary proxy/server glitches (502, 503, 504)
      if ((res.status === 502 || res.status === 503 || res.status === 504) && i < retries) {
        console.warn(`[Network] Server returned ${res.status} for ${url}. Retrying in ${delayMs}ms... (attempt ${i + 1}/${retries})`);
        await abortableDelay(delayMs, signal);
        delayMs = Math.round(delayMs * 1.5);
        continue;
      }
      return res;
    } catch (err: any) {
      clearTimeout(attemptTimer);
      signal?.removeEventListener("abort", onExternalAbort);

      if (signal?.aborted) {
        throw new DOMException("Aborted", "AbortError");
      }

      if (timedOut) {
        const timeoutErr = new Error("Codsigu wuu daahay (Request timeout). Fadlan iskuday markale.");
        lastError = timeoutErr;
        if (i < retries && timeoutMs <= 60000) {
          console.warn(`[Network] Request to ${url} timed out after ${timeoutMs}ms. Retrying...`);
          await abortableDelay(delayMs, signal);
          delayMs = Math.round(delayMs * 1.5);
          continue;
        }
        throw timeoutErr;
      }

      if (err?.name === "AbortError") {
        throw err;
      }

      lastError = err;
      if (err?.isCookieBlocked) {
        throw err;
      }

      const isNetworkErr =
        err?.name === "TypeError" ||
        err?.message?.includes("Load failed") ||
        err?.message?.includes("Failed to fetch") ||
        err?.message?.includes("NetworkError") ||
        err?.message?.includes("network");

      if (isNetworkErr && i < retries) {
        console.warn(`[Network] Fetch to ${url} failed (${err.message}). Retrying in ${delayMs}ms... (attempt ${i + 1}/${retries})`);
        await abortableDelay(delayMs, signal);
        delayMs = Math.round(delayMs * 1.5);
        continue;
      }
      throw err;
    }
  }
  throw lastError;
}

async function readCaptionResponse(
  response: Response,
  onProgress?: (status: string) => void,
  signal?: AbortSignal
): Promise<{ data: any; responseText: string }> {
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/x-ndjson") && response.body) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let finalData: any = null;

    const readNextChunkWithIdleTimeout = () => {
      return new Promise<ReadableStreamReadResult<Uint8Array>>((resolve, reject) => {
        if (signal?.aborted) {
          reject(new DOMException("Aborted", "AbortError"));
          return;
        }
        let settled = false;
        const cleanup = () => {
          clearTimeout(idleTimer);
          signal?.removeEventListener("abort", onAbort);
        };
        const onAbort = () => {
          if (settled) return;
          settled = true;
          cleanup();
          try { reader.cancel(); } catch {}
          reject(new DOMException("Aborted", "AbortError"));
        };
        const idleTimer = setTimeout(() => {
          if (settled) return;
          settled = true;
          cleanup();
          try { reader.cancel(); } catch {}
          reject(new Error("Xiriirka server-ka ayaa daahay (Stream timeout). Fadlan iskuday markale."));
        }, 45000);

        signal?.addEventListener("abort", onAbort, { once: true });

        reader.read().then(
          (res) => {
            if (settled) return;
            settled = true;
            cleanup();
            resolve(res);
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

    try {
      while (true) {
        const { done, value } = await readNextChunkWithIdleTimeout();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const rawLine of lines) {
          const line = rawLine.trim();
          if (!line) continue;
          try {
            const event = JSON.parse(line);
            if (event.type === "status" && event.status) {
              onProgress?.(String(event.status));
            } else if (event.type === "result") {
              finalData = event;
            } else if (event.type === "error") {
              throw new Error(event.error || "An error occurred while generating captions.");
            }
          } catch (lineErr: any) {
            if (lineErr instanceof SyntaxError) {
              // ignore partial/malformed heartbeat line
            } else {
              throw lineErr;
            }
          }
        }
      }
      if (buffer.trim()) {
        try {
          const event = JSON.parse(buffer.trim());
          if (event.type === "result") finalData = event;
          else if (event.type === "error") throw new Error(event.error || "An error occurred while generating captions.");
        } catch (tailErr: any) {
          if (!(tailErr instanceof SyntaxError)) throw tailErr;
        }
      }
    } finally {
      try { reader.releaseLock(); } catch {}
    }

    if (finalData) {
      return { data: finalData, responseText: JSON.stringify(finalData) };
    }
    return { data: null, responseText: "" };
  }

  const responseText = await response.text();
  let data: any = null;
  try {
    data = JSON.parse(responseText);
  } catch {
    // Not valid JSON
  }
  return { data, responseText };
}

export const generateCaptions = async (
  videoFile: File,
  onProgress?: (status: string) => void,
  signal?: AbortSignal
): Promise<Caption[]> => {
  if (!videoFile) {
    throw new Error("Please select a video file first.");
  }

  try {
    if (signal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }
    onProgress?.("Acoustic analysis...");

    // 1. Try extracting a lightweight WAV directly in browser first if file is <= 60MB.
    // This reduces video files down to ~1-3.4MB audio, ensuring fast uploads even on Vercel.
    let audioBlob: Blob | null = null;
    if (videoFile.size <= 60 * 1024 * 1024) {
      try {
        audioBlob = await extractAudioWavBlob(videoFile, signal);
      } catch (extractErr: any) {
        if (extractErr?.name === "AbortError" || signal?.aborted) {
          throw extractErr;
        }
        console.warn("Client-side audio extraction skipped:", extractErr);
      }
    }

    if (signal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }

    let response: Response;

    // 2. If audio was extracted or video file is small (<= 3.8MB, safe for Vercel 4.5MB limit), send directly
    if (audioBlob && audioBlob.size > 1000 && audioBlob.size <= 4 * 1024 * 1024) {
      console.log(`Sending extracted audio directly (${(audioBlob.size / 1024 / 1024).toFixed(2)} MB)`);
      onProgress?.("Uploading audio track...");

      response = await resilientFetch("/api/generate-captions?stream=1", () => {
        const formData = new FormData();
        formData.append("video", audioBlob!, "audio.wav");
        return {
          method: "POST",
          body: formData,
        };
      }, 1, 900, signal, 120000);
    } else if (videoFile.size <= 3.8 * 1024 * 1024) {
      console.log(`Sending small video directly (${(videoFile.size / 1024 / 1024).toFixed(2)} MB)`);
      onProgress?.("Uploading video...");

      const safeName = (videoFile.name || "video.mp4").replace(/[^a-zA-Z0-9._-]/g, "_") || "video.mp4";
      response = await resilientFetch("/api/generate-captions?stream=1", () => {
        const formData = new FormData();
        formData.append("video", videoFile, safeName);
        return {
          method: "POST",
          body: formData,
        };
      }, 1, 900, signal, 120000);
    } else {
      // 3. For larger video files (supports up to 1GB = 1024MB),
      // use Chunked Upload (2.5MB chunks) to safely bypass proxy/serverless payload limits.
      console.log(`Video size (${(videoFile.size / 1024 / 1024).toFixed(2)} MB) uploading in 2.5MB chunks...`);
      const CHUNK_SIZE = Math.floor(2.5 * 1024 * 1024);
      const totalChunks = Math.ceil(videoFile.size / CHUNK_SIZE);
      const fileId = `up_${Date.now()}_${Math.random().toString(36).substring(7)}`;

      for (let i = 0; i < totalChunks; i++) {
        if (signal?.aborted) {
          throw new DOMException("Aborted", "AbortError");
        }
        const start = i * CHUNK_SIZE;
        const end = Math.min(videoFile.size, start + CHUNK_SIZE);
        const chunkBlob = videoFile.slice(start, end);

        const pct = Math.round(((i + 1) / totalChunks) * 100);
        onProgress?.(`Uploading video (${pct}%)...`);

        const chunkRes = await resilientFetch("/api/upload-chunk", () => {
          const chunkData = new FormData();
          chunkData.append("fileId", fileId);
          chunkData.append("chunkIndex", String(i));
          chunkData.append("totalChunks", String(totalChunks));
          chunkData.append("chunk", chunkBlob, `chunk_${i}`);
          return {
            method: "POST",
            body: chunkData,
          };
        }, 2, 900, signal, 60000);

        if (!chunkRes.ok) {
          const chunkErrText = await chunkRes.text();
          throw new Error(`Chunk upload failed (${chunkRes.status}): ${chunkErrText}`);
        }
      }

      if (signal?.aborted) {
        throw new DOMException("Aborted", "AbortError");
      }

      onProgress?.("Extracting speech audio...");
      response = await resilientFetch("/api/generate-captions-from-file?stream=1", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ fileId }),
      }, 1, 1000, signal, 120000);
    }

    if (signal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }

    const { data, responseText } = await readCaptionResponse(response, onProgress, signal);

    // Check if server returned an HTML page (e.g. gateway error, 413, or cookie check page)
    if (!data && responseText && (responseText.trim().startsWith("<!DOCTYPE") || responseText.includes("<html"))) {
      const titleMatch = responseText.match(/<title>([^<]+)<\/title>/i);
      const title = titleMatch ? titleMatch[1].trim() : "Gateway / Proxy response";

      if (
        title.toLowerCase().includes("cookie") ||
        isCookieCheckHtml(responseText, response.url) ||
        /cookie\s*check/i.test(responseText)
      ) {
        const cookieErr = new Error(
          "Browser-kaagu wuxuu xannibay cookies-ka amniga ee preview-ga iframe-ka. Fadlan app-ka ku fur Daaqad Cusub (Open in New Tab) ama riix 'Oggolow Cookies'."
        );
        (cookieErr as any).isCookieBlocked = true;
        throw cookieErr;
      }

      if (response.status === 413 || title.toLowerCase().includes("large")) {
        throw new Error("Video file is too large for direct transfer. Please try a shorter clip or modern browser.");
      }
      if (response.status === 504 || title.toLowerCase().includes("timeout")) {
        throw new Error("Server took too long to respond (504 Gateway Timeout). Please try again in a few moments.");
      }
      throw new Error(`Server notice: ${title}. Please check your connection and retry.`);
    }

    if (!response.ok) {
      let errMsg = data?.error;
      if (!errMsg) {
        if (typeof responseText === "string" && responseText.trim().length > 0 && responseText.length < 250) {
          errMsg = responseText.trim();
        } else {
          errMsg = `Server error (${response.status}). Please try again.`;
        }
      }

      if (typeof errMsg === "string") {
        try {
          const nested = JSON.parse(errMsg);
          if (nested?.error?.message) {
            errMsg = nested.error.message;
          }
        } catch {
          // not nested JSON
        }
      }

      if (errMsg.includes("429") || errMsg.includes("RESOURCE_EXHAUSTED") || errMsg.includes("quota")) {
        if (errMsg.includes("per day") || errMsg.includes("limit exceeded")) {
          errMsg = "Quota Limit Exceeded: Xadka codsiyada maalinlaha ah ee Gemini Free Tier (20 codsi/maalintii) waa buuxsamay. Fadlan u fur Settings > Secrets si aad ugu darto ama u doorato API Key kuu gaar ah (ama sug inta quota-du dib u cusboonaanayso).";
        } else {
          errMsg = "AI request limit temporarily reached. Please wait a few moments or connect your billing API key in Settings > Secrets.";
        }
      } else if (errMsg.includes("503") || errMsg.includes("UNAVAILABLE") || errMsg.includes("high demand")) {
        errMsg = "AI model is currently experiencing high demand. Please click 'Iskuday Markale' to retry, or check your API key in Settings > Secrets.";
      }

      throw new Error(errMsg);
    }

    if (!data) {
      throw new Error("Invalid response received from server. Please try again.");
    }

    if (!data.success && data.error) {
      throw new Error(data.error);
    }

    if (!Array.isArray(data.captions)) {
      throw new Error(data?.error || "No speech captions found in this video. Please ensure the audio contains audible voice.");
    }

    return data.captions.map((item: any, index: number) => ({
      id: item.id || `cap-${index + 1}`,
      startTime: typeof item.startTime === "number" ? item.startTime : parseFloat(item.startTime || 0),
      endTime: typeof item.endTime === "number" ? item.endTime : parseFloat(item.endTime || 1),
      text: String(item.text || "").trim()
    }));

  } catch (error: any) {
    if (error?.name === "AbortError" || signal?.aborted) {
      throw error;
    }
    if (error?.isCookieBlocked || isCookieBlockedError(error?.message || "")) {
      console.warn("Caption generation notice: Cookie check / iframe restrictions encountered.");
      const friendlyErr = new Error(
        "Browser-kaagu wuxuu xannibayaa cookies-ka amniga ee preview-ga iframe-ka. Fadlan ku fur app-ka Daaqad Cusub (Open in New Tab) ama riix 'Oggolow Cookies'."
      );
      (friendlyErr as any).isCookieBlocked = true;
      throw friendlyErr;
    }

    let msg = error?.message || "An error occurred while generating subtitles.";
    if (msg === "Load failed" || msg.includes("Failed to fetch") || msg.includes("NetworkError")) {
      const inIframe = isInIframe();
      const friendlyMsg = inIframe
        ? "Xiriirka internetka ama soo-gelinta ayaa go'day (Failed to fetch). Browser-kaagu wuxuu xannibay cookies-ka preview-ga. Fadlan ku fur daaqad cusub (Open in New Tab)."
        : "Xiriirka internetka ama soo-gelinta ayaa go'day (Failed to fetch). Fadlan hubi internetkaaga ama dib u riix soo-saarista subtitles-ka.";
      const e = new Error(friendlyMsg);
      (e as any).isCookieBlocked = inIframe;
      throw e;
    }

    console.error("Caption generation error:", error?.message || error);
    throw error;
  }
};
