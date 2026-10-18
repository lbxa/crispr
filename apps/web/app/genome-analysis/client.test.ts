import type { HttpRequest, HttpResponse, Upload } from "tus-js-client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GenomeUpload } from "./client";
import { UPLOAD_CHUNK_BYTES } from "./contract";
import { uploadConfig, uploadJob, uploadSession } from "./upload.fixture";

type UploadOptions = ConstructorParameters<typeof Upload>[1];
const { uploads } = vi.hoisted(() => ({
  uploads: [] as {
    file: File;
    options: UploadOptions;
    start: ReturnType<typeof vi.fn>;
    abort: ReturnType<typeof vi.fn>;
  }[],
}));

vi.mock("tus-js-client", () => ({
  Upload: class {
    url = `${uploadSession.upload_endpoint}${uploadSession.id}`;
    start = vi.fn();
    abort = vi.fn().mockResolvedValue(undefined);
    constructor(
      readonly file: File,
      readonly options: UploadOptions,
    ) {
      uploads.push(this);
    }
  },
}));

beforeEach(() => {
  uploads.length = 0;
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function prepare(file = new File(["VCF"], "sample.vcf")) {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(Response.json(uploadConfig))
    .mockResolvedValueOnce(Response.json(uploadSession))
    .mockImplementation(async () => Response.json(uploadJob(file.size)));
  vi.stubGlobal("fetch", fetch);
  const publish = vi.fn();
  return { file, fetch, publish, client: new GenomeUpload(file, publish) };
}

describe("IBM genome upload gateway", () => {
  it("downloads the saved analysis with its capability without uploading the genome again", async () => {
    const { client, fetch, publish } = prepare();
    await client.start();
    uploads[0]!.options.onSuccess?.(
      {} as Parameters<NonNullable<UploadOptions["onSuccess"]>>[0],
    );
    await vi.waitFor(() =>
      expect(publish).toHaveBeenLastCalledWith(
        expect.objectContaining({ status: "complete" }),
      ),
    );
    fetch.mockClear();
    fetch.mockResolvedValue(
      new Response("%PDF-test", {
        headers: { "Content-Type": "application/pdf", "Content-Length": "9" },
      }),
    );
    const pdf = await client.downloadReport(new AbortController().signal);
    expect(await pdf.text()).toBe("%PDF-test");
    expect(fetch).toHaveBeenCalledExactlyOnceWith(
      `${uploadConfig.api_url}/uploads/${uploadSession.id}/report.pdf`,
      expect.objectContaining({
        headers: {
          Authorization: `Bearer ${uploadSession.token}`,
          Accept: "application/pdf",
        },
        credentials: "omit",
        redirect: "error",
        cache: "no-store",
      }),
    );
    expect(uploads).toHaveLength(1);
    client.dispose();
    await expect(
      client.downloadReport(new AbortController().signal),
    ).rejects.toThrow("in this session");
  });

  it.each([
    ["text/html", "9", "<private>"],
    ["application/pdf", "9", "not a pdf"],
    ["application/pdf", "9000000", "%PDF-test"],
    ["application/pdf", "", "%PDF-test"],
  ])(
    "rejects an invalid PDF boundary (%s, length=%s)",
    async (type, length, content) => {
      const { client, fetch, publish } = prepare();
      await client.start();
      uploads[0]!.options.onSuccess?.(
        {} as Parameters<NonNullable<UploadOptions["onSuccess"]>>[0],
      );
      await vi.waitFor(() =>
        expect(publish).toHaveBeenLastCalledWith(
          expect.objectContaining({ status: "complete" }),
        ),
      );
      fetch.mockResolvedValue(
        new Response(content, {
          headers: { "Content-Type": type, "Content-Length": length },
        }),
      );
      await expect(
        client.downloadReport(new AbortController().signal),
      ).rejects.toThrow("invalid PDF");
      client.dispose();
    },
  );

  it("reports expired PDF access without exposing the server response", async () => {
    const { client, fetch, publish } = prepare();
    await client.start();
    uploads[0]!.options.onSuccess?.(
      {} as Parameters<NonNullable<UploadOptions["onSuccess"]>>[0],
    );
    await vi.waitFor(() =>
      expect(publish).toHaveBeenLastCalledWith(
        expect.objectContaining({ status: "complete" }),
      ),
    );
    fetch.mockResolvedValue(
      new Response("private server diagnostic", { status: 410 }),
    );
    await expect(
      client.downloadReport(new AbortController().signal),
    ).rejects.toThrow("has expired");
    client.dispose();
  });

  it("passes a large compressed File to tus without reading it or sending its name", async () => {
    const file = new File(["compressed fixture"], "HG001.vcf.gz");
    Object.defineProperty(file, "size", { value: 1_900_000_000 });
    const text = vi.fn();
    Object.defineProperty(file, "text", { value: text });
    const { client, fetch } = prepare(file);
    await client.start();
    const upload = uploads[0]!;
    expect(upload.file).toBe(file);
    expect(upload.options).toMatchObject({
      chunkSize: UPLOAD_CHUNK_BYTES,
      uploadUrl: `${uploadSession.upload_endpoint}${uploadSession.id}`,
      storeFingerprintForResuming: false,
      metadata: { session_id: uploadSession.id, format: "vcf_gzip" },
      retryDelays: [0, 1000, 3000, 5000],
    });
    expect(JSON.parse(fetch.mock.calls[1]![1].body)).toEqual({
      size_bytes: file.size,
      format: "vcf_gzip",
    });
    expect(JSON.stringify(fetch.mock.calls)).not.toContain(file.name);
    expect(text).not.toHaveBeenCalled();
    expect(upload.start).toHaveBeenCalledOnce();
    client.dispose();
  });

  it("pauses and resumes the same resource at acknowledged chunk progress", async () => {
    const { client, publish } = prepare();
    await client.start();
    const upload = uploads[0]!;
    upload.options.onChunkComplete?.(1, 1, 3);
    client.pause();
    expect(publish).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: "paused", uploaded: 1 }),
    );
    upload.options.onChunkComplete?.(1, 2, 3);
    expect(publish).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: "paused", uploaded: 1 }),
    );
    await Promise.all([client.resume(), client.resume()]);
    expect(upload.abort).toHaveBeenCalledOnce();
    expect(upload.start).toHaveBeenCalledTimes(2);
    expect(uploads).toHaveLength(1);
    client.dispose();
  });

  it("lets the real tus SDK create a missing resource and resume with HEAD offsets", async () => {
    const { Upload: ActualUpload } =
      await vi.importActual<typeof import("tus-js-client")>("tus-js-client");
    const { client, file } = prepare(
      new File(["abcdefghijklmnopqrst"], "sample.vcf"),
    );
    await client.start();
    const options = uploads[0]!.options;
    const requests: {
      method: string;
      offset: number;
      bytes: number;
      headers: Map<string, string>;
    }[] = [];
    let exists = false;
    let offset = 0;
    let paused = false;
    let pause!: () => void;
    let complete!: () => void;
    let fail!: (error: Error) => void;
    const didPause = new Promise<void>((resolve) => {
      pause = resolve;
    });
    const didComplete = new Promise<void>((resolve, reject) => {
      complete = resolve;
      fail = reject;
    });
    const actual = new ActualUpload(file, {
      ...options,
      chunkSize: 8,
      retryDelays: null,
      fileReader: {
        openFile: async () => ({
          size: file.size,
          slice: async (start, end) => ({
            value: file.slice(start, end),
            done: end >= file.size,
          }),
          close() {},
        }),
      },
      httpStack: {
        getName: () => "test-tus-server",
        createRequest: (method, url) => {
          const headers = new Map<string, string>();
          return {
            getMethod: () => method,
            getURL: () => url,
            setHeader: (name, value) => {
              headers.set(name, value);
            },
            getHeader: (name) => headers.get(name),
            setProgressHandler() {},
            getUnderlyingObject: () => null,
            abort: async () => {},
            send: async (body: unknown) => {
              const bytes = body instanceof Blob ? body.size : 0;
              requests.push({ method, offset, bytes, headers });
              const status =
                method === "HEAD"
                  ? exists
                    ? 200
                    : 404
                  : method === "POST"
                    ? 201
                    : 204;
              if (method === "POST") exists = true;
              if (method === "PATCH") offset += bytes;
              return {
                getStatus: () => status,
                getHeader: (name) =>
                  ({
                    location: `${uploadSession.upload_endpoint}${uploadSession.id}`,
                    "upload-offset": String(offset),
                    "upload-length": String(file.size),
                  })[
                    name.toLowerCase() as
                      "location" | "upload-offset" | "upload-length"
                  ],
                getBody: () => "",
                getUnderlyingObject: () => null,
              };
            },
          };
        },
      },
      onChunkComplete: (...args) => {
        options.onChunkComplete?.(...args);
        if (!paused) {
          paused = true;
          void actual.abort();
          pause();
        }
      },
      onSuccess: () => complete(),
      onError: (error) => fail(error),
    });
    actual.start();
    await didPause;
    actual.start();
    await didComplete;
    expect(
      requests.map(({ method, offset, bytes }) => ({ method, offset, bytes })),
    ).toEqual([
      { method: "HEAD", offset: 0, bytes: 0 },
      { method: "POST", offset: 0, bytes: 0 },
      { method: "PATCH", offset: 0, bytes: 8 },
      { method: "HEAD", offset: 8, bytes: 0 },
      { method: "PATCH", offset: 8, bytes: 8 },
      { method: "PATCH", offset: 16, bytes: 4 },
    ]);
    expect(
      requests.every(
        ({ headers }) =>
          headers.get("Authorization") === `Bearer ${uploadSession.token}`,
      ),
    ).toBe(true);
    await actual.abort();
    client.dispose();
  });

  it("uses completion and job polling, then projects only the validated report", async () => {
    vi.useFakeTimers();
    const { client, fetch, publish, file } = prepare();
    fetch
      .mockReset()
      .mockResolvedValueOnce(Response.json(uploadConfig))
      .mockResolvedValueOnce(Response.json(uploadSession))
      .mockResolvedValueOnce(
        Response.json(uploadJob(file.size, { status: "queued", report: null })),
      )
      .mockResolvedValueOnce(
        Response.json(
          uploadJob(file.size, { status: "processing", report: null }),
        ),
      )
      .mockResolvedValueOnce(
        Response.json({
          ...uploadJob(file.size),
          raw_private_variant: "secret",
        }),
      );
    await client.start();
    uploads[0]!.options.onSuccess?.(
      {} as Parameters<NonNullable<UploadOptions["onSuccess"]>>[0],
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(publish).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: "queued" }),
    );
    await vi.advanceTimersByTimeAsync(1000);
    expect(publish).toHaveBeenLastCalledWith(
      expect.objectContaining({
        status: "processing",
        progress: {
          records_scanned: 100,
          variants_checked: 100,
          retained_variants: 1,
          uncompressed_bytes: 2048,
        },
      }),
    );
    await vi.advanceTimersByTimeAsync(1000);
    expect(publish).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: "complete" }),
    );
    expect(JSON.stringify(publish.mock.calls)).not.toContain(
      "raw_private_variant",
    );
    expect(fetch.mock.calls[2]).toMatchObject([
      expect.stringContaining("/complete"),
      { method: "POST" },
    ]);
    client.dispose();
  });

  it("retries a durable failed job without uploading its bytes again", async () => {
    const { client, fetch, publish, file } = prepare();
    fetch
      .mockReset()
      .mockResolvedValueOnce(Response.json(uploadConfig))
      .mockResolvedValueOnce(Response.json(uploadSession))
      .mockResolvedValueOnce(
        Response.json(
          uploadJob(file.size, {
            status: "failed",
            report: null,
            error: {
              code: "worker_interrupted",
              message: "Worker interrupted.",
              retryable: true,
            },
          }),
        ),
      )
      .mockResolvedValueOnce(Response.json(uploadJob(file.size)));
    await client.start();
    uploads[0]!.options.onSuccess?.(
      {} as Parameters<NonNullable<UploadOptions["onSuccess"]>>[0],
    );
    await vi.waitFor(() =>
      expect(publish).toHaveBeenLastCalledWith(
        expect.objectContaining({
          status: "error",
          error: {
            code: "processing_failed",
            message: "Worker interrupted.",
            retryable: true,
          },
        }),
      ),
    );
    await client.resume();
    expect(fetch.mock.calls[3]).toMatchObject([
      expect.stringContaining("/retry"),
      { method: "POST" },
    ]);
    expect(uploads[0]!.start).toHaveBeenCalledOnce();
    expect(publish).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: "complete" }),
    );
    client.dispose();
  });

  it("rejects a foreign tus endpoint and a foreign Location before sending a token", async () => {
    const { client, fetch, publish } = prepare();
    fetch
      .mockReset()
      .mockResolvedValueOnce(Response.json(uploadConfig))
      .mockResolvedValueOnce(
        Response.json({
          ...uploadSession,
          upload_endpoint: "https://foreign.example/files/",
        }),
      );
    await client.start();
    expect(uploads).toHaveLength(0);
    expect(publish).toHaveBeenLastCalledWith(
      expect.objectContaining({
        status: "error",
        error: expect.objectContaining({ code: "invalid_response" }),
      }),
    );

    const second = prepare();
    await second.client.start();
    expect(() =>
      uploads[0]!.options.onBeforeRequest?.({
        getMethod: () => "PATCH",
        getURL: () => "https://foreign.example/stolen",
      } as HttpRequest),
    ).toThrow();
    expect(() =>
      uploads[0]!.options.onBeforeRequest?.({
        getMethod: () => "PATCH",
        getURL: () => `${uploadSession.upload_endpoint}${uploadSession.id}`,
      } as HttpRequest),
    ).not.toThrow();
    second.client.dispose();
  });

  it("ignores SDK callbacks and late network results after disposal", async () => {
    const { client, publish } = prepare();
    await client.start();
    client.dispose();
    publish.mockClear();
    uploads[0]!.options.onChunkComplete?.(1, 1, 3);
    uploads[0]!.options.onError?.(new Error("late"));
    uploads[0]!.options.onSuccess?.(
      {} as Parameters<NonNullable<UploadOptions["onSuccess"]>>[0],
    );
    await Promise.resolve();
    expect(publish).not.toHaveBeenCalled();
  });

  it("rejects a completed job with an incomplete report", async () => {
    const { client, fetch, publish, file } = prepare();
    fetch
      .mockReset()
      .mockResolvedValueOnce(Response.json(uploadConfig))
      .mockResolvedValueOnce(Response.json(uploadSession))
      .mockResolvedValueOnce(
        Response.json(uploadJob(file.size, { report: null })),
      );
    await client.start();
    uploads[0]!.options.onSuccess?.(
      {} as Parameters<NonNullable<UploadOptions["onSuccess"]>>[0],
    );
    await vi.waitFor(() =>
      expect(publish).toHaveBeenLastCalledWith(
        expect.objectContaining({
          status: "error",
          error: expect.objectContaining({ code: "invalid_response" }),
        }),
      ),
    );
    client.dispose();
  });

  it.each([
    { head: 404, accepted: 0, restart: true },
    { head: 200, accepted: 0, restart: false },
    { head: 404, accepted: 1, restart: false },
  ])(
    "offers a fresh session only for a claimed, missing, empty tus resource ($head/$accepted)",
    async ({ head, accepted, restart }) => {
      const { client, publish } = prepare();
      await client.start();
      const upload = uploads[0]!;
      if (accepted) upload.options.onChunkComplete?.(accepted, accepted, 3);
      await upload.options.onAfterResponse?.(
        {
          getMethod: () => "HEAD",
          getURL: () => `${uploadSession.upload_endpoint}${uploadSession.id}`,
        } as HttpRequest,
        { getStatus: () => head } as HttpResponse,
      );
      await upload.options.onAfterResponse?.(
        {
          getMethod: () => "POST",
          getURL: () => uploadSession.upload_endpoint,
        } as HttpRequest,
        {
          getStatus: () => 409,
          getBody: () =>
            JSON.stringify({ error: { code: "UPLOAD_ALREADY_CREATED" } }),
        } as HttpResponse,
      );
      if (restart) {
        expect(publish).toHaveBeenLastCalledWith(
          expect.objectContaining({
            status: "error",
            error: expect.objectContaining({ code: "upload_setup_failed" }),
          }),
        );
        expect(upload.abort).toHaveBeenCalledOnce();
      } else {
        expect(publish).toHaveBeenLastCalledWith(
          expect.objectContaining({ status: "uploading" }),
        );
        expect(upload.abort).not.toHaveBeenCalled();
      }
      client.dispose();
    },
  );
});
