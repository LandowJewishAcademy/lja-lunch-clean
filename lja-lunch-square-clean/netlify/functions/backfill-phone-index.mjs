// netlify/functions/backfill-phone-index.mjs
//
// ONE-TIME USE: builds phone-index entries for every order that already
// exists in the live "orders" store. New orders get indexed
// automatically going forward (see create-checkout.mjs) — this is just
// to catch up on everything placed before that indexing existed, so the
// "Did I already order?" lookup gets fast immediately instead of
// waiting for the next scheduled archive-old-orders.mjs run (which also
// does this, but only once a day).
//
// Trigger it by visiting this URL directly in a browser, once:
//   https://YOUR-SITE.netlify.app/.netlify/functions/backfill-phone-index?passcode=YOUR_STAFF_PASSCODE
//
// Safe to run more than once — it just overwrites the same index
// entries, nothing gets duplicated or broken.

import { getOrdersStore, getPhoneIndexStore } from "./_shared/ordersStore.mjs";

export const handler = async function (event) {
  const PASSCODE = process.env.STAFF_ORDERS_PASSCODE;
  const provided = (event.queryStringParameters && event.queryStringParameters.passcode) || "";
  if (!PASSCODE || provided !== PASSCODE) {
    return { statusCode: 401, body: "Incorrect or missing ?passcode= in the URL." };
  }

  const ordersStore = getOrdersStore();
  const phoneIndexStore = getPhoneIndexStore();

  let indexedCount = 0;
  let skippedCount = 0;

  try {
    const { blobs } = await ordersStore.list();
    const records = await Promise.all(blobs.map(b => ordersStore.get(b.key, { type: "json" })));

    for (let i = 0; i < blobs.length; i++) {
      const record = records[i];
      if (!record || !record.parentPhone || !record.orderRef) {
        skippedCount++;
        continue;
      }
      await phoneIndexStore.setJSON(`${record.parentPhone}/${record.orderRef}`, { orderRef: record.orderRef });
      indexedCount++;
    }
  } catch (err) {
    return { statusCode: 500, body: `Error: ${err.message}` };
  }

  return {
    statusCode: 200,
    body: `Backfill complete. Indexed ${indexedCount} orders, skipped ${skippedCount} (missing phone number). The phone lookup should be fast now.`,
  };
};
