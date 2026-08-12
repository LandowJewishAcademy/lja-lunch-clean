// netlify/functions/create-checkout.mjs
//
// This runs on Netlify's servers, never in the parent's browser.
// SQUARE_ACCESS_TOKEN and SQUARE_LOCATION_ID come from Netlify environment
// variables — they are never present in the HTML/JS the browser downloads.
//
// This function:
//   1. Re-validates every selected day (deadline, calendar, price) using
//      the SERVER's clock and calendar — never trusts the browser's copy.
//   2. Saves the full order (child names, grades, days, items) to Netlify
//      Blobs as "pending", tagged with a random orderRef.
//   3. Creates a Square Payment Link, attaching that orderRef as order
//      metadata so the webhook can find this record again after payment.
//   4. Returns the checkout URL for the front-end to redirect to.

import { getOrdersStore } from "./_shared/ordersStore.mjs";
import { randomUUID } from "node:crypto";
import { validateLineItemDate } from "./_shared/schoolCalendar.mjs";

export const handler = async function (event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  const SQUARE_ACCESS_TOKEN = process.env.SQUARE_ACCESS_TOKEN;
  const SQUARE_LOCATION_ID = process.env.SQUARE_LOCATION_ID;
  const SQUARE_API_BASE =
    process.env.SQUARE_ENV === "production"
      ? "https://connect.squareup.com"
      : "https://connect.squareupsandbox.com";

  if (!SQUARE_ACCESS_TOKEN || !SQUARE_LOCATION_ID) {
    return { statusCode: 500, body: JSON.stringify({ error: "Server is missing Square configuration." }) };
  }

  let payload;
  try {
    payload = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: "Invalid request body." }) };
  }

  const { parentName, parentEmail, parentPhone, lineItems } = payload;
  const parentPhoneDigits = (parentPhone || "").replace(/\D/g, "");

  if (!parentName || !parentEmail || parentPhoneDigits.length < 10 || !Array.isArray(lineItems) || lineItems.length === 0) {
    return { statusCode: 400, body: JSON.stringify({ error: "Missing order details (name, email, and a valid phone number are all required)." }) };
  }

  // --- Server-side re-validation of each line item ---
  const now = new Date();
  const validatedItems = [];   // for Square (name + price)
  const orderRecordItems = []; // for our own order log (structured fields)

  for (const li of lineItems) {
    const check = validateLineItemDate(li.dateId, now);
    if (!check.ok) {
      return { statusCode: check.status, body: JSON.stringify({ error: check.error }) };
    }
    const { menu } = check;
    const correctAmountCents = Math.round(menu.price * 100);
    const childName = li.childName || "Child";
    const grade = li.grade || "";

    validatedItems.push({
      name: `${childName}${grade ? " (" + grade + ")" : ""} — ${menu.day} ${li.dateId}: ${menu.item}`,
      quantity: "1",
      base_price_money: { amount: correctAmountCents, currency: "USD" },
    });
    orderRecordItems.push({
      childName,
      grade,
      dateId: li.dateId,
      dayName: menu.day,
      item: menu.item,
      amountCents: correctAmountCents,
    });
  }

  const orderRef = randomUUID();
  const totalCents = orderRecordItems.reduce((sum, i) => sum + i.amountCents, 0);

  const orderRecord = {
    orderRef,
    parentName,
    parentEmail,
    parentPhone: parentPhoneDigits,
    items: orderRecordItems,
    totalCents,
    status: "pending",
    createdAt: now.toISOString(),
  };

  try {
    const store = getOrdersStore();
    await store.setJSON(orderRef, orderRecord);
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: `Could not save order: ${err.message}` }) };
  }

  try {
    const resp = await fetch(`${SQUARE_API_BASE}/v2/online-checkout/payment-links`, {
      method: "POST",
      headers: {
        "Square-Version": "2024-01-18",
        Authorization: `Bearer ${SQUARE_ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        idempotency_key: orderRef,
        order: {
          location_id: SQUARE_LOCATION_ID,
          line_items: validatedItems,
          metadata: { orderRef },
        },
        checkout_options: {
          redirect_url: process.env.SQUARE_REDIRECT_URL || undefined,
        },
        pre_populated_data: {
          buyer_email: parentEmail,
        },
      }),
    });

    const data = await resp.json();

    if (!resp.ok) {
      return { statusCode: resp.status, body: JSON.stringify({ error: data }) };
    }

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ checkoutUrl: data.payment_link.url }),
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
