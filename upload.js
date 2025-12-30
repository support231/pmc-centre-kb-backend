import multer from "multer";
import mammoth from "mammoth";
import pdfParse from "pdf-parse";

/* ===============================
   FILE UPLOAD CONFIG (100 MB)
   =============================== */

export const upload = multer({
  limits: { fileSize: 100 * 1024 * 1024 }, // 100 MB
  fileFilter(req, file, cb) {
    const allowed = [
      "application/pdf",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "text/plain",
      "image/jpeg",
      "image/png",
      "image/webp"
    ];

    if (!allowed.includes(file.mimetype)) {
      return cb(new Error("Unsupported file type"));
    }
    cb(null, true);
  }
});

/* ===============================
   FILE TEXT EXTRACTION
   =============================== */

export async function extractUploadedText(file) {
  if (!file) return "";

  if (file.mimetype === "application/pdf") {
    const r = await pdfParse(file.buffer);
    return r.text || "";
  }

  if (
    file.mimetype ===
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    const r = await mammoth.extractRawText({ buffer: file.buffer });
    return r.value || "";
  }

  if (file.mimetype === "text/plain") {
    return file.buffer.toString("utf8");
  }

  // Images: placeholder for future vision support
  if (file.mimetype.startsWith("image/")) {
    return `Image uploaded: ${file.originalname}. 
Visual analysis support will be added soon.`;
  }

  return "";
}
