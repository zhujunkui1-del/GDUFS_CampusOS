import { AgentOrchestrator, type ModelResolver } from "../agent/orchestrator";
import { RunLimiter } from "../agent/limits";
import { defaultModelRuntime } from "../models/runtime";
import { createMapSkillRegistry } from "./skills";
import { mapSkillService } from "./runtime";

const instructions = `地图专业能力规则：必须先查search_places，使用工具给出的placeId，禁止猜建筑ID。多候选应呈现列表或问用户，不擅自选定。
最近/附近排序使用find_nearby_places并明确起点来源，缺定位时询问起点。几何距离不是步行距离。
路线必须调用plan_route，原样使用实际距离/预计时间，不能自行创建路线。control_map只是校验后的操作意图，前端尚未执行，不说已经显示/移动。
输出仅简洁的可核实事实，不输出完整坐标数组或内部技术说明。失败由受控错误结束本轮，不能用自由生成补足。`;
export function createMapAgent(
  service = mapSkillService,
  router: ModelResolver = defaultModelRuntime(),
  limiter = new RunLimiter(),
) {
  const registry = createMapSkillRegistry(service);
  return {
    service,
    registry,
    orchestrator: new AgentOrchestrator(router, registry, limiter, {
      stopOnToolError: true,
      instructions,
    }),
  };
}
