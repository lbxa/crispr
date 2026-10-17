import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GenomeSummaryCard } from "./summary-card";
import { uploadJob } from "./upload.fixture";

afterEach(cleanup);

describe("large genome summary", () => {
  it("shows saved byte progress and accessible pause/resume controls", () => {
    const file = new File(["data"], "genome.vcf.gz");
    const actions = {
      onPause: vi.fn(),
      onResume: vi.fn(),
      onCancel: vi.fn(),
      onRetry: vi.fn(),
    };
    const { rerender } = render(
      <GenomeSummaryCard
        {...actions}
        analysis={{
          status: "uploading",
          stage: "transferring",
          file,
          uploaded: 2,
        }}
      />,
    );
    expect(
      screen
        .getByRole("progressbar", { name: "Genome upload" })
        .getAttribute("value"),
    ).toBe("2");
    fireEvent.click(screen.getByRole("button", { name: "Pause upload" }));
    expect(actions.onPause).toHaveBeenCalledOnce();
    rerender(
      <GenomeSummaryCard
        {...actions}
        analysis={{ status: "paused", file, uploaded: 2 }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Resume upload" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(actions.onResume).toHaveBeenCalledOnce();
    expect(actions.onCancel).toHaveBeenCalledOnce();
  });

  it("reports streaming records instead of inventing a processing percentage", () => {
    const file = new File(["data"], "genome.vcf.gz");
    render(
      <GenomeSummaryCard
        onPause={vi.fn()}
        onResume={vi.fn()}
        onCancel={vi.fn()}
        onRetry={vi.fn()}
        analysis={{
          status: "processing",
          file,
          progress: uploadJob(file.size),
        }}
      />,
    );
    expect(screen.getByText("100 records scanned · 2 KB read")).toBeTruthy();
    expect(screen.getByText("1 panel variants retained")).toBeTruthy();
    expect(screen.queryByRole("progressbar")).toBeNull();
  });
});
