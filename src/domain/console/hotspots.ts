export const campusHotspot = {
  code: "campus_hot",
  label: "TOP · 校园热点",
} as const;

export type CampusHotspotItem = {
  id: string;
  source_id: string;
  source_name: string;
  title: string;
  published_at: string | null;
};
