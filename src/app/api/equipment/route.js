import { supabase } from "@/lib/supabase";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    // Get fleet from equipment table
    const { data: fleet, error: fleetErr } = await supabase
      .from("equipment")
      .select("*")
      .order("vendor")
      .order("vendor_unit");

    if (fleetErr) return NextResponse.json({ error: fleetErr.message }, { status: 500 });

    // Get invoice cost data per unit
    const { data: invoices, error: invErr } = await supabase
      .from("invoices")
      .select("vendor_name, invoice_number, invoice_date, amount, amount_paid, description, status");

    if (invErr) return NextResponse.json({ error: invErr.message }, { status: 500 });

    // Build cost lookup by vendor_unit number
    const costMap = {};
    (invoices || []).forEach((inv) => {
      const desc = inv.description || "";
      const unitMatch = desc.match(/unit\s*#?\s*(\w+)/i) || desc.match(/(\d{5,6})/);
      if (!unitMatch) return;
      const unitNum = unitMatch[1];
      if (!costMap[unitNum]) costMap[unitNum] = { invoiceCount: 0, totalBilled: 0, totalPaid: 0, lastInvoiceDate: "" };
      costMap[unitNum].invoiceCount++;
      costMap[unitNum].totalBilled += parseFloat(inv.amount) || 0;
      costMap[unitNum].totalPaid += parseFloat(inv.amount_paid) || 0;
      if (inv.invoice_date > costMap[unitNum].lastInvoiceDate) costMap[unitNum].lastInvoiceDate = inv.invoice_date;
    });

    // Merge fleet data with invoice costs
    const units = (fleet || []).map((eq) => {
      const costs = costMap[eq.vendor_unit] || {};
      return {
        id: eq.id,
        fleetNumber: eq.fleet_number,
        vendor: eq.vendor,
        vendorUnit: eq.vendor_unit,
        vin: eq.vin,
        make: eq.make,
        model: eq.model,
        year: eq.year,
        type: eq.type,
        category: eq.category,
        monthlyCost: parseFloat(eq.monthly_cost) || 0,
        mileageRate: parseFloat(eq.mileage_rate) || 0,
        contract: eq.contract,
        status: eq.status,
        invoiceCount: costs.invoiceCount || 0,
        totalBilled: costs.totalBilled || 0,
        totalPaid: costs.totalPaid || 0,
        outstanding: (costs.totalBilled || 0) - (costs.totalPaid || 0),
        lastInvoiceDate: costs.lastInvoiceDate || "",
      };
    });

    const trucks = units.filter((u) => u.category === "truck");
    const trailers = units.filter((u) => u.category === "trailer");

    return NextResponse.json({
      units,
      summary: {
        totalUnits: units.length,
        trucks: trucks.length,
        trailers: trailers.length,
        activeTrucks: trucks.filter((u) => u.status === "Active").length,
        activeTrailers: trailers.filter((u) => u.status === "Active").length,
        totalMonthly: units.filter((u) => u.status === "Active").reduce((s, u) => s + u.monthlyCost, 0),
        totalBilled: units.reduce((s, u) => s + u.totalBilled, 0),
        totalOutstanding: units.reduce((s, u) => s + u.outstanding, 0),
      },
      updatedAt: new Date().toISOString(),
    });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
