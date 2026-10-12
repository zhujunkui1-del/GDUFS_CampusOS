import { withApi } from "@/lib/server/http";
import {
  campusData,
  searchCampusPlaces,
} from "@/features/campus-map/data/campus";
import { z } from "zod";
export const dynamic = "force-dynamic";
export const GET = withApi((request) => {
  const url = new URL(request.url);
  const query = z
    .string()
    .max(100)
    .parse(url.searchParams.get("q") || "");
  return {
    places: searchCampusPlaces(query).slice(0, 100),
    attribution: campusData.attribution,
    license: campusData.license,
    sourceUrl: campusData.sourceUrl,
    source:
      "OSM source-mapped geometry; entrances and walkability are not verified",
  };
});
