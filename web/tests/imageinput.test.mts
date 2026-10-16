// Input wiring for the screenshot check: picker, paste and drop each hand over the image;
// text pastes, text drags and drops onto other file inputs are left to the browser.
// Run via: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { carriesFiles, firstImage, wireImageInput } from "../src/imageinput.ts";

const png = new File([new Uint8Array([137, 80, 78, 71])], "shot.png", { type: "image/png" });
const txt = new File(["hello"], "notes.txt", { type: "text/plain" });

/** A document, compose section and file input, as far as the wiring touches them. */
function setup() {
  const root = new EventTarget();
  const classes = new Set<string>();
  const zone = { classList: { toggle: (c: string, on?: boolean) => (on ? classes.add(c) : classes.delete(c)) } };
  const picker = Object.assign(new EventTarget(), { files: null as File[] | null, value: "" });
  const got: File[] = [];
  const rejected: File[] = [];
  wireImageInput({ root, zone, picker, onImage: (f) => got.push(f), onReject: (f) => rejected.push(f) });
  return { root, classes, picker, got, rejected };
}

function fire(target: EventTarget, type: string, props: Record<string, unknown>) {
  const e = Object.assign(new Event(type, { cancelable: true }), props);
  target.dispatchEvent(e);
  return e;
}

const files = (...f: File[]) => ({ types: ["Files"], files: f });

test("firstImage finds an image in files or in clipboard items, and nothing else", () => {
  assert.equal(firstImage(files(txt, png)), png);
  assert.equal(firstImage({ items: [{ kind: "string", type: "text/plain", getAsFile: () => null }, { kind: "file", type: "image/png", getAsFile: () => png }] }), png);
  assert.equal(firstImage(files(txt)), null);
  assert.equal(firstImage(null), null);
  assert.equal(carriesFiles({ types: ["text/plain"] }), false);
  assert.equal(carriesFiles({ types: ["Files"] }), true);
});

test("pasting an image reads it and stops the default paste", () => {
  const { root, got } = setup();
  const e = fire(root, "paste", { clipboardData: { items: [{ kind: "file", type: "image/png", getAsFile: () => png }] } });
  assert.deepEqual(got, [png]);
  assert.equal(e.defaultPrevented, true);
});

test("pasting text is left alone", () => {
  const { root, got } = setup();
  const e = fire(root, "paste", { clipboardData: { types: ["text/plain"], items: [{ kind: "string", type: "text/plain", getAsFile: () => null }] } });
  assert.deepEqual(got, []);
  assert.equal(e.defaultPrevented, false);
});

test("dragging files highlights the drop zone; dropping an image reads it", () => {
  const { root, classes, got } = setup();
  fire(root, "dragenter", { dataTransfer: files(png) });
  assert.ok(classes.has("dropping"));
  const over = fire(root, "dragover", { dataTransfer: files(png) });
  assert.equal(over.defaultPrevented, true, "dragover must be cancelled for the drop to fire");
  const drop = fire(root, "drop", { dataTransfer: files(png) });
  assert.equal(drop.defaultPrevented, true, "the browser must not open the image");
  assert.deepEqual(got, [png]);
  assert.ok(!classes.has("dropping"));
});

test("leaving the page clears the highlight once every dragenter is matched", () => {
  const { root, classes } = setup();
  fire(root, "dragenter", { dataTransfer: files(png) });
  fire(root, "dragenter", { dataTransfer: files(png) });
  fire(root, "dragleave", { dataTransfer: files(png) });
  assert.ok(classes.has("dropping"));
  fire(root, "dragleave", { dataTransfer: files(png) });
  assert.ok(!classes.has("dropping"));
});

test("dropping a non-image file is rejected, dragging text is ignored", () => {
  const { root, got, rejected } = setup();
  fire(root, "drop", { dataTransfer: files(txt) });
  assert.deepEqual(rejected, [txt]);
  const over = fire(root, "dragover", { dataTransfer: { types: ["text/plain"] } });
  assert.equal(over.defaultPrevented, false);
  assert.deepEqual(got, []);
});

test("drops onto another file input (the batch upload) keep their native behaviour", () => {
  const { root, got } = setup();
  const batchInput = { closest: (sel: string) => (sel === "input[type=file]" ? batchInput : null) };
  const e = new Event("drop", { cancelable: true });
  Object.defineProperty(e, "target", { value: batchInput });
  Object.assign(e, { dataTransfer: files(png) });
  root.dispatchEvent(e);
  assert.deepEqual(got, []);
  assert.equal(e.defaultPrevented, false);
});

test("the picker hands over its image and resets so the same file can be picked again", () => {
  const { picker, got, rejected } = setup();
  picker.files = [png];
  picker.value = "C:\\fakepath\\shot.png";
  picker.dispatchEvent(new Event("change"));
  assert.deepEqual(got, [png]);
  assert.equal(picker.value, "");
  picker.files = [txt];
  picker.dispatchEvent(new Event("change"));
  assert.deepEqual(rejected, [txt]);
});
