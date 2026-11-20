/**
 * Robust API Client & Iframe Authentication Handler
 * Handles cross-site iframe cookie restrictions, Safari/iOS Storage Access API,
 * and resilient network requests for Google AI Studio applets.
 */

/**
 * Cleans up and removes any legacy or malformed test cookies that trigger
 * 401/400 "The server cannot process the request because it is malformed"
 * from Google Front End (GFE) / Cloud Run proxies.
 */
export function cleanupMalformedCookies(): void {
  try {
    if (typeof document !== 'undefined') {
      const names = [
        '__SECURE-aistudio_auth_flow_may_set_cookies',
        '__Secure-aistudio_auth_flow_may_set_cookies',
        'aistudio_auth_flow_may_set_cookies'
      ];
      const host = window.location.hostname;
      for (const name of names) {
        document.cookie = `${name}=; Path=/; Max-Age=0; expires=Thu, 01 Jan 1970 00:00:00 GMT;`;
        if (host) {
          document.cookie = `${name}=; Path=/; Domain=${host}; Max-Age=0; expires=Thu, 01 Jan 1970 00:00:00 GMT;`;
        }
      }
    }
  } catch {}
}

export function setClientTestCookie(): void {
  // Clear any malformed cookies to ensure clean requests
  cleanupMalformedCookies();
}

// Clean up malformed cookies immediately on startup
if (typeof window !== 'undefined') {
  cleanupMalformedCookies();
}

/**
 * Checks if the current page is running embedded inside an iframe
 */
export function isInIframe(): boolean {
  try {
    return typeof window !== 'undefined' && window.self !== window.top;
  } catch {
    return true;
  }
}

/**
 * Opens current application in a clean top-level browser tab
 * completely bypassing all iframe cookie and storage restrictions.
 */
export function openInNewTab(): void {
  try {
    if (typeof window !== 'undefined') {
      window.open(window.location.href, '_blank', 'noopener,noreferrer');
    }
  } catch (err) {
    console.warn('Failed to open in new tab:', err);
  }
}

/**
 * Attempts to grant browser storage access inside iframes (Safari / WebKit)
 */
export async function ensureStorageAccess(): Promise<boolean> {
  if (typeof document === 'undefined') return false;
  try {
    const doc = document as any;
    if (typeof doc.hasStorageAccess === 'function') {
      const checkPromise = (async () => {
        const hasAccess = await doc.hasStorageAccess().catch(() => false);
        if (!hasAccess && typeof doc.requestStorageAccess === 'function') {
          await doc.requestStorageAccess();
          console.log('[StorageAccess] Storage access granted successfully.');
          return true;
        }
        return Boolean(hasAccess);
      })();
      return await Promise.race([
        checkPromise,
        new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 1500)),
      ]);
    }
  } catch (err) {
    console.warn('[StorageAccess] Storage access request declined or unsupported:', err);
  }
  return false;
}

/**
 * Detects if a server response is an HTML "Cookie check" security page
 */
export function isCookieCheckHtml(text: string, url?: string): boolean {
  if (!text && !url) return false;
  if (url && (url.includes('cookie_check') || url.includes('__cookie_check.html'))) {
    return true;
  }
  if (typeof text === 'string') {
    const lower = text.toLowerCase();
    if (
      lower.includes('cookie check') ||
      lower.includes('action required to load your app') ||
      lower.includes('__secure-aistudio_auth_flow_may_set_cookies') ||
      lower.includes('cookie_check.html') ||
      lower.includes('blocking a required security cookie') ||
      lower.includes('grant permission for the required security cookie') ||
      lower.includes('authenticate in new window')
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Checks if an error message is related to cookie blocking or cross-site iframe restrictions
 */
export function isCookieBlockedError(msg: string): boolean {
  if (!msg) return false;
  const lower = msg.toLowerCase();
  return (
    lower.includes('cookie check') ||
    lower.includes('cookie') ||
    lower.includes('storage access') ||
    lower.includes('action required to load your app')
  );
}

/**
 * Warm up authentication on startup using a clean GET request
 */
export async function warmupAuthSession(): Promise<boolean> {
  cleanupMalformedCookies();
  try {
    const res = await fetch('/api/health', {
      method: 'GET',
    });

    if (res.ok) {
      const text = await res.text().catch(() => '');
      return !isCookieCheckHtml(text, res.url);
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Standard app fetch wrapper
 */
export async function appFetch(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  return fetch(input, init);
}
