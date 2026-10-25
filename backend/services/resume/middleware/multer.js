import fs from "fs";
import path from "path";
import crypto from "crypto";
import multer from "multer";

const uploadPath = path.resolve("./uploads");
fs.mkdirSync(uploadPath, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadPath),
  filename: (_req, _file, cb) => cb(null, `${crypto.randomUUID()}.pdf`),
});

const fileFilter = (_req, file, cb) => {
  if (path.extname(file.originalname).toLowerCase() !== ".pdf" || file.mimetype !== "application/pdf") {
    return cb(new Error("Only PDF files are allowed"));
  }
  cb(null, true);
};

const uploadPdf = multer({ storage, fileFilter, limits: { fileSize: 5 * 1024 * 1024 } }).single("resume");

export const upload = {
  single(fieldName) {
    const middleware = uploadPdf;
    return (req, res, next) => middleware(req, res, (error) => {
      if (error) return next(error);
      if (!req.file) return next();
      const fd = fs.openSync(req.file.path, "r");
      const header = Buffer.alloc(5);
      const bytesRead = fs.readSync(fd, header, 0, 5, 0);
      fs.closeSync(fd);
      if (bytesRead !== 5 || header.toString("ascii") !== "%PDF-") {
        fs.unlink(req.file.path, () => {});
        return next(new Error("Uploaded file is not a valid PDF"));
      }
      next();
    });
  },
};
