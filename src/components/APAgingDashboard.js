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
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(dueDate + "T00:00:00");
  const daysOverdue = Math.floor((today - due) / 86400000);
  if (daysOverdue <= 0) return "current";
  if (daysOverdue <= 30) return "1-30";
  if (daysOverdue <= 60) return "31-60";
  if (daysOverdue <= 90) return "61-90";
  return "90+";
}

function bucketTotal(invoices, key) {
  return invoices
    .filter((i) => i.status !== "paid" && i.status !== "void" && agingBucket(i.dueDate) === key)
    .reduce((s, i) => s + (i.amount - i.amountPaid), 0);
}

const fmt = (n) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });
const fmtDate = (d) => d ? new Date(d + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—";

/* ══════════════════════════════════════════════════════
   Main Dashboard Component
   ══════════════════════════════════════════════════════ */
export default function APAgingDashboard() {
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState("aging");        // "aging" | "vendors"
  const [selectedVendor, setSelectedVendor] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [editInvoice, setEditInvoice] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [formData, setFormData] = useState({});
  const [pdfFile, setPdfFile] = useState(null);
  const [sortField, setSortField] = useState("dueDate");
  const [sortDir, setSortDir] = useState("asc");
  const [filterBucket, setFilterBucket] = useState(null);
  const fileRef = useRef();

  /* ── Load invoices ── */
  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/invoices");
      const data = await res.json();
      if (Array.isArray(data)) setInvoices(data);
    } catch (e) {
      console.error("Load error:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  /* ── PDF extraction (client-side, free) ── */
  const handleFiles = useCallback(async (files) => {
    const pdfs = [...files].filter((f) => f.type === "application/pdf");
    if (!pdfs.length) return;

    setExtracting(true);
    try {
      const { extractInvoice } = await import("../lib/extract-pdf");
      const result = await extractInvoice(pdfs[0]);
      setFormData({
        vendorName: result.vendorName || "",
        invoiceNumber: result.invoiceNumber || "",
        invoiceDate: result.invoiceDate || "",
        dueDate: result.dueDate || "",
        amount: result.amount || "",
        terms: result.terms || "",
        description: "",
      });
      setPdfFile(pdfs[0]);
      setEditInvoice(null);
      setShowModal(true);
    } catch (e) {
      console.error("Extraction error:", e);
      // Open blank form on failure
      setFormData({ vendorName: "", invoiceNumber: "", invoiceDate: "", dueDate: "", amount: "", terms: "", description: "" });
      setPdfFile(pdfs[0]);
      setEditInvoice(null);
      setShowModal(true);
    } finally {
      setExtracting(false);
    }
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
  const saveInvoice = async () => {
    const payload = { ...formData };

    // Upload PDF if present
    if (pdfFile && !editInvoice) {
      payload.pdfPath = await uploadPdf(pdfFile, payload.vendorName || "Unknown");
    }

    const method = editInvoice ? "PUT" : "POST";
    const body = editInvoice ? { id: editInvoice.id, ...payload } : payload;

    const res = await fetch("/api/invoices", {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (res.ok) {
      setShowModal(false);
      setPdfFile(null);
      setFormData({});
      setEditInvoice(null);
      load();
    } else {
      const err = await res.json();
      alert(err.error || "Save failed");
    }
  };

  /* ── Record payment ── */
  const recordPayment = async (inv) => {
    const input = prompt(`Payment for ${inv.vendorName} — ${inv.invoiceNumber}\nOutstanding: ${fmt(inv.amount - inv.amountPaid)}\n\nEnter payment amount:`);
    if (!input) return;
    const pmt = parseFloat(input);
    if (isNaN(pmt) || pmt <= 0) return;
    const newPaid = inv.amountPaid + pmt;
    const status = newPaid >= inv.amount ? "paid" : "partial";
    await fetch("/api/invoices", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: inv.id, amountPaid: newPaid, status }),
    });
    load();
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
    const a = document.createElement("a");
    a.href = url;
    a.download = inv.pdfPath.split("/").pop();
    a.click();
    URL.revokeObjectURL(url);
  };

  /* ── Download all vendor PDFs as individual files ── */
  const downloadVendorPdfs = async (vendorName) => {
    const vendorInvs = invoices.filter((i) => i.vendorName === vendorName && i.pdfPath);
    if (!vendorInvs.length) { alert("No PDFs for this vendor"); return; }
    for (const inv of vendorInvs) {
      await downloadPdf(inv);
    }
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

  /* ── Vendor grouping ── */
  const vendors = {};
  invoices.forEach((i) => {
    if (!vendors[i.vendorName]) vendors[i.vendorName] = [];
    vendors[i.vendorName].push(i);
  });
  const vendorList = Object.keys(vendors).sort();

  const totalOutstanding = openInvoices.reduce((s, i) => s + (i.amount - i.amountPaid), 0);

  /* ══════════════════════════════════════════════════
     RENDER
     ══════════════════════════════════════════════════ */

  const S = styles;

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
          <button style={{ ...S.btn, ...(view === "aging" ? S.btnActive : {}) }} onClick={() => setView("aging")}>
            Aging View
          </button>
          <button style={{ ...S.btn, ...(view === "vendors" ? S.btnActive : {}) }} onClick={() => { setView("vendors"); setSelectedVendor(null); }}>
            Vendor Folders
          </button>
          <button style={S.btnPrimary} onClick={() => {
            setFormData({ vendorName: "", invoiceNumber: "", invoiceDate: "", dueDate: "", amount: "", terms: "", description: "" });
            setPdfFile(null);
            setEditInvoice(null);
            setShowModal(true);
          }}>
            + Add Invoice
          </button>
        </div>
      </div>

      {/* ── Drop Zone ── */}
      <div
        style={{ ...S.dropZone, ...(dragOver ? S.dropZoneActive : {}), ...(extracting ? { opacity: 0.6 } : {}) }}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        onClick={() => !extracting && fileRef.current?.click()}
      >
        <input
          ref={fileRef}
          type="file"
          accept=".pdf"
          style={{ display: "none" }}
          onChange={(e) => handleFiles(e.target.files)}
        />
        {extracting ? (
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={S.spinner} />
            <span>Extracting invoice data…</span>
          </div>
        ) : (
          <>
            <span style={{ fontSize: 24, marginBottom: 4 }}>📄</span>
            <span>Drop PDF invoice here or <span style={{ color: "#3b82f6", textDecoration: "underline", cursor: "pointer" }}>browse</span></span>
            <span style={{ fontSize: 11, color: "#475569" }}>Free extraction — no API charges</span>
          </>
        )}
      </div>

      {/* ── Aging Buckets ── */}
      {view === "aging" && (
        <>
          <div style={S.bucketRow}>
            {BUCKETS.map((b) => {
              const total = bucketTotal(invoices, b.key);
              const count = openInvoices.filter((i) => agingBucket(i.dueDate) === b.key).length;
              const active = filterBucket === b.key;
              return (
                <div
                  key={b.key}
                  style={{
                    ...S.bucketCard,
                    borderColor: active ? b.color : "#1e293b",
                    background: active ? b.bg : "#0d1117",
                    cursor: "pointer",
                  }}
                  onClick={() => setFilterBucket(active ? null : b.key)}
                >
                  <div style={{ fontSize: 11, color: "#64748b", fontWeight: 600, textTransform: "uppercase", letterSpacing: 1 }}>
                    {b.label}
                  </div>
                  <div style={{ fontSize: 22, fontWeight: 700, color: b.color, fontVariantNumeric: "tabular-nums", marginTop: 4 }}>
                    {fmt(total)}
                  </div>
                  <div style={{ fontSize: 11, color: "#475569", marginTop: 2 }}>
                    {count} invoice{count !== 1 ? "s" : ""}
                  </div>
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

          {/* ── Invoice Table ── */}
          <div style={S.tableWrap}>
            {loading ? (
              <div style={{ padding: 40, textAlign: "center", color: "#475569" }}>Loading…</div>
            ) : filtered.length === 0 ? (
              <div style={{ padding: 40, textAlign: "center", color: "#475569" }}>
                {filterBucket ? "No invoices in this aging bucket" : "No open invoices — drop a PDF above to get started"}
              </div>
            ) : (
              <table style={S.table}>
                <thead>
                  <tr>
                    {[
                      { key: "vendorName", label: "Vendor" },
                      { key: "invoiceNumber", label: "Invoice #" },
                      { key: "invoiceDate", label: "Inv Date" },
                      { key: "dueDate", label: "Due Date" },
                      { key: "amount", label: "Outstanding" },
                      { key: "terms", label: "Terms" },
                      { key: "aging", label: "Aging" },
                    ].map((col) => (
                      <th
                        key={col.key}
                        style={{ ...S.th, cursor: "pointer" }}
                        onClick={() => toggleSort(col.key)}
                      >
                        {col.label} {sortField === col.key ? (sortDir === "asc" ? "↑" : "↓") : ""}
                      </th>
                    ))}
                    <th style={S.th}>Actions</th>
                  </tr>
                </thead>
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
                          {inv.amountPaid > 0 && (
                            <span style={{ fontSize: 10, color: "#22c55e", marginLeft: 4 }}>
                              ({fmt(inv.amountPaid)} paid)
                            </span>
                          )}
                        </td>
                        <td style={S.td}>{inv.terms || "—"}</td>
                        <td style={S.td}>
                          <span style={{
                            display: "inline-block",
                            padding: "2px 8px",
                            borderRadius: 4,
                            fontSize: 11,
                            fontWeight: 600,
                            color: bInfo?.color,
                            background: bInfo?.bg,
                            border: `1px solid ${bInfo?.color}33`,
                          }}>
                            {bInfo?.label}
                          </span>
                        </td>
                        <td style={S.td}>
                          <div style={{ display: "flex", gap: 4 }}>
                            <button style={S.btnSmall} onClick={() => recordPayment(inv)} title="Record payment">💰</button>
                            <button style={S.btnSmall} onClick={() => {
                              setEditInvoice(inv);
                              setFormData({
                                vendorName: inv.vendorName,
                                invoiceNumber: inv.invoiceNumber,
                                invoiceDate: inv.invoiceDate || "",
                                dueDate: inv.dueDate || "",
                                amount: inv.amount,
                                terms: inv.terms || "",
                                description: inv.description || "",
                              });
                              setPdfFile(null);
                              setShowModal(true);
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

          {/* ── Vendor Breakdown ── */}
          {vendorList.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <h3 style={{ fontSize: 13, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>
                Vendor Breakdown
              </h3>
              <div style={S.tableWrap}>
                <table style={S.table}>
                  <thead>
                    <tr>
                      <th style={S.th}>Vendor</th>
                      <th style={{ ...S.th, textAlign: "center" }}>Invoices</th>
                      {BUCKETS.map((b) => (
                        <th key={b.key} style={{ ...S.th, textAlign: "right", color: b.color }}>{b.label}</th>
                      ))}
                      <th style={{ ...S.th, textAlign: "right" }}>Total Outstanding</th>
                    </tr>
                  </thead>
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
                            const bTotal = vOpen
                              .filter((i) => agingBucket(i.dueDate) === b.key)
                              .reduce((s, i) => s + (i.amount - i.amountPaid), 0);
                            return (
                              <td key={b.key} style={{ ...S.td, textAlign: "right", fontVariantNumeric: "tabular-nums", color: bTotal > 0 ? b.color : "#334155" }}>
                                {bTotal > 0 ? fmt(bTotal) : "—"}
                              </td>
                            );
                          })}
                          <td style={{ ...S.td, textAlign: "right", fontWeight: 700, fontVariantNumeric: "tabular-nums", color: "#f1f5f9" }}>
                            {fmt(vTotal)}
                          </td>
                        </tr>
                      );
                    })}
                    {/* Totals row */}
                    <tr style={{ borderTop: "2px solid #1e293b" }}>
                      <td style={{ ...S.td, fontWeight: 700, color: "#e2e8f0" }}>Total</td>
                      <td style={{ ...S.td, textAlign: "center", fontWeight: 700 }}>{openInvoices.length}</td>
                      {BUCKETS.map((b) => {
                        const bTotal = bucketTotal(invoices, b.key);
                        return (
                          <td key={b.key} style={{ ...S.td, textAlign: "right", fontWeight: 700, fontVariantNumeric: "tabular-nums", color: bTotal > 0 ? b.color : "#334155" }}>
                            {bTotal > 0 ? fmt(bTotal) : "—"}
                          </td>
                        );
                      })}
                      <td style={{ ...S.td, textAlign: "right", fontWeight: 700, fontVariantNumeric: "tabular-nums", color: "#f1f5f9", fontSize: 14 }}>
                        {fmt(totalOutstanding)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ── Paid / Void invoices ── */}
          {invoices.filter((i) => i.status === "paid" || i.status === "void").length > 0 && (
            <details style={{ margin: "0 0 16px" }}>
              <summary style={{ ...S.btn, cursor: "pointer", display: "inline-block", marginBottom: 8 }}>
                Show paid/void invoices ({invoices.filter((i) => i.status === "paid" || i.status === "void").length})
              </summary>
              <div style={S.tableWrap}>
                <table style={S.table}>
                  <thead>
                    <tr>
                      <th style={S.th}>Vendor</th>
                      <th style={S.th}>Invoice #</th>
                      <th style={S.th}>Amount</th>
                      <th style={S.th}>Status</th>
                      <th style={S.th}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {invoices.filter((i) => i.status === "paid" || i.status === "void").map((inv) => (
                      <tr key={inv.id} style={{ ...S.tr, opacity: 0.6 }}>
                        <td style={S.td}>{inv.vendorName}</td>
                        <td style={{ ...S.td, fontFamily: "'JetBrains Mono', monospace", fontSize: 12 }}>{inv.invoiceNumber}</td>
                        <td style={S.td}>{fmt(inv.amount)}</td>
                        <td style={S.td}>
                          <span style={{ padding: "2px 8px", borderRadius: 4, fontSize: 11, fontWeight: 600, background: inv.status === "paid" ? "#052e16" : "#1e1b2e", color: inv.status === "paid" ? "#22c55e" : "#8b5cf6" }}>
                            {inv.status}
                          </span>
                        </td>
                        <td style={S.td}>
                          {inv.pdfPath && <button style={S.btnSmall} onClick={() => downloadPdf(inv)} title="Download PDF">📥</button>}
                          <button style={{ ...S.btnSmall, color: "#ef4444" }} onClick={() => deleteInvoice(inv)} title="Delete">🗑️</button>
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

      {/* ══════════════════════════════════════════════
          VENDOR FOLDERS VIEW
          ══════════════════════════════════════════════ */}
      {view === "vendors" && !selectedVendor && (
        <div style={S.vendorGrid}>
          {vendorList.length === 0 ? (
            <div style={{ gridColumn: "1/-1", padding: 40, textAlign: "center", color: "#475569" }}>
              No vendors yet — drop an invoice above
            </div>
          ) : vendorList.map((v) => {
            const vInvs = vendors[v];
            const open = vInvs.filter((i) => i.status !== "paid" && i.status !== "void");
            const total = open.reduce((s, i) => s + (i.amount - i.amountPaid), 0);
            const hasPdfs = vInvs.some((i) => i.pdfPath);
            return (
              <div key={v} style={S.vendorCard} onClick={() => setSelectedVendor(v)}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div style={{ fontSize: 24, marginBottom: 8 }}>📁</div>
                  {hasPdfs && (
                    <button
                      style={{ ...S.btnSmall, fontSize: 10 }}
                      onClick={(e) => { e.stopPropagation(); downloadVendorPdfs(v); }}
                      title="Download all PDFs"
                    >📥 All</button>
                  )}
                </div>
                <div style={{ fontWeight: 600, fontSize: 14, color: "#e2e8f0", marginBottom: 4 }}>{v}</div>
                <div style={{ fontSize: 12, color: "#64748b" }}>
                  {vInvs.length} invoice{vInvs.length !== 1 ? "s" : ""} · {open.length} open
                </div>
                <div style={{ fontSize: 16, fontWeight: 700, color: total > 0 ? "#f59e0b" : "#22c55e", marginTop: 6, fontVariantNumeric: "tabular-nums" }}>
                  {fmt(total)}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Vendor Detail ── */}
      {view === "vendors" && selectedVendor && (
        <div>
          <button style={{ ...S.btn, marginBottom: 12 }} onClick={() => setSelectedVendor(null)}>
            ← Back to Vendors
          </button>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: "#e2e8f0", marginBottom: 12 }}>{selectedVendor}</h2>
          <div style={S.tableWrap}>
            <table style={S.table}>
              <thead>
                <tr>
                  <th style={S.th}>Invoice #</th>
                  <th style={S.th}>Date</th>
                  <th style={S.th}>Due</th>
                  <th style={S.th}>Amount</th>
                  <th style={S.th}>Paid</th>
                  <th style={S.th}>Status</th>
                  <th style={S.th}>Aging</th>
                  <th style={S.th}>Actions</th>
                </tr>
              </thead>
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
                      <td style={S.td}>
                        <span style={{ padding: "2px 8px", borderRadius: 4, fontSize: 11, fontWeight: 600, background: inv.status === "paid" ? "#052e16" : inv.status === "partial" ? "#2d1f05" : "#0c1a3d", color: inv.status === "paid" ? "#22c55e" : inv.status === "partial" ? "#f59e0b" : "#3b82f6" }}>
                          {inv.status}
                        </span>
                      </td>
                      <td style={S.td}>
                        {inv.status !== "paid" && inv.status !== "void" && (
                          <span style={{ padding: "2px 8px", borderRadius: 4, fontSize: 11, fontWeight: 600, color: bInfo?.color, background: bInfo?.bg, border: `1px solid ${bInfo?.color}33` }}>
                            {bInfo?.label}
                          </span>
                        )}
                      </td>
                      <td style={S.td}>
                        <div style={{ display: "flex", gap: 4 }}>
                          {inv.status !== "paid" && <button style={S.btnSmall} onClick={() => recordPayment(inv)}>💰</button>}
                          <button style={S.btnSmall} onClick={() => {
                            setEditInvoice(inv);
                            setFormData({
                              vendorName: inv.vendorName,
                              invoiceNumber: inv.invoiceNumber,
                              invoiceDate: inv.invoiceDate || "",
                              dueDate: inv.dueDate || "",
                              amount: inv.amount,
                              terms: inv.terms || "",
                              description: inv.description || "",
                            });
                            setPdfFile(null);
                            setShowModal(true);
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

            {pdfFile && (
              <div style={{ marginBottom: 12, padding: "8px 12px", background: "#0d1117", borderRadius: 6, border: "1px solid #1e293b", fontSize: 12 }}>
                📄 {pdfFile.name}
              </div>
            )}

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
                  <span style={{ fontSize: 11, color: "#64748b", fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5 }}>
                    {f.label}{f.required ? " *" : ""}
                  </span>
                  <input
                    style={S.input}
                    type={f.type || "text"}
                    step={f.type === "number" ? "0.01" : undefined}
                    value={formData[f.key] || ""}
                    onChange={(e) => setFormData((p) => ({ ...p, [f.key]: e.target.value }))}
                    placeholder={f.label}
                  />
                </label>
              ))}
            </div>

            <label style={{ ...S.formLabel, marginTop: 12 }}>
              <span style={{ fontSize: 11, color: "#64748b", fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5 }}>Description</span>
              <textarea
                style={{ ...S.input, minHeight: 60, resize: "vertical" }}
                value={formData.description || ""}
                onChange={(e) => setFormData((p) => ({ ...p, description: e.target.value }))}
              />
            </label>

            <div style={{ display: "flex", gap: 8, marginTop: 16, justifyContent: "flex-end" }}>
              <button style={S.btn} onClick={() => { setShowModal(false); setPdfFile(null); }}>Cancel</button>
              <button style={S.btnPrimary} onClick={saveInvoice}>
                {editInvoice ? "Update" : "Save Invoice"}
              </button>
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
  header: {
    display: "flex", justifyContent: "space-between", alignItems: "center",
    marginBottom: 16, flexWrap: "wrap", gap: 12,
  },
  logo: {
    width: 40, height: 40, borderRadius: 8, background: "linear-gradient(135deg, #3b82f6, #1d4ed8)",
    display: "flex", alignItems: "center", justifyContent: "center",
    fontWeight: 800, fontSize: 14, color: "#fff", letterSpacing: 1,
  },
  title: { fontSize: 20, fontWeight: 700, color: "#f1f5f9", letterSpacing: -0.5 },
  subtitle: { fontSize: 12, color: "#64748b", marginTop: 2 },

  btn: {
    padding: "8px 14px", borderRadius: 6, border: "1px solid #1e293b",
    background: "#0d1117", color: "#94a3b8", fontSize: 12, fontWeight: 500,
    cursor: "pointer", transition: "all .15s",
  },
  btnActive: { background: "#1e293b", color: "#e2e8f0", borderColor: "#3b82f6" },
  btnPrimary: {
    padding: "8px 16px", borderRadius: 6, border: "none",
    background: "linear-gradient(135deg, #3b82f6, #2563eb)", color: "#fff",
    fontSize: 12, fontWeight: 600, cursor: "pointer",
  },
  btnSmall: {
    padding: "4px 6px", borderRadius: 4, border: "1px solid #1e293b",
    background: "transparent", color: "#94a3b8", fontSize: 12,
    cursor: "pointer",
  },

  dropZone: {
    border: "2px dashed #1e293b", borderRadius: 8, padding: "24px",
    textAlign: "center", marginBottom: 16, cursor: "pointer",
    display: "flex", flexDirection: "column", alignItems: "center", gap: 4,
    transition: "all .2s", background: "#0a0f1a",
  },
  dropZoneActive: { borderColor: "#3b82f6", background: "#0c1a3d" },

  bucketRow: { display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 10, marginBottom: 16 },
  bucketCard: {
    padding: "14px 16px", borderRadius: 8, border: "1px solid #1e293b",
    transition: "all .2s",
  },

  tableWrap: {
    background: "#0d1117", border: "1px solid #1e293b", borderRadius: 8,
    overflow: "auto", marginBottom: 16,
  },
  table: { width: "100%", borderCollapse: "collapse" },
  th: {
    padding: "10px 12px", textAlign: "left", fontSize: 11, fontWeight: 600,
    textTransform: "uppercase", letterSpacing: 0.5, color: "#64748b",
    borderBottom: "1px solid #1e293b", background: "#0a0f1a",
    whiteSpace: "nowrap",
  },
  tr: { borderBottom: "1px solid #111827" },
  td: { padding: "10px 12px", fontSize: 13, whiteSpace: "nowrap" },

  vendorGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 12, marginBottom: 16 },
  vendorCard: {
    padding: "16px", borderRadius: 8, border: "1px solid #1e293b",
    background: "#0d1117", cursor: "pointer", transition: "all .2s",
  },

  overlay: {
    position: "fixed", inset: 0, background: "rgba(0,0,0,.7)",
    display: "flex", alignItems: "center", justifyContent: "center",
    zIndex: 999, animation: "fadeIn .2s",
  },
  modal: {
    background: "#161b22", border: "1px solid #1e293b", borderRadius: 12,
    padding: "24px", width: "100%", maxWidth: 520, maxHeight: "90vh",
    overflow: "auto", animation: "modalIn .2s",
  },
  formGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 },
  formLabel: { display: "flex", flexDirection: "column", gap: 4 },
  input: {
    padding: "8px 12px", borderRadius: 6, border: "1px solid #1e293b",
    background: "#0d1117", color: "#e2e8f0", fontSize: 13,
    fontFamily: "inherit", outline: "none",
  },

  spinner: {
    width: 18, height: 18, border: "2px solid #1e293b", borderTopColor: "#3b82f6",
    borderRadius: "50%", animation: "spin .6s linear infinite",
  },
};
