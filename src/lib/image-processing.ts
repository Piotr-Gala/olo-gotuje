const SOURCE_LIMIT = 15 * 1024 * 1024;
const OUTPUT_LIMIT = 5.5 * 1024 * 1024;
const MAX_EDGE = 2560;

export function assertImageSourceSize(file: File) {
  if (file.size > SOURCE_LIMIT) throw new Error("source-too-large");
}

export async function preparePostImage(file: File): Promise<File> {
  assertImageSourceSize(file);

  // Preserve GIF animation; it cannot be safely re-encoded through a canvas.
  if (file.type === "image/gif") {
    if (file.size > 8 * 1024 * 1024) throw new Error("animated-image-too-large");
    return file;
  }

  if (!(["image/jpeg", "image/png", "image/webp"].includes(file.type))) {
    throw new Error("unsupported-image");
  }
  if (typeof createImageBitmap !== "function") throw new Error("image-processing-unavailable");

  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  try {
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("image-processing-unavailable");
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

    for (const quality of [0.86, 0.78, 0.68, 0.58, 0.5]) {
      const blob = await canvasToBlob(canvas, quality);
      if (blob.size <= OUTPUT_LIMIT) {
        const baseName = file.name.replace(/\.[^.]+$/, "") || "photo";
        return new File([blob], `${baseName}.webp`, { type: "image/webp", lastModified: file.lastModified });
      }
    }
    throw new Error("compressed-image-too-large");
  } finally {
    bitmap.close();
  }
}

function canvasToBlob(canvas: HTMLCanvasElement, quality: number) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("image-processing-unavailable")), "image/webp", quality);
  });
}

export function getCoverPosition(metadata: Record<string, unknown> | null | undefined) {
  const position = metadata?.coverPosition;
  if (!position || typeof position !== "object") return { x: 50, y: 50 };
  const { x, y } = position as { x?: unknown; y?: unknown };
  return {
    x: typeof x === "number" && Number.isFinite(x) ? Math.min(100, Math.max(0, x)) : 50,
    y: typeof y === "number" && Number.isFinite(y) ? Math.min(100, Math.max(0, y)) : 50,
  };
}
