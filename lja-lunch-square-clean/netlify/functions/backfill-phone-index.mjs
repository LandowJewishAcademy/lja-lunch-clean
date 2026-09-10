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
//
// Each record's read+write happens together, in one pass, in parallel
// batches — an earlier version did a full read pass across every order
// THEN a full separate write pass, which doubled the number of
// sequential round-trips needed and (combined with real network
// latency being higher than expected) pushed total time past Netlify's
// function timeout, returning a 502. This version does roughly half
// the round trips for the same work.

import { getOrdersStore, getPhoneIndexStore } from "./_shared/ordersStore.mjs";

const BATCH_SIZE = 75;

async function processInBatches(items, batchSize, fn) {
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    await Promise.all(batch.map(fn));
  }
}

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
  let errorCount = 0;

  try {
    const { blobs } = await ordersStore.list();

    // One pass: for each order, read it and (if valid) write its index
    // entry, all within the same batched step — not two separate full
    // passes over every record.
    await processInBatches(blobs, BATCH_SIZE, async (b) => {
      try {
        const record = await ordersStore.get(b.key, { type: "json" });
        if (!record || !record.parentPhone || !record.orderRef) {
          skippedCount++;
          return;
        }
        await phoneIndexStore.setJSON(`${record.parentPhone}/${record.orderRef}`, { orderRef: record.orderRef });
        indexedCount++;
      } catch (err) {
        // One bad record shouldn't take down the whole batch.
        console.error(`Failed to index ${b.key}:`, err.message);
        errorCount++;
      }
    });
  } catch (err) {
    return { statusCode: 500, body: `Error: ${err.message}` };
  }

  return {
    statusCode: 200,
    body: `Backfill complete. Indexed ${indexedCount} orders, skipped ${skippedCount} (missing phone number), ${errorCount} individual errors. The phone lookup should be fast now.`,
  };
};
