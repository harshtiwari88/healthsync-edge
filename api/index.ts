import type {IncomingMessage, ServerResponse} from 'http';
import {createHealthSyncServer} from '../server.ts';

let serverPromise: ReturnType<typeof createHealthSyncServer> | null = null;

export default async function handler(req: IncomingMessage, res: ServerResponse) {
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

  if (!serverPromise) {
    serverPromise = createHealthSyncServer();
  }
  const {app} = await serverPromise;
  app(req as never, res as never);
}
