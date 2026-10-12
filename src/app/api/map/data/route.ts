import { withApi } from "@/lib/server/http";
import { campusData } from "@/features/campus-map/data/campus";
export const GET = withApi(() => campusData);
