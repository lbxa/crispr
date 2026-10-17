import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ModelWorkspace } from "./model-workspace";
import { carrierReport, report } from "./genome-analysis/report.fixture";
import {
  uploadConfig,
  uploadJob,
  uploadSession,
} from "./genome-analysis/upload.fixture";
import type { Upload } from "tus-js-client";

vi.mock("tus-js-client", () => ({
  Upload: class {
    url = `${uploadSession.upload_endpoint}${uploadSession.id}`;
    constructor(
      _file: File,
      readonly options: ConstructorParameters<typeof Upload>[1],
    ) {}
    start() {
      this.options.onSuccess?.(
        {} as Parameters<
          NonNullable<ConstructorParameters<typeof Upload>[1]["onSuccess"]>
        >[0],
      );
    }
    abort() {
      return Promise.resolve();
    }
  },
}));

function mockUploadFetch(nextReport = report) {
  return vi
    .fn()
    .mockImplementation(async (url: string, options?: RequestInit) => {
      if (url === "/api/genome-uploads/config")
        return Response.json(uploadConfig);
      if (url.endsWith("/uploads") && options?.method === "POST")
        return Response.json(uploadSession);
      return Response.json(uploadJob(3, { report: nextReport }));
    });
}

// Scene startup is independently covered by verify:browser; retain the real
// grids and file picker here to exercise their event/state boundaries.
vi.mock("next/dynamic", () => ({
  default: () =>
    function HumanModel({
      profile,
      modelUrl,
    }: {
      profile: string;
      modelUrl: string;
    }) {
      return (
        <div
          data-testid="human-model"
          data-profile={profile}
          data-model-url={modelUrl}
        />
      );
    },
}));
vi.mock("./genome-explorer", () => ({
  GenomeExplorer: ({ active }: { active: boolean }) => (
    <div aria-label="Genome explorer" data-active={active} />
  ),
}));

