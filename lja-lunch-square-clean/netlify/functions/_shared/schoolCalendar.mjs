// netlify/functions/_shared/schoolCalendar.mjs
//
// Single source of truth for the backend: menu, prices, the 5:00 PM
// deadline rule, school-year bounds, and the no-school calendar. Must be
// kept in sync with the equivalent constants in index.html (the front-end
// copy exists so the form works instantly for parents; this copy is what
// actually gets enforced before any money moves).

export const MENU_BY_WEEKDAY = {
  1: { day: "Monday", options: [
    { name: "Chicken Lo Mein with Vegetables and Chinese Pasta", price: 8.50 },
    { name: "Oven-Roasted Turkey Wrap with Israeli Salad", price: 8.50 },
  ]},
  2: { day: "Tuesday", options: [
    { name: "California Roll", price: 8.50 },
    { name: "Avocado Roll", price: 8.50 },
    { name: "Two Slices of Pizza", price: 7.50 },
    { name: "Greek Salad", price: 8.50 },
    { name: "Caesar Salad", price: 8.50 },
  ]},
  3: { day: "Wednesday", options: [
    { name: "Pasta with Alfredo Sauce & Fruit Cup", price: 8.50 },
    { name: "Spaghetti with Marinara Sauce & Fruit Cup", price: 8.50 },
    { name: "Mac & Cheese & Fruit Cup", price: 8.50 },
  ]},
  4: { day: "Thursday", options: [
    { name: "Burger & Fries", price: 8.50 },
    { name: "Schnitzel & Israeli Salad", price: 8.50 },
  ]},
  5: { day: "Friday", options: [
    { name: "Two Slices of Pizza", price: 7.50 },
  ]},
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
addOffRange(2026, 8, 28, 2026, 8, 28);   // Unplanned closure (added Aug 24, 2026)
addOffRange(2026, 9, 11, 2026, 9, 11);   // No school Friday (added Sep 8, 2026)
addOffRange(2026, 9, 21, 2026, 9, 21);   // Yom Kippur
addOffRange(2026, 9, 25, 2026, 10, 2);   // Sukkot Break (through "continues")
addOffRange(2026, 11, 26, 2026, 11, 27); // Thanksgiving
addOffRange(2026, 12, 7, 2026, 12, 7);   // Chanukah Break
addOffRange(2026, 12, 25, 2026, 12, 25); // Federal Holiday
addOffRange(2027, 1, 21, 2027, 1, 31);   // Winter Break
addOffRange(2027, 3, 23, 2027, 3, 23);   // Purim
addOffRange(2027, 4, 19, 2027, 4, 30);   // Pesach Break
addOffRange(2027, 5, 31, 2027, 5, 31);   // Memorial Day

// Converts a wall-clock time meant as "America/New_York local time" into
// the correct UTC instant, accounting for Daylight Saving Time. This is
// necessary because Netlify's servers run in UTC, not Eastern — without
// this, "5:00 PM" would silently mean 5:00 PM UTC (1:00 PM Eastern in
// summer, noon in winter), locking parents out hours earlier than
// intended. (This was a real bug, fixed here.)
function easternWallTimeToUTC(y, m, d, hh, mm, ss = 0) {
  const guessUTC = new Date(Date.UTC(y, m - 1, d, hh, mm, ss));
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  });
  const parts = {};
  fmt.formatToParts(guessUTC).forEach(p => { if (p.type !== "literal") parts[p.type] = p.value; });
  const shownAsUTC = Date.UTC(
    parseInt(parts.year, 10), parseInt(parts.month, 10) - 1, parseInt(parts.day, 10),
    parseInt(parts.hour, 10), parseInt(parts.minute, 10), parseInt(parts.second, 10)
  );
  const correction = guessUTC.getTime() - shownAsUTC;
  return new Date(guessUTC.getTime() + correction);
}

export function deadlineFor(isoDateStr) {
  const [y, m, d] = isoDateStr.split("-").map(Number);
  const dayBeforeUTC = new Date(Date.UTC(y, m - 1, d));
  dayBeforeUTC.setUTCDate(dayBeforeUTC.getUTCDate() - 1);
  return easternWallTimeToUTC(
    dayBeforeUTC.getUTCFullYear(), dayBeforeUTC.getUTCMonth() + 1, dayBeforeUTC.getUTCDate(),
    DEADLINE_HOUR, 0, 0
  );
}

// Validates one { dateId, optionIndex } line item against the calendar,
// deadline, and menu-choice rules. Returns { ok: true, menu } (where menu
// = { day, item, price } for the CHOSEN option) or { ok: false, status, error }.
export function validateLineItemDate(dateId, optionIndex, now = new Date()) {
  if (!dateId) return { ok: false, status: 400, error: "Line item missing dateId." };
  if (dateId < SCHOOL_YEAR_START || dateId > SCHOOL_YEAR_END) {
    return { ok: false, status: 400, error: `${dateId} is outside the 2026-2027 school year.` };
  }
  if (OFF_DATES.has(dateId)) {
    return { ok: false, status: 409, error: `${dateId} is a no-school day — lunch is not available.` };
  }
  const dow = new Date(dateId + "T00:00:00").getDay();
  const dayMenu = MENU_BY_WEEKDAY[dow];
  if (!dayMenu) return { ok: false, status: 400, error: `${dateId} is not a valid lunch day.` };

  const idx = Number.isInteger(optionIndex) ? optionIndex : parseInt(optionIndex, 10);
  const option = Number.isInteger(idx) ? dayMenu.options[idx] : undefined;
  if (!option) return { ok: false, status: 400, error: `Invalid menu choice for ${dateId}.` };

  const deadline = deadlineFor(dateId);
  if (now >= deadline) {
    return { ok: false, status: 409, error: `Ordering for ${dateId} closed at 5:00 PM the day before and is no longer available.` };
  }
  return { ok: true, menu: { day: dayMenu.day, item: option.name, price: option.price } };
}
