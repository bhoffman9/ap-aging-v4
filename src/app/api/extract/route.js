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
  "description": "brief description of what was invoiced"
}

RULES — follow these exactly:
1. vendorName: The COMPANY NAME that issued the invoice (look for a logo, letterhead, or business name at the top). NEVER use a lockbox number, PO box, address, or "remit to" line as the vendor name.
2. amount: Use the FINAL TOTAL the customer owes — look for "Total Due", "Amount Due", "Balance Due", or "Total Due This Invoice". This must INCLUDE tax/shipping if shown. Do NOT use subtotals, "Total Before Tax", or line item amounts.
3. description: Summarize what was invoiced (e.g. "Truck rental - Unit #104463, mileage charge"). Never leave blank.
4. invoiceDate/dueDate: Use YYYY-MM-DD format.
5. terms: e.g. "Net 10", "Net 30", "Due on Receipt".

Return ONLY valid JSON, no markdown, no explanation.`,
            },
          ],
        },
      ],
    });

    const text = response.content[0]?.text || "";
    // Extract JSON from response (handle potential markdown wrapping)
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return NextResponse.json({ error: "Could not parse AI response" }, { status: 500 });
    }

    const parsed = JSON.parse(jsonMatch[0]);
    return NextResponse.json({
      ...parsed,
      method: "haiku",
      cost: "~$0.003",
    });
  } catch (e) {
    console.error("Extract error:", e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
