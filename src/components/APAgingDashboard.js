"use client";
import React, { useState, useEffect, useCallback, useRef } from "react";
import { createClient } from "@supabase/supabase-js";

/* ── Supabase browser client ── */
const sbUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const sbAnon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
const sb = sbUrl ? createClient(sbUrl, sbAnon) : null;

/* ── Vendor name normalization ── */
function normalizeVendor(name) {
  return (name || "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

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

/* ── Status icon for color-blind accessibility ── */
const STATUS_ICON = { paid: "✓", partial: "◐", open: "○", void: "✕", current: "○", "1-30": "◔", "31-60": "◑", "61-90": "◕", "90+": "●" };

/* ── Form draft persistence key ── */
const DRAFT_KEY = "ap-aging-invoice-draft";

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
  const [filterVendor, setFilterVendor] = useState("");
  const [filterInvDate, setFilterInvDate] = useState("");
  const [filterDueDate, setFilterDueDate] = useState("");
  const [equipment, setEquipment] = useState([]);
  const [expandedUnit, setExpandedUnit] = useState(null);
  const [selectedInvoices, setSelectedInvoices] = useState(new Set());
  // Batch upload queue
  const [uploadQueue, setUploadQueue] = useState([]);  // [{file, fields, status}]
  const [showBatchModal, setShowBatchModal] = useState(false);
  const [batchIndex, setBatchIndex] = useState(0);
  // Payment modal
  const [paymentInvoice, setPaymentInvoice] = useState(null);
  const [paymentMode, setPaymentMode] = useState("full"); // "full" | "partial" | "credit"
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentDate, setPaymentDate] = useState(todayStr());
  const [paymentHistory, setPaymentHistory] = useState([]);
  const [loadingPayments, setLoadingPayments] = useState(false);
  // Batch payment modal
  const [showBatchPayModal, setShowBatchPayModal] = useState(false);
  const [batchPayItems, setBatchPayItems] = useState([]); // [{invoice, mode, amount}]
  const [batchPayDate, setBatchPayDate] = useState(todayStr());
  const [batchPaying, setBatchPaying] = useState(false);

  // ── New: search, toasts, inline edit, recent payments, confirm modal ──
  const [searchQuery, setSearchQuery] = useState("");
  const [toasts, setToasts] = useState([]); // [{id, type, message, action?, actionLabel?}]
  const [editingCell, setEditingCell] = useState(null); // {invoiceId, field, value}
  const [recentPayments, setRecentPayments] = useState([]);
  const [showRecentPayments, setShowRecentPayments] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState(null); // {message, onConfirm}
  const [quickFilter, setQuickFilter] = useState(null); // 'overdue' | 'thisWeek' | null
  const [printMode, setPrintMode] = useState(false);

  const fileRef = useRef();
  const searchInputRef = useRef();
  const draftSaveTimer = useRef();

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

  const loadEquipment = useCallback(async () => {
    try {
      const res = await fetch("/api/equipment");
      const data = await res.json();
      if (data.units) setEquipment(data.units);
    } catch (e) { console.error("Equipment load error:", e); }
  }, []);

  useEffect(() => { if (view === "equipment") loadEquipment(); }, [view, loadEquipment]);

  /* ── Toast notifications ── */
  const addToast = useCallback((message, type = "info", opts = {}) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, message, type, action: opts.action, actionLabel: opts.actionLabel }]);
    if (!opts.action) {
      setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), opts.duration || 3500);
    }
    return id;
  }, []);
  const removeToast = useCallback((id) => setToasts((t) => t.filter((x) => x.id !== id)), []);

  /* ── Confirm dialog wrapper (replaces window.confirm) ── */
  const askConfirm = useCallback((message) => new Promise((resolve) => {
    setConfirmDialog({ message, onConfirm: () => { setConfirmDialog(null); resolve(true); }, onCancel: () => { setConfirmDialog(null); resolve(false); } });
  }), []);

  /* ── Recent payments (last 20) ── */
  const loadRecentPayments = useCallback(async () => {
    try {
      const res = await fetch("/api/payments?recent=20");
      const data = await res.json();
      if (Array.isArray(data)) setRecentPayments(data);
    } catch (e) { /* silent */ }
  }, []);
  useEffect(() => { loadRecentPayments(); }, [loadRecentPayments, invoices.length]);

  /* ── Auto-save invoice modal draft to localStorage ── */
  useEffect(() => {
    if (!showModal || editInvoice) return; // only save drafts for new invoices
    if (draftSaveTimer.current) clearTimeout(draftSaveTimer.current);
    draftSaveTimer.current = setTimeout(() => {
      try { localStorage.setItem(DRAFT_KEY, JSON.stringify(formData)); } catch {}
    }, 500);
    return () => { if (draftSaveTimer.current) clearTimeout(draftSaveTimer.current); };
  }, [formData, showModal, editInvoice]);

  /* ── Keyboard shortcuts (Cmd/Ctrl+K, N, Esc) ── */
  useEffect(() => {
    const handler = (e) => {
      // Skip if typing in input/textarea (except Esc)
      const tag = (e.target.tagName || "").toLowerCase();
      const inField = tag === "input" || tag === "textarea" || tag === "select";

      // Esc closes modals
      if (e.key === "Escape") {
        if (showModal) setShowModal(false);
        else if (paymentInvoice) setPaymentInvoice(null);
        else if (showBatchPayModal && !batchPaying) setShowBatchPayModal(false);
        else if (showBatchModal) { setShowBatchModal(false); setUploadQueue([]); }
        else if (confirmDialog) confirmDialog.onCancel();
        else if (showRecentPayments) setShowRecentPayments(false);
        return;
      }

      if (inField) return;

      // Cmd/Ctrl+K → focus search
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        searchInputRef.current?.focus();
        return;
      }
      // N → new invoice
      if (e.key.toLowerCase() === "n" && !showModal && !paymentInvoice) {
        e.preventDefault();
        // Try to restore draft
        let draft = {};
        try {
          const saved = localStorage.getItem(DRAFT_KEY);
          if (saved) draft = JSON.parse(saved);
        } catch {}
        setFormData({ vendorName: "", invoiceNumber: "", invoiceDate: "", dueDate: "", amount: "", terms: "", description: "", ...draft });
        setPdfFile(null); setEditInvoice(null); setShowModal(true);
      }
      // / → focus search
      if (e.key === "/" && !showModal && !paymentInvoice) {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [showModal, paymentInvoice, showBatchPayModal, batchPaying, showBatchModal, confirmDialog, showRecentPayments]);

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
        try { localStorage.removeItem(DRAFT_KEY); } catch {}
        addToast(editInvoice ? "Invoice updated" : "Invoice saved", "success");
      }
      load();
      return true;
    } else {
      const err = await res.json();
      if (!data) addToast(err.error || "Save failed", "error");
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
    // Smart default: if invoice has a due date in the future, use that; otherwise today
    const today = todayStr();
    const smartDate = inv.dueDate && inv.dueDate >= today ? inv.dueDate : today;
    setPaymentDate(smartDate);
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
        note: paymentMode === "credit" ? "CREDIT APPLIED" : "",
      }),
    });

    if (res.ok) {
      setPaymentInvoice(null);
      load();
      addToast(`Payment of ${fmt(amt)} recorded for ${paymentInvoice.vendorName}`, "success");
    } else {
      const err = await res.json();
      addToast(err.error || "Payment failed", "error");
    }
  };

  /* ── Toggle invoice selection ── */
  const toggleSelect = (id) => {
    setSelectedInvoices((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };
  const toggleSelectAll = () => {
    if (selectedInvoices.size === filtered.length) setSelectedInvoices(new Set());
    else setSelectedInvoices(new Set(filtered.map((i) => i.id)));
  };

  /* ── Batch pay selected invoices ── */
  const openBatchPayModal = () => {
    const selected = invoices.filter((i) => selectedInvoices.has(i.id) && (i.amount - i.amountPaid) > 0);
    if (selected.length === 0) return;
    setBatchPayItems(selected.map((inv) => ({
      invoice: inv,
      mode: "full",
      amount: String(inv.amount - inv.amountPaid),
    })));
    setBatchPayDate(todayStr());
    setShowBatchPayModal(true);
  };

  const updateBatchItem = (index, field, value) => {
    setBatchPayItems((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      if (field === "mode" && value === "full") {
        const inv = next[index].invoice;
        next[index].amount = String(inv.amount - inv.amountPaid);
      }
      if (field === "mode" && value === "partial") {
        next[index].amount = "";
      }
      return next;
    });
  };

  const submitBatchPay = async () => {
    setBatchPaying(true);
    let count = 0;
    let total = 0;
    try {
      for (const item of batchPayItems) {
        const amt = parseFloat(item.amount);
        if (isNaN(amt) || amt <= 0) continue;
        await fetch("/api/payments", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ invoiceId: item.invoice.id, amount: amt, paymentDate: batchPayDate }),
        });
        count++;
        total += amt;
      }
      setShowBatchPayModal(false);
      setSelectedInvoices(new Set());
      load();
      addToast(`${count} payment${count !== 1 ? "s" : ""} totaling ${fmt(total)} recorded`, "success");
    } finally {
      setBatchPaying(false);
    }
  };

  /* ── Reopen paid/void invoice — undoes the most recent payment ── */
  const reopenInvoice = async (inv) => {
    // Fetch payment history to find the most recent one to undo
    let lastPaymentId = null;
    let lastPaymentAmount = 0;
    try {
      const r = await fetch(`/api/payments?invoiceId=${inv.id}`);
      const payments = await r.json();
      if (Array.isArray(payments) && payments.length > 0) {
        lastPaymentId = payments[0].id;
        lastPaymentAmount = payments[0].amount;
      }
    } catch {}

    const msg = lastPaymentId
      ? `Undo last payment of ${fmt(lastPaymentAmount)} on invoice ${inv.invoiceNumber} from ${inv.vendorName}?`
      : `Reopen invoice ${inv.invoiceNumber} from ${inv.vendorName}? This will set it back to ${inv.amountPaid > 0 ? "partial" : "open"}.`;
    if (!(await askConfirm(msg))) return;

    if (lastPaymentId) {
      await fetch(`/api/payments?id=${lastPaymentId}`, { method: "DELETE" });
      addToast(`Payment of ${fmt(lastPaymentAmount)} undone`, "success");
    } else {
      const newStatus = inv.amountPaid > 0 ? "partial" : "open";
      await fetch(`/api/invoices?id=${inv.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      addToast(`Invoice ${inv.invoiceNumber} reopened`, "success");
    }
    load();
  };

  /* ── Delete invoice ── */
  const deleteInvoice = async (inv) => {
    if (!(await askConfirm(`Delete invoice ${inv.invoiceNumber} from ${inv.vendorName}?`))) return;
    await fetch(`/api/invoices?id=${inv.id}`, { method: "DELETE" });
    load();
    addToast(`Invoice ${inv.invoiceNumber} deleted`, "success");
  };

  /* ── Bulk delete selected invoices ── */
  const bulkDelete = async () => {
    const ids = [...selectedInvoices];
    if (ids.length === 0) return;
    if (!(await askConfirm(`Delete ${ids.length} selected invoice${ids.length !== 1 ? "s" : ""}? This cannot be undone.`))) return;
    for (const id of ids) {
      await fetch(`/api/invoices?id=${id}`, { method: "DELETE" });
    }
    setSelectedInvoices(new Set());
    load();
    addToast(`${ids.length} invoice${ids.length !== 1 ? "s" : ""} deleted`, "success");
  };

  /* ── Undo a specific payment by ID (used by recent payments panel) ── */
  const undoPayment = async (payment) => {
    if (!(await askConfirm(`Undo payment of ${fmt(payment.amount)} for ${payment.vendorName} invoice ${payment.invoiceNumber}?`))) return;
    const r = await fetch(`/api/payments?id=${payment.id}`, { method: "DELETE" });
    if (r.ok) {
      addToast(`Payment of ${fmt(payment.amount)} undone`, "success");
      load();
      loadRecentPayments();
    } else {
      addToast("Undo failed", "error");
    }
  };

  /* ── Inline edit save ── */
  const saveInlineEdit = async () => {
    if (!editingCell) return;
    const { invoiceId, field, value } = editingCell;
    const inv = invoices.find((i) => i.id === invoiceId);
    if (!inv) { setEditingCell(null); return; }
    const newVal = field === "amount" ? parseFloat(value) : value;
    if (field === "amount" && (isNaN(newVal) || newVal < 0)) {
      addToast("Invalid amount", "error");
      setEditingCell(null);
      return;
    }
    // Optimistic update
    setInvoices((prev) => prev.map((i) => i.id === invoiceId ? { ...i, [field]: newVal } : i));
    setEditingCell(null);
    try {
      await fetch("/api/invoices", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: invoiceId, [field]: newVal }),
      });
      addToast(`${field === "amount" ? "Amount" : "Due date"} updated`, "success");
    } catch (e) {
      addToast("Update failed — reverting", "error");
      load();
    }
  };

  /* ── Download PDF ── */
  const downloadPdf = async (inv) => {
    if (!sb || !inv.pdfPath) return;
    const { data, error } = await sb.storage.from("invoices").download(inv.pdfPath);
    if (error) { addToast("Download failed", "error"); return; }
    const url = URL.createObjectURL(data);
    const a = document.createElement("a"); a.href = url;
    a.download = inv.pdfPath.split("/").pop(); a.click();
    URL.revokeObjectURL(url);
  };

  const downloadVendorPdfs = async (vendorName) => {
    const nKey = normalizeVendor(vendorName);
    const vendorInvs = invoices.filter((i) => normalizeVendor(i.vendorName) === nKey && i.pdfPath);
    if (!vendorInvs.length) { addToast("No PDFs for this vendor", "error"); return; }
    for (const inv of vendorInvs) await downloadPdf(inv);
  };

  /* ── Sorting ── */
  const toggleSort = (field) => {
    if (sortField === field) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortField(field); setSortDir("asc"); }
  };

  const openInvoices = invoices.filter((i) => i.status !== "paid" && i.status !== "void");

  // Quick filter (from clickable home cards)
  const todayISO = todayStr();
  const wkAhead = (() => { const d = new Date(); d.setDate(d.getDate() + 7); return d.toISOString().slice(0, 10); })();

  const q = searchQuery.trim().toLowerCase();
  const filtered = openInvoices.filter((i) => {
    if (filterBucket && agingBucket(i.dueDate) !== filterBucket) return false;
    if (filterVendor && normalizeVendor(i.vendorName) !== normalizeVendor(filterVendor)) return false;
    if (filterInvDate && i.invoiceDate !== filterInvDate) return false;
    if (filterDueDate && i.dueDate !== filterDueDate) return false;
    if (quickFilter === "overdue" && !(i.dueDate && i.dueDate < todayISO)) return false;
    if (quickFilter === "thisWeek" && !(i.dueDate && i.dueDate >= todayISO && i.dueDate <= wkAhead)) return false;
    if (q) {
      const hay = `${i.vendorName || ""} ${i.invoiceNumber || ""} ${i.amount || ""} ${i.description || ""}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  }).sort((a, b) => {
    let va = a[sortField], vb = b[sortField];
    if (sortField === "amount") { va = a.amount - a.amountPaid; vb = b.amount - b.amountPaid; }
    if (va < vb) return sortDir === "asc" ? -1 : 1;
    if (va > vb) return sortDir === "asc" ? 1 : -1;
    return 0;
  });

  const vendorGroups = {};
  const vendorDisplayNames = {};
  invoices.forEach((i) => {
    const key = normalizeVendor(i.vendorName);
    if (!vendorGroups[key]) { vendorGroups[key] = []; vendorDisplayNames[key] = i.vendorName; }
    vendorGroups[key].push(i);
  });
  const vendors = {};
  Object.keys(vendorGroups).forEach((key) => { vendors[vendorDisplayNames[key]] = vendorGroups[key]; });
  const vendorList = Object.keys(vendors).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
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
          <div style={S.logo} aria-hidden="true">AP</div>
          <div>
            <h1 style={S.title}>Accounts Payable Aging</h1>
            <p style={S.subtitle}>{invoices.length} invoices · {fmt(totalOutstanding)} outstanding</p>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          {/* Global search */}
          <div style={{ position: "relative" }}>
            <span aria-hidden="true" style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "#94a3b8", fontSize: 13, pointerEvents: "none" }}>🔍</span>
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search vendors, invoices, amounts… (⌘K)"
              aria-label="Search invoices"
              style={{ ...S.input, padding: "8px 28px 8px 30px", fontSize: 12, width: 260, margin: 0 }}
            />
            {searchQuery && (
              <button onClick={() => setSearchQuery("")} aria-label="Clear search" style={{ position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)", background: "transparent", border: "none", color: "#94a3b8", cursor: "pointer", fontSize: 14, padding: 4 }}>×</button>
            )}
          </div>
          <button style={{ ...S.btn, ...(view === "aging" ? S.btnActive : {}) }} onClick={() => setView("aging")} aria-label="Aging View">Aging View</button>
          <button style={{ ...S.btn, ...(view === "vendors" ? S.btnActive : {}) }} onClick={() => { setView("vendors"); setSelectedVendor(null); }} aria-label="Vendor Folders">Vendor Folders</button>
          <button style={{ ...S.btn, ...(view === "equipment" ? S.btnActive : {}) }} onClick={() => setView("equipment")} aria-label="Equipment">Equipment</button>
          <button style={{ ...S.btn, ...(view === "expected" ? S.btnActive : {}) }} onClick={() => { setView("expected"); loadEquipment(); }} aria-label="Expected">Expected</button>
          <button style={{ ...S.btn, ...(view === "analytics" ? S.btnActive : {}) }} onClick={() => setView("analytics")} aria-label="Analytics">Analytics</button>
          <button style={S.btn} onClick={() => setShowRecentPayments(true)} aria-label="Recent payments" title="Recent payments">💸 Payments</button>
          <button style={S.btnPrimary} aria-label="Add new invoice (N)" title="Add invoice (N)" onClick={() => {
            // Restore draft if any
            let draft = {};
            try { const saved = localStorage.getItem(DRAFT_KEY); if (saved) draft = JSON.parse(saved); } catch {}
            const hasDraft = draft && Object.values(draft).some((v) => v);
            setFormData({ vendorName: "", invoiceNumber: "", invoiceDate: "", dueDate: "", amount: "", terms: "", description: "", ...draft });
            setPdfFile(null); setEditInvoice(null); setShowModal(true);
            if (hasDraft) addToast("Restored unsaved draft", "info");
          }}>+ Add Invoice</button>
        </div>
      </div>

      {/* ── Dashboard Summary Cards ── */}
      {(() => {
        const today = new Date();
        const todayStr2 = today.toISOString().slice(0, 10);
        const weekFromNow = new Date(today); weekFromNow.setDate(weekFromNow.getDate() + 7);
        const weekStr = weekFromNow.toISOString().slice(0, 10);
        const monthStart = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0, 10);

        const dueThisWeek = openInvoices.filter(i => i.dueDate && i.dueDate >= todayStr2 && i.dueDate <= weekStr);
        const dueThisWeekAmt = dueThisWeek.reduce((s, i) => s + (i.amount - i.amountPaid), 0);
        const overdue = openInvoices.filter(i => i.dueDate && i.dueDate < todayStr2);
        const overdueAmt = overdue.reduce((s, i) => s + (i.amount - i.amountPaid), 0);
        const paidThisMonth = invoices.filter(i => i.status === "paid" && i.updatedAt && i.updatedAt >= monthStart);
        const paidThisMonthAmt = paidThisMonth.reduce((s, i) => s + i.amount, 0);

        const cards = [
          { label: "Total Outstanding", value: fmt(totalOutstanding), sub: `${openInvoices.length} open invoices`, color: totalOutstanding > 0 ? "#ef4444" : "#22c55e", filterKey: null },
          { label: "Due This Week", value: fmt(dueThisWeekAmt), sub: `${dueThisWeek.length} invoices`, color: dueThisWeekAmt > 0 ? "#f59e0b" : "#22c55e", filterKey: "thisWeek" },
          { label: "Overdue", value: fmt(overdueAmt), sub: `${overdue.length} past due`, color: overdueAmt > 0 ? "#ef4444" : "#22c55e", filterKey: "overdue" },
          { label: "Paid This Month", value: fmt(paidThisMonthAmt), sub: `${paidThisMonth.length} invoices`, color: "#22c55e", filterKey: null },
        ];

        return (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 16 }}>
            {cards.map((c, i) => {
              const isActive = c.filterKey && quickFilter === c.filterKey;
              const isClickable = !!c.filterKey;
              return (
                <button
                  key={i}
                  type="button"
                  aria-pressed={isActive}
                  aria-label={`${c.label}: ${c.value}${isClickable ? " (click to filter)" : ""}`}
                  onClick={() => {
                    if (!isClickable) return;
                    setQuickFilter(quickFilter === c.filterKey ? null : c.filterKey);
                    setView("aging");
                  }}
                  style={{
                    padding: "16px 20px", borderRadius: 10,
                    border: `1px solid ${isActive ? c.color : "#1e293b"}`,
                    background: isActive ? `${c.color}11` : "#0d1117",
                    cursor: isClickable ? "pointer" : "default",
                    textAlign: "left", outline: "none", color: "inherit",
                    transition: "all .15s",
                  }}
                >
                  <div style={{ fontSize: 11, color: "#94a3b8", fontWeight: 600, textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 }}>{c.label}{isClickable && <span style={{ marginLeft: 6, fontSize: 9, color: "#64748b" }}>{isActive ? "✓ filtered" : "↗ click to filter"}</span>}</div>
                  <div style={{ fontSize: 24, fontWeight: 800, color: c.color, fontVariantNumeric: "tabular-nums" }}>{c.value}</div>
                  <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 4 }}>{c.sub}</div>
                </button>
              );
            })}
          </div>
        );
      })()}

      {/* Quick filter chip indicator */}
      {quickFilter && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 14px", marginBottom: 12, background: "#0c1a3d", border: "1px solid #3b82f6", borderRadius: 8 }}>
          <span style={{ fontSize: 12, color: "#94a3b8" }}>Filtering by:</span>
          <span style={{ fontSize: 13, fontWeight: 700, color: "#3b82f6" }}>{quickFilter === "overdue" ? "Overdue invoices" : "Due this week"}</span>
          <button onClick={() => setQuickFilter(null)} aria-label="Clear quick filter" style={{ marginLeft: "auto", background: "transparent", border: "1px solid #1e293b", color: "#94a3b8", padding: "4px 10px", borderRadius: 4, fontSize: 11, cursor: "pointer" }}>Clear</button>
        </div>
      )}

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

          {/* Filter Bar */}
          <div style={{ display: "flex", gap: 10, alignItems: "center", padding: "0 0 10px", flexWrap: "wrap" }}>
            <select value={filterVendor} onChange={(e) => setFilterVendor(e.target.value)}
              style={{ padding: "6px 8px", fontSize: 12, background: "#0d1117", color: "#e2e8f0", border: "1px solid #1e293b", borderRadius: 6, minWidth: 180 }}>
              <option value="">All Vendors</option>
              {vendorList.map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
            <label style={{ fontSize: 11, color: "#64748b" }}>Inv Date:
              <input type="date" value={filterInvDate} onChange={(e) => setFilterInvDate(e.target.value)}
                style={{ marginLeft: 4, padding: "5px 6px", fontSize: 12, background: "#0d1117", color: "#e2e8f0", border: "1px solid #1e293b", borderRadius: 6 }} />
            </label>
            <label style={{ fontSize: 11, color: "#64748b" }}>Due Date:
              <input type="date" value={filterDueDate} onChange={(e) => setFilterDueDate(e.target.value)}
                style={{ marginLeft: 4, padding: "5px 6px", fontSize: 12, background: "#0d1117", color: "#e2e8f0", border: "1px solid #1e293b", borderRadius: 6 }} />
            </label>
            {(filterVendor || filterInvDate || filterDueDate) && (
              <span style={{ fontSize: 11, color: "#3b82f6", cursor: "pointer", textDecoration: "underline" }}
                onClick={() => { setFilterVendor(""); setFilterInvDate(""); setFilterDueDate(""); }}>
                clear filters
              </span>
            )}
            {(filterVendor || filterInvDate || filterDueDate || filterBucket) && (
              <span style={{ fontSize: 16, fontWeight: 700, color: "#e2e8f0", marginLeft: "auto" }}>
                {filtered.length} invoice{filtered.length !== 1 ? "s" : ""} · <span style={{ color: "#f59e0b" }}>{fmt(filtered.reduce((s, i) => s + (i.amount - i.amountPaid), 0))}</span> outstanding
              </span>
            )}
          </div>

          {/* Invoice Table */}
          <div style={S.tableWrap}>
            {loading ? (
              <div style={{ padding: 16 }}>
                {[...Array(5)].map((_, i) => (
                  <div key={i} className="skeleton" style={{ height: 36, marginBottom: 8 }} />
                ))}
              </div>
            )
            : filtered.length === 0 ? <div style={{ padding: 40, textAlign: "center", color: "#94a3b8" }}>{searchQuery ? `No invoices match "${searchQuery}"` : filterBucket ? "No invoices in this bucket" : quickFilter === "overdue" ? "No overdue invoices 🎉" : quickFilter === "thisWeek" ? "Nothing due this week" : "No open invoices — drop a PDF above"}</div>
            : (
              <>
              {/* Batch pay bar */}
              {selectedInvoices.size > 0 && (
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 16px", background: "#0c1a3d", borderBottom: "2px solid #3b82f6", borderRadius: "8px 8px 0 0" }}>
                  <span style={{ fontSize: 14, fontWeight: 700, color: "#e2e8f0" }}>
                    {selectedInvoices.size} selected · {fmt(invoices.filter(i => selectedInvoices.has(i.id)).reduce((s, i) => s + (i.amount - i.amountPaid), 0))} total
                  </span>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button style={{ ...S.btn, color: "#94a3b8" }} onClick={() => setSelectedInvoices(new Set())} aria-label="Clear selection">Clear</button>
                    <button style={{ ...S.btn, color: "#ef4444", borderColor: "#ef444433" }} onClick={bulkDelete} aria-label="Delete selected invoices">🗑️ Delete</button>
                    <button style={{ ...S.btnPrimary, padding: "8px 20px" }} onClick={openBatchPayModal} aria-label="Pay selected invoices">Pay Selected</button>
                  </div>
                </div>
              )}
              <table style={S.table}>
                <thead><tr>
                  <th style={{ ...S.th, width: 36 }}><input type="checkbox" checked={selectedInvoices.size === filtered.length && filtered.length > 0} onChange={toggleSelectAll} style={{ cursor: "pointer" }} /></th>
                  {[{ key: "vendorName", label: "Vendor" }, { key: "invoiceNumber", label: "Invoice #" }, { key: "invoiceDate", label: "Inv Date" }, { key: "dueDate", label: "Due Date" }, { key: "amount", label: "Outstanding" }, { key: "description", label: "Description" }, { key: "aging", label: "Aging" }].map((col) => (
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
                    const isEditingAmt = editingCell?.invoiceId === inv.id && editingCell?.field === "amount";
                    const isEditingDue = editingCell?.invoiceId === inv.id && editingCell?.field === "dueDate";
                    return (
                      <tr key={inv.id} style={{ ...S.tr, background: selectedInvoices.has(inv.id) ? "#0c1a3d" : "" }}>
                        <td style={S.td}><input type="checkbox" checked={selectedInvoices.has(inv.id)} onChange={() => toggleSelect(inv.id)} aria-label={`Select invoice ${inv.invoiceNumber}`} style={{ cursor: "pointer", width: 16, height: 16 }} /></td>
                        <td style={S.td}>{inv.vendorName}</td>
                        <td style={{ ...S.td, fontFamily: "'JetBrains Mono', monospace", fontSize: 12 }}>{inv.invoiceNumber}</td>
                        <td style={S.td}>{fmtDate(inv.invoiceDate)}</td>
                        <td style={{ ...S.td, cursor: isEditingDue ? "auto" : "pointer" }}
                          onClick={() => !isEditingDue && setEditingCell({ invoiceId: inv.id, field: "dueDate", value: inv.dueDate || "" })}
                          title="Click to edit due date">
                          {isEditingDue ? (
                            <input
                              type="date" autoFocus
                              value={editingCell.value}
                              onChange={(e) => setEditingCell({ ...editingCell, value: e.target.value })}
                              onBlur={saveInlineEdit}
                              onKeyDown={(e) => { if (e.key === "Enter") saveInlineEdit(); if (e.key === "Escape") setEditingCell(null); }}
                              aria-label="Edit due date"
                              style={{ ...S.input, padding: "4px 6px", fontSize: 12, margin: 0 }}
                            />
                          ) : fmtDate(inv.dueDate)}
                        </td>
                        <td style={{ ...S.td, fontWeight: 600, fontVariantNumeric: "tabular-nums", cursor: isEditingAmt ? "auto" : "pointer" }}
                          onClick={() => !isEditingAmt && setEditingCell({ invoiceId: inv.id, field: "amount", value: String(inv.amount) })}
                          title="Click to edit amount">
                          {isEditingAmt ? (
                            <input
                              type="number" step="0.01" autoFocus
                              value={editingCell.value}
                              onChange={(e) => setEditingCell({ ...editingCell, value: e.target.value })}
                              onBlur={saveInlineEdit}
                              onKeyDown={(e) => { if (e.key === "Enter") saveInlineEdit(); if (e.key === "Escape") setEditingCell(null); }}
                              aria-label="Edit amount"
                              style={{ ...S.input, padding: "4px 6px", fontSize: 13, margin: 0, width: 100, textAlign: "right" }}
                            />
                          ) : (
                            <>
                              {fmt(outstanding)}
                              {inv.amountPaid > 0 && <span style={{ fontSize: 10, color: "#22c55e", marginLeft: 4 }}>({fmt(inv.amountPaid)} paid)</span>}
                            </>
                          )}
                        </td>
                        <td style={{ ...S.td, fontSize: 11, maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={inv.description || ""}>{inv.description || "—"}</td>
                        <td style={S.td}>
                          <span aria-label={`Aging bucket: ${bInfo?.label}`} style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "2px 8px", borderRadius: 4, fontSize: 11, fontWeight: 600, color: bInfo?.color, background: bInfo?.bg, border: `1px solid ${bInfo?.color}33` }}>
                            <span aria-hidden="true">{STATUS_ICON[bucket] || ""}</span>{bInfo?.label}
                          </span>
                        </td>
                        <td style={S.td}>
                          <div style={{ display: "flex", gap: 4 }}>
                            <button style={S.btnSmall} onClick={() => openPaymentModal(inv)} title="Record payment" aria-label={`Record payment for invoice ${inv.invoiceNumber}`}>💰</button>
                            <button style={S.btnSmall} onClick={() => {
                              setEditInvoice(inv);
                              setFormData({ vendorName: inv.vendorName, invoiceNumber: inv.invoiceNumber, invoiceDate: inv.invoiceDate || "", dueDate: inv.dueDate || "", amount: inv.amount, terms: inv.terms || "", description: inv.description || "" });
                              setPdfFile(null); setShowModal(true);
                            }} title="Edit invoice" aria-label={`Edit invoice ${inv.invoiceNumber}`}>✏️</button>
                            {inv.pdfPath && <button style={S.btnSmall} onClick={() => downloadPdf(inv)} title="Download PDF" aria-label={`Download PDF for invoice ${inv.invoiceNumber}`}>📥</button>}
                            <button style={{ ...S.btnSmall, color: "#ef4444" }} onClick={() => deleteInvoice(inv)} title="Delete invoice" aria-label={`Delete invoice ${inv.invoiceNumber}`}>🗑️</button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              </>
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
                        <td style={S.td}><span aria-label={`Status: ${inv.status}`} style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "2px 8px", borderRadius: 4, fontSize: 11, fontWeight: 600, background: inv.status === "paid" ? "#052e16" : "#1e1b2e", color: inv.status === "paid" ? "#22c55e" : "#8b5cf6" }}><span aria-hidden="true">{STATUS_ICON[inv.status] || ""}</span>{inv.status}</span></td>
                        <td style={S.td}>
                          <button style={{ ...S.btnSmall, color: "#f59e0b" }} onClick={() => reopenInvoice(inv)} title="Reopen invoice" aria-label={`Reopen invoice ${inv.invoiceNumber}`}>↩️</button>
                          {inv.pdfPath && <button style={S.btnSmall} onClick={() => downloadPdf(inv)} aria-label={`Download PDF for ${inv.invoiceNumber}`}>📥</button>}
                          <button style={{ ...S.btnSmall, color: "#ef4444" }} onClick={() => deleteInvoice(inv)} aria-label={`Delete invoice ${inv.invoiceNumber}`}>🗑️</button>
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
                      <td style={S.td}><span aria-label={`Status: ${inv.status}`} style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "2px 8px", borderRadius: 4, fontSize: 11, fontWeight: 600, background: inv.status === "paid" ? "#052e16" : inv.status === "partial" ? "#2d1f05" : "#0c1a3d", color: inv.status === "paid" ? "#22c55e" : inv.status === "partial" ? "#f59e0b" : "#3b82f6" }}><span aria-hidden="true">{STATUS_ICON[inv.status] || ""}</span>{inv.status}</span></td>
                      <td style={S.td}>{inv.status !== "paid" && inv.status !== "void" && <span style={{ padding: "2px 8px", borderRadius: 4, fontSize: 11, fontWeight: 600, color: bInfo?.color, background: bInfo?.bg, border: `1px solid ${bInfo?.color}33` }}>{bInfo?.label}</span>}</td>
                      <td style={S.td}>
                        <div style={{ display: "flex", gap: 4 }}>
                          {inv.status !== "paid" && inv.status !== "void" && <button style={S.btnSmall} onClick={() => openPaymentModal(inv)} title="Record payment" aria-label={`Record payment for invoice ${inv.invoiceNumber}`}>💰</button>}
                          {(inv.status === "paid" || inv.status === "void") && <button style={{ ...S.btnSmall, color: "#f59e0b" }} onClick={() => reopenInvoice(inv)} title="Reopen invoice" aria-label={`Reopen invoice ${inv.invoiceNumber}`}>↩️</button>}
                          <button style={S.btnSmall} aria-label={`Edit invoice ${inv.invoiceNumber}`} title="Edit invoice" onClick={() => {
                            setEditInvoice(inv);
                            setFormData({ vendorName: inv.vendorName, invoiceNumber: inv.invoiceNumber, invoiceDate: inv.invoiceDate || "", dueDate: inv.dueDate || "", amount: inv.amount, terms: inv.terms || "", description: inv.description || "" });
                            setPdfFile(null); setShowModal(true);
                          }}>✏️</button>
                          {inv.pdfPath && <button style={S.btnSmall} onClick={() => downloadPdf(inv)} aria-label={`Download PDF for ${inv.invoiceNumber}`}>📥</button>}
                          <button style={{ ...S.btnSmall, color: "#ef4444" }} onClick={() => deleteInvoice(inv)} aria-label={`Delete invoice ${inv.invoiceNumber}`}>🗑️</button>
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

      {/* ── Expected Invoices View ── */}
      {view === "expected" && (() => {
        const now = new Date();
        const currentMonth = now.toLocaleString("en-US", { month: "long", year: "numeric" });
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
        const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);

        // Group equipment by vendor, calculate expected monthly
        const vendorExpected = {};
        equipment.filter(u => u.status === "Active" && u.monthlyCost > 0).forEach(u => {
          if (!vendorExpected[u.vendor]) vendorExpected[u.vendor] = { units: 0, expected: 0, received: 0, invoices: [], category: u.category };
          vendorExpected[u.vendor].units++;
          vendorExpected[u.vendor].expected += u.monthlyCost;
        });

        // Match actual invoices this month
        const VENDOR_MATCH = {
          "TCI": /transportation commodities|tci/i,
          "Penske": /penske/i,
          "TEC": /tec equipment/i,
          "McKinney": /mckinney/i,
          "XTRA Lease": /xtra/i,
          "Mountain West": /mountain west|utility trailer/i,
          "Ten Trailer Leasing": /ten trailer/i,
          "Premier Trailer": /premier/i,
          "Ryder": /ryder/i,
        };

        invoices.forEach(inv => {
          if (!inv.invoiceDate || inv.invoiceDate < monthStart) return;
          for (const [vendor, pattern] of Object.entries(VENDOR_MATCH)) {
            if (pattern.test(inv.vendorName) && vendorExpected[vendor]) {
              vendorExpected[vendor].received += inv.amount || 0;
              vendorExpected[vendor].invoices.push(inv);
              break;
            }
          }
        });

        const vendors = Object.entries(vendorExpected).sort((a, b) => b[1].expected - a[1].expected);
        const totalExpected = vendors.reduce((s, [, v]) => s + v.expected, 0);
        const totalReceived = vendors.reduce((s, [, v]) => s + v.received, 0);

        return (
          <>
            <h2 style={{ fontSize: 16, fontWeight: 700, color: "#e2e8f0", marginBottom: 12 }}>Expected Monthly Invoices — {currentMonth}</h2>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 20 }}>
              <div style={{ padding: "16px 20px", borderRadius: 10, border: "1px solid #1e293b", background: "#0d1117" }}>
                <div style={{ fontSize: 11, color: "#64748b", fontWeight: 600, textTransform: "uppercase" }}>Expected Total</div>
                <div style={{ fontSize: 24, fontWeight: 800, color: "#f59e0b", fontVariantNumeric: "tabular-nums", marginTop: 4 }}>{fmt(totalExpected)}</div>
                <div style={{ fontSize: 11, color: "#475569" }}>based on equipment monthly rates</div>
              </div>
              <div style={{ padding: "16px 20px", borderRadius: 10, border: "1px solid #1e293b", background: "#0d1117" }}>
                <div style={{ fontSize: 11, color: "#64748b", fontWeight: 600, textTransform: "uppercase" }}>Received So Far</div>
                <div style={{ fontSize: 24, fontWeight: 800, color: "#3b82f6", fontVariantNumeric: "tabular-nums", marginTop: 4 }}>{fmt(totalReceived)}</div>
                <div style={{ fontSize: 11, color: "#475569" }}>{Math.round(totalReceived / totalExpected * 100) || 0}% of expected</div>
              </div>
              <div style={{ padding: "16px 20px", borderRadius: 10, border: "1px solid #1e293b", background: "#0d1117" }}>
                <div style={{ fontSize: 11, color: "#64748b", fontWeight: 600, textTransform: "uppercase" }}>Still Awaiting</div>
                <div style={{ fontSize: 24, fontWeight: 800, color: totalExpected - totalReceived > 0 ? "#ef4444" : "#22c55e", fontVariantNumeric: "tabular-nums", marginTop: 4 }}>{fmt(Math.max(0, totalExpected - totalReceived))}</div>
                <div style={{ fontSize: 11, color: "#475569" }}>{vendors.filter(([, v]) => v.received === 0).length} vendors with no invoice yet</div>
              </div>
            </div>
            <div style={S.tableWrap}>
              <table style={S.table}>
                <thead><tr>
                  <th style={S.th}>Vendor</th>
                  <th style={S.th}>Type</th>
                  <th style={S.th}>Units</th>
                  <th style={S.th}>Expected</th>
                  <th style={S.th}>Received</th>
                  <th style={S.th}>Difference</th>
                  <th style={S.th}>Status</th>
                </tr></thead>
                <tbody>
                  {vendors.map(([vendor, v]) => {
                    const diff = v.received - v.expected;
                    const status = v.received === 0 ? "missing" : Math.abs(diff) < 1 ? "match" : diff > 0 ? "over" : "under";
                    const statusColors = { missing: { bg: "#1c0a0a", color: "#ef4444", label: "No Invoice" }, match: { bg: "#052e16", color: "#22c55e", label: "Matched" }, over: { bg: "#1e1b0e", color: "#f59e0b", label: "Over" }, under: { bg: "#0c1a3d", color: "#3b82f6", label: "Under" } };
                    const sc = statusColors[status];
                    return (
                      <tr key={vendor} style={S.tr}>
                        <td style={{ ...S.td, fontWeight: 600, color: "#e2e8f0" }}>{vendor}</td>
                        <td style={{ ...S.td, fontSize: 11 }}>{v.category === "truck" ? "Truck" : "Trailer"}</td>
                        <td style={{ ...S.td, textAlign: "center" }}>{v.units}</td>
                        <td style={{ ...S.td, fontVariantNumeric: "tabular-nums", color: "#f59e0b" }}>{fmt(v.expected)}</td>
                        <td style={{ ...S.td, fontVariantNumeric: "tabular-nums", color: "#3b82f6" }}>{v.received > 0 ? fmt(v.received) : "—"}</td>
                        <td style={{ ...S.td, fontVariantNumeric: "tabular-nums", fontWeight: 700, color: status === "match" ? "#22c55e" : diff > 0 ? "#f59e0b" : "#ef4444" }}>{v.received > 0 ? (diff >= 0 ? "+" : "") + fmt(diff) : "—"}</td>
                        <td style={S.td}><span style={{ padding: "2px 8px", borderRadius: 4, fontSize: 10, fontWeight: 600, background: sc.bg, color: sc.color }}>{sc.label}</span></td>
                      </tr>
                    );
                  })}
                  <tr style={{ borderTop: "2px solid #1e293b" }}>
                    <td style={{ ...S.td, fontWeight: 800, color: "#e2e8f0" }}>TOTAL</td>
                    <td style={S.td}></td>
                    <td style={{ ...S.td, textAlign: "center", fontWeight: 700 }}>{vendors.reduce((s, [, v]) => s + v.units, 0)}</td>
                    <td style={{ ...S.td, fontVariantNumeric: "tabular-nums", fontWeight: 800, color: "#f59e0b" }}>{fmt(totalExpected)}</td>
                    <td style={{ ...S.td, fontVariantNumeric: "tabular-nums", fontWeight: 800, color: "#3b82f6" }}>{fmt(totalReceived)}</td>
                    <td style={{ ...S.td, fontVariantNumeric: "tabular-nums", fontWeight: 800, color: totalReceived - totalExpected >= 0 ? "#f59e0b" : "#ef4444" }}>{(totalReceived - totalExpected >= 0 ? "+" : "") + fmt(totalReceived - totalExpected)}</td>
                    <td style={S.td}></td>
                  </tr>
                </tbody>
              </table>
            </div>
          </>
        );
      })()}

      {/* ── Vendor Analytics View ── */}
      {view === "analytics" && (() => {
        // Group all invoices by vendor
        const vendorStats = {};
        invoices.forEach(inv => {
          const vn = inv.vendorName;
          if (!vendorStats[vn]) vendorStats[vn] = { invoices: [], totalBilled: 0, totalPaid: 0, count: 0, dates: [] };
          vendorStats[vn].invoices.push(inv);
          vendorStats[vn].totalBilled += inv.amount || 0;
          vendorStats[vn].totalPaid += inv.amountPaid || 0;
          vendorStats[vn].count++;
          if (inv.invoiceDate) vendorStats[vn].dates.push(inv.invoiceDate);
        });

        const vendorList2 = Object.entries(vendorStats)
          .map(([name, s]) => ({
            name,
            ...s,
            outstanding: s.totalBilled - s.totalPaid,
            avgInvoice: s.count > 0 ? s.totalBilled / s.count : 0,
            firstDate: s.dates.length > 0 ? s.dates.sort()[0] : "",
            lastDate: s.dates.length > 0 ? s.dates.sort().pop() : "",
          }))
          .sort((a, b) => b.totalBilled - a.totalBilled);

        const totalBilled = vendorList2.reduce((s, v) => s + v.totalBilled, 0);

        return (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <h2 style={{ fontSize: 16, fontWeight: 700, color: "#e2e8f0" }}>Vendor Analytics</h2>
              <button style={S.btn} onClick={() => window.print()} aria-label="Print analytics report" className="no-print">🖨️ Print Report</button>
            </div>
            <div className="print-only" style={{ marginBottom: 16 }}>
              <h1 style={{ fontSize: 18, fontWeight: 800, color: "#000" }}>Vendor Analytics Report</h1>
              <p style={{ fontSize: 12, color: "#000" }}>Generated {new Date().toLocaleDateString()} · {invoices.length} invoices · {fmt(totalOutstanding)} outstanding</p>
            </div>
            <div style={S.tableWrap}>
              <table style={S.table}>
                <thead><tr>
                  <th style={S.th}>Vendor</th>
                  <th style={S.th}>Invoices</th>
                  <th style={S.th}>Total Billed</th>
                  <th style={S.th}>% of Spend</th>
                  <th style={S.th}>Avg Invoice</th>
                  <th style={S.th}>Total Paid</th>
                  <th style={S.th}>Outstanding</th>
                  <th style={S.th}>First Invoice</th>
                  <th style={S.th}>Last Invoice</th>
                </tr></thead>
                <tbody>
                  {vendorList2.map((v) => {
                    const pct = totalBilled > 0 ? (v.totalBilled / totalBilled * 100) : 0;
                    return (
                      <tr key={v.name} style={S.tr}>
                        <td style={{ ...S.td, fontWeight: 600, color: "#e2e8f0" }}>{v.name}</td>
                        <td style={{ ...S.td, textAlign: "center" }}>{v.count}</td>
                        <td style={{ ...S.td, fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>{fmt(v.totalBilled)}</td>
                        <td style={S.td}>
                          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <div style={{ flex: 1, background: "#1e293b", borderRadius: 3, height: 8, overflow: "hidden" }}>
                              <div style={{ width: `${Math.min(pct, 100)}%`, background: "#3b82f6", height: "100%", borderRadius: 3 }} />
                            </div>
                            <span style={{ fontSize: 11, color: "#94a3b8", minWidth: 36 }}>{pct.toFixed(1)}%</span>
                          </div>
                        </td>
                        <td style={{ ...S.td, fontVariantNumeric: "tabular-nums", color: "#94a3b8" }}>{fmt(v.avgInvoice)}</td>
                        <td style={{ ...S.td, fontVariantNumeric: "tabular-nums", color: "#22c55e" }}>{fmt(v.totalPaid)}</td>
                        <td style={{ ...S.td, fontVariantNumeric: "tabular-nums", fontWeight: 700, color: v.outstanding > 0 ? "#ef4444" : "#22c55e" }}>{v.outstanding > 0 ? fmt(v.outstanding) : "$0"}</td>
                        <td style={{ ...S.td, fontSize: 11, color: "#64748b" }}>{fmtDate(v.firstDate)}</td>
                        <td style={{ ...S.td, fontSize: 11, color: "#64748b" }}>{fmtDate(v.lastDate)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        );
      })()}

      {/* ── Equipment View ── */}
      {view === "equipment" && (() => {
        const trucks = equipment.filter((u) => u.category === "truck");
        const trailers = equipment.filter((u) => u.category === "trailer");
        const active = equipment.filter((u) => u.status === "Active");
        const totalMonthly = active.reduce((s, u) => s + u.monthlyCost, 0);
        const totalBilled = equipment.reduce((s, u) => s + u.totalBilled, 0);
        const totalOutst = equipment.reduce((s, u) => s + u.outstanding, 0);
        const vendorColor = (v) => ({ TCI: "#f97316", Penske: "#ef4444", TEC: "#3b82f6", McKinney: "#f59e0b", "XTRA Lease": "#06b6d4", "Mountain West": "#22c55e", "Ten Trailer Leasing": "#8b5cf6", "Premier Trailer": "#ec4899", Ryder: "#a855f7" }[v] || "#64748b");

        const renderGroup = (title, items, color) => (
          <div key={title} style={{ marginBottom: 24 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <h3 style={{ fontSize: 15, fontWeight: 700, color, textTransform: "uppercase", letterSpacing: 1 }}>
                {title} — {items.filter(u => u.status === "Active").length} active / {items.length} total
              </h3>
              <span style={{ fontSize: 14, fontWeight: 700, color, fontVariantNumeric: "tabular-nums" }}>
                {fmt(items.filter(u => u.status === "Active").reduce((s, u) => s + u.monthlyCost, 0))}/mo
              </span>
            </div>
            <div style={S.tableWrap}>
              <table style={S.table}>
                <thead><tr>
                  <th style={{ ...S.th, width: 60 }}>Fleet</th>
                  <th style={S.th}>Vendor</th>
                  <th style={{ ...S.th, width: 80 }}>Unit #</th>
                  <th style={S.th}>Type</th>
                  <th style={{ ...S.th, width: 90 }}>Monthly</th>
                  <th style={{ ...S.th, width: 70 }}>Mi Rate</th>
                  <th style={{ ...S.th, width: 50 }}>Inv</th>
                  <th style={{ ...S.th, width: 100 }}>Billed</th>
                  <th style={{ ...S.th, width: 100 }}>Outstanding</th>
                  <th style={{ ...S.th, width: 70 }}>Status</th>
                </tr></thead>
                <tbody>
                  {items.map((u) => {
                    const isExpanded = expandedUnit === u.id;
                    const hasInvoices = u.invoices && u.invoices.length > 0;
                    return (
                      <React.Fragment key={u.id}>
                        <tr style={{ ...S.tr, cursor: hasInvoices ? "pointer" : "default", opacity: u.status === "Active" ? 1 : 0.5 }}
                          onClick={() => hasInvoices && setExpandedUnit(isExpanded ? null : u.id)}>
                          <td style={{ ...S.td, fontWeight: 700, color: "#e2e8f0", fontFamily: "'JetBrains Mono', monospace" }}>{u.fleetNumber || "—"}</td>
                          <td style={S.td}><span style={{ borderLeft: `3px solid ${vendorColor(u.vendor)}`, paddingLeft: 8 }}>{u.vendor}</span></td>
                          <td style={{ ...S.td, fontFamily: "'JetBrains Mono', monospace", fontSize: 11 }}>{u.vendorUnit || "—"}</td>
                          <td style={{ ...S.td, fontSize: 11 }}>{u.type}</td>
                          <td style={{ ...S.td, fontVariantNumeric: "tabular-nums", color: "#f59e0b" }}>{u.monthlyCost > 0 ? fmt(u.monthlyCost) : "—"}</td>
                          <td style={{ ...S.td, fontVariantNumeric: "tabular-nums", fontSize: 11 }}>{u.mileageRate > 0 ? `$${u.mileageRate.toFixed(3)}` : "—"}</td>
                          <td style={{ ...S.td, textAlign: "center", color: hasInvoices ? "#3b82f6" : "#475569" }}>{hasInvoices ? `${u.invoiceCount}` : "—"}{hasInvoices && <span style={{ fontSize: 9, marginLeft: 2 }}>{isExpanded ? "▲" : "▼"}</span>}</td>
                          <td style={{ ...S.td, fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>{u.totalBilled > 0 ? fmt(u.totalBilled) : "—"}</td>
                          <td style={{ ...S.td, fontVariantNumeric: "tabular-nums", fontWeight: 700, color: u.outstanding > 0 ? "#ef4444" : u.totalBilled > 0 ? "#22c55e" : "#475569" }}>{u.outstanding > 0 ? fmt(u.outstanding) : u.totalBilled > 0 ? "$0" : "—"}</td>
                          <td style={S.td}><span style={{ padding: "2px 8px", borderRadius: 4, fontSize: 10, fontWeight: 600, background: u.status === "Active" ? "#052e16" : u.status === "Returned" ? "#1e1b0e" : "#1c0a0a", color: u.status === "Active" ? "#22c55e" : u.status === "Returned" ? "#a3a3a3" : "#ef4444" }}>{u.status}</span></td>
                        </tr>
                        {isExpanded && u.invoices && u.invoices.map((inv, j) => (
                          <tr key={`inv-${j}`} style={{ background: "#0a0f1a", cursor: inv.pdfPath ? "pointer" : "default" }}
                            onClick={() => inv.pdfPath && downloadPdf({ pdfPath: inv.pdfPath, invoiceNumber: inv.invoiceNumber })}
                            title={inv.pdfPath ? "Click to open PDF" : ""}>
                            <td style={{ ...S.td, borderLeft: "3px solid #1e293b" }}>{inv.pdfPath ? "📄" : ""}</td>
                            <td colSpan={2} style={{ ...S.td, fontSize: 11, color: inv.pdfPath ? "#3b82f6" : "#94a3b8", fontFamily: "'JetBrains Mono', monospace", textDecoration: inv.pdfPath ? "underline" : "none" }}>{inv.invoiceNumber}</td>
                            <td style={{ ...S.td, fontSize: 11, color: "#64748b" }}>{fmtDate(inv.date)}</td>
                            <td style={{ ...S.td, fontVariantNumeric: "tabular-nums", fontSize: 12 }}>{fmt(inv.amount)}</td>
                            <td style={{ ...S.td, fontVariantNumeric: "tabular-nums", fontSize: 11, color: "#22c55e" }}>{fmt(inv.paid)}</td>
                            <td></td>
                            <td colSpan={2} style={{ ...S.td, fontSize: 10, color: "#64748b", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{inv.description || "—"}</td>
                            <td style={S.td}><span style={{ padding: "1px 6px", borderRadius: 3, fontSize: 9, fontWeight: 600, background: inv.status === "paid" ? "#052e16" : "#0c1a3d", color: inv.status === "paid" ? "#22c55e" : "#3b82f6" }}>{inv.status}</span></td>
                          </tr>
                        ))}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        );

        return (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 10, marginBottom: 20 }}>
              {[
                { label: "Total Fleet", value: equipment.length, sub: `${active.length} active`, color: "#e2e8f0" },
                { label: "Trucks", value: trucks.length, sub: `${trucks.filter(u => u.status === "Active").length} active`, color: "#3b82f6" },
                { label: "Trailers", value: trailers.length, sub: `${trailers.filter(u => u.status === "Active").length} active`, color: "#f59e0b" },
                { label: "Monthly Cost", value: fmt(totalMonthly), sub: `${fmt(totalMonthly * 12)}/yr`, color: "#f59e0b", isText: true },
                { label: "Total Billed", value: fmt(totalBilled), sub: `${fmt(totalOutst)} outstanding`, color: "#ef4444", isText: true },
              ].map((card, i) => (
                <div key={i} style={{ padding: "14px 16px", borderRadius: 8, border: "1px solid #1e293b", background: "#0d1117" }}>
                  <div style={{ fontSize: 11, color: "#64748b", fontWeight: 600, textTransform: "uppercase" }}>{card.label}</div>
                  <div style={{ fontSize: card.isText ? 18 : 26, fontWeight: 700, color: card.color, marginTop: 4, fontVariantNumeric: "tabular-nums" }}>{card.value}</div>
                  <div style={{ fontSize: 11, color: "#64748b" }}>{card.sub}</div>
                </div>
              ))}
            </div>
            {trucks.length > 0 && renderGroup("Trucks", trucks, "#3b82f6")}
            {trailers.length > 0 && renderGroup("Trailers", trailers, "#f59e0b")}
          </>
        );
      })()}

      {/* ══════════════════════════════════════════════
          MODAL — Add / Edit Invoice
          ══════════════════════════════════════════════ */}
      {showModal && (
        <div style={S.overlay} onClick={() => setShowModal(false)} role="dialog" aria-modal="true" aria-label="Add or edit invoice">
          <div style={S.modal} onClick={(e) => e.stopPropagation()}>
            {/* Vendor autocomplete datalist */}
            <datalist id="vendor-options">
              {vendorList.map((v) => <option key={v} value={v} />)}
            </datalist>

            <h3 style={{ fontSize: 16, fontWeight: 700, color: "#e2e8f0", marginBottom: 16 }}>
              {editInvoice ? "Edit Invoice" : "Add Invoice"}
              {!editInvoice && (() => {
                let hasDraft = false;
                try { const s = localStorage.getItem(DRAFT_KEY); if (s && Object.values(JSON.parse(s)).some((v) => v)) hasDraft = true; } catch {}
                return hasDraft ? <span style={{ marginLeft: 10, fontSize: 11, color: "#f59e0b", fontWeight: 500 }}>· draft auto-saved</span> : null;
              })()}
            </h3>
            {pdfFile && <div style={{ marginBottom: 12, padding: "8px 12px", background: "#0d1117", borderRadius: 6, border: "1px solid #1e293b", fontSize: 12 }}>📄 {pdfFile.name}</div>}
            <div style={S.formGrid}>
              {[
                { key: "vendorName", label: "Vendor Name", required: true, autocomplete: true },
                { key: "invoiceNumber", label: "Invoice #", required: true },
                { key: "invoiceDate", label: "Invoice Date", type: "date" },
                { key: "dueDate", label: "Due Date", type: "date" },
                { key: "amount", label: "Amount", type: "number" },
                { key: "terms", label: "Terms" },
              ].map((f) => (
                <label key={f.key} style={S.formLabel}>
                  <span style={{ fontSize: 11, color: "#94a3b8", fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5 }}>{f.label}{f.required ? " *" : ""}</span>
                  <input
                    style={S.input}
                    type={f.type || "text"}
                    step={f.type === "number" ? "0.01" : undefined}
                    list={f.autocomplete ? "vendor-options" : undefined}
                    value={formData[f.key] || ""}
                    onChange={(e) => setFormData((p) => ({ ...p, [f.key]: e.target.value }))}
                    onKeyDown={(e) => { if (e.key === "Enter" && e.target.tagName === "INPUT") { e.preventDefault(); saveInvoice(); } }}
                    placeholder={f.label}
                    aria-label={f.label}
                    aria-required={f.required || undefined}
                  />
                </label>
              ))}
            </div>
            <label style={{ ...S.formLabel, marginTop: 12 }}>
              <span style={{ fontSize: 11, color: "#94a3b8", fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5 }}>Description</span>
              <textarea style={{ ...S.input, minHeight: 60, resize: "vertical" }} value={formData.description || ""} onChange={(e) => setFormData((p) => ({ ...p, description: e.target.value }))} aria-label="Description" />
            </label>
            <div style={{ display: "flex", gap: 8, marginTop: 16, justifyContent: "space-between", alignItems: "center" }}>
              {!editInvoice && (
                <button style={{ ...S.btn, color: "#f59e0b", fontSize: 11 }} onClick={() => {
                  try { localStorage.removeItem(DRAFT_KEY); } catch {}
                  setFormData({ vendorName: "", invoiceNumber: "", invoiceDate: "", dueDate: "", amount: "", terms: "", description: "" });
                  addToast("Draft cleared", "info");
                }} aria-label="Clear draft">Clear Draft</button>
              )}
              <div style={{ display: "flex", gap: 8, marginLeft: "auto" }}>
                <button style={S.btn} onClick={() => { setShowModal(false); setPdfFile(null); }} aria-label="Cancel">Cancel</button>
                <button style={S.btnPrimary} onClick={() => saveInvoice()} aria-label={editInvoice ? "Update invoice" : "Save invoice"}>{editInvoice ? "Update" : "Save Invoice"}</button>
              </div>
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
                { key: "vendorName", label: "Vendor Name", required: true, autocomplete: true },
                { key: "invoiceNumber", label: "Invoice #", required: true },
                { key: "invoiceDate", label: "Invoice Date", type: "date" },
                { key: "dueDate", label: "Due Date", type: "date" },
                { key: "amount", label: "Amount", type: "number" },
                { key: "terms", label: "Terms" },
              ].map((f) => (
                <label key={f.key} style={S.formLabel}>
                  <span style={{ fontSize: 11, color: "#94a3b8", fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5 }}>{f.label}{f.required ? " *" : ""}</span>
                  <input
                    style={S.input}
                    type={f.type || "text"}
                    step={f.type === "number" ? "0.01" : undefined}
                    list={f.autocomplete ? "vendor-options" : undefined}
                    value={uploadQueue[batchIndex]?.fields[f.key] || ""}
                    aria-label={f.label}
                    onChange={(e) => {
                      const newQ = [...uploadQueue];
                      newQ[batchIndex] = { ...newQ[batchIndex], fields: { ...newQ[batchIndex].fields, [f.key]: e.target.value } };
                      setUploadQueue(newQ);
                    }} placeholder={f.label} />
                </label>
              ))}
            </div>
            {/* Shared datalist for vendor autocomplete */}
            <datalist id="vendor-options">
              {vendorList.map((v) => <option key={v} value={v} />)}
            </datalist>

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

            {/* Full / Partial / Credit toggle */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 16 }}>
              <button
                style={{ ...S.btn, textAlign: "center", ...(paymentMode === "full" ? { borderColor: "#3b82f6", color: "#3b82f6", background: "#0c1a3d" } : {}) }}
                onClick={() => { setPaymentMode("full"); setPaymentAmount(String(paymentInvoice.amount - paymentInvoice.amountPaid)); }}
              >Full Payment</button>
              <button
                style={{ ...S.btn, textAlign: "center", ...(paymentMode === "partial" ? { borderColor: "#3b82f6", color: "#3b82f6", background: "#0c1a3d" } : {}) }}
                onClick={() => { setPaymentMode("partial"); setPaymentAmount(""); }}
              >Partial Payment</button>
              <button
                style={{ ...S.btn, textAlign: "center", ...(paymentMode === "credit" ? { borderColor: "#f59e0b", color: "#f59e0b", background: "#1e1b0e" } : {}) }}
                onClick={() => { setPaymentMode("credit"); setPaymentAmount(""); }}
              >Apply Credit</button>
            </div>

            {/* Amount display / input */}
            {paymentMode === "full" ? (
              <div style={{ background: "#052e16", border: "1px solid #22c55e33", borderRadius: 8, padding: "14px 16px", textAlign: "center", marginBottom: 16 }}>
                <span style={{ fontSize: 14, color: "#22c55e" }}>Paying: </span>
                <span style={{ fontSize: 18, fontWeight: 700, color: "#22c55e" }}>{fmt(paymentInvoice.amount - paymentInvoice.amountPaid)}</span>
              </div>
            ) : paymentMode === "credit" ? (
              <label style={{ ...S.formLabel, marginBottom: 16 }}>
                <span style={{ fontSize: 11, color: "#f59e0b", fontWeight: 600, textTransform: "uppercase" }}>Credit Amount (reduces balance)</span>
                <input style={{ ...S.input, fontSize: 18, fontWeight: 700, textAlign: "center", borderColor: "#f59e0b44" }} type="number" step="0.01"
                  value={paymentAmount} onChange={(e) => setPaymentAmount(e.target.value)}
                  placeholder="Enter credit amount" autoFocus />
                <span style={{ fontSize: 10, color: "#64748b", marginTop: 4, display: "block" }}>Enter the credit amount as a positive number — it will be applied to reduce the balance</span>
              </label>
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
                  paymentHistory.map((p) => {
                    const isCredit = (p.note || "").includes("CREDIT");
                    return (
                      <div key={p.id} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", borderBottom: "1px solid #111827", fontSize: 13 }}>
                        <span style={{ color: "#94a3b8" }}>{fmtDate(p.paymentDate)} {isCredit && <span style={{ fontSize: 10, color: "#f59e0b", marginLeft: 4 }}>CREDIT</span>}</span>
                        <span style={{ color: isCredit ? "#f59e0b" : "#22c55e", fontVariantNumeric: "tabular-nums", fontWeight: 500 }}>{fmt(p.amount)}</span>
                      </div>
                    );
                  })
                }
              </div>
            )}

            {/* Actions */}
            <div style={{ display: "flex", gap: 8 }}>
              <button style={{ ...S.btn, flex: 1 }} onClick={() => setPaymentInvoice(null)}>Cancel</button>
              <button style={{ ...S.btnPrimary, flex: 1, padding: "12px 16px", fontSize: 14, ...(paymentMode === "credit" ? { background: "#b45309" } : {}) }} onClick={submitPayment}>
                {paymentMode === "credit" ? "Apply Credit" : "Record Payment"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════
          MODAL — Batch Payment (per-invoice full/partial)
          ══════════════════════════════════════════════ */}
      {showBatchPayModal && (
        <div style={S.overlay} onClick={() => !batchPaying && setShowBatchPayModal(false)}>
          <div style={{ ...S.modal, maxWidth: 600, maxHeight: "80vh", display: "flex", flexDirection: "column" }} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ fontSize: 18, fontWeight: 800, color: "#e2e8f0", marginBottom: 4 }}>Batch Payment</h3>
            <p style={{ fontSize: 13, color: "#64748b", marginBottom: 16 }}>{batchPayItems.length} invoices selected</p>

            {/* Payment date */}
            <label style={{ ...S.formLabel, marginBottom: 16 }}>
              <span style={{ fontSize: 11, color: "#64748b", fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5 }}>Payment Date</span>
              <input style={S.input} type="date" value={batchPayDate} onChange={(e) => setBatchPayDate(e.target.value)} />
            </label>

            {/* Invoice list */}
            <div style={{ flex: 1, overflowY: "auto", marginBottom: 16 }}>
              {batchPayItems.map((item, idx) => {
                const inv = item.invoice;
                const outstanding = inv.amount - inv.amountPaid;
                return (
                  <div key={inv.id} style={{ background: "#0d1117", border: "1px solid #1e293b", borderRadius: 8, padding: 14, marginBottom: 8 }}>
                    {/* Header row */}
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                      <div>
                        <div style={{ fontSize: 14, fontWeight: 600, color: "#e2e8f0" }}>{inv.vendorName}</div>
                        <div style={{ fontSize: 12, color: "#64748b", fontFamily: "'JetBrains Mono', monospace" }}>#{inv.invoiceNumber}</div>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <div style={{ fontSize: 12, color: "#64748b" }}>Balance Due</div>
                        <div style={{ fontSize: 15, fontWeight: 700, color: "#f59e0b" }}>{fmt(outstanding)}</div>
                      </div>
                    </div>
                    {/* Full / Partial toggle + amount */}
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <button
                        style={{ ...S.btn, flex: "0 0 auto", fontSize: 12, padding: "6px 12px", ...(item.mode === "full" ? { borderColor: "#3b82f6", color: "#3b82f6", background: "#0c1a3d" } : {}) }}
                        onClick={() => updateBatchItem(idx, "mode", "full")}
                      >Full</button>
                      <button
                        style={{ ...S.btn, flex: "0 0 auto", fontSize: 12, padding: "6px 12px", ...(item.mode === "partial" ? { borderColor: "#3b82f6", color: "#3b82f6", background: "#0c1a3d" } : {}) }}
                        onClick={() => updateBatchItem(idx, "mode", "partial")}
                      >Partial</button>
                      {item.mode === "full" ? (
                        <div style={{ flex: 1, background: "#052e16", border: "1px solid #22c55e33", borderRadius: 6, padding: "6px 12px", textAlign: "right" }}>
                          <span style={{ fontSize: 14, fontWeight: 600, color: "#22c55e" }}>{fmt(outstanding)}</span>
                        </div>
                      ) : (
                        <input
                          style={{ ...S.input, flex: 1, fontSize: 14, fontWeight: 600, textAlign: "right", margin: 0 }}
                          type="number" step="0.01" placeholder="0.00" autoFocus={idx === 0}
                          value={item.amount} onChange={(e) => updateBatchItem(idx, "amount", e.target.value)}
                        />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Total + actions */}
            <div style={{ borderTop: "1px solid #1e293b", paddingTop: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
                <span style={{ fontSize: 14, fontWeight: 600, color: "#94a3b8" }}>Total Payment</span>
                <span style={{ fontSize: 18, fontWeight: 800, color: "#22c55e" }}>
                  {fmt(batchPayItems.reduce((s, item) => s + (parseFloat(item.amount) || 0), 0))}
                </span>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button style={{ ...S.btn, flex: 1 }} onClick={() => setShowBatchPayModal(false)} disabled={batchPaying}>Cancel</button>
                <button style={{ ...S.btnPrimary, flex: 1, padding: "12px 16px", fontSize: 14 }} onClick={submitBatchPay} disabled={batchPaying}>
                  {batchPaying ? "Processing..." : "Record Payments"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════
          MODAL — Confirm Dialog (replaces window.confirm)
          ══════════════════════════════════════════════ */}
      {confirmDialog && (
        <div style={S.overlay} onClick={() => confirmDialog.onCancel()} role="alertdialog" aria-modal="true">
          <div style={{ ...S.modal, maxWidth: 420 }} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ fontSize: 16, fontWeight: 700, color: "#e2e8f0", marginBottom: 12 }}>Confirm</h3>
            <p style={{ fontSize: 14, color: "#cbd5e1", marginBottom: 20, lineHeight: 1.5 }}>{confirmDialog.message}</p>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button style={S.btn} onClick={() => confirmDialog.onCancel()} aria-label="Cancel">Cancel</button>
              <button style={S.btnPrimary} onClick={() => confirmDialog.onConfirm()} aria-label="Confirm">Confirm</button>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════
          MODAL — Recent Payments
          ══════════════════════════════════════════════ */}
      {showRecentPayments && (
        <div style={S.overlay} onClick={() => setShowRecentPayments(false)} role="dialog" aria-modal="true" aria-label="Recent payments">
          <div style={{ ...S.modal, maxWidth: 640, maxHeight: "85vh", display: "flex", flexDirection: "column" }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <h3 style={{ fontSize: 18, fontWeight: 800, color: "#e2e8f0" }}>Recent Payments</h3>
              <span style={{ fontSize: 12, color: "#94a3b8" }}>Last {recentPayments.length} · click ↩️ to undo</span>
            </div>
            <div style={{ flex: 1, overflowY: "auto" }}>
              {recentPayments.length === 0 ? (
                <div style={{ padding: 30, textAlign: "center", color: "#94a3b8", fontSize: 13 }}>No payments yet</div>
              ) : (
                recentPayments.map((p) => {
                  const isCredit = (p.note || "").includes("CREDIT");
                  return (
                    <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 12px", marginBottom: 6, background: "#0d1117", border: "1px solid #1e293b", borderRadius: 6 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, color: "#e2e8f0", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.vendorName || "(no vendor)"}</div>
                        <div style={{ fontSize: 11, color: "#94a3b8", fontFamily: "'JetBrains Mono', monospace" }}>#{p.invoiceNumber || "—"} · {fmtDate(p.paymentDate)} {isCredit && <span style={{ color: "#f59e0b", marginLeft: 4 }}>CREDIT</span>}</div>
                      </div>
                      <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 14, fontWeight: 700, color: isCredit ? "#f59e0b" : "#22c55e" }}>{fmt(p.amount)}</div>
                      <button
                        onClick={() => undoPayment(p)}
                        style={{ ...S.btn, color: "#f59e0b", padding: "6px 10px", fontSize: 12 }}
                        title="Undo this payment"
                        aria-label={`Undo payment of ${fmt(p.amount)} for ${p.vendorName} invoice ${p.invoiceNumber}`}
                      >↩️ Undo</button>
                    </div>
                  );
                })
              )}
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 14, justifyContent: "flex-end" }}>
              <button style={S.btn} onClick={() => setShowRecentPayments(false)} aria-label="Close">Close</button>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════
          TOAST CONTAINER
          ══════════════════════════════════════════════ */}
      <div role="status" aria-live="polite" aria-atomic="false" style={{ position: "fixed", bottom: 20, right: 20, display: "flex", flexDirection: "column", gap: 8, zIndex: 9999, maxWidth: 360 }}>
        {toasts.map((t) => {
          const colors = {
            success: { bg: "#052e16", border: "#22c55e", color: "#22c55e", icon: "✓" },
            error: { bg: "#1c0a0a", border: "#ef4444", color: "#ef4444", icon: "✕" },
            info: { bg: "#0c1a3d", border: "#3b82f6", color: "#3b82f6", icon: "ℹ" },
          };
          const c = colors[t.type] || colors.info;
          return (
            <div key={t.id} style={{ background: c.bg, border: `1px solid ${c.border}`, borderRadius: 8, padding: "12px 14px", display: "flex", alignItems: "center", gap: 10, boxShadow: "0 4px 12px rgba(0,0,0,.4)", animation: "slideIn .2s" }}>
              <span aria-hidden="true" style={{ fontSize: 16, color: c.color }}>{c.icon}</span>
              <span style={{ flex: 1, fontSize: 13, color: "#e2e8f0" }}>{t.message}</span>
              {t.action && (
                <button onClick={() => { t.action(); removeToast(t.id); }} style={{ background: "transparent", border: `1px solid ${c.color}`, color: c.color, padding: "4px 10px", borderRadius: 4, fontSize: 11, fontWeight: 700, cursor: "pointer" }}>{t.actionLabel || "Action"}</button>
              )}
              <button onClick={() => removeToast(t.id)} aria-label="Dismiss notification" style={{ background: "transparent", border: "none", color: "#94a3b8", cursor: "pointer", fontSize: 16, padding: 0, lineHeight: 1 }}>×</button>
            </div>
          );
        })}
      </div>

      {/* Keyboard shortcuts hint (small footer) */}
      <div style={{ marginTop: 20, padding: "10px 14px", borderTop: "1px solid #1e293b", fontSize: 11, color: "#94a3b8", display: "flex", gap: 16, flexWrap: "wrap" }}>
        <span><kbd style={S.kbd}>⌘K</kbd> or <kbd style={S.kbd}>/</kbd> Search</span>
        <span><kbd style={S.kbd}>N</kbd> New invoice</span>
        <span><kbd style={S.kbd}>Esc</kbd> Close modal</span>
        <span>Click <kbd style={S.kbd}>amount</kbd> or <kbd style={S.kbd}>due date</kbd> to edit inline</span>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════
   STYLES
   ══════════════════════════════════════════════════ */
const styles = {
  page: { maxWidth: 1600, margin: "0 auto", padding: "16px" },
  header: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 12 },
  logo: { width: 40, height: 40, borderRadius: 8, background: "linear-gradient(135deg, #3b82f6, #1d4ed8)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 14, color: "#fff", letterSpacing: 1 },
  title: { fontSize: 20, fontWeight: 700, color: "#f1f5f9", letterSpacing: -0.5 },
  subtitle: { fontSize: 12, color: "#94a3b8", marginTop: 2 },
  btn: { padding: "8px 14px", minHeight: 36, borderRadius: 6, border: "1px solid #1e293b", background: "#0d1117", color: "#cbd5e1", fontSize: 12, fontWeight: 500, cursor: "pointer", transition: "all .15s" },
  btnActive: { background: "#1e293b", color: "#e2e8f0", borderColor: "#3b82f6" },
  btnPrimary: { padding: "8px 16px", minHeight: 36, borderRadius: 6, border: "none", background: "linear-gradient(135deg, #3b82f6, #2563eb)", color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer" },
  btnSmall: { padding: "8px 10px", minWidth: 32, minHeight: 32, borderRadius: 4, border: "1px solid #1e293b", background: "transparent", color: "#cbd5e1", fontSize: 13, cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center" },
  dropZone: { border: "2px dashed #1e293b", borderRadius: 8, padding: "24px", textAlign: "center", marginBottom: 16, cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 4, transition: "all .2s", background: "#0a0f1a" },
  dropZoneActive: { borderColor: "#3b82f6", background: "#0c1a3d" },
  bucketRow: { display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 10, marginBottom: 16 },
  bucketCard: { padding: "14px 16px", borderRadius: 8, border: "1px solid #1e293b", transition: "all .2s" },
  tableWrap: { background: "#0d1117", border: "1px solid #1e293b", borderRadius: 8, overflow: "auto", marginBottom: 16, position: "relative" },
  table: { width: "100%", borderCollapse: "collapse" },
  th: { padding: "10px 12px", textAlign: "left", fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5, color: "#94a3b8", borderBottom: "1px solid #1e293b", background: "#0a0f1a", whiteSpace: "nowrap", position: "sticky", top: 0, zIndex: 5 },
  tr: { borderBottom: "1px solid #111827" },
  td: { padding: "10px 12px", fontSize: 13, whiteSpace: "nowrap" },
  vendorGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 12, marginBottom: 16 },
  vendorCard: { padding: "16px", borderRadius: 8, border: "1px solid #1e293b", background: "#0d1117", cursor: "pointer", transition: "all .2s" },
  overlay: { position: "fixed", inset: 0, background: "rgba(0,0,0,.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 999, animation: "fadeIn .2s" },
  modal: { background: "#161b22", border: "1px solid #1e293b", borderRadius: 12, padding: "24px", width: "100%", maxWidth: 520, maxHeight: "90vh", overflow: "auto", animation: "modalIn .2s" },
  formGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 },
  formLabel: { display: "flex", flexDirection: "column", gap: 4 },
  input: { padding: "8px 12px", minHeight: 36, borderRadius: 6, border: "1px solid #1e293b", background: "#0d1117", color: "#e2e8f0", fontSize: 13, fontFamily: "inherit", outline: "none" },
  spinner: { width: 18, height: 18, border: "2px solid #1e293b", borderTopColor: "#3b82f6", borderRadius: "50%", animation: "spin .6s linear infinite" },
  kbd: { display: "inline-block", padding: "1px 6px", borderRadius: 4, border: "1px solid #1e293b", background: "#0d1117", color: "#cbd5e1", fontSize: 10, fontFamily: "'JetBrains Mono', monospace", fontWeight: 600, lineHeight: 1.5 },
};
