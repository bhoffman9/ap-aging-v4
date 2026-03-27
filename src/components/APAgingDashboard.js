"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import { createClient } from "@supabase/supabase-js";

/* ── Supabase browser client ── */
const sbUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const sbAnon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
const sb = sbUrl ? createClient(sbUrl, sbAnon) : null;

/* ── Aging helpers ── */
const BUCKETS = [
  { key: "current", label: "Current", color: "#22c55e", bg: "#052e16" },
  { key: "1-30",    label: "1–30",    color: "#3b82f6", bg: "#0c1a3d" },
  { key: "31-60",   label: "31–60",   color: "#f59e0b", bg: "#2d1f05" },
  { key: "61-90",   label: "61–90",   color: "#f97316", bg: "#2d1505" },
  { key: "90+",     label: "90+",     color: "#ef4444", bg: "#2d0a0a" },
];

function agingBucket(dueDate) {
  if (!dueDate) return "current";
  const today = new Date(); today.setHours(0,0,0,0);
  const due = new Date(dueDate + "T00:00:00");
  const days = Math.floor((today - due) / 86400000);
  if (days <= 0) return "current";
  if (days <= 30) return "1-30";
  if (days <= 60) return "31-60";
  if (days <= 90) return "61-90";
  return "90+";
}

function bucketTotal(invoices, key) {
  return invoices
    .filter((i) => i.status !== "paid" && i.status !== "void" && agingBucket(i.dueDate) === key)
    .reduce((s, i) => s + (i.amount - i.amountPaid), 0);
}

