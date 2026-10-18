import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FileDropCard } from "./file-drop-card";
import { useState } from "react";
import { UPLOAD_ERRORS, MAX_UPLOAD_BYTES } from "./genome-analysis/contract";

const oversizedFile = new File(["size-only fixture"], "large.vcf");
Object.defineProperty(oversizedFile, "size", { value: MAX_UPLOAD_BYTES + 1 });

function FileDropCardFixture() {
  const [file, setFile] = useState<File | null>(null);
  return <FileDropCard file={file} onFileSelect={setFile} />;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("FileDropCard", () => {
  it.each(["Enter", " "])("opens the drop box using the %s key", (key) => {
    render(<FileDropCardFixture />);
    const openPicker = vi.spyOn(HTMLInputElement.prototype, "click");
    const dropBox = screen.getByRole("button", { name: "Choose file" });

    dropBox.focus();
    fireEvent.keyDown(dropBox, { key });

    expect(openPicker).toHaveBeenCalledTimes(1);
  });

  it("opens one chooser and keeps the selection when a later choice is empty", async () => {
    render(<FileDropCardFixture />);
    const openPicker = vi.spyOn(HTMLInputElement.prototype, "click");
    fireEvent.click(screen.getByRole("button", { name: "Choose file" }));
    expect(openPicker).toHaveBeenCalledTimes(1);

    const input = screen.getByLabelText("Choose a file");
    await act(async () => {
      fireEvent.change(input, {
        target: { files: [new File(["sample"], "sample.vcf")] },
      });
    });
    expect(screen.getByText("sample.vcf")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Replace file" })).toBeTruthy();
    expect(screen.getAllByRole("button")).toHaveLength(1);

    await act(async () => {
      fireEvent.change(input, { target: { files: [] } });
    });
    expect(screen.getByText("sample.vcf")).toBeTruthy();
  });

  it("accepts a dropped file and rejects multiple files without losing it", async () => {
    render(<FileDropCardFixture />);
    const selected = new File(["sample"], "dropped.vcf", {
      type: "text/plain",
    });
    const extra = new File(["extra"], "extra.vcf", { type: "text/plain" });
    const dropArea = screen.getByRole("button", { name: "Choose file" });

    for (const files of [[selected], [selected, extra]]) {
      await act(async () => {
        fireEvent.drop(dropArea, {
          dataTransfer: {
            files,
            types: ["Files"],
            items: files.map((file) => ({
              kind: "file",
              type: file.type,
              getAsFile: () => file,
            })),
          },
        });
      });
      expect(screen.getByText("dropped.vcf")).toBeTruthy();
    }

    expect(screen.getByRole("alert").textContent).toBe(
      "Choose one file at a time.",
    );
    expect(screen.queryByText("extra.vcf")).toBeNull();
  });

  it("replaces the selected file and clears a previous rejection", async () => {
    render(<FileDropCardFixture />);
    const input = screen.getByLabelText("Choose a file");
    await act(async () => {
      fireEvent.change(input, {
        target: { files: [new File(["a"], "a.vcf"), new File(["b"], "b.vcf")] },
      });
    });
    expect(screen.getByRole("alert").textContent).toBe(
      "Choose one file at a time.",
    );

    for (const name of ["first.vcf", "replacement.vcf"]) {
      await act(async () => {
        fireEvent.change(input, {
          target: { files: [new File([name], name)] },
        });
      });
      expect(screen.getByText(name)).toBeTruthy();
    }
    expect(screen.queryByText("first.vcf")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it.each([
    {
      file: new File(["text"], "notes.txt"),
      message: UPLOAD_ERRORS.invalid_file,
    },
    {
      file: new File(["gzip"], "notes.gz", { type: "application/gzip" }),
      message: UPLOAD_ERRORS.invalid_file,
    },
    {
      file: new File([], "empty.vcf"),
      message: UPLOAD_ERRORS.invalid_file,
    },
    {
      file: oversizedFile,
      message: UPLOAD_ERRORS.too_large,
    },
  ])(
    "rejects $file.name without replacing a valid selection",
    async ({ file, message }) => {
      render(<FileDropCardFixture />);
      const input = screen.getByLabelText("Choose a file");
      for (const next of [new File(["sample"], "valid.vcf"), file]) {
        await act(async () => {
          fireEvent.change(input, { target: { files: [next] } });
        });
      }
      expect(screen.getByRole("alert").textContent).toBe(message);
      expect(screen.getByText("valid.vcf")).toBeTruthy();
    },
  );

  it("accepts a large compressed VCF without reading or expanding it", async () => {
    const onFileSelect = vi.fn();
    const genome = new File(["size-only fixture"], "HG001.vcf.gz", {
      type: "application/gzip",
    });
    Object.defineProperty(genome, "size", { value: 1_900_000_000 });
    render(<FileDropCard file={null} onFileSelect={onFileSelect} />);
    expect(screen.getByText("VCF or VCF.gz · Up to 10 GiB")).toBeTruthy();
    await act(async () => {
      fireEvent.change(screen.getByLabelText("Choose a file"), {
        target: { files: [genome] },
      });
    });
    expect(onFileSelect).toHaveBeenCalledWith(genome);
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
