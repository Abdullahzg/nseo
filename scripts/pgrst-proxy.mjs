// Tiny reverse proxy: maps /rest/v1/* to PostgREST root at :5441
import http from "http";

const PGRST = "127.0.0.1";
const PGRST_PORT = 5441;
const PORT = 5440;

const server = http.createServer((req, res) => {
  let targetPath = req.url ?? "/";
  // Strip /rest/v1 prefix
  if (targetPath.startsWith("/rest/v1/")) {
    targetPath = targetPath.slice("/rest/v1".length);
  }

  // Copy headers but strip Authorization (PostgREST has no JWT secret, uses anon role)
  const headers = { ...req.headers };
  delete headers.authorization;

  const proxyReq = http.request(
    { hostname: PGRST, port: PGRST_PORT, path: targetPath, method: req.method, headers },
    (proxyRes) => {
      res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers);
      proxyRes.pipe(res);
    }
  );
  proxyReq.on("error", (err) => {
    res.writeHead(502);
    res.end("proxy error: " + err.message);
  });
  req.pipe(proxyReq);
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[pgrst-proxy] listening on http://127.0.0.1:${PORT} -> :${PGRST_PORT}`);
});
