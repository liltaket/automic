import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, extname } from "node:path";
const root = resolve("dist/simulator");
const port = Number(process.env.PORT || 4317);
const server = createServer(async (req, res) => {
  const origin = req.headers.origin;
  if (
    req.headers.host !== `127.0.0.1:${port}` &&
    req.headers.host !== `localhost:${port}`
  ) {
    res.writeHead(403);
    res.end();
    return;
  }
  if (
    origin &&
    origin !== `http://127.0.0.1:${port}` &&
    origin !== `http://localhost:${port}`
  ) {
    res.writeHead(403);
    res.end();
    return;
  }
  if (req.url === "/api/decide" && req.method === "POST") {
    let body = "";
    for await (const chunk of req) {
      body += chunk;
      if (body.length > 16000) {
        res.writeHead(413);
        res.end();
        return;
      }
    }
    try {
      const data = JSON.parse(body);
      if (
        data.model !== "laya:multilingual" ||
        !data.questions ||
        JSON.stringify(data.state).length > 10000
      )
        throw new Error("Invalid request");
      const upstream = await fetch("http://127.0.0.1:11435/api/decide", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        signal: AbortSignal.timeout(15000),
        redirect: "error",
      });
      res.writeHead(upstream.status, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      });
      res.end(await upstream.text());
    } catch {
      res.writeHead(503, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          error: "Start Ollaya and pull laya:multilingual. See README.",
        }),
      );
    }
    return;
  }
  if (req.method !== "GET") {
    res.writeHead(405);
    res.end();
    return;
  }
  try {
    const url = new URL(req.url, "http://localhost");
    const path = resolve(
      root,
      "." +
        decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname),
    );
    if (!path.startsWith(root + "/")) {
      res.writeHead(403);
      res.end();
      return;
    }
    const content = await readFile(path);
    res.writeHead(200, {
      "Content-Type":
        { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" }[
          extname(path)
        ] || "application/octet-stream",
      "Cache-Control": "no-store",
      "Content-Security-Policy":
        "default-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'",
    });
    res.end(content);
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
});
server.listen(port, "127.0.0.1", () =>
  console.log(`Simulator: http://127.0.0.1:${port}`),
);
