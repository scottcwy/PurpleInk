import { describe, expect, it } from "vitest";

import {
  CaptureNetworkPolicy,
  isPublicAddress,
} from "../src/network-policy.mjs";

describe("CaptureNetworkPolicy", () => {
  it("rejects a URL outside the exact allowed origins before DNS resolution", async () => {
    const policy = new CaptureNetworkPolicy({
      allowedOrigins: ["https://product.example.com"],
      resolve: async () => [{ address: "93.184.216.34", family: 4 }],
    });

    await expect(policy.assertUrl("https://attacker.example/path")).rejects.toMatchObject({
      code: "ORIGIN_NOT_ALLOWED",
    });
  });

  it.each([
    "127.0.0.1",
    "10.0.0.1",
    "172.16.0.1",
    "192.168.1.1",
    "169.254.169.254",
    "::1",
    "fe80::1",
    "fd00::1",
  ])("rejects non-public address %s after resolution", async (address) => {
    const policy = new CaptureNetworkPolicy({
      allowedOrigins: ["https://product.example.com"],
      resolve: async () => [{ address, family: address.includes(":") ? 6 : 4 }],
    });

    await expect(policy.assertUrl("https://product.example.com/path")).rejects.toMatchObject({
      code: "SSRF_ADDRESS_BLOCKED",
    });
  });

  it("pins the first public DNS result for the capture attempt", async () => {
    let call = 0;
    const policy = new CaptureNetworkPolicy({
      allowedOrigins: ["https://product.example.com"],
      resolve: async () => [
        { address: call++ === 0 ? "93.184.216.34" : "93.184.216.35", family: 4 },
      ],
    });

    await policy.assertUrl("https://product.example.com/first");
    await expect(policy.resolveUrl("https://product.example.com/second")).resolves.toMatchObject({
      addresses: ["93.184.216.34"],
    });
    expect(call).toBe(1);
  });

  it("retries a transient DNS resolution failure before pinning", async () => {
    let call = 0;
    const policy = new CaptureNetworkPolicy({
      allowedOrigins: ["https://product.example.com"],
      resolve: async () => {
        call += 1;
        if (call === 1) throw new Error("EAI_AGAIN");
        return [{ address: "93.184.216.34", family: 4 }];
      },
    });

    await expect(policy.resolveUrl("https://product.example.com/path")).resolves.toMatchObject({
      addresses: ["93.184.216.34"],
    });
    expect(call).toBe(2);
  });

  it("allows a private address only for an explicitly enabled test origin", async () => {
    const policy = new CaptureNetworkPolicy({
      allowedOrigins: ["https://host.docker.internal:8443"],
      allowPrivateTestOrigins: true,
      resolve: async () => [{ address: "192.168.65.2", family: 4 }],
    });

    await expect(
      policy.assertUrl("https://host.docker.internal:8443/product")
    ).resolves.toBeUndefined();
  });
});

describe("isPublicAddress", () => {
  it.each(["93.184.216.34", "1.1.1.1", "2606:4700:4700::1111"])(
    "accepts globally routable address %s",
    (address) => expect(isPublicAddress(address)).toBe(true)
  );

  it.each(["0.0.0.0", "100.64.0.1", "198.18.0.1", "224.0.0.1", "2001:db8::1"])(
    "rejects reserved address %s",
    (address) => expect(isPublicAddress(address)).toBe(false)
  );
});
