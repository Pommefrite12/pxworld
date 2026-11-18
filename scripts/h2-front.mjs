#!/usr/bin/env node
// A local HTTP/2 front for a production server, to measure the map the way a real host serves it (one connection, many requests at once: the
// 6-connection limit of plain HTTP/1.1 would hide what the server costs). For `scripts/perf-map.mjs`; never for anything else.
//   node scripts/h2-front.mjs [port of the site = 3000] [port of this front = 3443]
import http from "node:http";
import http2 from "node:http2";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const target = Number(process.argv[2] ?? 3000), port = Number(process.argv[3] ?? 3443);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "px-h2-"));
execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", `${dir}/k.pem`, "-out", `${dir}/c.pem`, "-subj", "/CN=localhost", "-days", "1", "-addext", "subjectAltName=DNS:localhost"], { stdio: "ignore" });
const server = http2.createSecureServer({ key: fs.readFileSync(`${dir}/k.pem`), cert: fs.readFileSync(`${dir}/c.pem`), settings: { maxConcurrentStreams: 256 } });
const agent = new http.Agent({ keepAlive: true, maxSockets: 256 });
server.on("request", (req, res) => {
  const headers = { ...req.headers };
  for (const h of [":method", ":path", ":scheme", ":authority"]) delete headers[h];
  headers.host = `localhost:${target}`;
  const up = http.request({ host: "127.0.0.1", port: target, path: req.url, method: req.method, headers, agent }, (r) => {
    const out = { ...r.headers };
    for (const h of ["connection", "keep-alive", "transfer-encoding", "upgrade"]) delete out[h];
    res.writeHead(r.statusCode ?? 502, out);
    r.pipe(res);
  });
  up.on("error", () => { try { res.writeHead(502); res.end(); } catch { /* the client left */ } });
  req.pipe(up);
});
server.listen(port, () => console.log(`HTTP/2 front on https://localhost:${port} -> http://localhost:${target} (a throw-away certificate: the browser must be told to ignore it)`));
