// netlify/functions/_shared/schoolCalendar.mjs
//
// Single source of truth for the backend: menu, prices, the 5:00 PM
// deadline rule, school-year bounds, and the no-school calendar. Must be
// kept in sync with the equivalent constants in index.html (the front-end
// copy exists so the form works instantly for parents; this copy is what
// actually gets enforced before any money moves).

export const MENU_BY_WEEKDAY = {
  1: { day: "Monday",    item: "Hot dog & onion rings",   price: 8.0 },
  2: { day: "Tuesday",   item: "Two slices of pizza",     price: 7.5 },
  3: { day: "Wednesday", item: "Burger & fries",          price: 8.0 },
  4: { day: "Thursday",  item: "Chicken nuggets & fries", price: 8.0 },
  5: { day: "Friday",    item: "Two slices of pizza",     price: 7.5 },
};

export const DEADLINE_HOUR = 17; // 5:00 PM the day before

// ---- 2026-2027 school year bounds ----
export const SCHOOL_YEAR_START = "2026-08-17"; // Mon, Aug 17, 2026 — first day (K-12)
export const SCHOOL_YEAR_END   = "2027-06-02"; // Tue, Jun 2, 2027 — last day of school

export function isoDate(d) {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, "0"), day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// ---- Days with no school, from the 2026-2027 LJA calendar ----
// Early-dismissal and special/note days are normal school days and are
// NOT listed here (see index.html for the full rationale).
export const OFF_DATES = new Set();
function addOffRange(y1, m1, d1, y2, m2, d2) {
  let cur = new Date(y1, m1 - 1, d1);
  const end = new Date(y2, m2 - 1, d2);
  while (cur <= end) {
    OFF_DATES.add(isoDate(cur));
    cur.setDate(cur.getDate() + 1);
  }
}
addOffRange(2026, 8, 5, 2026, 8, 5);     // Staff Reports (no students)
addOffRange(2026, 8, 13, 2026, 8, 13);   // Orientation only (before first day)
addOffRange(2026, 9, 21, 2026, 9, 21);   // Yom Kippur
addOffRange(2026, 9, 25, 2026, 10, 2);   // Sukkot Break (through "continues")
addOffRange(2026, 11, 26, 2026, 11, 27); // Thanksgiving
addOffRange(2026, 12, 7, 2026, 12, 7);   // Chanukah Break
addOffRange(2026, 12, 25, 2026, 12, 25); // Federal Holiday
addOffRange(2027, 1, 21, 2027, 1, 31);   // Winter Break
addOffRange(2027, 3, 23, 2027, 3, 23);   // Purim
addOffRange(2027, 4, 19, 2027, 4, 30);   // Pesach Break
addOffRange(2027, 5, 31, 2027, 5, 31);   // Memorial Day

export function deadlineFor(isoDateStr) {
  const lunchDate = new Date(isoDateStr + "T00:00:00");
  const deadline = new Date(lunchDate);
  deadline.setDate(deadline.getDate() - 1);
  deadline.setHours(DEADLINE_HOUR, 0, 0, 0);
  return deadline;
}

// Validates one { dateId } line item against the calendar/deadline rules.
// Returns { ok: true, menu } or { ok: false, status, error }.
export function validateLineItemDate(dateId, now = new Date()) {
  if (!dateId) return { ok: false, status: 400, error: "Line item missing dateId." };
  if (dateId < SCHOOL_YEAR_START || dateId > SCHOOL_YEAR_END) {
    return { ok: false, status: 400, error: `${dateId} is outside the 2026-2027 school year.` };
  }
  if (OFF_DATES.has(dateId)) {
    return { ok: false, status: 409, error: `${dateId} is a no-school day — lunch is not available.` };
  }
  const dow = new Date(dateId + "T00:00:00").getDay();
  const menu = MENU_BY_WEEKDAY[dow];
  if (!menu) return { ok: false, status: 400, error: `${dateId} is not a valid lunch day.` };
  const deadline = deadlineFor(dateId);
  if (now >= deadline) {
    return { ok: false, status: 409, error: `Ordering for ${dateId} closed at 5:00 PM the day before and is no longer available.` };
  }
  return { ok: true, menu };
}
