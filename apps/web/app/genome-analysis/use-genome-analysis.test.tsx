import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useGenomeAnalysis } from "./use-genome-analysis";
import { currentGenomeCache } from "./cache";
import { uploadConfig, uploadJob, uploadSession } from "./upload.fixture";
import { report } from "./report.fixture";
import type { GenomeAnalysisState } from "./contract";
import type { HttpRequest, HttpResponse, Upload } from "tus-js-client";
import { LIBRARY_GENOMES } from "../genome-library/catalog";

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

vi.mock("./cache", () => ({
  currentGenomeCache: {
    restore: vi.fn(),
    remember: vi.fn(),
    forget: vi.fn(),
  },
}));

const cachedGenome: Extract<GenomeAnalysisState, { status: "complete" }> = {
  status: "complete",
  file: {
    name: "saved.vcf",
    size: 2_100_000_000,
    type: "application/vcf",
    lastModified: 1000,
  },
  report,
  progress: {
    records_scanned: 100,
    variants_checked: 100,
    retained_variants: 1,
    uncompressed_bytes: 2048,
  },
};

beforeEach(() => {
  vi.mocked(currentGenomeCache.restore).mockReset().mockResolvedValue(null);
  vi.mocked(currentGenomeCache.remember)
    .mockReset()
    .mockResolvedValue(undefined);
  vi.mocked(currentGenomeCache.forget).mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  uploads.length = 0;
});

