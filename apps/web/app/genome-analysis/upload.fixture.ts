import {
  MAX_UPLOAD_BYTES,
  UPLOAD_CHUNK_BYTES,
  type UploadJob,
} from "./contract";
import { report } from "./report.fixture";

export const uploadConfig = {
  api_url: "https://ibm.example",
  max_upload_bytes: MAX_UPLOAD_BYTES,
  chunk_size: UPLOAD_CHUNK_BYTES,
};

export const uploadSession = {
  id: "abc123def456abc123def456",
  token: "test-upload-capability-not-a-secret",
  upload_endpoint: "https://ibm.example/files/",
  chunk_size: UPLOAD_CHUNK_BYTES,
  max_upload_bytes: MAX_UPLOAD_BYTES,
  status: "uploading" as const,
  expires_at: "2026-10-18T12:00:00Z",
};

export function uploadJob(
  size: number,
  changes: Partial<UploadJob> = {},
): UploadJob {
  return {
    id: uploadSession.id,
    status: "complete",
    size_bytes: size,
    uploaded_bytes: size,
    records_scanned: 100,
    variants_checked: 100,
    retained_variants: 1,
    uncompressed_bytes: 2048,
    report,
    error: null,
    ...changes,
  };
}
