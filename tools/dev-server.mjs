#!/usr/bin/env node
// 로컬 개발 서버: 정적 파일은 그대로 서빙하고 /api/* 는 _worker.js 를 직접 호출한다(Cloudflare Pages와 같은 동작).
// 사용법: node tools/dev-server.mjs [포트=8788] [--mock]   (--mock: 국립생물자원관 대신 가짜 응답, 오프라인 테스트용)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.gz': 'application/gzip' };

export async function startServer({ port = 8788, mock = false } = {}) {
  if (mock) (await import(pathToFileURL(path.join(root, 'test', 'mock-nibr.mjs')))).installMockUpstream();
  const worker = (await import(pathToFileURL(path.join(root, '_worker.js')))).default;
  const serveFile = urlPath => {
    const file = path.join(root, path.normalize(decodeURIComponent(urlPath === '/' ? '/index.html' : urlPath)));
    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return null;
    return new Response(fs.readFileSync(file), { headers: { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' } });
  };
  const env = { ASSETS: { fetch: req => serveFile(new URL(req.url || String(req)).pathname) || new Response('Not found', { status: 404 }) } };
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const response = url.pathname.startsWith('/api/')
      ? await worker.fetch(new Request(url, { method: req.method }), env)
      : serveFile(url.pathname) || new Response('Not found', { status: 404 });
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  });
  await new Promise(resolve => server.listen(port, '127.0.0.1', resolve));
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.argv.find(a => /^\d+$/.test(a)) || 8788);
  await startServer({ port, mock: process.argv.includes('--mock') });
  console.log(`http://127.0.0.1:${port}/${process.argv.includes('--mock') ? '  (가짜 국립생물자원관 응답)' : ''}`);
}
