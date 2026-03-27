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

/* ── helpers ── */

/** Match a label followed by a value — requires actual content after the label */
function labelValue(text, labelPattern, valuePattern) {
  const re = new RegExp(labelPattern + "\\s*:?\\s*" + valuePattern, "i");
  const m = text.match(re);
  return m ? (m[1] || "").trim() : "";
}

/** Try multiple label+value combos, return first hit */
function firstLabelValue(text, pairs) {
  for (const [label, value] of pairs) {
    const result = labelValue(text, label, value);
    if (result && result.length > 1) return result;
  }
  return "";
}

/** Find all dates in text, return array of {raw, index} */
function findAllDates(text) {
  const datePatterns = [
    /(\d{1,2}\/\d{1,2}\/\d{2,4})/g,
    /(\d{1,2}-\d{1,2}-\d{2,4})/g,
    /((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\s+\d{1,2},?\s*\d{4})/gi,
    /(\d{4}-\d{2}-\d{2})/g,
  ];
  const results = [];
  for (const p of datePatterns) {
    let m;
    while ((m = p.exec(text)) !== null) {
      results.push({ raw: m[1], index: m.index });
    }
  }
  return results;
}

function parseDate(raw) {
  if (!raw) return "";
  raw = raw.trim();
  // YYYYMMDD (from filenames like 20260304)
  const ymd = raw.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (ymd) return `${ymd[1]}-${ymd[2]}-${ymd[3]}`;
  // ISO: YYYY-MM-DD
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return raw;
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
    const mo = months[named[1].toLowerCase().slice(0, 3)];
    return `${named[3]}-${mo}-${named[2].padStart(2, "0")}`;
  }
  return "";
}

function parseAmount(raw) {
  if (!raw) return "";
  return raw.replace(/[$,\s]/g, "");
}

/* ── Filename parsing ── */

function parseFilename(name) {
  if (!name) return {};
  const base = name.replace(/\.pdf$/i, "").trim();
  const result = {};

  // Pattern: XXXXX_YYYYMMDD_NNNNN (like 31R1700002_20260304_000055)
  const parts = base.split(/[_\-]/);
  for (const part of parts) {
    // 8-digit date: YYYYMMDD
    if (/^\d{8}$/.test(part)) {
      const y = part.slice(0, 4);
      const m = part.slice(4, 6);
      const d = part.slice(6, 8);
      if (+m >= 1 && +m <= 12 && +d >= 1 && +d <= 31) {
        result.date = `${y}-${m}-${d}`;
      }
    }
  }

  // Use first segment as invoice number if alphanumeric
  if (parts.length > 0 && /[A-Za-z]/.test(parts[0]) && parts[0].length >= 3) {
    result.invoiceNumber = parts[0];
  }
  // Or use the whole base if it's a simple code
  if (!result.invoiceNumber && /^[A-Za-z][A-Za-z0-9]{3,}$/.test(base)) {
    result.invoiceNumber = base;
  }

  return result;
}

/* ── Main extraction ── */

