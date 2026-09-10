// netlify/functions/_shared/ordersStore.mjs
//
// Netlify Blobs can auto-configure itself in some deploy setups, but not
// this one — it needs an explicit site ID + access token. Both come from
// environment variables (set in Netlify): NETLIFY_SITE_ID and
// NETLIFY_BLOBS_TOKEN. See README for exactly where to find/create these.

import { getStore } from "@netlify/blobs";

function getNamedStore(name) {
  const siteID = process.env.NETLIFY_SITE_ID;
  const token = process.env.NETLIFY_BLOBS_TOKEN;

  if (!siteID || !token) {
    throw new Error(
      "Missing NETLIFY_SITE_ID or NETLIFY_BLOBS_TOKEN environment variables — see README section on Netlify Blobs setup."
    );
  }

  return getStore({ name, siteID, token });
}

export function getOrdersStore() {
  return getNamedStore("orders");
}

// Tracks which days the teacher email has already gone out for, so the
// scheduled function (which checks every ~10 minutes) never sends twice.
export function getTeacherEmailLogStore() {
  return getNamedStore("teacher-email-log");
}

// Archive for deleted orders — "delete" moves a record here instead of
// erasing it, so there's always a record of what was removed and when.
export function getDeletedOrdersStore() {
  return getNamedStore("deleted-orders");
}

// Archive for orders automatically moved out of the live "orders" store
// once they're old enough (see archive-old-orders.mjs). Kept separate
// from "deleted-orders" since these are ordinary completed orders that
// simply aged out — not cancellations or refunds.
export function getArchivedOrdersStore() {
  return getNamedStore("archived-orders");
}

// Lightweight index: key = "{phoneDigits}/{orderRef}", value = just the
// orderRef. Lets check-orders.mjs find a family's orders directly by
// phone number (via a prefix list) instead of scanning every order ever
// placed. New orders get indexed at checkout time (create-checkout.mjs);
// archive-old-orders.mjs also re-indexes every live order once a day,
// so older orders placed before this index existed get backfilled
// automatically within a day, with zero manual migration needed.
export function getPhoneIndexStore() {
  return getNamedStore("phone-index");
}

