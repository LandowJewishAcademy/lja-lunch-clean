// netlify/functions/get-deleted-orders.mjs
//
// Returns every order in the "deleted-orders" archive, for the staff
// page's "Deleted orders" tab. Mirrors get-orders.mjs's approach (fetch
// everything in parallel, not one at a time).

import { getDeletedOrdersStore } from "./_shared/ordersStore.mjs";

export const handler = async function (event) {
  if (event.httpMethod !== "GET") {
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

  let orders;
  try {
    const store = getDeletedOrdersStore();
    const { blobs } = await store.list();
    const records = await Promise.all(blobs.map(b => store.get(b.key, { type: "json" })));
    orders = records.filter(Boolean);
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }

  orders.sort((a, b) => new Date(b.deletedAt) - new Date(a.deletedAt));

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ orders }),
  };
};
