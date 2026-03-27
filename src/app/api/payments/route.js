import { supabase } from "@/lib/supabase";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/* GET — list payments for an invoice */
export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const invoiceId = searchParams.get("invoiceId");
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
    const { invoiceId, amount, paymentDate, note } = body;
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
    const status = newPaid >= parseFloat(inv.amount) ? "paid" : "partial";

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
