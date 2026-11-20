import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createExpressApp } from "../server.js";

let appPromise: Promise<any> | null = null;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
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

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        res.off("finish", done);
        res.off("close", done);
        resolve();
      };
      res.once("finish", done);
      res.once("close", done);

      try {
        app(req, res, (err?: any) => {
          if (err) {
            if (settled) return;
            settled = true;
            res.off("finish", done);
            res.off("close", done);
            reject(err);
          } else {
            done();
          }
        });
      } catch (invokeErr) {
        if (!settled) {
          settled = true;
          res.off("finish", done);
          res.off("close", done);
          reject(invokeErr);
        }
      }
    });
  } catch (err: any) {
    console.error("[Vercel Handler Error]:", err);
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        error: err?.message || "Serverless function failed to handle request.",
      });
    } else if (!res.writableEnded) {
      try { res.end(); } catch {}
    }
  }
}
