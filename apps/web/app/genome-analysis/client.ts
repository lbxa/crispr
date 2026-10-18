import { Upload } from "tus-js-client";
import { z } from "zod";
import {
  MAX_UPLOAD_BYTES,
  UPLOAD_ERRORS,
  uploadConfigSchema,
  uploadJobSchema,
  uploadSessionSchema,
  type GenomeAnalysisState,
  type GenomeUploadError,
  type UploadConfig,
  type UploadJob,
  type UploadSession,
} from "./contract";

class UploadFailure extends Error {
  constructor(readonly detail: GenomeUploadError) {
    super(detail.message);
  }
}

function failure(code: keyof typeof UPLOAD_ERRORS, retryable = true) {
  return new UploadFailure({ code, message: UPLOAD_ERRORS[code], retryable });
}

function safeApiUrl(value: string): URL {
  const url = new URL(value);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (
    (url.protocol !== "https:" && !(url.protocol === "http:" && local)) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  )
    throw failure("invalid_response", false);
  return url;
}

function progress(job: UploadJob) {
  return {
    records_scanned: job.records_scanned,
    variants_checked: job.variants_checked,
    retained_variants: job.retained_variants,
    uncompressed_bytes: job.uncompressed_bytes,
  };
}

/** Owns one capability-bound IBM upload and its durable analysis job. */
export class GenomeUpload {
  private readonly request = new AbortController();
  private config: UploadConfig | null = null;
  private session: UploadSession | null = null;
  private upload: Upload | null = null;
  private phase:
    "preparing" | "uploading" | "paused" | "job" | "error" | "finished" =
    "preparing";
  private uploaded = 0;
  private pauseTask: Promise<void> | null = null;
  private lastJob: UploadJob | null = null;
  private resuming = false;

  constructor(
    private readonly file: File,
    private readonly publish: (state: GenomeAnalysisState) => void,
  ) {}

