// netlify/functions/check-orders.mjs
//
// Lets a parent check "did I already order?" using just their phone
// number — no login. This is intentionally low-friction for parents who
// may not reliably check email, but that means it's also not strongly
// authenticated: anyone who knows a phone number can see that family's
// orders for THE CURRENT ORDERING WEEK (child names, days, items,
// payment status) — deliberately scoped to just this week. It does NOT
// expose payment details, email, or the phone number itself back to the
// caller.
//
// SPEED: this uses the phone-index (see _shared/ordersStore.mjs) to
// fetch only this specific family's orders, instead of scanning every
// order in the system. If the index has nothing for this phone number
// yet (e.g. an order placed before indexing existed, and neither the
// backfill nor a daily archive run has caught it yet), it falls back to
// a full scan as a safety net — slower, but correctness is never lost
// while the index catches up.

import { getOrdersStore, getPhoneIndexStore } from "./_shared/ordersStore.mjs";
import { getCurrentOrderingWeekBounds } from "./_shared/schoolCalendar.mjs";

function matchesToResponse(records, startIso, endIso) {
  const matches = [];
  for (const record of records) {
    if (!record) continue;
    const thisWeekItems = record.items.filter(i => i.dateId >= startIso && i.dateId <= endIso);
    if (thisWeekItems.length === 0) continue;
    matches.push({
      status: record.status,
      items: thisWeekItems.map(i => ({
        childName: i.childName,
        grade: i.grade,
        dateId: i.dateId,
        dayName: i.dayName,
        item: i.item,
      })),
    });
  }
  return matches;
}

export const handler = async function (event) {
  if (event.httpMethod !== "GET") {
    return { statusCode: 405, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  const rawPhone = (event.queryStringParameters && event.queryStringParameters.phone) || "";
  const phoneDigits = rawPhone.replace(/\D/g, "");

  if (phoneDigits.length < 10) {
    return { statusCode: 400, body: JSON.stringify({ error: "Enter a full phone number." }) };
  }

  const { startIso, endIso } = getCurrentOrderingWeekBounds();
  const ordersStore = getOrdersStore();

  try {
    // Fast path: look up this phone's specific orders via the index.
    const phoneIndexStore = getPhoneIndexStore();
    const { blobs: indexBlobs } = await phoneIndexStore.list({ prefix: `${phoneDigits}/` });

    if (indexBlobs.length > 0) {
      const indexEntries = await Promise.all(indexBlobs.map(b => phoneIndexStore.get(b.key, { type: "json" })));
      const orderRefs = indexEntries.filter(Boolean).map(e => e.orderRef);
      const records = await Promise.all(orderRefs.map(ref => ordersStore.get(ref, { type: "json" })));
      const matches = matchesToResponse(records, startIso, endIso);

      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orders: matches, weekStartIso: startIso, weekEndIso: endIso }),
      };
    }

    // Fallback: nothing indexed yet for this phone (order predates
    // indexing, and hasn't been backfilled yet) — scan everything, same
    // as before indexing existed. Correct, just slower.
    const { blobs } = await ordersStore.list();
    const allRecords = await Promise.all(blobs.map(b => ordersStore.get(b.key, { type: "json" })));
    const phoneRecords = allRecords.filter(r => r && r.parentPhone === phoneDigits);
    const matches = matchesToResponse(phoneRecords, startIso, endIso);

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orders: matches, weekStartIso: startIso, weekEndIso: endIso }),
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