beforeEach(() => {
  vi.stubGlobal("fetch", mockUploadFetch());
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("workspace widget grids", () => {
  it("omits manual body profiles and developer region controls", () => {
    render(
      <ModelWorkspace
        modelUrls={{ male: "/male.glb", female: "/female.glb" }}
      />,
    );

    expect(screen.queryAllByRole("radio")).toHaveLength(0);
    expect(screen.queryByRole("button", { name: "Regions" })).toBeNull();
    expect(
      screen.queryByRole("complementary", { name: "Anatomy controls" }),
    ).toBeNull();
  });

  it.each(["male", "female", null, undefined] as const)(
    "selects the avatar from the completed genome profile %s",
    async (modelProfile) => {
      vi.stubGlobal(
        "fetch",
        mockUploadFetch({
          ...report,
          genome: { ...report.genome, model_profile: modelProfile },
        }),
      );
      render(
        <ModelWorkspace
          modelUrls={{ male: "/male.glb", female: "/female.glb" }}
        />,
      );
      fireEvent.click(screen.getByRole("button", { name: "Left pane" }));

      await act(async () => {
        fireEvent.change(screen.getByLabelText("Choose a file"), {
          target: { files: [new File(["VCF"], "sample.vcf")] },
        });
      });

      const expected = modelProfile ?? "male";
      expect(
        screen.getByTestId("human-model").getAttribute("data-profile"),
      ).toBe(expected);
      expect(
        screen.getByTestId("human-model").getAttribute("data-model-url"),
      ).toBe(`/${expected}.glb`);
    },
  );

  it("drops the previous genome's profile when a replacement has no metadata", async () => {
    vi.stubGlobal(
      "fetch",
      mockUploadFetch({
        ...report,
        genome: { ...report.genome, model_profile: "female" },
      }),
    );
    render(
      <ModelWorkspace
        modelUrls={{ male: "/male.glb", female: "/female.glb" }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Left pane" }));
    await act(async () => {
      fireEvent.change(screen.getByLabelText("Choose a file"), {
        target: { files: [new File(["VCF"], "first.vcf")] },
      });
    });
    expect(screen.getByTestId("human-model").getAttribute("data-profile")).toBe(
      "female",
    );

    vi.stubGlobal("fetch", mockUploadFetch());
    await act(async () => {
      fireEvent.change(screen.getByLabelText("Choose a file"), {
        target: { files: [new File(["VCF"], "replacement.vcf")] },
      });
    });

    expect(screen.getByTestId("human-model").getAttribute("data-profile")).toBe(
      "male",
    );
    expect(screen.getByText("replacement.vcf")).toBeTruthy();
  });

  it("shows the backend's carrier summary and disclaimer without treating it as a diagnosis", async () => {
    vi.stubGlobal("fetch", mockUploadFetch(carrierReport));
    render(
      <ModelWorkspace
        modelUrls={{ male: "/male.glb", female: "/female.glb" }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Left pane" }));
    await act(async () => {
      fireEvent.change(screen.getByLabelText("Choose a file"), {
        target: { files: [new File(["VCF"], "carrier.vcf")] },
      });
    });
    expect(screen.getByText(carrierReport.summary.text)).toBeTruthy();
    expect(screen.getByText(carrierReport.disclaimer)).toBeTruthy();
    expect(screen.getByText("Genome-only analysis")).toBeTruthy();
  });
  it("keeps the file and scene mounted across independent pane switches", async () => {
    render(
      <ModelWorkspace
        modelUrls={{ male: "/male.glb", female: "/female.glb" }}
      />,
    );
    const scene = screen.getByTestId("human-model");
    fireEvent.click(screen.getByRole("button", { name: "Left pane" }));
    const leftPane = screen.getByRole("region", {
      name: "Left workspace pane",
    });
    expect(
      within(leftPane).getByLabelText("Left widgets").getAttribute("data-slot"),
    ).toBe("widget-grid");
    expect(within(leftPane).getByRole("group", { name: "Files" })).toBeTruthy();
    await act(async () => {
      fireEvent.change(screen.getByLabelText("Choose a file"), {
        target: { files: [new File(["VCF"], "sample.vcf")] },
      });
    });

    fireEvent.click(screen.getByRole("button", { name: "Right pane" }));
    const rightPane = screen.getByRole("region", {
      name: "Right workspace pane",
    });
    expect(
      within(rightPane)
        .getByLabelText("Genome explorer")
        .getAttribute("data-active"),
    ).toBe("true");
    expect(leftPane.hasAttribute("inert")).toBe(true);
    expect(screen.getByTestId("human-model")).toBe(scene);

    fireEvent.click(screen.getByRole("button", { name: "Left pane" }));
    expect(screen.getByText("sample.vcf")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Replace file" })).toBeTruthy();
    expect(screen.getByText(report.summary.text)).toBeTruthy();
    const widgets = within(leftPane)
      .getAllByRole("group")
      .filter((item) => item.hasAttribute("data-widget-id"));
    expect(widgets.map((item) => item.getAttribute("data-widget-id"))).toEqual([
      "files",
      "summary",
    ]);
  });

  it("shows an analysis error and retries the same file without opening another chooser", async () => {
    const fetch = mockUploadFetch();
    fetch.mockRejectedValueOnce(new TypeError("offline"));
    vi.stubGlobal("fetch", fetch);
    render(
      <ModelWorkspace
        modelUrls={{ male: "/male.glb", female: "/female.glb" }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Left pane" }));
    await act(async () => {
      fireEvent.change(screen.getByLabelText("Choose a file"), {
        target: { files: [new File(["VCF"], "retry.vcf")] },
      });
    });
    expect(screen.getByRole("alert").textContent).toContain("unavailable");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    });
    expect(screen.getByText(report.summary.text)).toBeTruthy();
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(screen.getByText("retry.vcf")).toBeTruthy();
  });

  it("separates widget keyboard pickup from the file picker and pane dismissal", () => {
    render(
      <ModelWorkspace
        modelUrls={{ male: "/male.glb", female: "/female.glb" }}
      />,
    );
    const openPicker = vi.spyOn(HTMLInputElement.prototype, "click");
    const leftToggle = screen.getByRole("button", { name: "Left pane" });
    fireEvent.click(leftToggle);
    const widget = screen.getByRole("group", { name: "Files" });

    fireEvent.keyDown(widget, { key: " " });
    expect(widget.getAttribute("data-drag-state")).toBe("dragging");
    fireEvent.keyDown(widget, { key: "Escape" });
    expect(widget.getAttribute("data-drag-state")).toBe("idle");
    expect(leftToggle.getAttribute("aria-expanded")).toBe("true");
    expect(openPicker).not.toHaveBeenCalled();

    fireEvent.keyDown(screen.getByRole("button", { name: "Choose file" }), {
      key: "Enter",
    });
    expect(openPicker).toHaveBeenCalledOnce();
    fireEvent.keyDown(widget, { key: "Escape" });
    expect(leftToggle.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(leftToggle);
  });

  it("cancels an unfinished pickup when switching panes", () => {
    render(
      <ModelWorkspace
        modelUrls={{ male: "/male.glb", female: "/female.glb" }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Left pane" }));
    const widget = screen.getByRole("group", { name: "Files" });
    fireEvent.keyDown(widget, { key: " " });

    const rightToggle = screen.getByRole("button", { name: "Right pane" });
    fireEvent.click(rightToggle);
    expect(widget.getAttribute("data-drag-state")).toBe("idle");
    fireEvent.keyDown(rightToggle, { key: "Escape" });
    expect(rightToggle.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(screen.getByRole("button", { name: "Left pane" }));
    expect(widget.getAttribute("data-drag-state")).toBe("idle");
  });
});
