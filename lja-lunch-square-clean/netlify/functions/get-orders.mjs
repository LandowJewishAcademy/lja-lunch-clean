// netlify/functions/get-orders.mjs
//
// Returns the list of orders from Netlify Blobs for the staff webpage.
// Protected by a shared passcode (STAFF_ORDERS_PASSCODE env var) sent as
// the x-staff-passcode header — not bank-vault security, but enough to
// keep this off of Google and out of casual reach. Optional ?date=
// query param filters to orders containing at least one item for that day.

import { getOrdersStore } from "./_shared/ordersStore.mjs";

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

  const dateFilter = event.queryStringParameters && event.queryStringParameters.date; // "YYYY-MM-DD"

  const orders = [];
  try {
    const store = getOrdersStore();
    const { blobs } = await store.list();
    for (const b of blobs) {
      const record = await store.get(b.key, { type: "json" });
      if (!record) continue;
      if (dateFilter) {
        const matchingItems = record.items.filter(i => i.dateId === dateFilter);
        if (matchingItems.length === 0) continue;
        orders.push({ ...record, items: matchingItems });
      } else {
        orders.push(record);
      }
    }
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }

  orders.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ orders, generatedAt: new Date().toISOString() }),
  };
};
