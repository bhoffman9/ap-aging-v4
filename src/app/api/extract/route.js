import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY || "" });

export async function POST(req) {
  try {
    const formData = await req.formData();
    const file = formData.get("file");
    if (!file) return NextResponse.json({ error: "No file" }, { status: 400 });

    const bytes = await file.arrayBuffer();
    const base64 = Buffer.from(bytes).toString("base64");

    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1024,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "document",
              source: {
                type: "base64",
                media_type: "application/pdf",
                data: base64,
              },
            },
            {
              type: "text",
              text: `Extract invoice data from this PDF. Return ONLY a JSON object with these fields:
{
  "vendorName": "company name",
  "invoiceNumber": "invoice number",
  "invoiceDate": "YYYY-MM-DD",
  "dueDate": "YYYY-MM-DD or null",
  "amount": 0.00,
  "terms": "payment terms",
  "description": "brief description",
  "units": ["unit1", "unit2"],
  "vins": ["vin1", "vin2"],
  "contractNumber": "contract or agreement number or null",
  "billingPeriod": "billing period text or null"
}

RULES — follow these exactly:
1. vendorName: The COMPANY NAME that issued the invoice (look for a logo, letterhead, or business name at the top). NEVER use a lockbox number, PO box, address, or "remit to" line as the vendor name.
2. amount: Use the FINAL TOTAL the customer owes — look for "Total Due", "Amount Due", "Balance Due", or "Total Due This Invoice". This must INCLUDE tax/shipping if shown. Do NOT use subtotals, "Total Before Tax", or line item amounts.
3. description: Summarize what was invoiced. Include unit numbers and type of charge (e.g. "Truck lease - Units 26440, 26441, fixed + mileage"). Never leave blank.
4. invoiceDate/dueDate: Use YYYY-MM-DD format.
5. terms: e.g. "Net 10", "Net 30", "Due on Receipt".
6. units: Extract ALL unit numbers, equipment numbers, or fleet numbers mentioned (e.g. "Unit # 104463", "Unit 26440", "P5181425"). Return as array of strings. Look for patterns like "Unit #", "Unit No.", equipment serial numbers, trailer numbers. If none found, return empty array [].
7. vins: Extract ALL VIN numbers mentioned (17-character alphanumeric codes). Return as array. If none, return [].
8. contractNumber: Look for lease agreement numbers, contract numbers, rental agreement numbers (e.g. "Agr #875", "Agreement 070R-001058", "Lease 1710", "Rental Contract"). Return the number/ID. If none, return null.
9. billingPeriod: The billing period or date range (e.g. "Mar 1 - Mar 31, 2026", "Feb 9 - Feb 28, 2026"). If none, return null.

Return ONLY valid JSON, no markdown, no explanation.`,
            },
          ],
        },
      ],
    });

    const text = response.content[0]?.text || "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return NextResponse.json({ error: "Could not parse AI response" }, { status: 500 });
    }

    const parsed = JSON.parse(jsonMatch[0]);

    // Build rich description from extracted data
    let desc = parsed.description || "";
    if (parsed.units && parsed.units.length > 0 && !desc.includes(parsed.units[0])) {
      desc += (desc ? " — " : "") + "Units: " + parsed.units.join(", ");
    }
    if (parsed.billingPeriod && !desc.includes(parsed.billingPeriod)) {
      desc += (desc ? " | " : "") + parsed.billingPeriod;
    }

    return NextResponse.json({
      vendorName: parsed.vendorName,
      invoiceNumber: parsed.invoiceNumber,
      invoiceDate: parsed.invoiceDate,
      dueDate: parsed.dueDate,
      amount: parsed.amount,
      terms: parsed.terms,
      description: desc,
      units: parsed.units || [],
      vins: parsed.vins || [],
      contractNumber: parsed.contractNumber || null,
      billingPeriod: parsed.billingPeriod || null,
      method: "haiku",
      cost: "~$0.003",
    });
  } catch (e) {
    console.error("Extract error:", e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
