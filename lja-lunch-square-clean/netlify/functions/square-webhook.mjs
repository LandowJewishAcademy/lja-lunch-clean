// netlify/functions/square-webhook.mjs
//
// Square calls this URL automatically whenever a payment completes (you
// configure this in the Square Developer Dashboard → Webhooks). It:
//   1. Verifies the request really came from Square (HMAC signature check).
//   2. Looks up which of our orders this payment belongs to (via the
//      orderRef we attached as order metadata when creating the link).
//   3. Marks that order "paid" in Netlify Blobs — the staff page (and its
//      CSV export) read straight from this.
//
// Required env vars: SQUARE_WEBHOOK_SIGNATURE_KEY, SQUARE_WEBHOOK_NOTIFICATION_URL
// (must exactly match the URL you register in the Square webhook subscription).

import crypto from "node:crypto";
import { getOrdersStore } from "./_shared/ordersStore.mjs";

function verifySignature(signatureKey, notificationUrl, rawBody, headerSignature) {
  if (!headerSignature) return false;
  const hmac = crypto.createHmac("sha256", signatureKey);
  hmac.update(notificationUrl + rawBody);
  const expected = hmac.digest("base64");
  // Constant-time-ish comparison
  return expected.length === headerSignature.length &&
    crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(headerSignature));
}

export const handler = async function (event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }

  const SIGNATURE_KEY = process.env.SQUARE_WEBHOOK_SIGNATURE_KEY;
  const NOTIFICATION_URL = process.env.SQUARE_WEBHOOK_NOTIFICATION_URL;
  const SQUARE_ACCESS_TOKEN = process.env.SQUARE_ACCESS_TOKEN;
  const SQUARE_API_BASE =
    process.env.SQUARE_ENV === "production"
      ? "https://connect.squareup.com"
      : "https://connect.squareupsandbox.com";

  if (!SIGNATURE_KEY || !NOTIFICATION_URL) {
    console.error("Webhook misconfigured: missing SQUARE_WEBHOOK_SIGNATURE_KEY or SQUARE_WEBHOOK_NOTIFICATION_URL.");
    return { statusCode: 500, body: "Server misconfigured" };
  }

  const headerSig =
    event.headers["x-square-hmacsha256-signature"] || event.headers["x-square-signature"];

  const signatureOk = verifySignature(SIGNATURE_KEY, NOTIFICATION_URL, event.body, headerSig);
  if (!signatureOk) {
    console.error("Square webhook signature verification failed.");
    return { statusCode: 401, body: "Invalid signature" };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: "Invalid JSON" };
  }

  const eventType = body.type;
  const payment = body.data && body.data.object && body.data.object.payment;

  // We only care about completed payments. Ack anything else so Square
  // doesn't keep retrying this notification.
  if (!payment || payment.status !== "COMPLETED" || !["payment.updated", "payment.created"].includes(eventType)) {
    return { statusCode: 200, body: "Ignored" };
  }

  if (!payment.order_id) {
    console.error("Completed payment has no order_id:", payment.id);
    return { statusCode: 200, body: "No order_id" };
  }

  let orderRef;
  try {
    const resp = await fetch(`${SQUARE_API_BASE}/v2/orders/${payment.order_id}`, {
      headers: {
        "Square-Version": "2024-01-18",
        Authorization: `Bearer ${SQUARE_ACCESS_TOKEN}`,
      },
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(JSON.stringify(data));
    orderRef = data.order && data.order.metadata && data.order.metadata.orderRef;
  } catch (err) {
    console.error("Failed to retrieve Square order:", err.message);
    return { statusCode: 200, body: "Could not retrieve order" };
  }

  if (!orderRef) {
    console.error("Square order had no orderRef metadata:", payment.order_id);
    return { statusCode: 200, body: "No orderRef" };
  }

  let store;
  let record;
  try {
    store = getOrdersStore();
    record = await store.get(orderRef, { type: "json" });
  } catch (err) {
    console.error("Failed to read order record:", err.message);
    record = null;
  }

  if (!record) {
    console.error("No local order record found for orderRef:", orderRef);
    return { statusCode: 200, body: "No matching local order" };
  }

  record.status = "paid";
  record.paidAt = new Date().toISOString();
  record.squarePaymentId = payment.id;

  try {
    await store.setJSON(orderRef, record);
  } catch (err) {
    console.error("Failed to update order record:", err.message);
  }

  return { statusCode: 200, body: "OK" };
};
