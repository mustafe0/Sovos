import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createExpressApp } from "../server";

let appPromise: Promise<any> | null = null;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.url) {
    try {
      const parsed = new URL(req.url, "http://localhost");
      const vercelPath = parsed.searchParams.get("__vercel_path");
      if (vercelPath !== null) {
        parsed.searchParams.delete("__vercel_path");
        const cleanSubPath = vercelPath.replace(/^\/+/, "");
        const qs = parsed.searchParams.toString();
        req.url = `/api/${cleanSubPath}${qs ? `?${qs}` : ""}`;
      }
    } catch {}
  }

  // Prevent Express body-parser from stalling if Vercel already consumed JSON body
  if (
    req.headers["content-type"]?.includes("application/json") &&
    (req as any).readableEnded &&
    req.body !== undefined
  ) {
    (req as any)._body = true;
  }

  if (!appPromise) {
    appPromise = createExpressApp();
  }
  const app = await appPromise;
  return app(req, res);
}
