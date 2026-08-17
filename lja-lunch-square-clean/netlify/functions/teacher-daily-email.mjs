// netlify/functions/teacher-daily-email.mjs
//
// Runs automatically on a schedule (see the `config.schedule` export
// below) and emails each K-5 teacher a list of which of their students
// ordered lunch that day. Sends at 8:15 AM Eastern.
//
// WHY THIS RUNS EVERY ~10 MINUTES INSTEAD OF ONCE A DAY: cron schedules
// run in UTC, but "8:15 AM" in Florida shifts between UTC-5 (winter) and
// UTC-4 (summer) as Daylight Saving Time changes — a fixed UTC cron time
// would drift an hour off twice a year. Instead, this runs every 10
// minutes across a window that covers 8:15 AM Eastern in both cases, and
// the function itself checks the real Eastern-time clock and only
// actually sends once it's genuinely 8:15 AM (or just after) local time.
// A log entry in Netlify Blobs guarantees it only sends once per day
// even though the schedule fires multiple times during that window.
//
// Requires an email-sending account — see README for full setup.
// Required env vars: RESEND_API_KEY, TEACHER_EMAIL_FROM.

export const config = { schedule: "*/10 12,13 * * *" };

import { getOrdersStore, getTeacherEmailLogStore } from "./_shared/ordersStore.mjs";
import { OFF_DATES, SCHOOL_YEAR_START, SCHOOL_YEAR_END } from "./_shared/schoolCalendar.mjs";
import { TEACHERS, GRADE_LABEL_TO_FULL } from "./_shared/teacherRoster.mjs";

const EASTERN_TARGET_MINUTES = 8 * 60 + 15; // 8:15 AM

function nowEasternParts() {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
  });
  const parts = {};
  fmt.formatToParts(new Date()).forEach(p => { if (p.type !== "literal") parts[p.type] = p.value; });
  return parts;
}

function escapeHtml(s) {
  return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function sendEmail(to, subject, html) {
  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: process.env.TEACHER_EMAIL_FROM,
      to: [to],
      subject,
      html,
    }),
  });
  if (!resp.ok) {
    const data = await resp.json().catch(() => ({}));
    throw new Error(`Resend error for ${to}: ${JSON.stringify(data)}`);
  }
}

export default async () => {
  const parts = nowEasternParts();
  const todayIso = `${parts.year}-${parts.month}-${parts.day}`;
  const hour = parseInt(parts.hour, 10);
  const minute = parseInt(parts.minute, 10);
  const minuteOfDay = hour * 60 + minute;

  // Only actually run once it's genuinely 8:15 AM Eastern or just after —
  // the cron window runs a bit before that, so this guards against firing
  // too early.
  if (minuteOfDay < EASTERN_TARGET_MINUTES) {
    return new Response("Not yet 8:15 AM Eastern — skipping.", { status: 200 });
  }

  if (todayIso < SCHOOL_YEAR_START || todayIso > SCHOOL_YEAR_END || OFF_DATES.has(todayIso)) {
    return new Response(`${todayIso} is not a school day — skipping.`, { status: 200 });
  }

  const logStore = getTeacherEmailLogStore();
  const logKey = `sent-${todayIso}`;
  const alreadySent = await logStore.get(logKey, { type: "json" }).catch(() => null);
  if (alreadySent) {
    return new Response(`Already sent for ${todayIso} — skipping.`, { status: 200 });
  }

  // Pull every order, keep only paid items for today.
  let studentsByFullGrade = {}; // "1st Grade" -> [childName, childName, ...]
  try {
    const store = getOrdersStore();
    const { blobs } = await store.list();
    const records = await Promise.all(blobs.map(b => store.get(b.key, { type: "json" })));
    records.filter(Boolean).forEach(record => {
      if (record.status !== "paid") return;
      record.items.forEach(item => {
        if (item.dateId !== todayIso) return;
        const grade = item.grade || "Unspecified";
        if (!studentsByFullGrade[grade]) studentsByFullGrade[grade] = [];
        studentsByFullGrade[grade].push(item.childName);
      });
    });
    Object.values(studentsByFullGrade).forEach(list => list.sort((a, b) => a.localeCompare(b)));
  } catch (err) {
    console.error("Failed to load orders for teacher email:", err.message);
    return new Response(`Failed to load orders: ${err.message}`, { status: 500 });
  }

  const dateLabel = new Date(todayIso + "T00:00:00").toLocaleDateString("en-US", {
    weekday: "long", month: "long", day: "numeric",
  });

  const results = await Promise.allSettled(
    TEACHERS.map(teacher => {
      const sections = teacher.grades.map(shortGrade => {
        const fullGrade = GRADE_LABEL_TO_FULL[shortGrade];
        const students = studentsByFullGrade[fullGrade] || [];
        const list = students.length > 0
          ? `<ul>${students.map(name => `<li>${escapeHtml(name)}</li>`).join("")}</ul>`
          : `<p style="color:#5c6474; font-style:italic;">No students in ${escapeHtml(fullGrade)} ordered lunch today.</p>`;
        return `<h3 style="margin-top:18px; color:#16264a;">${escapeHtml(fullGrade)} (${students.length})</h3>${list}`;
      }).join("");

      const html = `
        <div style="font-family:-apple-system,Helvetica,Arial,sans-serif; max-width:500px;">
          <h2 style="color:#16264a; margin-bottom:2px;">Lion Cafe — Today's Lunch Orders</h2>
          <p style="color:#5c6474; margin-top:0;">${dateLabel}</p>
          <p>Hi ${escapeHtml(teacher.name.split(" ")[0])}, here's who ordered lunch today in your class${teacher.grades.length > 1 ? "es" : ""}:</p>
          ${sections}
        </div>
      `;

      return sendEmail(teacher.email, `Lunch Orders Today — ${dateLabel}`, html);
    })
  );

  const failures = results.filter(r => r.status === "rejected");
  failures.forEach(f => console.error("Teacher email failed:", f.reason && f.reason.message));

  // Mark as sent regardless of individual failures, so we don't spam
  // retries every 10 minutes for the rest of the hour. Check the function
  // logs if any addresses failed.
  await logStore.setJSON(logKey, {
    sentAt: new Date().toISOString(),
    successCount: results.length - failures.length,
    failureCount: failures.length,
  });

  return new Response(
    `Sent ${results.length - failures.length}/${results.length} teacher emails for ${todayIso}.`,
    { status: 200 }
  );
};
