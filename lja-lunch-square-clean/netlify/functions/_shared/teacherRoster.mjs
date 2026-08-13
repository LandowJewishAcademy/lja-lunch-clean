// netlify/functions/_shared/teacherRoster.mjs
//
// K-5 teacher roster for the daily "who ordered lunch" email. Grades here
// use short labels (K, 1st, 2nd...) — GRADE_LABEL_TO_FULL translates those
// to the exact grade strings stored on each order (e.g. "1st Grade").
//
// To update staff (new hire, grade change, etc.), just edit this list —
// nothing else needs to change.

export const TEACHERS = [
  { name: "Judy Weinberg",       email: "Jweinberg@ljaonline.com", grades: ["K"] },
  { name: "Taly Liberman",       email: "TLiberman@ljaonline.com", grades: ["K"] },
  { name: "Danielle Green",      email: "DGreen@ljaonline.com",    grades: ["1st"] },
  { name: "Orrel Biton",         email: "Obiton@ljaonline.com",    grades: ["1st"] },
  { name: "Ella Smith",          email: "ESmith@ljaonline.com",    grades: ["2nd"] },
  { name: "Yisroel Lavrinoff",   email: "YLavrinoff@ljaonline.com",grades: ["2nd"] },
  { name: "Elisa Valentin",      email: "Evalentin@ljaonline.com", grades: ["3rd"] },
  { name: "Solomon Dahari",      email: "SDahari@LJAonline.com",   grades: ["3rd"] },
  { name: "Abigail Treasure",    email: "ATreasure@ljaonline.com", grades: ["3rd", "5th"] },
  { name: "Jacob Albert",        email: "JAlbert@ljaonline.com",   grades: ["4th"] },
  { name: "Lissette Torres",     email: "LTorres@ljaonline.com",   grades: ["4th"] },
  { name: "Shameka Lewis",       email: "SLewis@ljaonline.com",    grades: ["5th"] },
  { name: "Yaakov Krasny",       email: "Ykrasny@ljaonline.com",   grades: ["5th"] },
];

// Short label -> exact grade string used in order records (must match
// the GRADES list in index.html and the staff page).
export const GRADE_LABEL_TO_FULL = {
  "K": "Kindergarten",
  "1st": "1st Grade",
  "2nd": "2nd Grade",
  "3rd": "3rd Grade",
  "4th": "4th Grade",
  "5th": "5th Grade",
};
