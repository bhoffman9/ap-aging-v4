import { supabase } from "@/lib/supabase";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function toFrontend(row) {
  return {
    id: row.id,
    vendorName: row.vendor_name,
    invoiceNumber: row.invoice_number,
    invoiceDate: row.invoice_date,
    dueDate: row.due_date,
    amount: parseFloat(row.amount) || 0,
    amountPaid: parseFloat(row.amount_paid) || 0,
    terms: row.terms || "",
    description: row.description || "",
    status: row.status,
    pdfPath: row.pdf_path || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/* ── GET — list all or check duplicate ── */
export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const vendor = searchParams.get("vendor");
    const invNum = searchParams.get("invoiceNumber");

    // Duplicate check
    if (vendor && invNum) {
      const { data } = await supabase
        .from("invoices")
        .select("id")
        .eq("vendor_name", vendor)
        .eq("invoice_number", invNum)
        .limit(1);
      return NextResponse.json({ exists: data?.length > 0 });
    }

    // List all (open/partial first, then by due date)
    const { data, error } = await supabase
      .from("invoices")
      .select("*")
      .order("status", { ascending: true })
      .order("due_date", { ascending: true });

    if (error) throw error;
    return NextResponse.json(data.map(toFrontend));
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

/* ── POST — create invoice ── */
export async function POST(req) {
  try {
    const body = await req.json();
    const { vendorName, invoiceNumber, invoiceDate, dueDate, amount, terms, description, pdfPath } = body;

    if (!vendorName || !invoiceNumber) {
      return NextResponse.json({ error: "vendorName and invoiceNumber are required" }, { status: 400 });
    }

    // Duplicate check
    const { data: existing } = await supabase
      .from("invoices")
      .select("id")
      .eq("vendor_name", vendorName)
      .eq("invoice_number", invoiceNumber)
      .limit(1);

    if (existing?.length > 0) {
      return NextResponse.json({ error: "Duplicate invoice" }, { status: 409 });
    }

    const { data, error } = await supabase
      .from("invoices")
      .insert({
        vendor_name: vendorName,
        invoice_number: invoiceNumber,
        invoice_date: invoiceDate || null,
        due_date: dueDate || null,
        amount: parseFloat(amount) || 0,
        terms: terms || "",
        description: description || "",
        pdf_path: pdfPath || "",
      })
      .select()
      .single();

    if (error) throw error;
    return NextResponse.json(toFrontend(data), { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

/* ── PUT — update invoice ── */
export async function PUT(req) {
  try {
    const body = await req.json();
    const { id, ...fields } = body;
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

    const updates = {};
    if (fields.vendorName !== undefined) updates.vendor_name = fields.vendorName;
    if (fields.invoiceNumber !== undefined) updates.invoice_number = fields.invoiceNumber;
    if (fields.invoiceDate !== undefined) updates.invoice_date = fields.invoiceDate || null;
    if (fields.dueDate !== undefined) updates.due_date = fields.dueDate || null;
    if (fields.amount !== undefined) updates.amount = parseFloat(fields.amount) || 0;
    if (fields.amountPaid !== undefined) updates.amount_paid = parseFloat(fields.amountPaid) || 0;
    if (fields.terms !== undefined) updates.terms = fields.terms;
    if (fields.description !== undefined) updates.description = fields.description;
    if (fields.status !== undefined) updates.status = fields.status;
    if (fields.pdfPath !== undefined) updates.pdf_path = fields.pdfPath;

    const { data, error } = await supabase
      .from("invoices")
      .update(updates)
      .eq("id", id)
      .select()
      .single();

    if (error) throw error;
    return NextResponse.json(toFrontend(data));
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

/* ── DELETE — remove invoice ── */
export async function DELETE(req) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

    // Get pdf_path to clean up storage
    const { data: inv } = await supabase
      .from("invoices")
      .select("pdf_path")
      .eq("id", id)
      .single();

    if (inv?.pdf_path) {
      await supabase.storage.from("invoices").remove([inv.pdf_path]);
    }

    const { error } = await supabase.from("invoices").delete().eq("id", id);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
