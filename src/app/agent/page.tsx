import type { Metadata } from "next";
import { AgentWorkflow } from "@/features/agent-workflow/agent-workflow";
export const metadata: Metadata = { title: "校园助理工作流" };
export default function AgentPage() {
  return <AgentWorkflow />;
}
