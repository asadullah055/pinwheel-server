const { parentPort, workerData } = require("worker_threads");
const { PDFDocument } = require("pdf-lib");

// Process untrusted PDF object graphs outside the request thread with a memory
// budget and a deadline supplied by secureForm. Rebuild only checked pages.
const rewritePdf = async (buffer) => {
  const input = await PDFDocument.load(buffer, { updateMetadata: false, throwOnInvalidObject: true });
  if (input.isEncrypted || input.getPageCount() < 1 || input.getPageCount() > 10) throw new Error("Unsupported PDF");
  const forbidden = new Set(["JS", "JavaScript", "OpenAction", "AA", "Launch", "EmbeddedFiles", "EmbeddedFile", "RichMedia", "XFA", "SubmitForm", "ImportData", "GoToR", "GoToE", "URI", "AcroForm", "Filespec", "FileAttachment", "Sound", "Movie", "Screen", "3D", "Rendition"]);
  let count = 0;
  const inspect = (value, depth = 0, seen = new Set()) => {
    if (!value || seen.has(value)) return;
    if (depth > 30 || ++count > 50000) throw new Error("PDF is too complex");
    seen.add(value);
    if (forbidden.has(value.decodeText?.())) throw new Error("Active PDF content is not allowed");
    if (value.dict) inspect(value.dict, depth + 1, seen);
    if (typeof value.entries === "function") {
      for (const [key, child] of value.entries()) { inspect(key, depth + 1, seen); inspect(child, depth + 1, seen); }
    } else if (typeof value.asArray === "function") {
      for (const child of value.asArray()) inspect(child, depth + 1, seen);
    }
  };
  for (const [, object] of input.context.enumerateIndirectObjects()) inspect(object);
  const output = await PDFDocument.create();
  for (const page of await output.copyPages(input, input.getPageIndices())) {
    const { width, height } = page.getSize();
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0 || width > 14400 || height > 14400) throw new Error("Unsupported page size");
    output.addPage(page);
  }
  return output.save();
};
if (parentPort) rewritePdf(Buffer.from(workerData)).then((pdf) => parentPort.postMessage({ pdf })).catch(() => parentPort.postMessage({ error: true }));
