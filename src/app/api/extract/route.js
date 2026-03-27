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
  "vendorName": "the company that sent this invoice / remit to / who you pay",
  "invoiceNumber": "the invoice number or reference number",
  "invoiceDate": "YYYY-MM-DD format",
  "dueDate": "YYYY-MM-DD format (if shown)",
  "amount": "total amount as a number (no $ or commas)",
  "terms": "payment terms like Net 30, 30 Days, etc.",
  "description": "brief one-line description of what was invoiced"
}

IMPORTANT: "vendorName" is the company that ISSUED the invoice (the seller/vendor/remit-to), NOT the customer/bill-to.
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
