export const APP = {
  name: "广外通 CampusOS",
  version: "0.1.0",
  origin: process.env.NEXT_PUBLIC_APP_URL || "https://gdufs.ccwu.cc",
  campusId: "gdufs_university_town",
  campusName: "广外大学城校区",
} as const;

// Server availability is separate from per-browser SDK rendering (MapContext.status).
export const CAPABILITIES = {
  map: {
    available: false,
    implemented: true,
    status: "client_sdk_render_check_required",
  },
  places: { available: true, status: "source_mapped_entrances_pending" },
  routes: {
    available: false,
    implemented: true,
    status: "client_walking_only_verified_network_pending",
  },
  agent: { available: false, status: "pending_integration" },
  knowledge: { available: false, status: "pending_verified_sources" },
  events: { available: false, status: "pending_verified_sources" },
  auth: { available: false, status: "pending_sms_service" },
} as const;
