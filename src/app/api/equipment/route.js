import { supabase } from "@/lib/supabase";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const EQUIP_VENDORS = [
  { match: /penske/i, label: "Penske", type: "Truck" },
  { match: /tec/i, label: "TEC Equipment", type: "Truck" },
  { match: /tci/i, label: "TCI Leasing", type: "Truck" },
  { match: /ryder/i, label: "Ryder", type: "Truck" },
  { match: /mckinney/i, label: "McKinney Trailers", type: "Trailer" },
  { match: /xtra/i, label: "XTRA Lease", type: "Trailer" },
  { match: /mountain.*west|utility.*trailer/i, label: "Mountain West / Utility", type: "Trailer" },
  { match: /bermuda/i, label: "Bermuda Rent", type: "Trailer" },
];

export async function GET() {
  try {
    const { data, error } = await supabase
      .from("invoices")
      .select("vendor_name, invoice_number, invoice_date, amount, amount_paid, description, status")
      .order("invoice_date", { ascending: false });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const unitMap = {};

    (data || []).forEach((inv) => {
      const vendor = EQUIP_VENDORS.find((v) => v.match.test(inv.vendor_name));
      if (!vendor) return;

      const desc = inv.description || "";
      const unitMatch = desc.match(/unit\s*#?\s*(\w+)/i) || desc.match(/(\d{5,6})/);
      const unitNum = unitMatch ? unitMatch[1] : null;
      const key = unitNum ? `${vendor.label}|${unitNum}` : `${vendor.label}|INV-${inv.invoice_number}`;

      if (!unitMap[key]) {
        unitMap[key] = {
          unitNumber: unitNum || null,
          vendor: vendor.label,
          type: vendor.type,
          invoiceCount: 0,
          totalBilled: 0,
          totalPaid: 0,
          lastInvoiceDate: "",
          status: "active",
        };
      }
      unitMap[key].invoiceCount++;
      unitMap[key].totalBilled += parseFloat(inv.amount) || 0;
      unitMap[key].totalPaid += parseFloat(inv.amount_paid) || 0;
      if (inv.invoice_date > unitMap[key].lastInvoiceDate) unitMap[key].lastInvoiceDate = inv.invoice_date;
    });

    const units = Object.values(unitMap).sort((a, b) =>
      a.vendor.localeCompare(b.vendor) || (a.unitNumber || "").localeCompare(b.unitNumber || "")
    );

    return NextResponse.json({
      units,
      summary: {
        totalUnits: units.length,
        trucks: units.filter((u) => u.type === "Truck").length,
        trailers: units.filter((u) => u.type === "Trailer").length,
        totalBilled: units.reduce((s, u) => s + u.totalBilled, 0),
        totalOutstanding: units.reduce((s, u) => s + (u.totalBilled - u.totalPaid), 0),
      },
      updatedAt: new Date().toISOString(),
    });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
