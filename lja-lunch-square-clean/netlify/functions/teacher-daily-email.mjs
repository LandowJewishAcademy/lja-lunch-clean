// netlify/functions/teacher-daily-email.mjs
//
// ⚠️ TEMPORARY ONE-DAY TEST — sends a simple "you're subscribed"
// confirmation message to each teacher at 1:42 PM today, instead of the
// real daily lunch roster. This is just to verify email delivery itself
// works (right sender address, right recipients, actually lands in
// inboxes) before trusting it with real roster data tomorrow.
//
// REVERT THIS FILE TO THE REAL 8:10 AM ROSTER VERSION before tomorrow
// morning — this version does not send the actual lunch list.
//
// Required env vars: RESEND_API_KEY, TEACHER_EMAIL_FROM.

export const config = { schedule: "* 17,18 * * *" };

import { getTeacherEmailLogStore } from "./_shared/ordersStore.mjs";
import { TEACHERS, GRADE_LABEL_TO_FULL } from "./_shared/teacherRoster.mjs";

const EASTERN_TARGET_MINUTES = 13 * 60 + 42; // TEMPORARY: 1:42 PM today only

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
    body: JSON.stringify({ from: process.env.TEACHER_EMAIL_FROM, to: [to], subject, html }),
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

  if (minuteOfDay < EASTERN_TARGET_MINUTES) {
    return new Response("Not yet 1:42 PM Eastern — skipping.", { status: 200 });
  }

  const logStore = getTeacherEmailLogStore();
  const logKey = `subscribe-test-${todayIso}`;
  const alreadySent = await logStore.get(logKey, { type: "json" }).catch(() => null);
  if (alreadySent) {
    return new Response(`Subscription test already sent for ${todayIso} — skipping.`, { status: 200 });
  }

  const results = await Promise.allSettled(
    TEACHERS.map(teacher => {
      const gradeNames = teacher.grades.map(g => GRADE_LABEL_TO_FULL[g]).join(" and ");
      const firstName = escapeHtml(teacher.name.split(" ")[0]);
      const html = `
        <div style="font-family:-apple-system,Helvetica,Arial,sans-serif; max-width:500px;">
          <h2 style="color:#16264a; margin-bottom:8px;">Lion Cafe — Subscription Confirmed</h2>
          <p>Hi ${firstName}, you are now subscribed to the daily lunch roster for your class grade${teacher.grades.length > 1 ? "s" : ""}: <strong>${escapeHtml(gradeNames)}</strong>.</p>
          <p style="color:#5c6474; font-size:13px;">Starting tomorrow, you'll receive an email each school morning listing which of your students ordered lunch that day. This message is just a one-time test to confirm delivery is working correctly.</p>
        </div>
      `;
      return sendEmail(teacher.email, "You're subscribed to the daily lunch roster", html);
    })
  );

  const failures = results.filter(r => r.status === "rejected");
  failures.forEach(f => console.error("Subscription test email failed:", f.reason && f.reason.message));

  await logStore.setJSON(logKey, {
    sentAt: new Date().toISOString(),
    successCount: results.length - failures.length,
    failureCount: failures.length,
  });

  return new Response(
    `Sent ${results.length - failures.length}/${results.length} subscription test emails for ${todayIso}.`,
    { status: 200 }
  );
};