/** Extract structured invoice fields from raw PDF text */
export function extractFields(text, fileName = "") {
  const fileInfo = parseFilename(fileName);

  // ── Invoice Number ──
  // Look for labeled invoice numbers — require digits in the value to avoid matching labels
  let invoiceNumber = firstLabelValue(text, [
    ["invoice\\s*#", "([A-Z0-9][A-Z0-9\\w\\-]{2,20})"],
    ["invoice\\s*(?:no|num|number)", "([A-Z0-9][A-Z0-9\\w\\-]{2,20})"],
    ["inv\\s*\\.?\\s*#", "([A-Z0-9][A-Z0-9\\w\\-]{2,20})"],
    ["reference\\s*#?", "([A-Z0-9][A-Z0-9\\w\\-]{2,20})"],
    ["bill\\s*#", "([A-Z0-9][A-Z0-9\\w\\-]{2,20})"],
    ["document\\s*#?", "([A-Z0-9][A-Z0-9\\w\\-]{2,20})"],
  ]);
  // Validate: must contain at least one digit (to avoid matching words like "Date", "Number")
  if (invoiceNumber && !/\d/.test(invoiceNumber)) invoiceNumber = "";
  // Fallback to filename
  if (!invoiceNumber) invoiceNumber = fileInfo.invoiceNumber || "";

  // ── Dates ──
  // Try labeled dates first
  let rawInvDate = firstLabelValue(text, [
    ["invoice\\s*date", "([\\d\\/\\-]+(?:\\s*\\d{2,4})?)"],
    ["inv\\.?\\s*date", "([\\d\\/\\-]+(?:\\s*\\d{2,4})?)"],
    ["date\\s*of\\s*invoice", "([\\d\\/\\-]+(?:\\s*\\d{2,4})?)"],
    ["bill\\s*date", "([\\d\\/\\-]+(?:\\s*\\d{2,4})?)"],
    ["issued", "([\\d\\/\\-]+(?:\\s*\\d{2,4})?)"],
  ]);

  let rawDueDate = firstLabelValue(text, [
    ["due\\s*date", "([\\d\\/\\-]+(?:\\s*\\d{2,4})?)"],
    ["payment\\s*due", "([\\d\\/\\-]+(?:\\s*\\d{2,4})?)"],
    ["pay\\s*by", "([\\d\\/\\-]+(?:\\s*\\d{2,4})?)"],
  ]);

  // If no labeled date, try to find dates in the text
  if (!rawInvDate) {
    const allDates = findAllDates(text);
    if (allDates.length >= 1) rawInvDate = allDates[0].raw;
    if (!rawDueDate && allDates.length >= 2) rawDueDate = allDates[1].raw;
  }

  let invoiceDate = parseDate(rawInvDate);
  let dueDate = parseDate(rawDueDate);

  // Filename date fallback
  if (!invoiceDate && fileInfo.date) invoiceDate = fileInfo.date;

  // ── Amount ──
  const rawAmount = firstLabelValue(text, [
    ["total\\s*due", "\\$?([\\d,]+\\.\\d{2})"],
    ["amount\\s*due", "\\$?([\\d,]+\\.\\d{2})"],
    ["balance\\s*due", "\\$?([\\d,]+\\.\\d{2})"],
    ["please\\s*pay", "\\$?([\\d,]+\\.\\d{2})"],
    ["grand\\s*total", "\\$?([\\d,]+\\.\\d{2})"],
    ["total\\s*amount", "\\$?([\\d,]+\\.\\d{2})"],
    ["total", "\\$?([\\d,]+\\.\\d{2})"],
    ["amount", "\\$?([\\d,]+\\.\\d{2})"],
  ]) || firstLabelValue(text, [
    // Looser: amounts without decimal
    ["total\\s*due", "\\$?([\\d,]{3,})"],
    ["amount\\s*due", "\\$?([\\d,]{3,})"],
    ["balance\\s*due", "\\$?([\\d,]{3,})"],
    ["total", "\\$?([\\d,]{3,})"],
  ]);

  // Also try standalone dollar amounts: $1,234.56
  let amount = parseAmount(rawAmount);
  if (!amount) {
    const dollarMatch = text.match(/\$\s*([\d,]+\.\d{2})/);
    if (dollarMatch) amount = parseAmount(dollarMatch[1]);
  }

  // ── Terms ──
  const terms = firstLabelValue(text, [
    ["terms?", "(net\\s*\\d+)"],
    ["payment\\s*terms?", "(net\\s*\\d+)"],
    ["terms?", "(due\\s*(?:on|upon)\\s*receipt)"],
  ]) || (() => {
    const m = text.match(/(net\s*\d+)/i);
    return m ? m[1] : "";
  })();

  // ── Vendor Name ──
  let vendorName = firstLabelValue(text, [
    ["(?:from|vendor|company|supplier)", "([A-Za-z][\\w\\s&.,'-]{2,50})"],
    ["(?:sold\\s*by|remit\\s*to|bill\\s*from)", "([A-Za-z][\\w\\s&.,'-]{2,50})"],
  ]);

  if (!vendorName) {
    // Use first meaningful text chunk — split on spaces and look for company-like names
    const chunks = text.split(/\s{2,}|\n/).map((c) => c.trim()).filter(Boolean);
    const skipRe = /^(invoice|bill|date|page|total|amount|from|to|ship|remit|phone|fax|email|www|http|tax|sub|po|#|number|terms|qty|quantity|description|item|unit|price|due|paid|balance|statement|account|sold|order|net|check|payment|credit|debit|ref)/i;
    const skipVal = /^[\d\s\-\/.,;:$%#]+$|^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}$/;
    for (const chunk of chunks) {
      const clean = chunk.replace(/\s+/g, " ").trim();
      if (
        clean.length >= 3 &&
        clean.length <= 60 &&
        !skipRe.test(clean) &&
        !skipVal.test(clean) &&
        /[a-zA-Z]{2,}/.test(clean) &&
        !/^\d/.test(clean)
      ) {
        vendorName = clean;
        break;
      }
    }
  }

  vendorName = vendorName.replace(/[\s,.:;]+$/, "").trim();

  // ── Confidence ──
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

/** Full pipeline: File → extracted fields */
export async function extractInvoice(file) {
  const text = await extractTextFromPdf(file);
  const fields = extractFields(text, file.name);
  return { ...fields, rawText: text };
}