  async start() {
    this.emit({
      status: "uploading",
      file: this.file,
      uploaded: 0,
      stage: "preparing",
    });
    try {
      if (!this.file.size || !/\.vcf(?:\.gz)?$/i.test(this.file.name))
        throw failure("invalid_file", false);
      if (this.file.size > MAX_UPLOAD_BYTES) throw failure("too_large", false);
      const config = uploadConfigSchema.safeParse(
        await this.json("/api/genome-uploads/config"),
      );
      if (!config.success) throw failure("invalid_response", false);
      safeApiUrl(config.data.api_url);
      this.config = config.data;
      if (this.file.size > config.data.max_upload_bytes)
        throw failure("too_large", false);
      const session = uploadSessionSchema.safeParse(
        await this.json(`${config.data.api_url.replace(/\/$/, "")}/uploads`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            size_bytes: this.file.size,
            format: /\.gz$/i.test(this.file.name) ? "vcf_gzip" : "vcf",
          }),
        }),
      );
      if (!session.success) throw failure("invalid_response", false);
      this.session = session.data;
      const endpoint = new URL(session.data.upload_endpoint);
      const api = safeApiUrl(config.data.api_url);
      if (
        endpoint.href !== `${api.origin}/files/` ||
        this.file.size > session.data.max_upload_bytes
      )
        throw failure("invalid_response", false);
      if (this.request.signal.aborted) return;
      const resource = `${endpoint.href}${session.data.id}`;
      let missingResource = false;
      this.upload = new Upload(this.file, {
        endpoint: endpoint.href,
        uploadUrl: resource,
        chunkSize: Math.min(config.data.chunk_size, session.data.chunk_size),
        retryDelays: [0, 1000, 3000, 5000],
        uploadDataDuringCreation: false,
        storeFingerprintForResuming: false,
        removeFingerprintOnSuccess: true,
        headers: { Authorization: `Bearer ${session.data.token}` },
        metadata: {
          session_id: session.data.id,
          format: /\.gz$/i.test(this.file.name) ? "vcf_gzip" : "vcf",
        },
        onBeforeRequest: (request) => {
          const allowed =
            request.getMethod() === "POST"
              ? request.getURL() === endpoint.href
              : ["HEAD", "PATCH"].includes(request.getMethod()) &&
                request.getURL() === resource;
          if (!allowed) throw failure("invalid_response", false);
        },
        onAfterResponse: (request, response) => {
          if (request.getMethod() === "HEAD" && request.getURL() === resource)
            missingResource = response.getStatus() === 404;
          if (
            request.getMethod() !== "POST" ||
            request.getURL() !== endpoint.href ||
            response.getStatus() !== 409 ||
            !missingResource ||
            this.uploaded !== 0
          )
            return;
          try {
            const conflict = z
              .object({
                error: z.object({ code: z.literal("UPLOAD_ALREADY_CREATED") }),
              })
              .safeParse(JSON.parse(response.getBody()));
            if (conflict.success) {
              // A claimed-but-missing tus resource cannot safely reuse its id:
              // tusd's file store truncates duplicate creations. Never retry it.
              this.fail(failure("upload_setup_failed"));
              void this.upload?.abort().catch(() => undefined);
            }
          } catch {
            /* Other conflict responses retain normal SDK retry behavior. */
          }
        },
        onChunkComplete: (_size, accepted) => {
          if (this.phase !== "uploading") return;
          if (
            !Number.isSafeInteger(accepted) ||
            accepted < 0 ||
            accepted > this.file.size
          ) {
            this.fail(failure("invalid_response", false));
            void this.upload?.abort();
            return;
          }
          this.uploaded = accepted;
          this.emit({
            status: "uploading",
            file: this.file,
            uploaded: accepted,
            stage: "transferring",
          });
        },
        onError: (error) => {
          if (this.phase !== "uploading") return;
          const status =
            "originalResponse" in error
              ? error.originalResponse?.getStatus()
              : undefined;
          this.fail(
            status && [401, 403, 404, 410].includes(status)
              ? failure("session_expired")
              : failure("upload_failed"),
          );
        },
        onSuccess: () => {
          if (this.phase === "uploading") {
            if (this.upload?.url !== resource)
              this.fail(failure("invalid_response", false));
            else void this.finish();
          }
        },
      });
      this.phase = "uploading";
      this.emit({
        status: "uploading",
        file: this.file,
        uploaded: this.uploaded,
        stage: "transferring",
      });
      this.upload.start();
    } catch (error) {
      this.fail(error);
    }
  }

  pause() {
    if (this.phase !== "uploading" || !this.upload) return;
    this.phase = "paused";
    this.emit({ status: "paused", file: this.file, uploaded: this.uploaded });
    this.pauseTask = this.upload.abort().catch(() => undefined);
  }

  async resume() {
    if (
      this.request.signal.aborted ||
      this.resuming ||
      !["error", "paused"].includes(this.phase)
    )
      return;
    this.resuming = true;
    try {
      await this.pauseTask;
      if (this.request.signal.aborted) return;
      if (!this.session || !this.upload) {
        await this.start();
        return;
      }
      if (this.lastJob?.status === "failed" && this.lastJob.error?.retryable) {
        this.phase = "job";
        const job = await this.jobRequest("/retry", "POST");
        await this.poll(job);
      } else if (this.phase === "paused" || this.phase === "error") {
        if (this.lastJob) {
          this.phase = "job";
          await this.poll(await this.jobRequest());
        } else {
          this.phase = "uploading";
          this.emit({
            status: "uploading",
            file: this.file,
            uploaded: this.uploaded,
            stage: "transferring",
          });
          this.upload.start();
        }
      }
    } catch (error) {
      this.fail(error);
    } finally {
      this.resuming = false;
    }
  }

  /** Local cleanup is synchronous; server cleanup expires safely if offline. */
  dispose() {
    this.request.abort();
    this.phase = "finished";
    void this.upload?.abort().catch(() => undefined);
  }

  async cancel() {
    this.dispose();
    if (this.config && this.session) {
      try {
        await fetch(
          `${this.config.api_url.replace(/\/$/, "")}/uploads/${this.session.id}`,
          {
            method: "DELETE",
            headers: { Authorization: `Bearer ${this.session.token}` },
            credentials: "omit",
            redirect: "error",
            cache: "no-store",
            signal: AbortSignal.timeout(15_000),
          },
        );
      } catch {
        /* The server's session expiry reclaims an unreachable upload. */
      }
    }
  }

  private emit(state: GenomeAnalysisState) {
    if (!this.request.signal.aborted) this.publish(state);
  }

  private fail(error: unknown) {
    if (this.request.signal.aborted) return;
    this.phase = "error";
    this.emit({
      status: "error",
      file: this.file,
      error:
        error instanceof UploadFailure
          ? error.detail
          : failure("backend_unavailable").detail,
    });
  }

  private async json(
    url: string,
    init: RequestInit = {},
    sessionRequest = false,
  ) {
    this.request.signal.throwIfAborted();
    const response = await fetch(url, {
      ...init,
      signal: AbortSignal.any([
        this.request.signal,
        AbortSignal.timeout(30_000),
      ]),
      credentials: "omit",
      redirect: "error",
      cache: "no-store",
    });
    this.request.signal.throwIfAborted();
    if (!response.ok) {
      if (sessionRequest && [401, 403, 404, 410].includes(response.status))
        throw failure("session_expired");
      if (response.status === 413) throw failure("too_large", false);
      throw failure("backend_unavailable");
    }
    try {
      return await response.json();
    } catch {
      throw failure("invalid_response");
    }
  }

  private async jobRequest(suffix = "", method = "GET") {
    if (!this.session || !this.config) throw failure("invalid_response", false);
    const result = uploadJobSchema.safeParse(
      await this.json(
        `${this.config.api_url.replace(/\/$/, "")}/uploads/${this.session.id}${suffix}`,
        {
          method,
          headers: { Authorization: `Bearer ${this.session.token}` },
        },
        true,
      ),
    );
    if (
      !result.success ||
      result.data.id !== this.session.id ||
      result.data.size_bytes !== this.file.size ||
      result.data.uploaded_bytes > this.file.size
    )
      throw failure("invalid_response");
    this.lastJob = result.data;
    return result.data;
  }

  private async finish() {
    this.phase = "job";
    this.uploaded = this.file.size;
    this.emit({
      status: "uploading",
      file: this.file,
      uploaded: this.uploaded,
      stage: "finishing",
    });
    try {
      await this.poll(await this.jobRequest("/complete", "POST"));
    } catch (error) {
      this.fail(error);
    }
  }

  private async poll(initial: UploadJob) {
    let job = initial;
    while (!this.request.signal.aborted) {
      if (job.status === "complete") {
        if (!job.report) throw failure("invalid_response");
        this.phase = "finished";
        this.emit({
          status: "complete",
          file: this.file,
          report: job.report,
          progress: progress(job),
        });
        return;
      }
      if (job.status === "failed")
        throw new UploadFailure({
          code: "processing_failed",
          message: job.error?.message ?? UPLOAD_ERRORS.processing_failed,
          retryable: job.error?.retryable ?? false,
        });
      if (job.status === "expired") throw failure("session_expired");
      if (job.status === "canceled") {
        this.phase = "finished";
        this.emit({ status: "canceled", file: this.file });
        return;
      }
      if (job.status !== "queued" && job.status !== "processing")
        throw failure("invalid_response");
      this.emit({
        status: job.status,
        file: this.file,
        progress: progress(job),
      });
      await new Promise<void>((resolve, reject) => {
        const stop = () => {
          clearTimeout(timer);
          reject(this.request.signal.reason);
        };
        const timer = setTimeout(() => {
          this.request.signal.removeEventListener("abort", stop);
          resolve();
        }, 1000);
        this.request.signal.addEventListener("abort", stop, { once: true });
      });
      job = await this.jobRequest();
    }
  }
}
