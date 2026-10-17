import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useGenomeAnalysis } from "./use-genome-analysis";
import { uploadConfig, uploadSession } from "./upload.fixture";
import type { HttpRequest, HttpResponse, Upload } from "tus-js-client";

const { uploads } = vi.hoisted(() => ({
  uploads: [] as {
    options: ConstructorParameters<typeof Upload>[1];
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
      _file: File,
      readonly options: ConstructorParameters<typeof Upload>[1],
    ) {
      uploads.push(this);
    }
  },
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  uploads.length = 0;
});

describe("genome analysis lifecycle", () => {
  it("aborts the previous upload and ignores its response if it arrives late", async () => {
    let resolveFirst!: (response: Response) => void;
    const first = new Promise<Response>((resolve) => {
      resolveFirst = resolve;
    });
    const fetch = vi
      .fn()
      .mockReturnValueOnce(first)
      .mockResolvedValueOnce(Response.json(uploadConfig))
      .mockResolvedValueOnce(Response.json(uploadSession));
    vi.stubGlobal("fetch", fetch);
    const { result } = renderHook(useGenomeAnalysis);
    let pending: Promise<void>;
    act(() => {
      pending = result.current.analyze(new File(["a"], "old.vcf"));
    });
    expect(result.current.analysis.status).toBe("uploading");

    await act(async () => {
      await result.current.analyze(new File(["b"], "new.vcf"));
    });
    expect(fetch.mock.calls[0]?.[1]?.signal.aborted).toBe(true);
    expect(JSON.parse(fetch.mock.calls[2]?.[1]?.body)).toEqual({
      size_bytes: 1,
      format: "vcf",
    });
    await act(async () => {
      resolveFirst(Response.json(uploadConfig));
      await pending;
    });

    expect(result.current.analysis).toMatchObject({
      status: "uploading",
      file: { name: "new.vcf" },
    });
  });

  it("cancels the active request when the owning workspace unmounts", async () => {
    let resolvePending!: (response: Response) => void;
    const pending = new Promise<Response>((resolve) => {
      resolvePending = resolve;
    });
    const fetch = vi.fn().mockReturnValue(pending);
    vi.stubGlobal("fetch", fetch);
    const { result, unmount } = renderHook(useGenomeAnalysis);
    let completed: Promise<void>;
    act(() => {
      completed = result.current.analyze(new File(["data"], "sample.vcf"));
    });
    unmount();
    expect(fetch.mock.calls[0]?.[1]?.signal.aborted).toBe(true);
    await act(async () => {
      resolvePending(Response.json(uploadConfig));
      await completed;
    });
  });

  it("rejects an invalid upload configuration before selecting a data endpoint", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(Response.json({ api_url: "https://ibm.example" })),
    );
    const { result } = renderHook(useGenomeAnalysis);
    await act(async () => {
      await result.current.analyze(new File(["data"], "sample.vcf"));
    });
    expect(result.current.analysis).toMatchObject({
      status: "error",
      error: { code: "invalid_response" },
    });
  });

  it("cancels a claimed-but-missing resource and starts a fresh session only after an explicit retry", async () => {
    const freshId = "fresh123fresh456fresh789";
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json(uploadConfig))
      .mockResolvedValueOnce(Response.json(uploadSession))
      .mockResolvedValueOnce(Response.json({ status: "canceled" }))
      .mockResolvedValueOnce(Response.json(uploadConfig))
      .mockResolvedValueOnce(Response.json({ ...uploadSession, id: freshId }));
    vi.stubGlobal("fetch", fetch);
    const { result } = renderHook(useGenomeAnalysis);
    await act(async () => {
      await result.current.analyze(new File(["VCF"], "genome.vcf"));
    });
    const previous = uploads[0]!;
    await act(async () => {
      await previous.options.onAfterResponse?.(
        {
          getMethod: () => "HEAD",
          getURL: () => `${uploadSession.upload_endpoint}${uploadSession.id}`,
        } as HttpRequest,
        { getStatus: () => 404 } as HttpResponse,
      );
      await previous.options.onAfterResponse?.(
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
    });
    expect(result.current.analysis).toMatchObject({
      status: "error",
      error: { code: "upload_setup_failed" },
    });
    expect(fetch).toHaveBeenCalledTimes(2);
    await act(async () => {
      await result.current.retry();
    });
    expect(fetch.mock.calls[2]).toMatchObject([
      `${uploadConfig.api_url}/uploads/${uploadSession.id}`,
      { method: "DELETE" },
    ]);
    expect(uploads).toHaveLength(2);
    expect(uploads[1]!.options).toMatchObject({
      uploadUrl: `${uploadSession.upload_endpoint}${freshId}`,
      metadata: { session_id: freshId },
    });
    expect(previous.start).toHaveBeenCalledOnce();
    expect(result.current.analysis).toMatchObject({
      status: "uploading",
      file: { name: "genome.vcf" },
    });
  });

  it("does not start a replacement upload if the workspace unmounts during session cancellation", async () => {
    let resolveCancel!: (response: Response) => void;
    const pendingCancel = new Promise<Response>((resolve) => {
      resolveCancel = resolve;
    });
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json(uploadConfig))
      .mockResolvedValueOnce(Response.json(uploadSession))
      .mockReturnValueOnce(pendingCancel);
    vi.stubGlobal("fetch", fetch);
    const { result, unmount } = renderHook(useGenomeAnalysis);
    await act(async () => {
      await result.current.analyze(new File(["VCF"], "genome.vcf"));
    });
    await act(async () => {
      uploads[0]!.options.onError?.({
        originalResponse: { getStatus: () => 410 },
      } as Parameters<
        NonNullable<ConstructorParameters<typeof Upload>[1]["onError"]>
      >[0]);
    });
    let retry!: Promise<void>;
    act(() => {
      retry = result.current.retry();
    });
    unmount();
    await act(async () => {
      resolveCancel(Response.json({ status: "canceled" }));
      await retry;
    });
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(uploads).toHaveLength(1);
  });
});
