// netlify/functions/_shared/gradesList.mjs
//
// Full grade order (used for sorting/columns) and grade-band groupings,
// matching the GRADES list in staff/orders.html. If you ever add/remove
// a grade there (e.g. adding 6th grade PK, or a new elective track),
// update it here too so the admin PDF stays consistent.

export const GRADES = [
  "PK2", "PK3", "PK4", "Kindergarten",
  "1st Grade", "2nd Grade", "3rd Grade", "4th Grade", "5th Grade",
  "6th Grade", "7th Grade", "8th Grade",
  "9th Grade", "10th Grade", "11th Grade", "12th Grade",
];

export const BANDS = {
  "K\u20135": ["Kindergarten", "1st Grade", "2nd Grade", "3rd Grade", "4th Grade", "5th Grade"],
  "6\u20138": ["6th Grade", "7th Grade", "8th Grade"],
  "9\u201312": ["9th Grade", "10th Grade", "11th Grade", "12th Grade"],
};