const fmt = (n) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });
const fmtDate = (d) => d ? new Date(d + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—";
const todayStr = () => new Date().toISOString().slice(0, 10);

/* ══════════════════════════════════════════════════════
   Main Dashboard Component
   ══════════════════════════════════════════════════════ */
export default function APAgingDashboard() {
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState("aging");
  const [selectedVendor, setSelectedVendor] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [editInvoice, setEditInvoice] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [extractProgress, setExtractProgress] = useState("");
  const [formData, setFormData] = useState({});
  const [pdfFile, setPdfFile] = useState(null);
  const [sortField, setSortField] = useState("dueDate");
  const [sortDir, setSortDir] = useState("asc");
  const [filterBucket, setFilterBucket] = useState(null);
  // Batch upload queue
  const [uploadQueue, setUploadQueue] = useState([]);  // [{file, fields, status}]
  const [showBatchModal, setShowBatchModal] = useState(false);
  const [batchIndex, setBatchIndex] = useState(0);
  // Payment modal
  const [paymentInvoice, setPaymentInvoice] = useState(null);
  const [paymentMode, setPaymentMode] = useState("full"); // "full" | "partial"
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentDate, setPaymentDate] = useState(todayStr());
  const [paymentHistory, setPaymentHistory] = useState([]);
  const [loadingPayments, setLoadingPayments] = useState(false);

  const fileRef = useRef();

  /* ── Load invoices ── */
  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/invoices");
      const data = await res.json();
      if (Array.isArray(data)) setInvoices(data);
    } catch (e) { console.error("Load error:", e); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  /* ── Extract single PDF: regex first, Haiku fallback ── */
  const extractOne = async (file) => {
    // Try client-side regex first
    const { extractInvoice } = await import("../lib/extract-pdf");
    const result = await extractInvoice(file);

    // If confidence is high, use regex result
    if (result.confidence === "high") return result;

    // Otherwise, try Haiku API fallback
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/extract", { method: "POST", body: fd });
      if (res.ok) {
        const ai = await res.json();
        return {
          vendorName: ai.vendorName || result.vendorName || "",
          invoiceNumber: ai.invoiceNumber || result.invoiceNumber || "",
          invoiceDate: ai.invoiceDate || result.invoiceDate || "",
          dueDate: ai.dueDate || result.dueDate || "",
          amount: ai.amount || result.amount || "",
          terms: ai.terms || result.terms || "",
          description: ai.description || "",
          confidence: "high",
          method: "haiku",
        };
      }
    } catch (e) {
      console.warn("Haiku fallback failed, using regex:", e);
    }

    return result;
  };

  /* ── Handle file upload — single or batch ── */
  const handleFiles = useCallback(async (files) => {
    const pdfs = [...files].filter((f) => f.type === "application/pdf");
    if (!pdfs.length) return;

    setExtracting(true);

    if (pdfs.length === 1) {
      // Single file — extract and open form
      try {
        setExtractProgress("Extracting invoice data...");
        const result = await extractOne(pdfs[0]);
        setFormData({
          vendorName: result.vendorName || "",
          invoiceNumber: result.invoiceNumber || "",
          invoiceDate: result.invoiceDate || "",
          dueDate: result.dueDate || "",
          amount: result.amount || "",
          terms: result.terms || "",
          description: result.description || "",
        });
        setPdfFile(pdfs[0]);
        setEditInvoice(null);
        setShowModal(true);
      } catch (e) {
        console.error("Extraction error:", e);
        setFormData({ vendorName: "", invoiceNumber: "", invoiceDate: "", dueDate: "", amount: "", terms: "", description: "" });
        setPdfFile(pdfs[0]);
        setEditInvoice(null);
        setShowModal(true);
      }
    } else {
      // Batch — extract all, then show review queue
      const queue = [];
      for (let i = 0; i < pdfs.length; i++) {
        setExtractProgress(`Extracting ${i + 1} of ${pdfs.length}...`);
        try {
          const result = await extractOne(pdfs[i]);
          queue.push({
            file: pdfs[i],
            fields: {
              vendorName: result.vendorName || "",
              invoiceNumber: result.invoiceNumber || "",
              invoiceDate: result.invoiceDate || "",
              dueDate: result.dueDate || "",
              amount: result.amount || "",
              terms: result.terms || "",
              description: result.description || "",
            },
            status: "pending",
          });
        } catch (e) {
          queue.push({
            file: pdfs[i],
            fields: { vendorName: "", invoiceNumber: "", invoiceDate: "", dueDate: "", amount: "", terms: "", description: "" },
            status: "pending",
          });
        }
      }
      setUploadQueue(queue);
      setBatchIndex(0);
      setShowBatchModal(true);
    }

    setExtracting(false);
    setExtractProgress("");
  }, []);

  /* ── Drag & drop ── */
  const onDragOver = (e) => { e.preventDefault(); setDragOver(true); };
  const onDragLeave = () => setDragOver(false);
  const onDrop = (e) => { e.preventDefault(); setDragOver(false); handleFiles(e.dataTransfer.files); };

  /* ── Upload PDF to Supabase storage ── */
  const uploadPdf = async (file, vendorName) => {
    if (!sb || !file) return "";
    const folder = vendorName.replace(/[^a-zA-Z0-9\s-]/g, "").replace(/\s+/g, "_");
    const path = `${folder}/${Date.now()}_${file.name}`;
    const { error } = await sb.storage.from("invoices").upload(path, file);
    if (error) { console.error("Upload error:", error); return ""; }
    return path;
  };

  /* ── Save invoice ── */
  const saveInvoice = async (data = null, file = null) => {
    const payload = data || { ...formData };
    const pFile = file || pdfFile;

    if (pFile && !editInvoice) {
      payload.pdfPath = await uploadPdf(pFile, payload.vendorName || "Unknown");
    }

    const method = editInvoice ? "PUT" : "POST";
    const body = editInvoice ? { id: editInvoice.id, ...payload } : payload;

    const res = await fetch("/api/invoices", {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (res.ok) {
      if (!data) {
        setShowModal(false);
        setPdfFile(null);
        setFormData({});
        setEditInvoice(null);
      }
      load();
      return true;
    } else {
      const err = await res.json();
      if (!data) alert(err.error || "Save failed");
      return false;
    }
  };

  /* ── Batch: save current and advance ── */
  const saveBatchItem = async () => {
    const item = uploadQueue[batchIndex];
    if (!item) return;

    const ok = await saveInvoice(item.fields, item.file);
    const newQueue = [...uploadQueue];
    newQueue[batchIndex] = { ...item, status: ok ? "saved" : "error" };
    setUploadQueue(newQueue);

    // Advance to next pending
    const nextIdx = newQueue.findIndex((q, i) => i > batchIndex && q.status === "pending");
    if (nextIdx >= 0) {
      setBatchIndex(nextIdx);
    } else {
      // All done
      setTimeout(() => { setShowBatchModal(false); setUploadQueue([]); }, 500);
    }
  };

  /* ── Batch: skip current ── */
  const skipBatchItem = () => {
    const newQueue = [...uploadQueue];
    newQueue[batchIndex] = { ...newQueue[batchIndex], status: "skipped" };
    setUploadQueue(newQueue);
    const nextIdx = newQueue.findIndex((q, i) => i > batchIndex && q.status === "pending");
    if (nextIdx >= 0) setBatchIndex(nextIdx);
    else { setShowBatchModal(false); setUploadQueue([]); }
  };

  /* ── Open payment modal ── */
  const openPaymentModal = async (inv) => {
    setPaymentInvoice(inv);
    setPaymentMode("full");
    setPaymentAmount(String(inv.amount - inv.amountPaid));
    setPaymentDate(todayStr());
    setLoadingPayments(true);

    try {
      const res = await fetch(`/api/payments?invoiceId=${inv.id}`);
      const data = await res.json();
      setPaymentHistory(Array.isArray(data) ? data : []);
    } catch (e) { setPaymentHistory([]); }
    setLoadingPayments(false);
  };

  /* ── Submit payment ── */
  const submitPayment = async () => {
    if (!paymentInvoice) return;
    const amt = parseFloat(paymentAmount);
    if (isNaN(amt) || amt <= 0) return;

    const res = await fetch("/api/payments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        invoiceId: paymentInvoice.id,
        amount: amt,
        paymentDate: paymentDate,
      }),
    });

    if (res.ok) {
      setPaymentInvoice(null);
      load();
    } else {
      const err = await res.json();
      alert(err.error || "Payment failed");
    }
  };

  /* ── Delete invoice ── */
  const deleteInvoice = async (inv) => {
    if (!confirm(`Delete invoice ${inv.invoiceNumber} from ${inv.vendorName}?`)) return;
    await fetch(`/api/invoices?id=${inv.id}`, { method: "DELETE" });
    load();
  };

  /* ── Download PDF ── */
  const downloadPdf = async (inv) => {
    if (!sb || !inv.pdfPath) return;
    const { data, error } = await sb.storage.from("invoices").download(inv.pdfPath);
    if (error) { alert("Download failed"); return; }
    const url = URL.createObjectURL(data);
    const a = document.createElement("a"); a.href = url;
    a.download = inv.pdfPath.split("/").pop(); a.click();
    URL.revokeObjectURL(url);
  };

  const downloadVendorPdfs = async (vendorName) => {
    const vendorInvs = invoices.filter((i) => i.vendorName === vendorName && i.pdfPath);
    if (!vendorInvs.length) { alert("No PDFs for this vendor"); return; }
    for (const inv of vendorInvs) await downloadPdf(inv);
  };

  /* ── Sorting ── */
  const toggleSort = (field) => {
    if (sortField === field) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortField(field); setSortDir("asc"); }
  };

  const openInvoices = invoices.filter((i) => i.status !== "paid" && i.status !== "void");
  const filtered = (filterBucket
    ? openInvoices.filter((i) => agingBucket(i.dueDate) === filterBucket)
    : openInvoices
  ).sort((a, b) => {
    let va = a[sortField], vb = b[sortField];
    if (sortField === "amount") { va = a.amount - a.amountPaid; vb = b.amount - b.amountPaid; }
    if (va < vb) return sortDir === "asc" ? -1 : 1;
    if (va > vb) return sortDir === "asc" ? 1 : -1;
    return 0;
  });

  const vendors = {};
  invoices.forEach((i) => { if (!vendors[i.vendorName]) vendors[i.vendorName] = []; vendors[i.vendorName].push(i); });
  const vendorList = Object.keys(vendors).sort();
  const totalOutstanding = openInvoices.reduce((s, i) => s + (i.amount - i.amountPaid), 0);

  const S = styles;

  /* ══════════════════════════════════════════════════
     RENDER
     ══════════════════════════════════════════════════ */
  return (
    <div style={S.page}>
      {/* ── Header ── */}
      <div style={S.header}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={S.logo}>AP</div>
          <div>
            <h1 style={S.title}>Accounts Payable Aging</h1>
            <p style={S.subtitle}>{invoices.length} invoices · {fmt(totalOutstanding)} outstanding</p>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button style={{ ...S.btn, ...(view === "aging" ? S.btnActive : {}) }} onClick={() => setView("aging")}>Aging View</button>
          <button style={{ ...S.btn, ...(view === "vendors" ? S.btnActive : {}) }} onClick={() => { setView("vendors"); setSelectedVendor(null); }}>Vendor Folders</button>
          <button style={S.btnPrimary} onClick={() => {
            setFormData({ vendorName: "", invoiceNumber: "", invoiceDate: "", dueDate: "", amount: "", terms: "", description: "" });
            setPdfFile(null); setEditInvoice(null); setShowModal(true);
          }}>+ Add Invoice</button>
        </div>
      </div>

      {/* ── Total AP Outstanding ── */}
      <div style={{ display: "inline-block", padding: "14px 24px", borderRadius: 8, border: "1px solid #1e293b", background: "#0d1117", marginBottom: 16 }}>
        <div style={{ fontSize: 11, color: "#64748b", fontWeight: 600, textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>
          Total AP Outstanding
        </div>
        <div style={{ fontSize: 26, fontWeight: 700, color: totalOutstanding > 0 ? "#ef4444" : "#22c55e", fontVariantNumeric: "tabular-nums" }}>
          {fmt(totalOutstanding)}
        </div>
      </div>

      {/* ── Drop Zone ── */}
      <div
        style={{ ...S.dropZone, ...(dragOver ? S.dropZoneActive : {}), ...(extracting ? { opacity: 0.6 } : {}) }}
        onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}
        onClick={() => !extracting && fileRef.current?.click()}
      >
        <input ref={fileRef} type="file" accept=".pdf" multiple style={{ display: "none" }}
          onChange={(e) => handleFiles(e.target.files)} />
        {extracting ? (
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={S.spinner} />
            <span>{extractProgress || "Extracting..."}</span>
          </div>
        ) : (
          <>
            <span style={{ fontSize: 24, marginBottom: 4 }}>📄</span>
            <span>Drop PDF invoices here or <span style={{ color: "#3b82f6", textDecoration: "underline", cursor: "pointer" }}>browse</span></span>
            <span style={{ fontSize: 11, color: "#475569" }}>Upload one or multiple — AI extraction with verification</span>
          </>
        )}
      </div>

      {/* ── Aging View ── */}
      {view === "aging" && (
        <>
          <div style={S.bucketRow}>
            {BUCKETS.map((b) => {
              const total = bucketTotal(invoices, b.key);
              const count = openInvoices.filter((i) => agingBucket(i.dueDate) === b.key).length;
              const active = filterBucket === b.key;
              return (
                <div key={b.key} style={{ ...S.bucketCard, borderColor: active ? b.color : "#1e293b", background: active ? b.bg : "#0d1117", cursor: "pointer" }}
                  onClick={() => setFilterBucket(active ? null : b.key)}>
                  <div style={{ fontSize: 11, color: "#64748b", fontWeight: 600, textTransform: "uppercase", letterSpacing: 1 }}>{b.label}</div>
                  <div style={{ fontSize: 22, fontWeight: 700, color: b.color, fontVariantNumeric: "tabular-nums", marginTop: 4 }}>{fmt(total)}</div>
                  <div style={{ fontSize: 11, color: "#475569", marginTop: 2 }}>{count} invoice{count !== 1 ? "s" : ""}</div>
                </div>
              );
            })}
          </div>

          {filterBucket && (
            <div style={{ padding: "0 16px 8px", fontSize: 12, color: "#64748b" }}>
              Showing: <strong style={{ color: BUCKETS.find(b => b.key === filterBucket)?.color }}>{BUCKETS.find(b => b.key === filterBucket)?.label} days</strong>
              {" "}· <span style={{ color: "#3b82f6", cursor: "pointer", textDecoration: "underline" }} onClick={() => setFilterBucket(null)}>clear filter</span>
            </div>
          )}

          {/* Invoice Table */}
          <div style={S.tableWrap}>
            {loading ? <div style={{ padding: 40, textAlign: "center", color: "#475569" }}>Loading…</div>
            : filtered.length === 0 ? <div style={{ padding: 40, textAlign: "center", color: "#475569" }}>{filterBucket ? "No invoices in this bucket" : "No open invoices — drop a PDF above"}</div>
            : (
              <table style={S.table}>
                <thead><tr>
                  {[{ key: "vendorName", label: "Vendor" }, { key: "invoiceNumber", label: "Invoice #" }, { key: "invoiceDate", label: "Inv Date" }, { key: "dueDate", label: "Due Date" }, { key: "amount", label: "Outstanding" }, { key: "terms", label: "Terms" }, { key: "aging", label: "Aging" }].map((col) => (
                    <th key={col.key} style={{ ...S.th, cursor: "pointer" }} onClick={() => toggleSort(col.key)}>
                      {col.label} {sortField === col.key ? (sortDir === "asc" ? "↑" : "↓") : ""}
                    </th>
                  ))}
                  <th style={S.th}>Actions</th>
                </tr></thead>
                <tbody>
                  {filtered.map((inv) => {
                    const bucket = agingBucket(inv.dueDate);
                    const bInfo = BUCKETS.find((b) => b.key === bucket);
                    const outstanding = inv.amount - inv.amountPaid;
                    return (
                      <tr key={inv.id} style={S.tr}>
                        <td style={S.td}>{inv.vendorName}</td>
                        <td style={{ ...S.td, fontFamily: "'JetBrains Mono', monospace", fontSize: 12 }}>{inv.invoiceNumber}</td>
                        <td style={S.td}>{fmtDate(inv.invoiceDate)}</td>
                        <td style={S.td}>{fmtDate(inv.dueDate)}</td>
                        <td style={{ ...S.td, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
                          {fmt(outstanding)}
                          {inv.amountPaid > 0 && <span style={{ fontSize: 10, color: "#22c55e", marginLeft: 4 }}>({fmt(inv.amountPaid)} paid)</span>}
                        </td>
                        <td style={S.td}>{inv.terms || "—"}</td>
                        <td style={S.td}>
                          <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 4, fontSize: 11, fontWeight: 600, color: bInfo?.color, background: bInfo?.bg, border: `1px solid ${bInfo?.color}33` }}>{bInfo?.label}</span>
                        </td>
                        <td style={S.td}>
                          <div style={{ display: "flex", gap: 4 }}>
                            <button style={S.btnSmall} onClick={() => openPaymentModal(inv)} title="Record payment">💰</button>
                            <button style={S.btnSmall} onClick={() => {
                              setEditInvoice(inv);
                              setFormData({ vendorName: inv.vendorName, invoiceNumber: inv.invoiceNumber, invoiceDate: inv.invoiceDate || "", dueDate: inv.dueDate || "", amount: inv.amount, terms: inv.terms || "", description: inv.description || "" });
                              setPdfFile(null); setShowModal(true);
                            }} title="Edit">✏️</button>
                            {inv.pdfPath && <button style={S.btnSmall} onClick={() => downloadPdf(inv)} title="Download PDF">📥</button>}
                            <button style={{ ...S.btnSmall, color: "#ef4444" }} onClick={() => deleteInvoice(inv)} title="Delete">🗑️</button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          {/* Vendor Breakdown */}
          {vendorList.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <h3 style={{ fontSize: 13, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>Vendor Breakdown</h3>
              <div style={S.tableWrap}>
                <table style={S.table}>
                  <thead><tr>
                    <th style={S.th}>Vendor</th>
                    <th style={{ ...S.th, textAlign: "center" }}>Invoices</th>
                    {BUCKETS.map((b) => <th key={b.key} style={{ ...S.th, textAlign: "right", color: b.color }}>{b.label}</th>)}
                    <th style={{ ...S.th, textAlign: "right" }}>Total Outstanding</th>
                  </tr></thead>
                  <tbody>
                    {vendorList.map((v) => {
                      const vOpen = (vendors[v] || []).filter((i) => i.status !== "paid" && i.status !== "void");
                      const vTotal = vOpen.reduce((s, i) => s + (i.amount - i.amountPaid), 0);
                      if (vOpen.length === 0) return null;
                      return (
                        <tr key={v} style={S.tr}>
                          <td style={{ ...S.td, fontWeight: 600, color: "#e2e8f0" }}>{v}</td>
                          <td style={{ ...S.td, textAlign: "center" }}>{vOpen.length}</td>
                          {BUCKETS.map((b) => {
                            const bT = vOpen.filter((i) => agingBucket(i.dueDate) === b.key).reduce((s, i) => s + (i.amount - i.amountPaid), 0);
                            return <td key={b.key} style={{ ...S.td, textAlign: "right", fontVariantNumeric: "tabular-nums", color: bT > 0 ? b.color : "#334155" }}>{bT > 0 ? fmt(bT) : "—"}</td>;
                          })}
                          <td style={{ ...S.td, textAlign: "right", fontWeight: 700, fontVariantNumeric: "tabular-nums", color: "#f1f5f9" }}>{fmt(vTotal)}</td>
                        </tr>
                      );
                    })}
                    <tr style={{ borderTop: "2px solid #1e293b" }}>
                      <td style={{ ...S.td, fontWeight: 700, color: "#e2e8f0" }}>Total</td>
                      <td style={{ ...S.td, textAlign: "center", fontWeight: 700 }}>{openInvoices.length}</td>
                      {BUCKETS.map((b) => {
                        const bT = bucketTotal(invoices, b.key);
                        return <td key={b.key} style={{ ...S.td, textAlign: "right", fontWeight: 700, fontVariantNumeric: "tabular-nums", color: bT > 0 ? b.color : "#334155" }}>{bT > 0 ? fmt(bT) : "—"}</td>;
                      })}
                      <td style={{ ...S.td, textAlign: "right", fontWeight: 700, fontVariantNumeric: "tabular-nums", color: "#f1f5f9", fontSize: 14 }}>{fmt(totalOutstanding)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Paid/Void */}
          {invoices.filter((i) => i.status === "paid" || i.status === "void").length > 0 && (
            <details style={{ margin: "0 0 16px" }}>
              <summary style={{ ...S.btn, cursor: "pointer", display: "inline-block", marginBottom: 8 }}>
                Show paid/void invoices ({invoices.filter((i) => i.status === "paid" || i.status === "void").length})
              </summary>
              <div style={S.tableWrap}>
                <table style={S.table}>
                  <thead><tr><th style={S.th}>Vendor</th><th style={S.th}>Invoice #</th><th style={S.th}>Amount</th><th style={S.th}>Status</th><th style={S.th}>Actions</th></tr></thead>
                  <tbody>
                    {invoices.filter((i) => i.status === "paid" || i.status === "void").map((inv) => (
                      <tr key={inv.id} style={{ ...S.tr, opacity: 0.6 }}>
                        <td style={S.td}>{inv.vendorName}</td>
                        <td style={{ ...S.td, fontFamily: "'JetBrains Mono', monospace", fontSize: 12 }}>{inv.invoiceNumber}</td>
                        <td style={S.td}>{fmt(inv.amount)}</td>
                        <td style={S.td}><span style={{ padding: "2px 8px", borderRadius: 4, fontSize: 11, fontWeight: 600, background: inv.status === "paid" ? "#052e16" : "#1e1b2e", color: inv.status === "paid" ? "#22c55e" : "#8b5cf6" }}>{inv.status}</span></td>
                        <td style={S.td}>
                          {inv.pdfPath && <button style={S.btnSmall} onClick={() => downloadPdf(inv)}>📥</button>}
                          <button style={{ ...S.btnSmall, color: "#ef4444" }} onClick={() => deleteInvoice(inv)}>🗑️</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          )}
        </>
      )}

      {/* ── Vendor Folders View ── */}
      {view === "vendors" && !selectedVendor && (
        <div style={S.vendorGrid}>
          {vendorList.length === 0
            ? <div style={{ gridColumn: "1/-1", padding: 40, textAlign: "center", color: "#475569" }}>No vendors yet — drop an invoice above</div>
            : vendorList.map((v) => {
              const vInvs = vendors[v];
              const open = vInvs.filter((i) => i.status !== "paid" && i.status !== "void");
              const total = open.reduce((s, i) => s + (i.amount - i.amountPaid), 0);
              const hasPdfs = vInvs.some((i) => i.pdfPath);
              return (
                <div key={v} style={S.vendorCard} onClick={() => setSelectedVendor(v)}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <div style={{ fontSize: 24, marginBottom: 8 }}>📁</div>
                    {hasPdfs && <button style={{ ...S.btnSmall, fontSize: 10 }} onClick={(e) => { e.stopPropagation(); downloadVendorPdfs(v); }}>📥 All</button>}
                  </div>
                  <div style={{ fontWeight: 600, fontSize: 14, color: "#e2e8f0", marginBottom: 4 }}>{v}</div>
                  <div style={{ fontSize: 12, color: "#64748b" }}>{vInvs.length} invoice{vInvs.length !== 1 ? "s" : ""} · {open.length} open</div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: total > 0 ? "#f59e0b" : "#22c55e", marginTop: 6, fontVariantNumeric: "tabular-nums" }}>{fmt(total)}</div>
                </div>
              );
            })}
        </div>
      )}

      {view === "vendors" && selectedVendor && (
        <div>
          <button style={{ ...S.btn, marginBottom: 12 }} onClick={() => setSelectedVendor(null)}>← Back to Vendors</button>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: "#e2e8f0", marginBottom: 12 }}>{selectedVendor}</h2>
          <div style={S.tableWrap}>
            <table style={S.table}>
              <thead><tr>
                <th style={S.th}>Invoice #</th><th style={S.th}>Date</th><th style={S.th}>Due</th>
                <th style={S.th}>Amount</th><th style={S.th}>Paid</th><th style={S.th}>Status</th>
                <th style={S.th}>Aging</th><th style={S.th}>Actions</th>
              </tr></thead>
              <tbody>
                {(vendors[selectedVendor] || []).map((inv) => {
                  const bucket = agingBucket(inv.dueDate);
                  const bInfo = BUCKETS.find((b) => b.key === bucket);
                  return (
                    <tr key={inv.id} style={S.tr}>
                      <td style={{ ...S.td, fontFamily: "'JetBrains Mono', monospace", fontSize: 12 }}>{inv.invoiceNumber}</td>
                      <td style={S.td}>{fmtDate(inv.invoiceDate)}</td>
                      <td style={S.td}>{fmtDate(inv.dueDate)}</td>
                      <td style={{ ...S.td, fontVariantNumeric: "tabular-nums" }}>{fmt(inv.amount)}</td>
                      <td style={{ ...S.td, color: "#22c55e", fontVariantNumeric: "tabular-nums" }}>{fmt(inv.amountPaid)}</td>
                      <td style={S.td}><span style={{ padding: "2px 8px", borderRadius: 4, fontSize: 11, fontWeight: 600, background: inv.status === "paid" ? "#052e16" : inv.status === "partial" ? "#2d1f05" : "#0c1a3d", color: inv.status === "paid" ? "#22c55e" : inv.status === "partial" ? "#f59e0b" : "#3b82f6" }}>{inv.status}</span></td>
                      <td style={S.td}>{inv.status !== "paid" && inv.status !== "void" && <span style={{ padding: "2px 8px", borderRadius: 4, fontSize: 11, fontWeight: 600, color: bInfo?.color, background: bInfo?.bg, border: `1px solid ${bInfo?.color}33` }}>{bInfo?.label}</span>}</td>
                      <td style={S.td}>
                        <div style={{ display: "flex", gap: 4 }}>
                          {inv.status !== "paid" && <button style={S.btnSmall} onClick={() => openPaymentModal(inv)}>💰</button>}
                          <button style={S.btnSmall} onClick={() => {
                            setEditInvoice(inv);
                            setFormData({ vendorName: inv.vendorName, invoiceNumber: inv.invoiceNumber, invoiceDate: inv.invoiceDate || "", dueDate: inv.dueDate || "", amount: inv.amount, terms: inv.terms || "", description: inv.description || "" });
                            setPdfFile(null); setShowModal(true);
                          }}>✏️</button>
                          {inv.pdfPath && <button style={S.btnSmall} onClick={() => downloadPdf(inv)}>📥</button>}
                          <button style={{ ...S.btnSmall, color: "#ef4444" }} onClick={() => deleteInvoice(inv)}>🗑️</button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════
          MODAL — Add / Edit Invoice
          ══════════════════════════════════════════════ */}
      {showModal && (
        <div style={S.overlay} onClick={() => setShowModal(false)}>
          <div style={S.modal} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ fontSize: 16, fontWeight: 700, color: "#e2e8f0", marginBottom: 16 }}>
              {editInvoice ? "Edit Invoice" : "Add Invoice"}
            </h3>
            {pdfFile && <div style={{ marginBottom: 12, padding: "8px 12px", background: "#0d1117", borderRadius: 6, border: "1px solid #1e293b", fontSize: 12 }}>📄 {pdfFile.name}</div>}
            <div style={S.formGrid}>
              {[
                { key: "vendorName", label: "Vendor Name", required: true },
                { key: "invoiceNumber", label: "Invoice #", required: true },
                { key: "invoiceDate", label: "Invoice Date", type: "date" },
                { key: "dueDate", label: "Due Date", type: "date" },
                { key: "amount", label: "Amount", type: "number" },
                { key: "terms", label: "Terms" },
              ].map((f) => (
                <label key={f.key} style={S.formLabel}>
                  <span style={{ fontSize: 11, color: "#64748b", fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5 }}>{f.label}{f.required ? " *" : ""}</span>
                  <input style={S.input} type={f.type || "text"} step={f.type === "number" ? "0.01" : undefined}
                    value={formData[f.key] || ""} onChange={(e) => setFormData((p) => ({ ...p, [f.key]: e.target.value }))} placeholder={f.label} />
                </label>
              ))}
            </div>
            <label style={{ ...S.formLabel, marginTop: 12 }}>
              <span style={{ fontSize: 11, color: "#64748b", fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5 }}>Description</span>
              <textarea style={{ ...S.input, minHeight: 60, resize: "vertical" }} value={formData.description || ""} onChange={(e) => setFormData((p) => ({ ...p, description: e.target.value }))} />
            </label>
            <div style={{ display: "flex", gap: 8, marginTop: 16, justifyContent: "flex-end" }}>
              <button style={S.btn} onClick={() => { setShowModal(false); setPdfFile(null); }}>Cancel</button>
              <button style={S.btnPrimary} onClick={() => saveInvoice()}>{editInvoice ? "Update" : "Save Invoice"}</button>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════
          MODAL — Batch Upload Review
          ══════════════════════════════════════════════ */}
      {showBatchModal && uploadQueue.length > 0 && (
        <div style={S.overlay} onClick={() => { setShowBatchModal(false); setUploadQueue([]); }}>
          <div style={{ ...S.modal, maxWidth: 600 }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <h3 style={{ fontSize: 16, fontWeight: 700, color: "#e2e8f0" }}>
                Review Invoices ({batchIndex + 1} of {uploadQueue.length})
              </h3>
              <div style={{ display: "flex", gap: 6 }}>
                {uploadQueue.map((q, i) => (
                  <div key={i} style={{
                    width: 8, height: 8, borderRadius: "50%",
                    background: q.status === "saved" ? "#22c55e" : q.status === "skipped" ? "#64748b" : q.status === "error" ? "#ef4444" : i === batchIndex ? "#3b82f6" : "#1e293b",
                  }} />
                ))}
              </div>
            </div>

            <div style={{ marginBottom: 12, padding: "8px 12px", background: "#0d1117", borderRadius: 6, border: "1px solid #1e293b", fontSize: 12 }}>
              📄 {uploadQueue[batchIndex]?.file.name}
            </div>

            <div style={S.formGrid}>
              {[
                { key: "vendorName", label: "Vendor Name", required: true },
                { key: "invoiceNumber", label: "Invoice #", required: true },
                { key: "invoiceDate", label: "Invoice Date", type: "date" },
                { key: "dueDate", label: "Due Date", type: "date" },
                { key: "amount", label: "Amount", type: "number" },
                { key: "terms", label: "Terms" },
              ].map((f) => (
                <label key={f.key} style={S.formLabel}>
                  <span style={{ fontSize: 11, color: "#64748b", fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5 }}>{f.label}{f.required ? " *" : ""}</span>
                  <input style={S.input} type={f.type || "text"} step={f.type === "number" ? "0.01" : undefined}
                    value={uploadQueue[batchIndex]?.fields[f.key] || ""}
                    onChange={(e) => {
                      const newQ = [...uploadQueue];
                      newQ[batchIndex] = { ...newQ[batchIndex], fields: { ...newQ[batchIndex].fields, [f.key]: e.target.value } };
                      setUploadQueue(newQ);
                    }} placeholder={f.label} />
                </label>
              ))}
            </div>

            <div style={{ display: "flex", gap: 8, marginTop: 16, justifyContent: "flex-end" }}>
              <button style={S.btn} onClick={() => { setShowBatchModal(false); setUploadQueue([]); }}>Cancel All</button>
              <button style={{ ...S.btn, color: "#f59e0b" }} onClick={skipBatchItem}>Skip</button>
              <button style={S.btnPrimary} onClick={saveBatchItem}>Save & Next</button>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════
          MODAL — Record Payment
          ══════════════════════════════════════════════ */}
      {paymentInvoice && (
        <div style={S.overlay} onClick={() => setPaymentInvoice(null)}>
          <div style={{ ...S.modal, maxWidth: 440 }} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ fontSize: 18, fontWeight: 800, color: "#e2e8f0", marginBottom: 16 }}>Record Payment</h3>

            {/* Invoice info card */}
            <div style={{ background: "#0d1117", border: "1px solid #1e293b", borderRadius: 8, padding: 16, marginBottom: 20 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                <span style={{ fontSize: 12, color: "#64748b" }}>Vendor</span>
                <span style={{ fontSize: 14, fontWeight: 600, color: "#e2e8f0" }}>{paymentInvoice.vendorName}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                <span style={{ fontSize: 12, color: "#64748b" }}>Invoice #</span>
                <span style={{ fontSize: 14, fontFamily: "'JetBrains Mono', monospace", color: "#e2e8f0" }}>{paymentInvoice.invoiceNumber}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                <span style={{ fontSize: 12, color: "#64748b" }}>Original Amount</span>
                <span style={{ fontSize: 14, color: "#e2e8f0" }}>{fmt(paymentInvoice.amount)}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ fontSize: 12, color: "#64748b" }}>Balance Due</span>
                <span style={{ fontSize: 16, fontWeight: 800, color: "#f59e0b" }}>{fmt(paymentInvoice.amount - paymentInvoice.amountPaid)}</span>
              </div>
            </div>

            {/* Payment date */}
            <label style={{ ...S.formLabel, marginBottom: 16 }}>
              <span style={{ fontSize: 11, color: "#64748b", fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5 }}>Payment Date</span>
              <input style={S.input} type="date" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} />
            </label>

            {/* Full / Partial toggle */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 16 }}>
              <button
                style={{ ...S.btn, textAlign: "center", ...(paymentMode === "full" ? { borderColor: "#3b82f6", color: "#3b82f6", background: "#0c1a3d" } : {}) }}
                onClick={() => { setPaymentMode("full"); setPaymentAmount(String(paymentInvoice.amount - paymentInvoice.amountPaid)); }}
              >Full Payment</button>
              <button
                style={{ ...S.btn, textAlign: "center", ...(paymentMode === "partial" ? { borderColor: "#3b82f6", color: "#3b82f6", background: "#0c1a3d" } : {}) }}
                onClick={() => { setPaymentMode("partial"); setPaymentAmount(""); }}
              >Partial Payment</button>
            </div>

            {/* Amount display / input */}
            {paymentMode === "full" ? (
              <div style={{ background: "#052e16", border: "1px solid #22c55e33", borderRadius: 8, padding: "14px 16px", textAlign: "center", marginBottom: 16 }}>
                <span style={{ fontSize: 14, color: "#22c55e" }}>Paying: </span>
                <span style={{ fontSize: 18, fontWeight: 700, color: "#22c55e" }}>{fmt(paymentInvoice.amount - paymentInvoice.amountPaid)}</span>
              </div>
            ) : (
              <label style={{ ...S.formLabel, marginBottom: 16 }}>
                <span style={{ fontSize: 11, color: "#64748b", fontWeight: 600, textTransform: "uppercase" }}>Payment Amount</span>
                <input style={{ ...S.input, fontSize: 18, fontWeight: 700, textAlign: "center" }} type="number" step="0.01"
                  value={paymentAmount} onChange={(e) => setPaymentAmount(e.target.value)}
                  placeholder="0.00" autoFocus />
              </label>
            )}

            {/* Payment history */}
            {(paymentHistory.length > 0 || loadingPayments) && (
              <div style={{ background: "#0d1117", border: "1px solid #1e293b", borderRadius: 8, padding: 12, marginBottom: 16 }}>
                <div style={{ fontSize: 11, color: "#64748b", fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>Payment History</div>
                {loadingPayments ? <div style={{ fontSize: 12, color: "#475569" }}>Loading...</div> :
                  paymentHistory.map((p) => (
                    <div key={p.id} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", borderBottom: "1px solid #111827", fontSize: 13 }}>
                      <span style={{ color: "#94a3b8" }}>{fmtDate(p.paymentDate)}</span>
                      <span style={{ color: "#22c55e", fontVariantNumeric: "tabular-nums", fontWeight: 500 }}>{fmt(p.amount)}</span>
                    </div>
                  ))
                }
              </div>
            )}

            {/* Actions */}
            <div style={{ display: "flex", gap: 8 }}>
              <button style={{ ...S.btn, flex: 1 }} onClick={() => setPaymentInvoice(null)}>Cancel</button>
              <button style={{ ...S.btnPrimary, flex: 1, padding: "12px 16px", fontSize: 14 }} onClick={submitPayment}>Record Payment</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════
   STYLES
   ══════════════════════════════════════════════════ */
const styles = {
  page: { maxWidth: 1200, margin: "0 auto", padding: "16px" },
  header: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 12 },
  logo: { width: 40, height: 40, borderRadius: 8, background: "linear-gradient(135deg, #3b82f6, #1d4ed8)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 14, color: "#fff", letterSpacing: 1 },
  title: { fontSize: 20, fontWeight: 700, color: "#f1f5f9", letterSpacing: -0.5 },
  subtitle: { fontSize: 12, color: "#64748b", marginTop: 2 },
  btn: { padding: "8px 14px", borderRadius: 6, border: "1px solid #1e293b", background: "#0d1117", color: "#94a3b8", fontSize: 12, fontWeight: 500, cursor: "pointer", transition: "all .15s" },
  btnActive: { background: "#1e293b", color: "#e2e8f0", borderColor: "#3b82f6" },
  btnPrimary: { padding: "8px 16px", borderRadius: 6, border: "none", background: "linear-gradient(135deg, #3b82f6, #2563eb)", color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer" },
  btnSmall: { padding: "4px 6px", borderRadius: 4, border: "1px solid #1e293b", background: "transparent", color: "#94a3b8", fontSize: 12, cursor: "pointer" },
  dropZone: { border: "2px dashed #1e293b", borderRadius: 8, padding: "24px", textAlign: "center", marginBottom: 16, cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 4, transition: "all .2s", background: "#0a0f1a" },
  dropZoneActive: { borderColor: "#3b82f6", background: "#0c1a3d" },
  bucketRow: { display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 10, marginBottom: 16 },
  bucketCard: { padding: "14px 16px", borderRadius: 8, border: "1px solid #1e293b", transition: "all .2s" },
  tableWrap: { background: "#0d1117", border: "1px solid #1e293b", borderRadius: 8, overflow: "auto", marginBottom: 16 },
  table: { width: "100%", borderCollapse: "collapse" },
  th: { padding: "10px 12px", textAlign: "left", fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5, color: "#64748b", borderBottom: "1px solid #1e293b", background: "#0a0f1a", whiteSpace: "nowrap" },
  tr: { borderBottom: "1px solid #111827" },
  td: { padding: "10px 12px", fontSize: 13, whiteSpace: "nowrap" },
  vendorGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 12, marginBottom: 16 },
  vendorCard: { padding: "16px", borderRadius: 8, border: "1px solid #1e293b", background: "#0d1117", cursor: "pointer", transition: "all .2s" },
  overlay: { position: "fixed", inset: 0, background: "rgba(0,0,0,.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 999, animation: "fadeIn .2s" },
  modal: { background: "#161b22", border: "1px solid #1e293b", borderRadius: 12, padding: "24px", width: "100%", maxWidth: 520, maxHeight: "90vh", overflow: "auto", animation: "modalIn .2s" },
  formGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 },
  formLabel: { display: "flex", flexDirection: "column", gap: 4 },
  input: { padding: "8px 12px", borderRadius: 6, border: "1px solid #1e293b", background: "#0d1117", color: "#e2e8f0", fontSize: 13, fontFamily: "inherit", outline: "none" },
  spinner: { width: 18, height: 18, border: "2px solid #1e293b", borderTopColor: "#3b82f6", borderRadius: "50%", animation: "spin .6s linear infinite" },
};
