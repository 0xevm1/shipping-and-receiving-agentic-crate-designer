/** Saves `data` as a file through a temporary link: the browser edge for every export. */
function download(filename: string, data: BlobPart, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke after the click has been handled, so the download has the data.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadText(filename: string, text: string, type = "text/csv") {
  download(filename, text, type);
}

export function downloadBytes(filename: string, data: ArrayBuffer, type = "model/gltf-binary") {
  download(filename, data, type);
}
