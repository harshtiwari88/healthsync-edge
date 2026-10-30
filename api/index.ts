import type {IncomingMessage, ServerResponse} from 'http';
import {createHealthSyncServer} from '../server.ts';

let serverPromise: ReturnType<typeof createHealthSyncServer> | null = null;

export function resetServerlessInstanceForTests(): void {
  serverPromise = null;
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  try {
    if (req.url) {
      const parsed = new URL(req.url, 'http://localhost');
      const rewrittenSubpath = parsed.searchParams.get('__hs_path');
      if (rewrittenSubpath !== null) {
        parsed.searchParams.delete('__hs_path');
        const restQuery = parsed.searchParams.toString();
        if (parsed.pathname === '/api/index' || parsed.pathname === '/api') {
          const cleanSubpath = rewrittenSubpath.replace(/^\/+/, '');
          req.url = `/api/${cleanSubpath}${restQuery ? `?${restQuery}` : ''}`;
        } else {
          req.url = `${parsed.pathname}${restQuery ? `?${restQuery}` : ''}`;
        }
      }
    }
  } catch (urlErr) {
    console.warn('[HealthSync Serverless] Malformed request URL normalized safely:', urlErr);
  }

  try {
    if (!serverPromise) {
      serverPromise = createHealthSyncServer();
    }
    const {app} = await serverPromise;
    app(req as never, res as never);
  } catch (err) {
    serverPromise = null;
    const message =
      err instanceof Error ? err.message : 'Server initialization error on serverless runtime.';
    console.warn('[HealthSync Serverless] Initialization fallback response:', message);
    if (!res.headersSent) {
      res.statusCode = 503;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(
        JSON.stringify({
          success: false,
          isDemoFallback: true,
          error: message,
          code: err instanceof Error ? err.name : 'SERVER_INIT_ERROR',
        })
      );
    }
  }
}
