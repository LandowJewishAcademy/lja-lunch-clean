// netlify/functions/get-archived-orders.mjs
//
// Returns every order in the "archived-orders" store (orders auto-moved
// there by archive-old-orders.mjs once all their items are 2+ weeks
// old), for the staff page's "Archived orders" tab. Same
// parallel-fetch pattern as get-orders.mjs and get-deleted-orders.mjs.

import { getArchivedOrdersStore } from "./_shared/ordersStore.mjs";

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
    const store = getArchivedOrdersStore();
    const { blobs } = await store.list();
    const records = await Promise.all(blobs.map(b => store.get(b.key, { type: "json" })));
    orders = records.filter(Boolean);
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }

  orders.sort((a, b) => new Date(b.archivedAt) - new Date(a.archivedAt));

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ orders }),
  };
};