describe("genome analysis lifecycle", () => {
  it("prepares the curated file and allows another attempt after a failed download", async () => {
    const genome = LIBRARY_GENOMES[0]!;
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(new Response("VCF"));
    vi.stubGlobal("fetch", fetch);
    const { result } = renderHook(useGenomeAnalysis);
    await act(async () => {
      expect(await result.current.prepareLibraryGenome(genome)).toBeNull();
    });
    expect(result.current.libraryError).toBeTruthy();
    let file: File | null = null;
    await act(async () => {
      file = await result.current.prepareLibraryGenome(genome);
    });
    expect(file).toMatchObject({
      name: genome.fileName,
      size: 3,
      type: "application/vcf",
    });
    expect(result.current.libraryLoading).toBeNull();
    expect(result.current.libraryError).toBeNull();
    expect(uploads).toHaveLength(0);
  });

  it("a local file cancels and supersedes a delayed library selection", async () => {
    let finish!: (response: Response) => void;
    const pending = new Promise<Response>((resolve) => {
      finish = resolve;
    });
    const fetch = vi
      .fn()
      .mockReturnValueOnce(pending)
      .mockResolvedValueOnce(Response.json(uploadConfig))
      .mockResolvedValueOnce(Response.json(uploadSession));
    vi.stubGlobal("fetch", fetch);
    const { result } = renderHook(useGenomeAnalysis);
    let preparation!: Promise<File | null>;
    act(() => {
      preparation = result.current.prepareLibraryGenome(LIBRARY_GENOMES[0]!);
    });
    expect(result.current.libraryLoading).toBe(LIBRARY_GENOMES[0]!.id);
    await act(async () => {
      await result.current.analyze(new File(["VCF"], "mine.vcf"));
    });
    expect(fetch.mock.calls[0]![1].signal.aborted).toBe(true);
    await act(async () => {
      finish(new Response("VCF"));
      expect(await preparation).toBeNull();
    });
    expect(result.current.analysis).toMatchObject({
      status: "uploading",
      file: { name: "mine.vcf" },
    });
    expect(result.current.libraryLoading).toBeNull();
    expect(result.current.libraryError).toBeNull();
    expect(uploads).toHaveLength(1);
  });

  it("aborts pending library requests on unmount and ignores a late response", async () => {
    let finish!: (response: Response) => void;
    const fetch = vi.fn().mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        }),
    );
    vi.stubGlobal("fetch", fetch);
    const { result, unmount } = renderHook(useGenomeAnalysis);
    let preparation!: Promise<File | null>;
    act(() => {
      preparation = result.current.prepareLibraryGenome(LIBRARY_GENOMES[0]!);
    });
    unmount();
    expect(fetch.mock.calls[0]![1].signal.aborted).toBe(true);
    finish(new Response("VCF"));
    expect(await preparation).toBeNull();
    expect(uploads).toHaveLength(0);
  });

  it("restores the current genome without starting an upload or fetching analysis again", async () => {
    // Arrange
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    vi.mocked(currentGenomeCache.restore).mockResolvedValue(cachedGenome);

    // Act
    const { result } = renderHook(() => useGenomeAnalysis({ restore: true }));
    await waitFor(() =>
      expect(result.current.analysis.status).toBe("complete"),
    );

    // Assert
    expect(result.current.analysis).toEqual(cachedGenome);
    expect(result.current.cacheSaved).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
    expect(currentGenomeCache.remember).not.toHaveBeenCalled();
  });

  it("starts without a genome and discards the saved copy by default", async () => {
    // Arrange
    vi.mocked(currentGenomeCache.restore).mockResolvedValue(cachedGenome);

    // Act
    const { result } = renderHook(useGenomeAnalysis);
    await waitFor(() => expect(result.current.cacheReady).toBe(true));

    // Assert
    expect(result.current.analysis.status).toBe("idle");
    expect(currentGenomeCache.restore).not.toHaveBeenCalled();
    expect(currentGenomeCache.forget).toHaveBeenCalled();
  });

  it("does not let a delayed cache read replace a newly selected genome", async () => {
    // Arrange
    let restore!: (value: typeof cachedGenome) => void;
    vi.mocked(currentGenomeCache.restore).mockReturnValue(
      new Promise((resolve) => {
        restore = resolve;
      }),
    );
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(Response.json(uploadConfig))
        .mockResolvedValueOnce(Response.json(uploadSession)),
    );
    const { result } = renderHook(() => useGenomeAnalysis({ restore: true }));

    // Act
    await act(async () => {
      await result.current.analyze(new File(["VCF"], "new.vcf"));
      restore(cachedGenome);
    });

    // Assert
    expect(result.current.analysis).toMatchObject({
      status: "uploading",
      file: { name: "new.vcf" },
    });
    await waitFor(() => expect(currentGenomeCache.forget).toHaveBeenCalled());
  });

  it("saves a completed analysis and preserves it when browser storage fails", async () => {
    // Arrange
    const file = new File(["VCF"], "new.vcf");
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(Response.json(uploadConfig))
        .mockResolvedValueOnce(Response.json(uploadSession))
        .mockResolvedValueOnce(Response.json(uploadJob(file.size))),
    );
    vi.mocked(currentGenomeCache.remember).mockRejectedValue(
      new DOMException("Full", "QuotaExceededError"),
    );
    const { result } = renderHook(useGenomeAnalysis);

    // Act
    await act(async () => {
      await result.current.analyze(file);
      uploads[0]!.options.onSuccess?.(
        {} as Parameters<
          NonNullable<ConstructorParameters<typeof Upload>[1]["onSuccess"]>
        >[0],
      );
    });

    // Assert
    await waitFor(() =>
      expect(result.current.analysis.status).toBe("complete"),
    );
    await waitFor(() => expect(result.current.cacheError).toMatch(/refresh/i));
    expect(currentGenomeCache.remember).toHaveBeenCalledWith(
      expect.objectContaining({ file, report }),
    );
    expect(result.current.cacheSaved).toBe(false);
  });

  it("marks a genome cached only after the IndexedDB write completes", async () => {
    // Arrange
    let finishSaving!: () => void;
    vi.mocked(currentGenomeCache.remember).mockReturnValue(
      new Promise((resolve) => {
        finishSaving = resolve;
      }),
    );
    const file = new File(["VCF"], "saved.vcf");
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(Response.json(uploadConfig))
        .mockResolvedValueOnce(Response.json(uploadSession))
        .mockResolvedValueOnce(Response.json(uploadJob(file.size))),
    );
    const { result } = renderHook(useGenomeAnalysis);

    // Act
    await act(async () => {
      await result.current.analyze(file);
      uploads[0]!.options.onSuccess?.(
        {} as Parameters<
          NonNullable<ConstructorParameters<typeof Upload>[1]["onSuccess"]>
        >[0],
      );
    });
    await waitFor(() =>
      expect(result.current.analysis.status).toBe("complete"),
    );

    // Assert
    expect(result.current.cacheSaved).toBe(false);
    await act(async () => {
      finishSaving();
    });
    expect(result.current.cacheSaved).toBe(true);
  });

  it("forgets the restored genome so a later refresh cannot bring it back", async () => {
    // Arrange
    vi.mocked(currentGenomeCache.restore).mockResolvedValue(cachedGenome);
    const { result } = renderHook(() => useGenomeAnalysis({ restore: true }));
    await waitFor(() =>
      expect(result.current.analysis.status).toBe("complete"),
    );

    // Act
    await act(async () => {
      await result.current.clear();
    });

    // Assert
    expect(result.current.analysis.status).toBe("idle");
    expect(currentGenomeCache.forget).toHaveBeenCalled();
  });

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
