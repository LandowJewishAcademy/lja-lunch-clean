// netlify/functions/check-orders.mjs
//
// Lets a parent check "did I already order?" using just their phone
// number — no login. This is intentionally low-friction for parents who
// may not reliably check email, but that means it's also not strongly
// authenticated: anyone who knows a phone number can see that family's
// orders for THE CURRENT ORDERING WEEK (child names, days, items,
// payment status) — deliberately scoped to just this week, both to keep
// the search fast (no need to scan unrelated weeks) and to limit how
// much this endpoint can leak. It does NOT expose payment details, email,
// or the phone number itself back to the caller.

import { getOrdersStore } from "./_shared/ordersStore.mjs";
import { getCurrentOrderingWeekBounds } from "./_shared/schoolCalendar.mjs";

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

  try {
    const store = getOrdersStore();
    const { blobs } = await store.list();
    const records = await Promise.all(blobs.map(b => store.get(b.key, { type: "json" })));

    const matches = [];
    for (const record of records) {
      if (!record || record.parentPhone !== phoneDigits) continue;

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

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orders: matches, weekStartIso: startIso, weekEndIso: endIso }),
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
