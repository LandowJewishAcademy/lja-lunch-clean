// netlify/functions/admin-daily-summary.mjs
//
// Runs each school day at 8:10 AM Eastern (same schedule/logic as the
// teacher roster email) and emails administrators a PDF version of the
// daily summary — the same content as the "Print Daily Summary" button
// on the staff page, generated entirely server-side.
//
// Same DST-safe scheduling approach as teacher-daily-email.mjs — see
// that file's comments for the full explanation of why this runs every
// 10 minutes across a UTC window instead of once at a fixed UTC time.
//
// Required env vars: RESEND_API_KEY, TEACHER_EMAIL_FROM (reused — same
// sending address as the teacher email).

export const config = { schedule: "*/10 12,13 * * *" };

import { getOrdersStore, getTeacherEmailLogStore } from "./_shared/ordersStore.mjs";
import { OFF_DATES, SCHOOL_YEAR_START, SCHOOL_YEAR_END } from "./_shared/schoolCalendar.mjs";
import { GRADES, BANDS } from "./_shared/gradesList.mjs";
import { ADMIN_RECIPIENTS } from "./_shared/adminRecipients.mjs";
import { buildDailySummaryPdf } from "./_shared/dailySummaryPdf.mjs";

const EASTERN_TARGET_MINUTES = 8 * 60 + 10; // 8:10 AM, same as the teacher email

function nowEasternParts() {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
  });
  const parts = {};
  fmt.formatToParts(new Date()).forEach(p => { if (p.type !== "literal") parts[p.type] = p.value; });
  return parts;
}

function bytesToBase64(bytes) {
  return Buffer.from(bytes).toString("base64");
}

async function sendEmailWithAttachment(to, subject, html, pdfBytes, filename) {
  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: process.env.TEACHER_EMAIL_FROM,
      to,
      subject,
      html,
      attachments: [{ filename, content: bytesToBase64(pdfBytes) }],
    }),
  });
  if (!resp.ok) {
    const data = await resp.json().catch(() => ({}));
    throw new Error(`Resend error: ${JSON.stringify(data)}`);
  }
}

export default async () => {
  const parts = nowEasternParts();
  const todayIso = `${parts.year}-${parts.month}-${parts.day}`;
  const hour = parseInt(parts.hour, 10);
  const minute = parseInt(parts.minute, 10);
  const minuteOfDay = hour * 60 + minute;

  if (minuteOfDay < EASTERN_TARGET_MINUTES) {
    return new Response("Not yet 8:10 AM Eastern — skipping.", { status: 200 });
  }

  if (todayIso < SCHOOL_YEAR_START || todayIso > SCHOOL_YEAR_END || OFF_DATES.has(todayIso)) {
    return new Response(`${todayIso} is not a school day — skipping.`, { status: 200 });
  }

  const logStore = getTeacherEmailLogStore();
  const logKey = `admin-summary-sent-${todayIso}`;
  const alreadySent = await logStore.get(logKey, { type: "json" }).catch(() => null);
  if (alreadySent) {
    return new Response(`Already sent for ${todayIso} — skipping.`, { status: 200 });
  }

  // --- Gather today's orders (mirrors the staff page's printDayReport logic) ---
  let dayName = "";
  let totalRevenueCents = 0;
  const itemCounts = {};
  const byGrade = {};
  const pendingChildren = [];

  try {
    const store = getOrdersStore();
    const { blobs } = await store.list();
    const records = await Promise.all(blobs.map(b => store.get(b.key, { type: "json" })));

    records.filter(Boolean).forEach(record => {
      record.items.forEach(item => {
        if (item.dateId !== todayIso) return;
        dayName = item.dayName;

        if (record.status === "paid") {
          totalRevenueCents += item.amountCents;
          itemCounts[item.item] = (itemCounts[item.item] || 0) + 1;
          const grade = item.grade || "Unspecified";
          if (!byGrade[grade]) byGrade[grade] = [];
          byGrade[grade].push({ childName: item.childName, parentName: record.parentName, item: item.item });
        } else {
          pendingChildren.push({ childName: item.childName, grade: item.grade || "Unspecified", parentName: record.parentName });
        }
      });
    });
  } catch (err) {
    console.error("Failed to load orders for admin summary:", err.message);
    return new Response(`Failed to load orders: ${err.message}`, { status: 500 });
  }

  const gradeOrder = GRADES.filter(g => byGrade[g]);
  if (byGrade["Unspecified"]) gradeOrder.push("Unspecified");
  gradeOrder.forEach(g => byGrade[g].sort((a, b) => a.childName.localeCompare(b.childName)));
  const grandTotal = gradeOrder.reduce((sum, g) => sum + byGrade[g].length, 0);

  const bandTotals = {};
  Object.entries(BANDS).forEach(([label, grades]) => {
    bandTotals[label] = grades.reduce((sum, g) => sum + (byGrade[g] ? byGrade[g].length : 0), 0);
  });

  if (!dayName) {
    // No orders reference today at all (e.g. a school day with zero orders) —
    // still worth sending an (empty) summary so admins know it ran.
    dayName = new Date(todayIso + "T00:00:00").toLocaleDateString("en-US", { weekday: "long" });
  }

  let pdfBytes;
  try {
    pdfBytes = await buildDailySummaryPdf({
      dayName, dateIso: todayIso, byGrade, gradeOrder, itemCounts,
      totalRevenueCents, grandTotal, bandTotals, pendingChildren,
    });
  } catch (err) {
    console.error("Failed to build admin summary PDF:", err.message);
    return new Response(`Failed to build PDF: ${err.message}`, { status: 500 });
  }

  const dateLabel = new Date(todayIso + "T00:00:00").toLocaleDateString("en-US", {
    weekday: "long", month: "long", day: "numeric",
  });

  try {
    await sendEmailWithAttachment(
      ADMIN_RECIPIENTS,
      `Lion Cafe Daily Summary \u2014 ${dateLabel}`,
      `<p style="font-family:-apple-system,Helvetica,Arial,sans-serif;">Attached is today's Lion Cafe lunch order summary (${dateLabel}): ${grandTotal} paid orders, $${(totalRevenueCents / 100).toFixed(2)} in revenue.</p>`,
      pdfBytes,
      `lion-cafe-summary-${todayIso}.pdf`
    );
  } catch (err) {
    console.error("Failed to send admin summary email:", err.message);
    return new Response(`Failed to send email: ${err.message}`, { status: 500 });
  }

  await logStore.setJSON(logKey, { sentAt: new Date().toISOString(), recipientCount: ADMIN_RECIPIENTS.length });

  return new Response(`Admin daily summary sent for ${todayIso}.`, { status: 200 });
};
