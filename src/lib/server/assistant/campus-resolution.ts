import { buildingPlaces } from "@/features/campus-map/data/building-groups";
type Campus = "university" | "baiyun";
// 「不要把白云山校区的图书馆混进来」「不是白云山校区那个」「不要查询北校区」
// name the other campus only to exclude it. Counting it as a request for both
// campuses made every long question that mentions the second campus while
// asking for one route answer “两校区之间没有步行路线”.
const EXCLUSION = /(?:不要|不需要|不用|别|不是|排除|除了|不查询|不含|不含|除掉)/;
function excluded(text: string) {
  const stripped = text
    .split(/[，,。；;！？!?\n]/)
    .filter((clause) => !EXCLUSION.test(clause))
    .join("，");
  return stripped;
}
function named(text: string) {
  const scope = excluded(text);
  return {
    baiyun: /白云山|北校区|北校|北校区图书馆/.test(scope),
    university: /大学城|南校区|南校/.test(scope),
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
