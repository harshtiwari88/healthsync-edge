import express from 'express';
import http from 'http';
import path from 'path';
import {fileURLToPath} from 'url';
import {WebSocketServer, WebSocket} from 'ws';
import {createServer as createViteServer} from 'vite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface StoredRecord {
  id: string;
  patientId: string;
  [key: string]: unknown;
}

const serverRecords: StoredRecord[] = [];

async function startServer() {
  const app = express();
  app.use(express.json({limit: '1mb'}));

  const httpServer = http.createServer(app);
  const wss = new WebSocketServer({noServer: true});

  const clients = new Set<WebSocket>();

  const broadcastJson = (payload: unknown, exclude?: WebSocket) => {
    const serialized = JSON.stringify(payload);
    for (const client of clients) {
      if (client !== exclude && client.readyState === WebSocket.OPEN) {
        client.send(serialized);
      }
    }
  };

  wss.on('connection', (ws: WebSocket) => {
    clients.add(ws);

    // Send initial authoritative state to newly connected client
    ws.send(
      JSON.stringify({
        type: 'sync:init',
        records: serverRecords,
        connectedPeers: clients.size,
      })
    );

    broadcastJson({type: 'presence:count', connectedPeers: clients.size}, ws);

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(String(raw));

        if (msg.type === 'record:created' && msg.record?.id) {
          const exists = serverRecords.some((r) => r.id === msg.record.id);
          if (!exists) {
            serverRecords.unshift(msg.record);
            if (serverRecords.length > 200) serverRecords.pop();
          }
          broadcastJson(
            {
              type: 'record:created',
              record: msg.record,
              triggerEmergencySiren: Boolean(msg.triggerEmergencySiren),
            },
            ws
          );
        } else if (msg.type === 'record:updated' && msg.record?.id) {
          const idx = serverRecords.findIndex((r) => r.id === msg.record.id);
          if (idx >= 0) {
            serverRecords[idx] = msg.record;
          } else {
            serverRecords.unshift(msg.record);
          }
          broadcastJson({type: 'record:updated', record: msg.record}, ws);
        } else if (msg.type === 'records:seed' && Array.isArray(msg.records)) {
          if (serverRecords.length === 0) {
            for (const rec of msg.records) {
              if (rec?.id && !serverRecords.some((r) => r.id === rec.id)) {
                serverRecords.push(rec);
              }
            }
          }
        }
      } catch {
        // Ignore malformed socket frames
      }
    });

    ws.on('close', () => {
      clients.delete(ws);
      broadcastJson({type: 'presence:count', connectedPeers: clients.size});
    });
  });

  httpServer.on('upgrade', (request, socket, head) => {
    const pathname = request.url ? request.url.split('?')[0] : '';
    if (pathname === '/ws/triage') {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    }
  });

  // REST Health & Fallback Sync API
  app.get('/api/health', (_req, res) => {
    res.json({
      status: 'ok',
      connectedDevices: clients.size,
      recordCount: serverRecords.length,
    });
  });

  app.get('/api/records', (_req, res) => {
    res.json({records: serverRecords});
  });

  app.post('/api/records', (req, res) => {
    const {record, triggerEmergencySiren} = req.body || {};
    if (!record || !record.id) {
      res.status(400).json({error: 'Invalid triage record'});
      return;
    }
    const existingIdx = serverRecords.findIndex((r) => r.id === record.id);
    if (existingIdx >= 0) {
      serverRecords[existingIdx] = record;
    } else {
      serverRecords.unshift(record);
    }
    broadcastJson({
      type: 'record:created',
      record,
      triggerEmergencySiren: Boolean(triggerEmergencySiren),
    });
    res.json({ok: true, record});
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: {middlewareMode: true},
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const PORT = Number(process.env.PORT) || 3000;
  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`HealthSync Edge Server & Real-Time WS listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
