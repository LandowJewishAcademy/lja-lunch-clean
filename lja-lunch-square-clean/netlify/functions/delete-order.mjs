// netlify/functions/delete-order.mjs
//
// Deletes one order record permanently from Netlify Blobs. Used when an
// order was refunded directly in Square (e.g. a menu change made the
// original order invalid) and should no longer appear anywhere in the
// system — staff reports, teacher emails, kitchen prep counts, etc.
//
// This does NOT touch Square or issue any refund — it only removes our
// own stored record. Refunding in Square is a separate, manual step that
// must be done first (or this just deletes bookkeeping without the money
// having moved back).
//
// Protected by the same STAFF_ORDERS_PASSCODE used for the staff page.

import { getOrdersStore } from "./_shared/ordersStore.mjs";

export const handler = async function (event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  const PASSCODE = process.env.STAFF_ORDERS_PASSCODE;
  if (!PASSCODE) {
    return { statusCode: 500, body: JSON.stringify({ error: "Server is missing STAFF_ORDERS_PASSCODE." }) };
  }
  const provided = event.headers["x-staff-passcode"];
  if (!provided || provided !== PASSCODE) {
    return { statusCode: 401, body: JSON.stringify({ error: "Incorrect passcode." }) };
  }

  let payload;
  try {
    payload = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: "Invalid request body." }) };
  }

  const { orderRef } = payload;
  if (!orderRef) {
    return { statusCode: 400, body: JSON.stringify({ error: "Missing orderRef." }) };
  }

  try {
    const store = getOrdersStore();
    const existing = await store.get(orderRef, { type: "json" }).catch(() => null);
    if (!existing) {
      return { statusCode: 404, body: JSON.stringify({ error: "No order found with that reference." }) };
    }
    await store.delete(orderRef);
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deleted: true, orderRef }),
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
