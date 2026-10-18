import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ModelWorkspace } from "./model-workspace";
import { currentGenomeCache } from "./genome-analysis/cache";
import { genomeView } from "./genome-analysis/genome-view.fixture";
import {
  carrierReport,
  mappedReport,
  report,
} from "./genome-analysis/report.fixture";
import type { HumanModelHighlight } from "@crispr/human-model";
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
      highlights,
    }: {
      profile: string;
      modelUrl: string;
      highlights: readonly HumanModelHighlight[];
    }) {
      return (
        <div
          data-testid="human-model"
          data-profile={profile}
          data-model-url={modelUrl}
          data-highlights={JSON.stringify(highlights)}
        />
      );
    },
}));
vi.mock("./genome-explorer", () => ({
  GenomeExplorer: ({ active }: { active: boolean }) => (
    <div aria-label="Genome explorer" data-active={active} />
  ),
}));

let wideViewport = false;
const viewportListeners = new Set<() => void>();

function resizeWorkspace(wide: boolean) {
  act(() => {
    wideViewport = wide;
    viewportListeners.forEach((listener) => listener());
  });
}

beforeEach(async () => {
  await currentGenomeCache.forget();
  wideViewport = false;
  viewportListeners.clear();
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query.includes("min-width") && wideViewport,
    addEventListener: (_event: string, listener: () => void) => {
      if (query.includes("min-width")) viewportListeners.add(listener);
    },
    removeEventListener: (_event: string, listener: () => void) => {
      viewportListeners.delete(listener);
    },
  }));
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

// The file pane starts open; open it only when a test has closed it.
function openLeftPane() {
  const toggle = screen.getByRole("button", { name: "Left pane" });
  if (toggle.getAttribute("aria-expanded") !== "true") fireEvent.click(toggle);
}

