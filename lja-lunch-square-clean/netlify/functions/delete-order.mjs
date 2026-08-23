// netlify/functions/delete-order.mjs
//
// Removes one order from the active "orders" store — it stops appearing
// in the staff order table, kitchen prep counts, teacher emails, and the
// admin summary — but the record itself is moved to a separate
// "deleted-orders" archive rather than being erased, so there's always a
// record of what was removed, when, and why. View it on the staff page's
// "Deleted orders" tab.
//
// This does NOT touch Square or issue any refund — it only affects our
// own stored record. Refunding in Square is a separate, manual step that
// must be done first (or this just archives bookkeeping without the
// money having moved back).
//
// Requires TWO passwords: the regular staff passcode (to be on the page
// at all) PLUS a separate delete-specific password, checked here on the
// server — so this isn't just a client-side prompt that anyone calling
// the API directly could skip.

const DELETE_PASSWORD = "Landrew613";

import { getOrdersStore, getDeletedOrdersStore } from "./_shared/ordersStore.mjs";

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

  const { orderRef, deletePassword } = payload;
  if (!deletePassword || deletePassword !== DELETE_PASSWORD) {
    return { statusCode: 401, body: JSON.stringify({ error: "Incorrect delete password." }) };
  }
  if (!orderRef) {
    return { statusCode: 400, body: JSON.stringify({ error: "Missing orderRef." }) };
  }

  try {
    const ordersStore = getOrdersStore();
    const existing = await ordersStore.get(orderRef, { type: "json" }).catch(() => null);
    if (!existing) {
      return { statusCode: 404, body: JSON.stringify({ error: "No order found with that reference." }) };
    }

    const archivedRecord = { ...existing, deletedAt: new Date().toISOString() };
    const deletedStore = getDeletedOrdersStore();
    await deletedStore.setJSON(orderRef, archivedRecord);
    await ordersStore.delete(orderRef);

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deleted: true, orderRef }),
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
