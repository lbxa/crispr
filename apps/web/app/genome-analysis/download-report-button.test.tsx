import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { toast } from "@crispr/ui/components/sonner";
import { DownloadReportButton } from "./download-report-button";

vi.mock("@crispr/ui/components/sonner", () => ({ toast: { error: vi.fn() } }));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it("downloads one PDF, prevents duplicate clicks, and revokes its temporary URL", async () => {
  vi.useFakeTimers();
  let resolve!: (blob: Blob) => void;
  const download = vi.fn(
    () =>
      new Promise<Blob>((done) => {
        resolve = done;
      }),
  );
  const create = vi
    .spyOn(URL, "createObjectURL")
    .mockReturnValue("blob:lab-report");
  const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  const click = vi
    .spyOn(HTMLAnchorElement.prototype, "click")
    .mockImplementation(function (this: HTMLAnchorElement) {
      expect(this.download).toBe("genome-lab-report.pdf");
      expect(this.href).toBe("blob:lab-report");
    });
  render(<DownloadReportButton download={download} />);
  const button = screen.getByRole("button", { name: "Download Report" });
  fireEvent.click(button);
  fireEvent.click(button);
  expect(download).toHaveBeenCalledOnce();
  expect(button.hasAttribute("disabled")).toBe(true);
  const pdf = new Blob(["%PDF-test"], { type: "application/pdf" });
  resolve(pdf);
  await vi.advanceTimersByTimeAsync(0);
  expect(create).toHaveBeenCalledWith(pdf);
  expect(click).toHaveBeenCalledOnce();
  expect(document.querySelector("a[download]")).toBeNull();
  await vi.advanceTimersByTimeAsync(1000);
  expect(revoke).toHaveBeenCalledWith("blob:lab-report");
});

it("aborts on unmount and never downloads a late response", async () => {
  let resolve!: (blob: Blob) => void;
  const download = vi.fn(
    (_signal: AbortSignal) =>
      new Promise<Blob>((done) => {
        resolve = done;
      }),
  );
  const create = vi.spyOn(URL, "createObjectURL");
  const view = render(<DownloadReportButton download={download} />);
  fireEvent.click(screen.getByRole("button", { name: "Download Report" }));
  view.unmount();
  expect(download.mock.calls[0]![0].aborted).toBe(true);
  resolve(new Blob(["%PDF-test"]));
  await Promise.resolve();
  expect(create).not.toHaveBeenCalled();
});

it("shows a safe error and allows a retry without displaying server details", async () => {
  const download = vi.fn().mockRejectedValue(new Error("private raw response"));
  render(<DownloadReportButton download={download} />);
  fireEvent.click(screen.getByRole("button", { name: "Download Report" }));
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith(
      "The lab report could not be downloaded. Try again shortly.",
    ),
  );
  expect(
    screen
      .getByRole("button", { name: "Download Report" })
      .hasAttribute("disabled"),
  ).toBe(false);
});

it("does not offer an unauthenticated download for a cached snapshot", () => {
  render(<DownloadReportButton />);
  expect(
    screen
      .getByRole("button", { name: "Download Report" })
      .hasAttribute("disabled"),
  ).toBe(true);
});
