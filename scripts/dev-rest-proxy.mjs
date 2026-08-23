// Dev-only reverse proxy: serves supabase-js's expected /rest/v1 prefix by stripping it
// and forwarding to a bare PostgREST instance (scripts/README: local dev without the
// full Supabase stack; swap NEXT_PUBLIC_SUPABASE_URL to a cloud project later).
import http from "http";

const TARGET_PORT = Number(process.env.PGRST_TARGET_PORT ?? 5441);
const LISTEN_PORT = Number(process.env.PGRST_PROXY_PORT ?? 5440);

const server = http.createServer((req, res) => {
  const url = req.url ?? "/";
  const stripped = url.replace(/^\/rest\/v1/, "");
  const headers = { ...req.headers, host: `127.0.0.1:${TARGET_PORT}` };
  // Bare PostgREST has no JWT secret configured: any Authorization/apikey header makes it
  // try to decode a JWT and fail. Drop them — anonymous role is the superuser locally.
  delete headers.authorization;
  delete headers.apikey;
  const opts = {
    hostname: "127.0.0.1",
    port: TARGET_PORT,
    path: stripped.length ? stripped : "/",
    method: req.method,
    headers,
  };
  const upstream = http.request(opts, (ur) => {
    res.writeHead(ur.statusCode ?? 502, ur.headers);
    ur.pipe(res);
  });
  upstream.on("error", (e) => {
    res.writeHead(502, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: `postgrest unreachable: ${e.message}` }));
  });
  req.pipe(upstream);
});

server.listen(LISTEN_PORT, () => console.log(`rest-proxy :${LISTEN_PORT} -> :${TARGET_PORT}`));
