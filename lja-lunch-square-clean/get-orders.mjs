// netlify/functions/get-orders.mjs
//
// Returns every order from Netlify Blobs for the staff webpage. Protected
// by a shared passcode (STAFF_ORDERS_PASSCODE env var) sent as the
// x-staff-passcode header. Fetches all order records IN PARALLEL rather
// than one at a time — with sequential fetches this got noticeably slower
// as the number of stored orders grew. The front-end fetches once and
// does its own date/grade filtering client-side, rather than asking this
// function for a filtered view on every interaction.

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

  let orders;
  try {
    const store = getOrdersStore();
    const { blobs } = await store.list();
    const records = await Promise.all(blobs.map(b => store.get(b.key, { type: "json" })));
    orders = records.filter(Boolean);
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
