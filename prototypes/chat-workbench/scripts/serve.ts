import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { Readable } from 'node:stream';
import { getApp } from '../agent/app';
import { POST } from '../app/api/chat/route';
import { GET } from '../app/api/state/route';

const port = Number(process.env.PORT ?? 3000);

createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const c of req) {
      size += (c as Buffer).length;
      if (size > 1_000_000) {
        res.writeHead(413).end();
        return;
      }
      chunks.push(c as Buffer);
    }
    const ac = new AbortController();
    res.on('close', () => ac.abort());
    const request = new Request(url, {
      method: req.method,
      headers: req.headers as Record<string, string>,
      body: req.method === 'POST' ? Buffer.concat(chunks) : undefined,
      signal: ac.signal,
    });
    let response: Response;
    if (url.pathname === '/' && req.method === 'GET') {
      // The workbench page. Served over http://localhost so the browser allows microphone access.
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(readFileSync(new URL('../web/index.html', import.meta.url)));
      return;
    }
    if (url.pathname === '/api/chat' && req.method === 'POST') response = await POST(request);
    else if (url.pathname === '/api/state' && req.method === 'GET') response = await GET(request);
    else response = new Response('Not found', { status: 404 });
    res.writeHead(response.status, Object.fromEntries(response.headers));
    if (response.body) Readable.fromWeb(response.body as never).pipe(res);
    else res.end();
  } catch {
    if (!res.headersSent) res.writeHead(500);
    res.end();
  }
}).listen(port, () => console.log(`crispr-agent on :${port} (model: ${getApp().modelLabel})`));
