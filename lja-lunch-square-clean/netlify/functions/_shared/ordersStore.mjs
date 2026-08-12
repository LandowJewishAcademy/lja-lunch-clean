// netlify/functions/_shared/ordersStore.mjs
//
// Netlify Blobs can auto-configure itself in some deploy setups, but not
// this one — it needs an explicit site ID + access token. Both come from
// environment variables (set in Netlify): NETLIFY_SITE_ID and
// NETLIFY_BLOBS_TOKEN. See README for exactly where to find/create these.

import { getStore } from "@netlify/blobs";

export function getOrdersStore() {
  const siteID = process.env.NETLIFY_SITE_ID;
  const token = process.env.NETLIFY_BLOBS_TOKEN;

  if (!siteID || !token) {
    throw new Error(
      "Missing NETLIFY_SITE_ID or NETLIFY_BLOBS_TOKEN environment variables — see README section on Netlify Blobs setup."
    );
  }

  return getStore({ name: "orders", siteID, token });
}
