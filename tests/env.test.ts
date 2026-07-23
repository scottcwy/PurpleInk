import { describe, expect, it } from "vitest";
import { parseServerEnv } from "@/lib/env";

describe("server environment", () => {
  it("accepts a PostgreSQL connection URL", () => {
    expect(
      parseServerEnv({
        DATABASE_URL: "postgresql://purpleink:secret@localhost:5432/purpleink",
      }),
    ).toEqual({
      DATABASE_URL: "postgresql://purpleink:secret@localhost:5432/purpleink",
    });
  });

  it("rejects a missing database URL", () => {
    expect(() => parseServerEnv({})).toThrow(/DATABASE_URL/);
  });

  it("rejects a non-PostgreSQL URL", () => {
    expect(() =>
      parseServerEnv({ DATABASE_URL: "https://database.example.com" }),
    ).toThrow(/PostgreSQL/);
  });
});
