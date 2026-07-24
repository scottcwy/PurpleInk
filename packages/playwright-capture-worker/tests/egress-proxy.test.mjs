import { createServer as createHttpServer, request } from "node:http";
import { createServer as createNetServer, connect } from "node:net";

import { afterEach, describe, expect, it } from "vitest";

import { CaptureNetworkPolicy } from "../src/network-policy.mjs";

const opened = [];

afterEach(async () => {
  await Promise.all(opened.splice(0).map((server) => new Promise((resolve) => server.close(resolve))));
});

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
}

async function proxyModule() {
  return import("../src/egress-proxy.mjs").catch(() => ({}));
}

describe("restricted capture egress proxy", () => {
  it("forwards an allowed HTTP origin to the address resolved by policy", async () => {
    const upstream = createHttpServer((incoming, response) => {
      response.end(`${incoming.headers.host}:${incoming.url}`);
    });
    opened.push(upstream);
    const upstreamPort = await listen(upstream);
    const policy = new CaptureNetworkPolicy({
      allowedOrigins: [`http://product.example.test:${upstreamPort}`],
      allowPrivateTestOrigins: true,
      resolve: async () => [{ address: "127.0.0.1", family: 4 }],
    });
    const module = await proxyModule();
    expect(module.startCaptureEgressProxy).toBeTypeOf("function");
    const proxy = await module.startCaptureEgressProxy({ policy });
    opened.push(proxy.server);

    const body = await new Promise((resolve, reject) => {
      const outbound = request({
        host: "127.0.0.1",
        port: proxy.port,
        method: "GET",
        path: `http://product.example.test:${upstreamPort}/health`,
      }, (response) => {
        let value = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => { value += chunk; });
        response.on("end", () => resolve(value));
      });
      outbound.on("error", reject);
      outbound.end();
    });

    expect(body).toBe(`product.example.test:${upstreamPort}:/health`);
  });

  it("rejects a non-allowlisted origin before opening an upstream connection", async () => {
    let resolutions = 0;
    const policy = new CaptureNetworkPolicy({
      allowedOrigins: ["https://product.example.test"],
      resolve: async () => {
        resolutions += 1;
        return [{ address: "93.184.216.34", family: 4 }];
      },
    });
    const module = await proxyModule();
    expect(module.startCaptureEgressProxy).toBeTypeOf("function");
    const proxy = await module.startCaptureEgressProxy({ policy });
    opened.push(proxy.server);

    const status = await new Promise((resolve, reject) => {
      const outbound = request({
        host: "127.0.0.1",
        port: proxy.port,
        method: "GET",
        path: "http://attacker.example.test/private",
      }, (response) => {
        response.resume();
        response.on("end", () => resolve(response.statusCode));
      });
      outbound.on("error", reject);
      outbound.end();
    });

    expect(status).toBe(403);
    expect(resolutions).toBe(0);
  });

  it("pins an allowed CONNECT tunnel to the policy-resolved address", async () => {
    const upstream = createNetServer((socket) => socket.on("data", (bytes) => socket.write(bytes)));
    opened.push(upstream);
    const upstreamPort = await listen(upstream);
    const policy = new CaptureNetworkPolicy({
      allowedOrigins: [`https://product.example.test:${upstreamPort}`],
      allowPrivateTestOrigins: true,
      resolve: async () => [{ address: "127.0.0.1", family: 4 }],
    });
    const module = await proxyModule();
    expect(module.startCaptureEgressProxy).toBeTypeOf("function");
    const proxy = await module.startCaptureEgressProxy({ policy });
    opened.push(proxy.server);

    const echoed = await new Promise((resolve, reject) => {
      const socket = connect(proxy.port, "127.0.0.1");
      let response = Buffer.alloc(0);
      socket.on("connect", () => {
        socket.write(`CONNECT product.example.test:${upstreamPort} HTTP/1.1\r\nHost: product.example.test:${upstreamPort}\r\n\r\n`);
      });
      socket.on("data", (bytes) => {
        response = Buffer.concat([response, bytes]);
        const boundary = response.indexOf("\r\n\r\n");
        if (boundary >= 0 && response.subarray(0, boundary).includes(Buffer.from("200"))) {
          const trailing = response.subarray(boundary + 4);
          if (trailing.includes(Buffer.from("ping"))) {
            socket.end();
            resolve(trailing.toString());
          } else {
            response = Buffer.alloc(0);
            socket.write("ping");
          }
        } else if (response.includes(Buffer.from("ping"))) {
          socket.end();
          resolve(response.toString());
        }
      });
      socket.on("error", reject);
    });

    expect(echoed).toContain("ping");
  });
});
