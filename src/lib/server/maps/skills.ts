import type { SkillDefinition, SkillContext } from "@/domain/skills/contracts";
import {
  SearchPlacesInputSchema,
  SearchPlacesOutputSchema,
  PlaceDetailsInputSchema,
  PlaceDetailsOutputSchema,
  NearbyPlacesInputSchema,
  NearbyPlacesOutputSchema,
  PlanRouteInputSchema,
  RouteOutputSchema,
  ControlMapInputSchema,
  ControlMapOutputSchema,
} from "@/domain/maps/skill-contracts";
import { SkillRegistry } from "../agent/skill-registry";
import { CampusMapService } from "./campus-map-service";
import { campusData } from "@/features/campus-map/data/campus";
import type { z } from "zod";

function define<I, O>(
  name: string,
  description: string,
  inputSchema: z.ZodType<I>,
  outputSchema: z.ZodType<O>,
  execute: (input: I, context: SkillContext) => O | Promise<O>,
): SkillDefinition<I, O> {
  return {
    name,
    description,
    inputSchema,
    outputSchema,
    version: "1.0.0",
    auth: "public",
    sideEffect: "none",
    reuseResultMs: ["search_places", "get_place_details"].includes(name)
      ? 5000
      : undefined,
    requiresConfirmation: false,
    timeoutMs: name === "plan_route" ? 8000 : 2000,
    execute: async (input, context) => ({
      ok: true,
      data: await execute(input, context),
      sources: [
        { title: "CampusOS 固定校园OSM数据", url: campusData.sourceUrl },
      ],
    }),
  };
}
export function createMapSkillRegistry(service = new CampusMapService()) {
  return new SkillRegistry()
    .register(
      "spatial-domain",
      define(
        "search_places",
        "搜索大学城真实地点：名称、已确认别名、类别、有限模糊匹配。先查名称取得真实placeId，不能猜ID。ambiguous=true时展示候选并询问用户；最近/附近必须再以明确起点调用find_nearby_places，不能把搜索顺序当距离。",
        SearchPlacesInputSchema,
        SearchPlacesOutputSchema,
        (input, context) => service.search(input, context),
      ),
    )
    .register(
      "spatial-domain",
      define(
        "get_place_details",
        "按真实placeId查询地点、区域、来源、核验状态和已知建筑信息。null/unknown表示尚无资料，不补造楼层、入口或开放情况。",
        PlaceDetailsInputSchema,
        PlaceDetailsOutputSchema,
        (input, context) => service.details(input, context),
      ),
    )
    .register(
      "spatial-domain",
      define(
        "find_nearby_places",
        "查明确建筑、当前选中地点或已获浏览器授权位置附近的真实设施。origin.type=place需要placeId；selected_place来自已验证上下文；device_location仅引用当次授权，参数不可提交坐标。未知起点应询问用户。返回WGS84地表直线距离，不是步行距离。",
        NearbyPlacesInputSchema,
        NearbyPlacesOutputSchema,
        (input, context) => service.nearby(input, context),
      ),
    )
    .register(
      "spatial-domain",
      define(
        "plan_route",
        "用现有校园OSM路网实际计算步行路线。先搜索得到start.placeId/endPlaceId；start也可引用selected_place或device_location（需现有授权）。mode必须walking；跨区经下沉隧道，教学实验楼可穿行，建筑周边到达。不能提供坐标或自算距离；无障碍资料不足时拒绝。",
        PlanRouteInputSchema,
        RouteOutputSchema,
        (input, context) => service.plan(input, context),
      ),
    )
    .register(
      "spatial-domain",
      define(
        "control_map",
        "生成经校验的地图操作意图（尚未执行）。只引用真实placeId或本会话plan_route返回的routeId；支持FOCUS_PLACE、SHOW_PLACE_DETAILS、SHOW_ROUTE、CLEAR_ROUTE、SET_VIEW_MODE(2d/2.5d/3d)。不执行JS，不接受自由坐标。前端确认执行前不得说地图已经移动或路线已经显示。",
        ControlMapInputSchema,
        ControlMapOutputSchema,
        (input, context) => service.control(input, context),
      ),
    );
}
