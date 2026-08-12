// netlify/functions/check-orders.mjs
//
// Lets a parent check "did I already order?" using just their phone
// number — no login. This is intentionally low-friction for parents who
// may not reliably check email, but that means it's also not strongly
// authenticated: anyone who knows a phone number can see that family's
// upcoming orders (child names, days, items, payment status). It does
// NOT expose payment details, email, or the phone number itself back to
// the caller, and only returns TODAY-OR-LATER orders, never order
// history — deliberately limiting how much this endpoint can leak.

import { getOrdersStore } from "./_shared/ordersStore.mjs";
import { isoDate } from "./_shared/schoolCalendar.mjs";

export const handler = async function (event) {
  if (event.httpMethod !== "GET") {
    return { statusCode: 405, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  const rawPhone = (event.queryStringParameters && event.queryStringParameters.phone) || "";
  const phoneDigits = rawPhone.replace(/\D/g, "");

  if (phoneDigits.length < 10) {
    return { statusCode: 400, body: JSON.stringify({ error: "Enter a full phone number." }) };
  }

  const todayIso = isoDate(new Date());

  try {
    const store = getOrdersStore();
    const { blobs } = await store.list();

    const matches = [];
    for (const b of blobs) {
      const record = await store.get(b.key, { type: "json" });
      if (!record || record.parentPhone !== phoneDigits) continue;

      const upcomingItems = record.items.filter(i => i.dateId >= todayIso);
      if (upcomingItems.length === 0) continue;

      matches.push({
        status: record.status,
        items: upcomingItems.map(i => ({
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
      body: JSON.stringify({ orders: matches }),
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