describe("workspace widget grids", () => {
  it("shows HG001's PKU carrier association in red with an explicit carrier label", async () => {
    vi.stubGlobal(
      "fetch",
      mockUploadFetch({
        ...carrierReport,
        findings: [
          { tier: "carrier", gene: "PAH", disease: "Phenylketonuria" },
        ],
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
        target: { files: [new File(["VCF"], "HG001.vcf")] },
      });
    });

    expect(
      screen.getByTestId("human-model").getAttribute("data-highlights"),
    ).toContain('"association":"carrier"');
    expect(
      screen.getByText(/Carrier finding · Associated region shown in red/),
    ).toBeTruthy();
    expect(
      screen
        .getByRole("region", { name: "3D anatomy workspace" })
        .hasAttribute("data-phenotype"),
    ).toBe(false);
  });
  it("highlights disease regions in red without dimming, then clears them for a replacement", async () => {
    vi.stubGlobal("fetch", mockUploadFetch(mappedReport));
    render(
      <ModelWorkspace
        modelUrls={{ male: "/male.glb", female: "/female.glb" }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Left pane" }));
    await act(async () => {
      fireEvent.change(screen.getByLabelText("Choose a file"), {
        target: { files: [new File(["VCF"], "affected.vcf")] },
      });
    });
    const model = screen.getByTestId("human-model");
    expect(JSON.parse(model.getAttribute("data-highlights")!)).toEqual([
      { regionId: "digestive_tract", color: "#ef4444", strength: 1 },
      { regionId: "major_joints", color: "#ef4444", strength: 1 },
    ]);
    expect(
      screen
        .getByRole("region", { name: "3D anatomy workspace" })
        .hasAttribute("data-phenotype"),
    ).toBe(false);
    expect(
      screen.getByText("Disease-associated regions shown in red"),
    ).toBeTruthy();
    expect(screen.getByText(/Digestive tract, Major joints/)).toBeTruthy();
    vi.stubGlobal("fetch", mockUploadFetch(carrierReport));
    await act(async () => {
      fireEvent.change(screen.getByLabelText("Choose a file"), {
        target: { files: [new File(["VCF"], "carrier.vcf")] },
      });
    });
    expect(model.getAttribute("data-highlights")).toBe("[]");
    expect(
      screen.queryByText("Disease-associated regions shown in red"),
    ).toBeNull();
  });

  it("restores saved highlights without a new analysis call and clears them on removal", async () => {
    await currentGenomeCache.remember({
      status: "complete",
      file: new File(["VCF"], "saved.vcf"),
      report: mappedReport,
      progress: {
        records_scanned: 3,
        variants_checked: 3,
        retained_variants: 2,
        uncompressed_bytes: 100,
      },
    });
    render(
      <ModelWorkspace
        modelUrls={{ male: "/male.glb", female: "/female.glb" }}
      />,
    );
    await waitFor(() =>
      expect(
        screen.getByTestId("human-model").getAttribute("data-highlights"),
      ).toContain("#ef4444"),
    );
    expect(fetch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Left pane" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Remove genome" }));
    });
    await waitFor(() =>
      expect(
        screen.getByTestId("human-model").getAttribute("data-highlights"),
      ).toBe("[]"),
    );
  });

  it("distinguishes unavailable mappings from no findings", async () => {
    vi.stubGlobal(
      "fetch",
      mockUploadFetch({ ...mappedReport, body_map: undefined }),
    );
    render(
      <ModelWorkspace
        modelUrls={{ male: "/male.glb", female: "/female.glb" }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Left pane" }));
    await act(async () => {
      fireEvent.change(screen.getByLabelText("Choose a file"), {
        target: { files: [new File(["VCF"], "legacy.vcf")] },
      });
    });
    expect(
      screen.getByText(
        "Body region mapping unavailable. Analyze this genome again.",
      ),
    ).toBeTruthy();
    expect(screen.queryByText("No phenotypic symptoms predicted")).toBeNull();
  });
  it("keeps both panes and the scene mounted on a wide workspace", () => {
    resizeWorkspace(true);
    render(
      <ModelWorkspace
        modelUrls={{ male: "/male.glb", female: "/female.glb" }}
      />,
    );
    const scene = screen.getByTestId("human-model");
    const leftToggle = screen.getByRole("button", { name: "Left pane" });
    const rightToggle = screen.getByRole("button", { name: "Right pane" });
    fireEvent.click(rightToggle);

    const leftPane = screen.getByRole("region", {
      name: "Left workspace pane",
    });
    const rightPane = screen.getByRole("region", {
      name: "Right workspace pane",
    });
    expect(leftToggle.getAttribute("aria-expanded")).toBe("true");
    expect(rightToggle.getAttribute("aria-expanded")).toBe("true");
    expect(leftPane.hasAttribute("inert")).toBe(false);
    expect(rightPane.hasAttribute("inert")).toBe(false);
    expect(screen.getByTestId("human-model")).toBe(scene);

    fireEvent.keyDown(leftPane, { key: "Escape" });
    expect(leftToggle.getAttribute("aria-expanded")).toBe("false");
    expect(rightToggle.getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement).toBe(leftToggle);
    expect(screen.getByTestId("human-model")).toBe(scene);
  });

  it("collapses to the last opened pane on resize without losing wide-screen state", () => {
    resizeWorkspace(true);
    render(
      <ModelWorkspace
        modelUrls={{ male: "/male.glb", female: "/female.glb" }}
      />,
    );
    const leftToggle = screen.getByRole("button", { name: "Left pane" });
    const rightToggle = screen.getByRole("button", { name: "Right pane" });
    fireEvent.click(rightToggle);
    const fileCard = screen.getByRole("button", { name: "Choose file" });
    const rightPane = screen.getByRole("region", {
      name: "Right workspace pane",
    });

    resizeWorkspace(false);
    expect(leftToggle.getAttribute("aria-expanded")).toBe("false");
    expect(rightToggle.getAttribute("aria-expanded")).toBe("true");
    expect(
      screen.queryByRole("region", { name: "Left workspace pane" }),
    ).toBeNull();
    expect(screen.getByRole("region", { name: "Right workspace pane" })).toBe(
      rightPane,
    );

    resizeWorkspace(true);
    expect(leftToggle.getAttribute("aria-expanded")).toBe("true");
    expect(rightToggle.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("button", { name: "Choose file" })).toBe(fileCard);

    resizeWorkspace(false);
    fireEvent.keyDown(rightPane, { key: "Escape" });
    resizeWorkspace(true);
    expect(leftToggle.getAttribute("aria-expanded")).toBe("false");
    expect(rightToggle.getAttribute("aria-expanded")).toBe("false");
  });

  it("opens the file pane first, before any genome is chosen", () => {
    render(
      <ModelWorkspace
        modelUrls={{ male: "/male.glb", female: "/female.glb" }}
      />,
    );

    expect(
      screen
        .getByRole("button", { name: "Left pane" })
        .getAttribute("aria-expanded"),
    ).toBe("true");
    expect(screen.getByText("Drop your genome")).toBeTruthy();
  });

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
      openLeftPane();

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
    openLeftPane();
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
    openLeftPane();
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
    openLeftPane();
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
      "date",
      "summary",
    ]);
  });

  it("opens the genome explorer once when a new genome finishes analysis", async () => {
    vi.stubGlobal(
      "fetch",
      mockUploadFetch({ ...report, genome_view: genomeView }),
    );
    render(
      <ModelWorkspace
        modelUrls={{ male: "/male.glb", female: "/female.glb" }}
      />,
    );
    const rightPane = document.getElementById("workspace-pane-right")!;
    const upload = async (name: string) => {
      await act(async () => {
        fireEvent.change(screen.getByLabelText("Choose a file"), {
          target: { files: [new File(["VCF"], name)] },
        });
      });
    };
    expect(rightPane.getAttribute("aria-hidden")).toBe("true");
    openLeftPane();
    await upload("first.vcf");
    expect(rightPane.getAttribute("aria-hidden")).toBe("false");
    expect(
      within(rightPane)
        .getByLabelText("Genome explorer")
        .getAttribute("data-active"),
    ).toBe("true");

    // Closing it sticks: the same analysis does not reopen it.
    fireEvent.click(screen.getByRole("button", { name: "Right pane" }));
    expect(rightPane.getAttribute("aria-hidden")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Left pane" }));
    expect(rightPane.getAttribute("aria-hidden")).toBe("true");

    // A replacement genome is new, so it opens again.
    await upload("second.vcf");
    expect(rightPane.getAttribute("aria-hidden")).toBe("false");
  });

  it("does not open the explorer for a genome without a region map", async () => {
    render(
      <ModelWorkspace
        modelUrls={{ male: "/male.glb", female: "/female.glb" }}
      />,
    );
    openLeftPane();
    await act(async () => {
      fireEvent.change(screen.getByLabelText("Choose a file"), {
        target: { files: [new File(["VCF"], "unmapped.vcf")] },
      });
    });
    expect(
      document
        .getElementById("workspace-pane-right")!
        .getAttribute("aria-hidden"),
    ).toBe("true");
  });

  it("dims the avatar and says why once a genome yields no predicted symptoms", async () => {
    render(
      <ModelWorkspace
        modelUrls={{ male: "/male.glb", female: "/female.glb" }}
      />,
    );
    const stage = screen.getByRole("region", { name: "3D anatomy workspace" });
    // Nothing has been analyzed yet, so there is nothing to say about symptoms.
    expect(stage.hasAttribute("data-phenotype")).toBe(false);
    expect(screen.queryByText("No phenotypic symptoms predicted")).toBeNull();
    openLeftPane();
    await act(async () => {
      fireEvent.change(screen.getByLabelText("Choose a file"), {
        target: { files: [new File(["VCF"], "sample.vcf")] },
      });
    });
    expect(stage.getAttribute("data-phenotype")).toBe("none");
    expect(
      within(stage).getByText("No phenotypic symptoms predicted"),
    ).toBeTruthy();
  });

  it("leaves the avatar alone when symptoms are predicted", async () => {
    vi.stubGlobal(
      "fetch",
      mockUploadFetch({
        ...report,
        predicted_symptoms: [{ id: "HP:0001945", name: "Fever" }],
      }),
    );
    render(
      <ModelWorkspace
        modelUrls={{ male: "/male.glb", female: "/female.glb" }}
      />,
    );
    openLeftPane();
    await act(async () => {
      fireEvent.change(screen.getByLabelText("Choose a file"), {
        target: { files: [new File(["VCF"], "sample.vcf")] },
      });
    });
    expect(screen.getByText(report.summary.text)).toBeTruthy();
    expect(
      screen
        .getByRole("region", { name: "3D anatomy workspace" })
        .hasAttribute("data-phenotype"),
    ).toBe(false);
    expect(screen.queryByText("No phenotypic symptoms predicted")).toBeNull();
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
    openLeftPane();
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
    openLeftPane();
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
