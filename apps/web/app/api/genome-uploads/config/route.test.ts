// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

vi.mock("server-only", () => ({}));
afterEach(() => vi.unstubAllEnvs());

describe("direct upload configuration", () => {
  it("uses the documented IBM origin when no override is configured", async () => {
    vi.stubEnv("CRISPR_API_URL", undefined);
    expect(await GET().json()).toMatchObject({
      api_url: "https://148-100-79-183.sslip.io",
    });
  });

  it("resolves the backend at request time and keeps configuration uncached", async () => {
    vi.stubEnv("CRISPR_API_URL", "http://127.0.0.1:9080");
    const local = GET();
    expect(local.headers.get("cache-control")).toContain("no-store");
    expect(await local.json()).toMatchObject({
      api_url: "http://127.0.0.1:9080",
      chunk_size: 8 * 1024 * 1024,
    });
    vi.stubEnv("CRISPR_API_URL", "https://genomes.example");
    expect(await GET().json()).toMatchObject({
      api_url: "https://genomes.example",
    });
  });

  it.each([
    "not a URL",
    "https://user:secret@example.com",
    "http://example.com",
    "file:///private/data",
    "https://example.com/analyze",
    "https://example.com/?token=secret",
  ])(
    "never exposes invalid origins or embedded secrets: %s",
    async (origin) => {
      vi.stubEnv("CRISPR_API_URL", origin);
      const response = GET();
      expect(response.status).toBe(503);
      expect(await response.text()).not.toContain("secret");
    },
  );
});
