export const APP = {
  name: "广外通 CampusOS",
  version: "0.1.0",
  origin: process.env.NEXT_PUBLIC_APP_URL || "https://gdufs.ccwu.cc",
  campusId: "gdufs_university_town",
  campusName: "广外大学城校区",
} as const;

// Static local data is available; actual browser rendering remains MapContext.status.
export const CAPABILITIES = {
  map: {
    available: true,
    implemented: true,
    status: "local_osm_snapshot_browser_render_check_required",
  },
  places: { available: true, status: "source_mapped_entrances_pending" },
  routes: {
    available: true,
    implemented: true,
    status: "reviewed_local_campus_network",
  },
  agent: {
    available: false,
    implemented: true,
    status: "s2_c_real_agent",
  },
  knowledge: { available: false, status: "pending_verified_sources" },
  events: { available: false, status: "pending_verified_sources" },
  auth: { available: false, status: "pending_sms_service" },
} as const;
