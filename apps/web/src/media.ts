// Evidence helpers shared by task reports and incident reports.

export function asDataURL(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
export async function preparePhoto(
  file: File,
): Promise<{ data_url: string; name: string }> {
  if (typeof createImageBitmap !== "function") {
    if (file.size > 2800000)
      throw new Error(
        "This browser cannot resize the photo; choose an image under 2.8 MB.",
      );
    return { data_url: await asDataURL(file), name: file.name };
  }
  const bitmap = await createImageBitmap(file);
  try {
    let scale = Math.min(1, 1920 / Math.max(bitmap.width, bitmap.height));
    let quality = 0.84;
    for (let attempt = 0; attempt < 7; attempt += 1) {
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Photo resizing is unavailable.");
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
          (result) =>
            result
              ? resolve(result)
              : reject(new Error("Photo compression failed.")),
          "image/jpeg",
          quality,
        ),
      );
      if (blob.size <= 2500000) {
        const stem = file.name.replace(/\.[^.]+$/, "");
        return {
          data_url: await asDataURL(blob),
          name: `${stem || "field-photo"}.jpg`,
        };
      }
      scale *= 0.78;
      quality = Math.max(0.52, quality - 0.06);
    }
    throw new Error(
      "Photo is still too large after resizing. Try a closer, smaller image.",
    );
  } finally {
    bitmap.close();
  }
}
