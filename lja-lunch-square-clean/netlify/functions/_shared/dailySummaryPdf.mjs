// netlify/functions/_shared/dailySummaryPdf.mjs
//
// Builds the daily summary PDF entirely server-side using pdf-lib (pure
// JS, no headless browser needed — deliberately avoided given how much
// trouble a heavier dependency caused earlier in this project). Mirrors
// the same content as the "Print Daily Summary" button on the staff
// page: stats, grade-band totals, kitchen prep counts, totals by grade,
// and a full student list per grade, plus a flagged list of anyone whose
// payment never completed.

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const NAVY = rgb(0.086, 0.149, 0.290);
const GRAY = rgb(0.36, 0.40, 0.45);
const RED = rgb(0.63, 0.24, 0.24);
const BLACK = rgb(0.09, 0.13, 0.20);

const PAGE_WIDTH = 612;  // US Letter, points
const PAGE_HEIGHT = 792;
const MARGIN = 50;

export async function buildDailySummaryPdf({
  dayName, dateIso, byGrade, gradeOrder, itemCounts,
  totalRevenueCents, grandTotal, bandTotals, pendingChildren,
}) {
  const doc = await PDFDocument.create();
  const fontRegular = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const fontItalic = await doc.embedFont(StandardFonts.HelveticaOblique);

  let page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let y = PAGE_HEIGHT - MARGIN;

  function ensureSpace(neededHeight) {
    if (y - neededHeight < MARGIN) {
      page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
      y = PAGE_HEIGHT - MARGIN;
    }
  }

  function line(text, { size = 11, font = fontRegular, color = BLACK, x = MARGIN, gap = 16 } = {}) {
    ensureSpace(gap);
    page.drawText(text, { x, y: y - size, size, font, color });
    y -= gap;
  }

  function spacer(h) { y -= h; }

  function rule() {
    ensureSpace(10);
    page.drawLine({
      start: { x: MARGIN, y: y - 2 },
      end: { x: PAGE_WIDTH - MARGIN, y: y - 2 },
      thickness: 1.2,
      color: NAVY,
    });
    y -= 12;
  }

  // --- Title ---
  line("Lion Cafe \u2014 Daily Summary", { size: 20, font: fontBold, color: NAVY, gap: 26 });
  line(`${dayName}, ${dateIso}`, { size: 11, color: GRAY, gap: 24 });

  // --- Top stats ---
  line(`Paid orders: ${grandTotal}     Revenue: $${(totalRevenueCents / 100).toFixed(2)}     Grades ordering: ${gradeOrder.length}`,
    { size: 11, font: fontBold, color: NAVY, gap: 18 });
  if (pendingChildren.length > 0) {
    line(`Unpaid / incomplete (not counted above): ${pendingChildren.length}`, { size: 11, font: fontBold, color: RED, gap: 20 });
  } else {
    spacer(6);
  }
  rule();

  // --- Grade bands ---
  line("Totals by grade band", { size: 13, font: fontBold, color: NAVY, gap: 18 });
  line(`K\u20135: ${bandTotals["K\u20135"] || 0}     6\u20138: ${bandTotals["6\u20138"] || 0}     9\u201312: ${bandTotals["9\u201312"] || 0}`,
    { size: 11, gap: 22 });

  // --- Items needed ---
  line("Items needed (kitchen prep)", { size: 13, font: fontBold, color: NAVY, gap: 18 });
  const itemEntries = Object.entries(itemCounts);
  if (itemEntries.length === 0) {
    line("No paid orders today.", { size: 10, font: fontItalic, color: GRAY, gap: 16 });
  } else {
    itemEntries.forEach(([item, count]) => line(`${item}: ${count}`, { size: 11, gap: 15 }));
  }
  spacer(8);

  // --- Totals by grade ---
  line("Totals by grade", { size: 13, font: fontBold, color: NAVY, gap: 18 });
  gradeOrder.forEach(g => line(`${g}: ${byGrade[g].length}`, { size: 11, gap: 15 }));
  spacer(10);
  rule();

  // --- Students by grade ---
  line("Students by grade", { size: 14, font: fontBold, color: NAVY, gap: 20 });
  gradeOrder.forEach(g => {
    ensureSpace(24);
    line(`${g} (${byGrade[g].length})`, { size: 12, font: fontBold, color: NAVY, gap: 16 });
    byGrade[g].forEach(s => {
      line(`\u2022 ${s.childName}  \u2014  ${s.parentName}`, { size: 10, gap: 13 });
    });
    spacer(8);
  });

  // --- Pending / unpaid ---
  if (pendingChildren.length > 0) {
    spacer(6);
    rule();
    line(`Not confirmed \u2014 payment incomplete (${pendingChildren.length})`, { size: 13, font: fontBold, color: RED, gap: 16 });
    line("These started an order but never finished paying \u2014 do not count in prep above.", { size: 9, font: fontItalic, color: GRAY, gap: 16 });
    pendingChildren.forEach(s => {
      line(`\u2022 ${s.childName} (${s.grade}) \u2014 ${s.parentName}`, { size: 10, gap: 13 });
    });
  }

  return doc.save(); // Uint8Array
}
