import { supabase } from "@/lib/supabase";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Map invoice vendor names to equipment vendor names
const VENDOR_ALIASES = {
  "penske truck leasing": "Penske",
  "penske": "Penske",
  "tec equipment leasing": "TEC",
  "tec equipment": "TEC",
  "tci dedicated logistics, leasing & rental": "TCI",
  "tci dedicated logistics": "TCI",
  "tci": "TCI",
  "transportation commodities inc": "TCI",
  "transportation commodities": "TCI",
  "mckinney trailers": "McKinney",
  "mckinney trailer rentals": "McKinney",
  "xtra lease": "XTRA Lease",
  "mountain west utility trailer": "Mountain West",
  "mountain west utility trailer, inc": "Mountain West",
  "utility trailer": "Mountain West",
  "ten trailer leasing": "Ten Trailer Leasing",
  "ten trailer": "Ten Trailer Leasing",
  "premier trailer leasing": "Premier Trailer",
  "premier trailer": "Premier Trailer",
  "premier trailers": "Premier Trailer",
  "ryder truck rentals": "Ryder",
  "bermuda rent": "Bermuda Rent",
};

function normalizeVendor(name) {
  const lower = (name || "").trim().toLowerCase();
  return VENDOR_ALIASES[lower] || null;
}

export async function GET() {
  try {
    const { data: fleet, error: fleetErr } = await supabase
      .from("equipment")
      .select("*")
      .order("vendor")
      .order("vendor_unit");

    if (fleetErr) return NextResponse.json({ error: fleetErr.message }, { status: 500 });

    const { data: invoices, error: invErr } = await supabase
      .from("invoices")
      .select("id, vendor_name, invoice_number, invoice_date, due_date, amount, amount_paid, description, status, pdf_path")
      .order("invoice_date", { ascending: false });

    if (invErr) return NextResponse.json({ error: invErr.message }, { status: 500 });

    // Build contract-to-unit lookup from fleet data
    const contractToUnit = {};
    (fleet || []).forEach((eq) => {
      if (eq.contract) {
        const m = eq.contract.match(/(\d{4})/);
        if (m) contractToUnit[m[1]] = eq.vendor_unit;
      }
    });

    // Build lookups: by unit number, by contract, by vendor
    const invoicesByUnit = {};
    const invoicesByVendor = {};

    (invoices || []).forEach((inv) => {
      const desc = inv.description || "";
      const invNum = inv.invoice_number || "";
      const equipVendor = normalizeVendor(inv.vendor_name);

      // Match by unit number in description
      const unitMatch = desc.match(/unit\s*#?\s*(\w+)/i) || desc.match(/(\d{5,6})/);
      if (unitMatch) {
        const unitNum = unitMatch[1];
        if (!invoicesByUnit[unitNum]) invoicesByUnit[unitNum] = [];
        invoicesByUnit[unitNum].push(inv);
      }

      // Match TCI invoices by contract number in invoice number (e.g. 31L1710002 → contract 1710)
      if (equipVendor === "TCI" && !unitMatch) {
        const contractMatch = invNum.match(/\d{2}[A-Z](\d{4})\d{2,}/);
        if (contractMatch && contractToUnit[contractMatch[1]]) {
          const vendorUnit = contractToUnit[contractMatch[1]];
          if (!invoicesByUnit[vendorUnit]) invoicesByUnit[vendorUnit] = [];
          invoicesByUnit[vendorUnit].push(inv);
        }
      }

      if (equipVendor) {
        if (!invoicesByVendor[equipVendor]) invoicesByVendor[equipVendor] = [];
        invoicesByVendor[equipVendor].push(inv);
      }
    });

    // Count how many units each vendor has (for splitting lump-sum invoices)
    const unitsPerVendor = {};
    (fleet || []).forEach((eq) => {
      if (eq.status === "Active") {
        unitsPerVendor[eq.vendor] = (unitsPerVendor[eq.vendor] || 0) + 1;
      }
    });

    // Merge fleet with invoice data
    const units = (fleet || []).map((eq) => {
      // Get invoices: unit-level first, then vendor-level for units without matches
      const unitInvs = invoicesByUnit[eq.vendor_unit] || [];
      const vendorInvs = invoicesByVendor[eq.vendor] || [];

      // Use unit-level if available, otherwise split vendor-level evenly across units
      let matchedInvs, totalBilled, totalPaid;
      if (unitInvs.length > 0) {
        matchedInvs = unitInvs;
        totalBilled = unitInvs.reduce((s, i) => s + (parseFloat(i.amount) || 0), 0);
        totalPaid = unitInvs.reduce((s, i) => s + (parseFloat(i.amount_paid) || 0), 0);
      } else if (vendorInvs.length > 0 && !invoicesByUnit[eq.vendor_unit]) {
        // Vendor-level: show all vendor invoices but split totals by unit count
        const unitCount = unitsPerVendor[eq.vendor] || 1;
        matchedInvs = vendorInvs;
        totalBilled = vendorInvs.reduce((s, i) => s + (parseFloat(i.amount) || 0), 0) / unitCount;
        totalPaid = vendorInvs.reduce((s, i) => s + (parseFloat(i.amount_paid) || 0), 0) / unitCount;
      } else {
        matchedInvs = [];
        totalBilled = 0;
        totalPaid = 0;
      }

      const lastDate = matchedInvs.length > 0 ? matchedInvs[0].invoice_date : "";

      return {
        id: eq.id,
        fleetNumber: eq.fleet_number,
        vendor: eq.vendor,
        vendorUnit: eq.vendor_unit,
        vin: eq.vin || "—",
        make: eq.make || "—",
        model: eq.model || "—",
        year: eq.year || "—",
        type: eq.type,
        category: eq.category,
        monthlyCost: parseFloat(eq.monthly_cost) || 0,
        mileageRate: parseFloat(eq.mileage_rate) || 0,
        contract: eq.contract || "",
        status: eq.status,
        invoiceCount: matchedInvs.length,
        totalBilled: Math.round(totalBilled * 100) / 100,
        totalPaid: Math.round(totalPaid * 100) / 100,
        outstanding: Math.round((totalBilled - totalPaid) * 100) / 100,
        lastInvoiceDate: lastDate,
        invoices: matchedInvs.map((i) => ({
          id: i.id,
          invoiceNumber: i.invoice_number,
          date: i.invoice_date,
          amount: parseFloat(i.amount) || 0,
          paid: parseFloat(i.amount_paid) || 0,
          description: i.description || "",
          status: i.status,
          pdfPath: i.pdf_path || "",
        })),
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
