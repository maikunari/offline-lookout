/**
 * The three ways a screenshot gets in: the file picker (accept="image/*", so phones offer the
 * photo library), dropping a file anywhere on the page, and pasting an image (Ctrl/Cmd+V).
 * Text pastes and text drags are left alone, as are drops onto other file inputs.
 */

/** The parts of DataTransfer this reads, so tests can pass a plain object. */
export interface TransferLike {
  types?: ArrayLike<string>;
  files?: ArrayLike<File> | null;
  items?: ArrayLike<{ kind: string; type: string; getAsFile(): File | null }> | null;
}

const isImage = (f: File | null | undefined): f is File => !!f && f.type.startsWith("image/");

/** The first image file in a paste, drop or picker selection, or null. */
export function firstImage(dt: TransferLike | null | undefined): File | null {
  for (const f of Array.from(dt?.files ?? [])) if (isImage(f)) return f;
  for (const it of Array.from(dt?.items ?? [])) {
    if (it.kind !== "file" || !it.type.startsWith("image/")) continue;
    const f = it.getAsFile();
    if (isImage(f)) return f;
  }
  return null;
}

/** True while dragging files (not text) over the page. */
export function carriesFiles(dt: TransferLike | null | undefined): boolean {
  return Array.from(dt?.types ?? []).includes("Files");
}

export interface ImageInputOptions {
  /** Where paste and drag events are heard, normally the document. */
  root: EventTarget;
  /** Gets the "dropping" class while files are dragged over the page. */
  zone: { classList: { toggle(token: string, force?: boolean): unknown } };
  picker: EventTarget & { files: ArrayLike<File> | null; value: string };
  onImage(file: File): void;
  /** A file arrived that is not an image. */
  onReject(file: File): void;
}

export function wireImageInput({ root, zone, picker, onImage, onReject }: ImageInputOptions): void {
  const take = (dt: TransferLike | null | undefined) => {
    const img = firstImage(dt);
    if (img) onImage(img);
    else {
      const other = Array.from(dt?.files ?? [])[0];
      if (other) onReject(other);
    }
  };
  /** Drops onto another file input (the batch upload) keep their native behaviour. */
  const onOtherInput = (e: Event) => {
    const t = e.target as { closest?: (sel: string) => unknown } | null;
    return !!t?.closest?.("input[type=file]") && e.target !== picker;
  };
  let depth = 0;
  const setDropping = (on: boolean) => zone.classList.toggle("dropping", on);

  picker.addEventListener("change", () => {
    take({ files: picker.files });
    picker.value = ""; // so picking the same file again still fires
  });

  root.addEventListener("paste", (e) => {
    const img = firstImage((e as ClipboardEvent).clipboardData);
    if (!img) return;
    e.preventDefault();
    onImage(img);
  });

  root.addEventListener("dragenter", (e) => {
    if (!carriesFiles((e as DragEvent).dataTransfer) || onOtherInput(e)) return;
    depth++;
    setDropping(true);
  });
  root.addEventListener("dragleave", (e) => {
    if (!carriesFiles((e as DragEvent).dataTransfer)) return;
    depth = Math.max(0, depth - 1);
    if (!depth) setDropping(false);
  });
  root.addEventListener("dragover", (e) => {
    const dt = (e as DragEvent).dataTransfer;
    if (!carriesFiles(dt) || onOtherInput(e)) return;
    e.preventDefault(); // allow the drop (and stop the browser opening the file)
    if (dt && "dropEffect" in dt) (dt as DataTransfer).dropEffect = "copy";
  });
  root.addEventListener("drop", (e) => {
    const dt = (e as DragEvent).dataTransfer;
    depth = 0;
    setDropping(false);
    if (!carriesFiles(dt) || onOtherInput(e)) return;
    e.preventDefault();
    take(dt);
  });
}
