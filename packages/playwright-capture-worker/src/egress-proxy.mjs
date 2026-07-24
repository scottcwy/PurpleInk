import { createServer, request as httpRequest } from "node:http";
import { connect as connectTcp } from "node:net";

const hopByHopHeaders = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

function filteredHeaders(headers) {
  return Object.fromEntries(
    Object.entries(headers).filter(([name]) => !hopByHopHeaders.has(name.toLowerCase()))
  );
}

function deny(response, statusCode = 403) {
  response.writeHead(statusCode, { connection: "close", "content-type": "text/plain" });
  response.end(statusCode === 403 ? "Forbidden" : "Bad Gateway");
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

export async function startCaptureEgressProxy({ policy, host = "127.0.0.1" }) {
  const server = createServer(async (incoming, response) => {
    try {
      const target = new URL(incoming.url);
      if (target.protocol !== "http:") throw new Error("absolute HTTP proxy URL required");
      const { addresses } = await policy.resolveUrl(target.href);
      const address = addresses[0];
      const outbound = httpRequest({
        host: address,
        family: address.includes(":") ? 6 : 4,
        port: target.port ? Number(target.port) : 80,
        method: incoming.method,
        path: `${target.pathname}${target.search}`,
        headers: { ...filteredHeaders(incoming.headers), host: target.host },
        agent: false,
      }, (upstream) => {
        response.writeHead(upstream.statusCode ?? 502, filteredHeaders(upstream.headers));
        upstream.pipe(response);
      });
      outbound.on("error", () => deny(response, 502));
      incoming.pipe(outbound);
    } catch {
      deny(response);
    }
  });

  server.on("connect", async (incoming, client, head) => {
    try {
      const target = new URL(`https://${incoming.url}/`);
      if (target.pathname !== "/" || target.username || target.password) throw new Error("invalid CONNECT authority");
      const { addresses } = await policy.resolveUrl(target.href);
      const address = addresses[0];
      const upstream = connectTcp({
        host: address,
        family: address.includes(":") ? 6 : 4,
        port: target.port ? Number(target.port) : 443,
      });
      upstream.once("connect", () => {
        client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        if (head.length > 0) upstream.write(head);
        upstream.pipe(client);
        client.pipe(upstream);
      });
      upstream.once("error", () => {
        if (!client.destroyed) client.end("HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n");
      });
      client.once("error", () => upstream.destroy());
    } catch {
      client.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
    }
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, host, resolve);
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return {
    server,
    port,
    url: `http://${host}:${port}`,
    close: () => closeServer(server),
  };
}
