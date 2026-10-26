import { afterEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import ReferenceBoard from "../../team/ReferenceBoard.vue";
import { carriesFiles, transferredFiles, readClipboardImages } from "../../team/reference-input";

const png = (name = "one.png") => new File(["image"], name, { type: "image/png" });
function transfer(files: File[] = [], types = files.length ? ["Files"] : []) {
  return { files, types, items: files.map((file) => ({ kind: "file", getAsFile: () => file })) } as unknown as DataTransfer;
}
function event(type: string, data: DataTransfer, target: EventTarget) {
  const e = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(e, type === "paste" ? "clipboardData" : "dataTransfer", { value: data });
  target.dispatchEvent(e);
  return e;
}
const mounted: Array<ReturnType<typeof mount>> = [];
function board(images: any[] = [], busy = false) {
  const wrapper = mount(ReferenceBoard, { props: { images, busy }, attachTo: document.body });
  mounted.push(wrapper);
  return wrapper;
}
afterEach(() => { mounted.splice(0).forEach((w) => w.unmount()); document.body.innerHTML = ""; });

describe("reference clipboard and file transfer", () => {
  it("does not duplicate files exposed by both browser collections and handles item-only paste", () => {
    const file = png(), data = transfer([file]);
    expect(transferredFiles(data)).toEqual([file]);
    Object.defineProperty(data, "files", { value: [] });
    expect(transferredFiles(data)).toEqual([file]);
    expect(transferredFiles(null)).toEqual([]);
    expect(carriesFiles(transfer([], ["Files"]))).toBe(true); // protected during dragover
    expect(carriesFiles(transfer([], ["text/uri-list"]))).toBe(false);
  });
  it("reads only image representations, selecting one format per item without reading clipboard text", async () => {
    const getType = vi.fn(async (type: string) => new Blob([type], { type }));
    const read = vi.fn().mockResolvedValue([
      { types: ["text/html", "image/png", "image/jpeg"], getType },
      { types: ["text/plain"], getType },
      { types: ["image/jpeg"], getType },
    ]);
    const files = await readClipboardImages({ read });
    expect(files.map((f) => f.type)).toEqual(["image/png", "image/jpeg"]);
    expect(getType.mock.calls.map(([type]) => type)).toEqual(["image/png", "image/jpeg"]);
    expect(read).toHaveBeenCalledTimes(1);
  });
  it("reports denied, unavailable, empty and unsupported clipboard images without text reads", async () => {
    await expect(readClipboardImages({ read: vi.fn().mockRejectedValue(new DOMException("denied", "NotAllowedError")) })).rejects.toThrow("CLIPBOARD_DENIED");
    await expect(readClipboardImages({} as Clipboard)).rejects.toThrow("CLIPBOARD_UNAVAILABLE");
    const getType = vi.fn();
    await expect(readClipboardImages({ read: vi.fn().mockResolvedValue([{ types: ["text/plain"], getType }]) })).rejects.toThrow("CLIPBOARD_NO_IMAGE");
    await expect(readClipboardImages({ read: vi.fn().mockResolvedValue([{ types: ["image/webp"], getType }]) })).rejects.toThrow("INVALID_IMAGE");
    expect(getType).not.toHaveBeenCalled();
  });
});

describe("ReferenceBoard browser events", () => {
  it("appends native image paste once and leaves normal text editing alone", () => {
    const wrapper = board(), file = png();
    const pasted = event("paste", transfer([file]), wrapper.get('[aria-label="参考图上传区域"]').element);
    expect(pasted.defaultPrevented).toBe(true);
    expect(wrapper.emitted("files")).toEqual([[[file]]]);
    const text = document.createElement("textarea"); document.body.append(text);
    expect(event("paste", transfer([], ["text/plain"]), text).defaultPrevented).toBe(false);
    expect(event("paste", transfer([file], ["Files", "text/html"]), text).defaultPrevented).toBe(false);
    expect(wrapper.emitted("files")).toHaveLength(1);
    expect(event("paste", transfer([file]), text).defaultPrevented).toBe(true);
    expect(wrapper.emitted("files")).toHaveLength(2);
  });
  it("ignores password and dialog paste and removes listeners after unmount", () => {
    const wrapper = board(), file = png(), password = document.createElement("input");
    password.type = "password"; document.body.append(password);
    expect(event("paste", transfer([file]), password).defaultPrevented).toBe(false);
    const dialog = document.createElement("div"); dialog.setAttribute("role", "dialog"); document.body.append(dialog);
    expect(event("paste", transfer([file]), dialog).defaultPrevented).toBe(false);
    expect(wrapper.emitted("files")).toBeUndefined();
    wrapper.unmount(); mounted.splice(mounted.indexOf(wrapper), 1);
    expect(event("paste", transfer([file]), document.body).defaultPrevented).toBe(false);
    expect(event("drop", transfer([file]), document.body).defaultPrevented).toBe(false);
  });
  it("keeps nested drag highlighting, drops files in order, and clears the highlight", async () => {
    const wrapper = board(), zone = wrapper.get('.upload-control'), files = [png("one.png"), png("two.png")];
    event("dragenter", transfer([], ["Files"]), zone.element);
    event("dragenter", transfer([], ["Files"]), zone.get("strong").element);
    event("dragleave", transfer([], ["Files"]), zone.get("strong").element);
    await wrapper.vm.$nextTick();
    expect(zone.classes()).toContain("is-dragging");
    expect(event("drop", transfer(files), zone.element).defaultPrevented).toBe(true);
    await wrapper.vm.$nextTick();
    expect(wrapper.emitted("files")).toEqual([[files]]);
    expect(zone.classes()).not.toContain("is-dragging");
  });
  it("prevents navigation for a missed drop, never follows dragged URLs and never imports while busy", async () => {
    const wrapper = board(), file = png();
    const outside = event("drop", transfer([file]), document.body);
    expect(outside.defaultPrevented).toBe(true);
    expect(wrapper.emitted("error")).toEqual([["DROP_OUTSIDE_REFERENCE"]]);
    event("drop", transfer([], ["text/uri-list"]), wrapper.get('.upload-control').element);
    expect(wrapper.emitted("error")?.at(-1)).toEqual(["DROP_IMAGE_FILES"]);
    expect(wrapper.emitted("files")).toBeUndefined();
    await wrapper.setProps({ busy: true });
    event("paste", transfer([file]), document.body);
    event("drop", transfer([file]), wrapper.get('.upload-control').element);
    expect(wrapper.emitted("files")).toBeUndefined();
    expect(wrapper.get('input[type=file]').attributes('disabled')).toBeDefined();
    expect(wrapper.findAll('button').every((b) => b.attributes('disabled') !== undefined)).toBe(true);
  });
  it("retains removal at the limit and routes over-limit pasted batches to shared validation", () => {
    const wrapper = board(Array.from({ length: 5 }, (_, i) => ({ path: `u/${i}.png`, preview: "blob:test", role: "auto", note: "" })));
    expect(wrapper.get('input[type=file]').attributes('disabled')).toBeDefined();
    expect(wrapper.get('button[aria-label="删除图1"]').attributes('disabled')).toBeUndefined();
    const file = png(); event("paste", transfer([file]), document.body);
    expect(wrapper.emitted("files")).toEqual([[[file]]]);
  });
});
