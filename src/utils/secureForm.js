const { formidable } = require("formidable");
const fs = require("fs/promises");
const sharp = require("sharp");
const { Worker } = require("worker_threads");
const createError = require("http-errors");
const { validateFormFields } = require("./formSchemas");
const { assertSafeStructure } = require("./inputSecurity");
const { consume } = require("../middleware/requestLimits");

const IMAGE_BYTES = 500 * 1024;
const PROFILE_BYTES = 5 * 1024 * 1024;
const definitions = {
  productCreate: { files: { images: 8 }, maxBytes: IMAGE_BYTES },
  productUpdate: { files: { images: 8 }, maxBytes: IMAGE_BYTES },
  taxonomyCreate: { files: { image: 1 }, required: ["image"], maxBytes: PROFILE_BYTES },
  taxonomyUpdate: { files: { image: 1 }, maxBytes: PROFILE_BYTES },
  bannerCreate: { files: { bannerImage: 1 }, required: ["bannerImage"], maxBytes: PROFILE_BYTES },
  bannerUpdate: { files: { bannerImage: 1 }, maxBytes: PROFILE_BYTES },
  seller: { files: { shopLogo: 1, idCopyFront: 1, idCopyBack: 1 }, maxBytes: PROFILE_BYTES },
  image: { files: { image: 1 }, required: ["image"], maxBytes: IMAGE_BYTES },
};
const rasterFormat = (buffer) => {
  if (buffer.subarray(0, 3).equals(Buffer.from([255, 216, 255]))) return "jpeg";
  if (buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "png";
  if (buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") return "webp";
  return null;
};
const normalizeImage = async (buffer, mimetype) => {
  const format = rasterFormat(buffer);
  const mime = { jpeg: ["image/jpeg", "image/jpg"], png: ["image/png"], webp: ["image/webp"] };
  if (!format || !mime[format].includes(mimetype)) throw createError(400, "Only genuine JPEG, PNG and WebP images are allowed");
  try {
    const image = sharp(buffer, { limitInputPixels: 16000000, failOn: "warning" });
    const info = await image.metadata();
    if ((info.pages || 1) > 1 || info.width > 8000 || info.height > 8000) throw new Error("Unsupported image dimensions");
    // Decoding and re-encoding removes supplied metadata and appended content.
    return await image.rotate().resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true }).webp({ quality: 82 }).toBuffer();
  } catch { throw createError(400, "Image is invalid or exceeds the supported dimensions"); }
};
const normalizePdf = async (buffer) => {
  if (buffer.toString("ascii", 0, 5) !== "%PDF-") throw createError(400, "Invalid PDF file");
  const worker = new Worker(require.resolve("./pdfSecurity.js"), { workerData: buffer, resourceLimits: { maxOldGenerationSizeMb: 64, stackSizeMb: 4 } });
  try {
    return await new Promise((resolve, reject) => {
      const fail = () => reject(createError(400, "Use a valid PDF of at most ten pages without scripts, attachments, forms or external actions"));
      const timer = setTimeout(fail, 5000);
      worker.once("message", (message) => { clearTimeout(timer); message.error ? fail() : resolve(Buffer.from(message.pdf)); });
      worker.once("error", () => { clearTimeout(timer); fail(); });
      worker.once("exit", () => { clearTimeout(timer); fail(); });
    });
  } finally { await worker.terminate(); }
};

const createSecureForm = (kind, { existing } = {}) => ({
  async parse(req, callback) {
    const definition = definitions[kind];
    const paths = new Set();
    let fields = Object.create(null), files = Object.create(null), failure;
    try {
      if (!req.is("multipart/form-data")) throw createError(415, "Use multipart/form-data");
      let quota;
      try { quota = await consume("account-uploads", req.id, 120, 15 * 60000); }
      catch { throw createError(503, "Upload protection is temporarily unavailable"); }
      if (!quota.allowed) {
        req.res.set("Retry-After", String(quota.retryAfter));
        throw createError(429, "Upload limit reached. Please try again later");
      }
      const form = formidable({
        maxFields: 40, maxFieldsSize: 512 * 1024,
        maxFiles: Object.values(definition.files).reduce((a, b) => a + b, 0),
        maxFileSize: definition.maxBytes, maxTotalFileSize: definition.maxBytes * Object.values(definition.files).reduce((a, b) => a + b, 0),
        allowEmptyFiles: false, minFileSize: 1, keepExtensions: false,
        filter(part) {
          const identity = kind === "seller" && ["idCopyFront", "idCopyBack"].includes(part.name);
          if (!Object.hasOwn(definition.files, part.name) || !(["image/jpeg", "image/jpg", "image/png", "image/webp"].includes(part.mimetype) || (identity && part.mimetype === "application/pdf"))) {
            // Abort the parser as well as rejecting the promise, so later parts
            // cannot open temporary files after rejection/cleanup has completed.
            form._error(createError(400, "Unsupported file field or file type"));
            return false;
          }
          return true;
        },
      });
      form.on("fileBegin", (_name, file) => paths.add(file.filepath));
      const [rawFields, rawFiles] = await form.parse(req);
      for (const [key, values] of Object.entries(rawFields)) {
        if (!Array.isArray(values) || values.length !== 1) throw createError(400, "Repeated form fields are not allowed");
        fields[key] = values[0];
      }
      assertSafeStructure(fields);
      fields = validateFormFields(kind, fields, existing);
      if (kind.startsWith("product")) {
        const retainedCount = fields.existingImages === undefined ? (existing?.images?.length || 0) : JSON.parse(fields.existingImages).length;
        if (retainedCount + (rawFiles.images?.length || 0) > 8) throw createError(400, "A product can have a maximum of eight images");
      }
      for (const [key, entries] of Object.entries(rawFiles)) {
        if (!Object.hasOwn(definition.files, key) || entries.length > definition.files[key]) throw createError(400, "Unexpected or repeated file field");
        for (const file of entries) {
          const input = await fs.readFile(file.filepath);
          const isPdf = file.mimetype === "application/pdf";
          const output = isPdf ? await normalizePdf(input) : await normalizeImage(input, file.mimetype);
          if (output.length > definition.maxBytes) throw createError(413, "Processed file exceeds the upload limit");
          await fs.writeFile(file.filepath, output);
          file.mimetype = isPdf ? "application/pdf" : "image/webp";
          file.size = output.length;
        }
        files[key] = key === "images" ? entries : entries[0];
      }
      for (const key of definition.required || []) if (!files[key]) throw createError(400, key + " is required");
    } catch (error) {
      failure = error.status ? error : createError(error.httpCode === 413 ? 413 : 400, error.httpCode === 413 ? "Upload exceeds the allowed size or file count" : "Invalid multipart input");
    }
    try { await callback(failure, fields, files); }
    finally { await Promise.allSettled([...paths].map((path) => fs.unlink(path))); }
  },
});
module.exports = { createSecureForm, normalizeImage, normalizePdf };
