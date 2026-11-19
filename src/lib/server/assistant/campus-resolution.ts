import { buildingPlaces } from "@/features/campus-map/data/building-groups";
type Campus = "university" | "baiyun";
function named(text: string) {
  return {
    baiyun: /白云山|北校区|北校|北校区图书馆/.test(text),
    university: /大学城|南校区|南校/.test(text),
  };
}
export function resolveCampus(
  question: string,
  map?: { campus?: Campus; selectedPlaceId?: string },
  previous?: string,
) {
  const explicit = named(question);
  const selected = buildingPlaces.find(
    (p) =>
      p.id === map?.selectedPlaceId &&
      (!map?.campus || map.campus === p.campus),
  );
  if (explicit.baiyun && explicit.university)
    return {
      campus: undefined,
      source: "both" as const,
      selectedPlaceId: undefined,
    };
  const prior = named(previous || "");
  const inherit = /那里|那边|刚才|那个校区|其中|这个校区|附近|按举办时间/.test(
    question,
  );
  const campus: Campus | undefined = explicit.baiyun
    ? "baiyun"
    : explicit.university
      ? "university"
      : (selected?.campus ??
        (inherit && prior.baiyun !== prior.university
          ? prior.baiyun
            ? "baiyun"
            : "university"
          : map?.campus));
  const source =
    explicit.baiyun || explicit.university
      ? "explicit"
      : selected
        ? "selection"
        : inherit && prior.baiyun !== prior.university
          ? "previous_turn"
          : map?.campus
            ? "map"
            : "unspecified";
  return {
    campus,
    source,
    selectedPlaceId: selected?.campus === campus ? selected?.id : undefined,
  };
}
