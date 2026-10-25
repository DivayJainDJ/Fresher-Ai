import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { promisify } from "node:util";
import PDFParser from "pdf2json";

const mkdtemp = promisify(fs.mkdtemp);
const rm = promisify(fs.rm);
const MIN_TEXT_CHARACTERS = 80;
const MIN_OCR_CHARACTERS = 40;
const OCR_PAGE_LIMIT = 3;
const OCR_BUDGET_MS = 60_000;

export class ResumePdfExtractionError extends Error {
    constructor(message, extractionMethod = "ocr") {
        super(message);
        this.name = "ResumePdfExtractionError";
        this.extractionMethod = extractionMethod;
        this.userMessage = "We couldn't read enough text from this PDF. Upload a clearer scanned resume or a PDF with selectable text.";
    }
}

const parsePdfText = (filePath) => new Promise((resolve, reject) => {
    let buffer;
    try {
        buffer = fs.readFileSync(filePath);
    } catch (error) {
        reject(error);
        return;
    }

    const parser = new PDFParser(null, 1);
    parser.on("pdfParser_dataReady", (data) => {
        try {
            const text = data.Pages
                .flatMap((page) => page.Texts || [])
                .map((item) => decodeURIComponent(item.R.map((run) => run.T).join("")))
                .join(" ")
                .replace(/\s+/g, " ")
                .trim();
            resolve(text);
        } catch (error) {
            reject(error);
        }
    });
    parser.on("pdfParser_dataError", (error) => reject(new Error(error.parserError || String(error))));
    parser.parseBuffer(buffer);
});

const runCommand = (command, args, { timeoutMs, maxOutputBytes = 512 * 1024 } = {}) => new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (error, result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        error ? reject(error) : resolve(result);
    };
    const timer = setTimeout(() => {
        child.kill("SIGKILL");
        const error = new Error(`${command} exceeded the OCR time budget`);
        error.code = "ETIMEDOUT";
        finish(error);
    }, timeoutMs);
    timer.unref?.();

    child.stdout.on("data", (chunk) => {
        stdout += chunk.toString("utf8");
        if (Buffer.byteLength(stdout) > maxOutputBytes) {
            child.kill("SIGKILL");
            finish(new Error(`${command} produced too much output`));
        }
    });
    child.stderr.on("data", (chunk) => {
        if (stderr.length < 8192) stderr += chunk.toString("utf8");
    });
    child.once("error", (error) => finish(error));
    child.once("close", (code, signal) => {
        if (code === 0) return finish(null, stdout);
        const error = new Error(`${command} failed${stderr.trim() ? `: ${stderr.trim().slice(0, 300)}` : ` (${signal || code})`}`);
        error.code = code;
        finish(error);
    });
});

const runOcr = async (filePath) => {
    const deadline = Date.now() + OCR_BUDGET_MS;
    const workDir = await mkdtemp(path.join(os.tmpdir(), "resume-ocr-"));
    const imagePrefix = path.join(workDir, "page");
    const remaining = () => {
        const timeoutMs = deadline - Date.now();
        if (timeoutMs <= 0) {
            const error = new Error("OCR exceeded the 60 second time budget");
            error.code = "ETIMEDOUT";
            throw error;
        }
        return timeoutMs;
    };

    try {
        await runCommand("pdftoppm", ["-f", "1", "-l", String(OCR_PAGE_LIMIT), "-r", "150", "-scale-to", "1800", "-png", filePath, imagePrefix], { timeoutMs: remaining() });
        const images = (await fs.promises.readdir(workDir))
            .filter((name) => /^page-\d+\.png$/.test(name))
            .sort((a, b) => Number(a.match(/\d+/)?.[0]) - Number(b.match(/\d+/)?.[0]))
            .slice(0, OCR_PAGE_LIMIT);
        if (!images.length) throw new Error("No pages could be rendered for OCR");

        const pageTexts = [];
        for (const imageName of images) {
            pageTexts.push(await runCommand("tesseract", [path.join(workDir, imageName), "stdout", "-l", "eng", "--psm", "3"], { timeoutMs: remaining() }));
        }
        return pageTexts.join(" ").replace(/\s+/g, " ").trim();
    } finally {
        await rm(workDir, { recursive: true, force: true }).catch(() => {});
    }
};

const extractText = async (filePath) => {
    let text = "";
    try {
        text = await parsePdfText(filePath);
    } catch (error) {
        console.warn(JSON.stringify({ service: "resume", event: "pdf_text_extraction_fallback", error: error.message }));
    }

    if (text.length >= MIN_TEXT_CHARACTERS) return { text, extractionMethod: "text" };

    try {
        const ocrText = await runOcr(filePath);
        if (ocrText.length < MIN_OCR_CHARACTERS) throw new ResumePdfExtractionError("OCR returned too little text to score this resume.");
        return { text: ocrText, extractionMethod: "ocr" };
    } catch (error) {
        if (error instanceof ResumePdfExtractionError) throw error;
        const message = error.code === "ETIMEDOUT"
            ? "OCR exceeded its 60 second time budget."
            : `OCR could not read this PDF${error.code === "ENOENT" ? " because the OCR tools are unavailable" : ""}.`;
        const extractionError = new ResumePdfExtractionError(message);
        extractionError.cause = error;
        throw extractionError;
    }
};

export default extractText;
