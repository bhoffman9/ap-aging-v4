/**
 * Client-side PDF text extraction + regex field parsing.
 * Zero API cost — runs entirely in the browser via PDF.js.
 */

let pdfjsLib = null;

async function getPdfjs() {
  if (pdfjsLib) return pdfjsLib;
  pdfjsLib = await import("pdfjs-dist");
  pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;
  return pdfjsLib;
}

/** Extract raw text from a PDF File/Blob */
export async function extractTextFromPdf(file) {
  const pdfjs = await getPdfjs();
  const buf = await file.arrayBuffer();
  const doc = await pdfjs.getDocument({ data: buf }).promise;
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    pages.push(content.items.map((t) => t.str).join(" "));
  }
  return pages.join("\n");
}

/* ── regex helpers ── */

function first(text, ...patterns) {
  for (const p of patterns) {
    const m = text.match(p);
    if (m) return m[1]?.trim();
  }
  return "";
}

function parseDate(raw) {
  if (!raw) return "";
  // try ISO
  const iso = Date.parse(raw);
  if (!isNaN(iso)) {
    const d = new Date(iso);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  // MM/DD/YYYY or MM-DD-YYYY
  const mdy = raw.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
  if (mdy) {
    const y = mdy[3].length === 2 ? "20" + mdy[3] : mdy[3];
    return `${y}-${mdy[1].padStart(2, "0")}-${mdy[2].padStart(2, "0")}`;
  }
  // Month DD, YYYY
  const named = raw.match(
    /(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\s+(\d{1,2}),?\s*(\d{4})/i
  );
  if (named) {
    const months = { jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06", jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12" };
    const m = months[named[1].toLowerCase().slice(0, 3)];
    return `${named[3]}-${m}-${named[2].padStart(2, "0")}`;
  }
  return "";
}

function parseAmount(raw) {
  if (!raw) return "";
  return raw.replace(/[$,\s]/g, "");
}

/** Extract structured invoice fields from raw PDF text */
export function extractFields(text, fileName = "") {
  const invoiceNumber = first(
    text,
    /invoice\s*#?\s*:?\s*([A-Z0-9][\w\-]{1,20})/i,
    /inv\s*\.?\s*#?\s*:?\s*([A-Z0-9][\w\-]{1,20})/i,
    /reference\s*#?\s*:?\s*([A-Z0-9][\w\-]{1,20})/i,
    /bill\s*#?\s*:?\s*([A-Z0-9][\w\-]{1,20})/i,
    /number\s*:?\s*([A-Z0-9][\w\-]{1,20})/i,
    /(?:^|\s)#\s*([A-Z0-9][\w\-]{3,20})/i,
  ) || extractInvoiceFromFilename(fileName);

  const rawDate = first(
    text,
    /invoice\s*date\s*:?\s*([\w\/\-,\s]{6,20})/i,
    /date\s*:?\s*([\w\/\-,\s]{6,20})/i,
    /bill\s*date\s*:?\s*([\w\/\-,\s]{6,20})/i,
    /issued\s*:?\s*([\w\/\-,\s]{6,20})/i,
  );

  const rawDueDate = first(
    text,
    /due\s*date\s*:?\s*([\w\/\-,\s]{6,20})/i,
    /payment\s*due\s*:?\s*([\w\/\-,\s]{6,20})/i,
    /pay\s*by\s*:?\s*([\w\/\-,\s]{6,20})/i,
  );

  const rawAmount = first(
    text,
    /total\s*due\s*:?\s*\$?([\d,]+\.?\d*)/i,
    /amount\s*due\s*:?\s*\$?([\d,]+\.?\d*)/i,
    /balance\s*due\s*:?\s*\$?([\d,]+\.?\d*)/i,
    /please\s*pay\s*:?\s*\$?([\d,]+\.?\d*)/i,
    /grand\s*total\s*:?\s*\$?([\d,]+\.?\d*)/i,
    /total\s*:?\s*\$?([\d,]+\.?\d*)/i,
    /amount\s*:?\s*\$?([\d,]+\.?\d*)/i,
  );

  const terms = first(
    text,
    /terms?\s*:?\s*(net\s*\d+)/i,
    /payment\s*terms?\s*:?\s*(net\s*\d+)/i,
    /terms?\s*:?\s*(due\s*(?:on|upon)\s*receipt)/i,
    /(net\s*\d+)\s*days?/i,
  );

  // Vendor: try labeled fields first, then fall back to first meaningful line
  let vendorName = first(
    text,
    /(?:from|vendor|company|sold\s*by|supplier|remit\s*to)\s*:?\s*([A-Za-z][\w\s&.,'-]{2,50})/i,
    /(?:bill\s*from)\s*:?\s*([A-Za-z][\w\s&.,'-]{2,50})/i,
  );

  if (!vendorName) {
    // Split into tokens/lines and find first plausible company name
    const lines = text.split(/\n/).map((l) => l.trim()).filter(Boolean);
    const skipWords = /^(invoice|bill\s|date|page|total|amount|from|to\s|ship|remit|phone|fax|email|www|http|tax|sub|po\s|#|number|terms|qty|quantity|description|item|unit|price|due|paid|balance|statement|account)/i;
    const skipPatterns = /^[\d\s\-\/.,]+$|^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}$/;
    for (const line of lines) {
      const clean = line.replace(/\s+/g, " ").trim();
      if (
        clean.length >= 3 &&
        clean.length <= 60 &&
        !skipWords.test(clean) &&
        !skipPatterns.test(clean) &&
        /[a-zA-Z]{2,}/.test(clean)
      ) {
        vendorName = clean;
        break;
      }
    }
  }

  // Clean up vendor name — trim trailing junk
  vendorName = vendorName.replace(/[\s,.:;]+$/, "").trim();

  const invoiceDate = parseDate(rawDate);
  const dueDate = parseDate(rawDueDate);
  const amount = parseAmount(rawAmount);

  // confidence
  const required = [invoiceNumber, invoiceDate, amount, vendorName];
  const filled = required.filter(Boolean).length;
  const confidence = filled === 4 ? "high" : filled >= 2 ? "medium" : "low";

  return {
    vendorName,
    invoiceNumber,
    invoiceDate,
    dueDate,
    amount,
    terms: terms || "",
    confidence,
  };
}

/** Try to extract invoice number from filename (e.g. LSVR100905.pdf → LSVR100905) */
function extractInvoiceFromFilename(name) {
  if (!name) return "";
  const base = name.replace(/\.pdf$/i, "").trim();
  // If the filename looks like an invoice number (alphanumeric, 4+ chars), use it
  if (/^[A-Za-z0-9][\w\-]{3,}$/.test(base)) return base;
  return "";
}

/** Full pipeline: File → extracted fields */
export async function extractInvoice(file) {
  const text = await extractTextFromPdf(file);
  const fields = extractFields(text, file.name);
  return { ...fields, rawText: text };
}
