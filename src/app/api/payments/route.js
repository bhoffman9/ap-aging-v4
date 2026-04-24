import { supabase } from "@/lib/supabase";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/* GET — list payments for an invoice, OR recent N payments across all invoices */
export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const invoiceId = searchParams.get("invoiceId");
    const recent = searchParams.get("recent");
    const all = searchParams.get("all");

    // All payments mode — for remittance grouping. Joins with invoices for context.
    if (all) {
      const { data, error } = await supabase
        .from("payments")
        .select("*, invoices(vendor_name, invoice_number, amount, amount_paid, status)")
        .order("payment_date", { ascending: false });
      if (error) throw error;
      return NextResponse.json(data.map((p) => ({
        id: p.id,
        invoiceId: p.invoice_id,
        amount: parseFloat(p.amount) || 0,
        paymentDate: p.payment_date,
        paymentMethod: p.payment_method || "ACH",
        note: p.note || "",
        createdAt: p.created_at,
        vendorName: p.invoices?.vendor_name || "",
        invoiceNumber: p.invoices?.invoice_number || "",
        invoiceAmount: parseFloat(p.invoices?.amount) || 0,
        invoiceAmountPaid: parseFloat(p.invoices?.amount_paid) || 0,
        invoiceStatus: p.invoices?.status || "",
      })));
    }

    // Recent payments mode — joins with invoices for context
    if (recent) {
      const limit = Math.min(parseInt(recent, 10) || 20, 100);
      const { data, error } = await supabase
        .from("payments")
        .select("*, invoices(vendor_name, invoice_number, amount, amount_paid)")
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) throw error;
      return NextResponse.json(data.map((p) => ({
        id: p.id,
        invoiceId: p.invoice_id,
        amount: parseFloat(p.amount) || 0,
        paymentDate: p.payment_date,
        paymentMethod: p.payment_method || "ACH",
        note: p.note || "",
        createdAt: p.created_at,
        vendorName: p.invoices?.vendor_name || "",
        invoiceNumber: p.invoices?.invoice_number || "",
        invoiceAmount: parseFloat(p.invoices?.amount) || 0,
        invoiceAmountPaid: parseFloat(p.invoices?.amount_paid) || 0,
      })));
    }

    if (!invoiceId) return NextResponse.json({ error: "invoiceId required" }, { status: 400 });

    const { data, error } = await supabase
      .from("payments")
      .select("*")
      .eq("invoice_id", invoiceId)
      .order("payment_date", { ascending: false });

    if (error) throw error;
    return NextResponse.json(data.map((p) => ({
      id: p.id,
      invoiceId: p.invoice_id,
      amount: parseFloat(p.amount) || 0,
      paymentDate: p.payment_date,
      paymentMethod: p.payment_method || "ACH",
      note: p.note || "",
      createdAt: p.created_at,
    })));
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

/* POST — record a payment */
export async function POST(req) {
  try {
    const body = await req.json();
    const { invoiceId, amount, paymentDate, note, paymentMethod } = body;
    if (!invoiceId || !amount) {
      return NextResponse.json({ error: "invoiceId and amount required" }, { status: 400 });
    }

    // Insert payment record
    const { error: pErr } = await supabase
      .from("payments")
      .insert({
        invoice_id: invoiceId,
        amount: parseFloat(amount),
        payment_date: paymentDate || new Date().toISOString().slice(0, 10),
        note: note || "",
        payment_method: paymentMethod || "ACH",
      });
    if (pErr) throw pErr;

    // Update invoice totals
    const { data: inv, error: iErr } = await supabase
      .from("invoices")
      .select("amount, amount_paid")
      .eq("id", invoiceId)
      .single();
    if (iErr) throw iErr;

    const newPaid = parseFloat(inv.amount_paid) + parseFloat(amount);
    // ±$0.05 tolerance to absorb float rounding so a "full" payment isn't stuck as partial
    const status = newPaid >= parseFloat(inv.amount) - 0.05 ? "paid" : "partial";

    const { error: uErr } = await supabase
      .from("invoices")
      .update({ amount_paid: newPaid, status })
      .eq("id", invoiceId);
    if (uErr) throw uErr;

    return NextResponse.json({ ok: true, newPaid, status });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

/* DELETE — undo a payment (subtracts from amount_paid, reverts status) */
export async function DELETE(req) {
  try {
    const { searchParams } = new URL(req.url);
    const paymentId = searchParams.get("id");
    if (!paymentId) return NextResponse.json({ error: "payment id required" }, { status: 400 });

    // Get the payment first
    const { data: pmt, error: pErr } = await supabase
      .from("payments")
      .select("invoice_id, amount")
      .eq("id", paymentId)
      .single();
    if (pErr) throw pErr;
    if (!pmt) return NextResponse.json({ error: "payment not found" }, { status: 404 });

    // Get the invoice
    const { data: inv, error: iErr } = await supabase
      .from("invoices")
      .select("amount, amount_paid")
      .eq("id", pmt.invoice_id)
      .single();
    if (iErr) throw iErr;

    // Delete the payment record
    const { error: dErr } = await supabase
      .from("payments")
      .delete()
      .eq("id", paymentId);
    if (dErr) throw dErr;

    // Recalculate invoice paid + status (±$0.05 tolerance for float rounding)
    const newPaid = Math.max(0, parseFloat(inv.amount_paid) - parseFloat(pmt.amount));
    let status;
    if (newPaid <= 0.05) status = "open";
    else if (newPaid >= parseFloat(inv.amount) - 0.05) status = "paid";
    else status = "partial";

    const { error: uErr } = await supabase
      .from("invoices")
      .update({ amount_paid: newPaid, status })
      .eq("id", pmt.invoice_id);
    if (uErr) throw uErr;

    return NextResponse.json({ ok: true, newPaid, status });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
