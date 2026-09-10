// netlify/functions/archive-old-orders.mjs
//
// Runs once a day and moves any order whose items are ALL more than 2
// weeks in the past into the "archived-orders" store, removing it from
// the live "orders" store. Nothing is deleted — full order history is
// still viewable on the staff page's "Archived orders" tab — but every
// other function (get-orders, the phone lookup, teacher/admin emails)
// only has to scan the live store, which stays roughly bounded to the
// last few weeks of activity instead of growing for the entire school
// year. Without this, every one of those functions gets slower and
// slower as the year goes on, since none of them expire old data on
// their own.
//
// An order is only archived if EVERY item on it is more than 2 weeks
// old — if it has even one recent item, the whole order stays live.
//
// While it's already scanning every live order for archiving, it also
// re-writes each one's phone-index entry (see _shared/ordersStore.mjs)
// — cheap to do since the records are already fetched, and it means any
// order that somehow didn't get indexed at checkout time self-heals
// within a day, with no separate migration ever needed.
//
// Each record's read + reindex + (maybe) archive all happen together,
// in one pass, in parallel batches — an earlier version split reading
// and writing into two separate full passes, doubling the round trips
// needed and risking the same timeout that hit the manual backfill
// function (502 error). This version does roughly half the work.

export const config = { schedule: "0 9 * * *" }; // once daily, ~4-5am Eastern

import { getOrdersStore, getArchivedOrdersStore, getPhoneIndexStore } from "./_shared/ordersStore.mjs";

const ARCHIVE_AFTER_DAYS = 14;
const BATCH_SIZE = 75;

function easternTodayIso() {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric", month: "2-digit", day: "2-digit",
  });
  const parts = {};
  fmt.formatToParts(new Date()).forEach(p => { if (p.type !== "literal") parts[p.type] = p.value; });
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function isoDaysBefore(isoStr, days) {
  const [y, m, d] = isoStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() - days);
  const yy = dt.getUTCFullYear(), mm = String(dt.getUTCMonth() + 1).padStart(2, "0"), dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

async function processInBatches(items, batchSize, fn) {
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    await Promise.all(batch.map(fn));
  }
}

export default async () => {
  const cutoffIso = isoDaysBefore(easternTodayIso(), ARCHIVE_AFTER_DAYS);

  const ordersStore = getOrdersStore();
  const archiveStore = getArchivedOrdersStore();
  const phoneIndexStore = getPhoneIndexStore();

  let archivedCount = 0;
  let checkedCount = 0;
  let reindexedCount = 0;
  let errorCount = 0;

  try {
    const { blobs } = await ordersStore.list();
    checkedCount = blobs.length;

    // One pass per order: read, re-index, and (if old enough) archive —
    // all within the same batched step.
    await processInBatches(blobs, BATCH_SIZE, async (b) => {
      try {
        const record = await ordersStore.get(b.key, { type: "json" });
        if (!record || !Array.isArray(record.items) || record.items.length === 0) return;

        if (record.parentPhone && record.orderRef) {
          await phoneIndexStore.setJSON(`${record.parentPhone}/${record.orderRef}`, { orderRef: record.orderRef });
          reindexedCount++;
        }

        const allOld = record.items.every(item => item.dateId < cutoffIso);
        if (!allOld) return;

        const archived = { ...record, archivedAt: new Date().toISOString() };
        await archiveStore.setJSON(b.key, archived);
        await ordersStore.delete(b.key);
        archivedCount++;
      } catch (err) {
        console.error(`Failed to process ${b.key}:`, err.message);
        errorCount++;
      }
    });
  } catch (err) {
    console.error("Failed to archive old orders:", err.message);
    return new Response(`Error: ${err.message}`, { status: 500 });
  }

  return new Response(
    `Checked ${checkedCount} live orders, re-indexed ${reindexedCount} for phone lookup, archived ${archivedCount} with all items before ${cutoffIso}, ${errorCount} individual errors.`,
    { status: 200 }
  );
};
