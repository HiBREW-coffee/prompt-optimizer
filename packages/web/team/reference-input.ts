type FileTransfer = Pick<DataTransfer, "files" | "items" | "types">;

// Browsers may expose the same file through both collections. Use one source.
export function transferredFiles(transfer: FileTransfer | null): File[] {
  if (!transfer) return [];
  const files = Array.from(transfer.files ?? []);
  if (files.length) return files;
  return Array.from(transfer.items ?? [])
    .filter((item) => item.kind === "file")
    .map((item) => item.getAsFile())
    .filter((file): file is File => file !== null);
}

export function carriesFiles(transfer: FileTransfer | null): boolean {
  return !!transfer && (
    Array.from(transfer.types ?? []).includes("Files") ||
    !!transfer.files?.length ||
    Array.from(transfer.items ?? []).some((item) => item.kind === "file")
  );
}

export async function readClipboardImages(
  clipboard: Pick<Clipboard, "read"> | undefined = navigator.clipboard,
): Promise<File[]> {
  if (!clipboard?.read) throw new Error("CLIPBOARD_UNAVAILABLE");
  let items: ClipboardItem[];
  try {
    items = await clipboard.read();
  } catch (error) {
    if (error instanceof DOMException && ["NotAllowedError", "SecurityError"].includes(error.name))
      throw new Error("CLIPBOARD_DENIED");
    throw new Error("CLIPBOARD_UNAVAILABLE");
  }
  const files: File[] = [];
  for (const item of items) {
    const type = item.types.find((value) => ["image/png", "image/jpeg"].includes(value));
    if (!type) {
      if (item.types.some((value) => value.startsWith("image/"))) throw new Error("INVALID_IMAGE");
      continue;
    }
    // Never read clipboard text, HTML, or image URLs.
    const blob = await item.getType(type);
    files.push(new File([blob], `粘贴图片-${files.length + 1}.${type === "image/png" ? "png" : "jpg"}`, { type }));
  }
  if (!files.length) throw new Error("CLIPBOARD_NO_IMAGE");
  return files;
}
