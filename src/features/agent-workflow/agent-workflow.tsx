"use client";
import Link from "next/link";
import {
  useEffect,
  useRef,
  useState,
  type PointerEvent,
  type CSSProperties,
} from "react";
import { AssistantMessageText } from "@/features/assistant/components/assistant-message-text";
import type { AssistantCard } from "@/domain/agent/assistant-contracts";
import {
  defaultPositions,
  fitPositions,
  layoutKey,
  minWorkflowZoom,
  readLayout,
} from "./layout";
import {
  ArrowLeft,
  Play,
  Square,
  RotateCcw,
  Download,
  Save,
  Plus,
  Minus,
  Maximize2,
  Workflow,
  ArrowRight,
  ShieldCheck,
  GitBranch,
  Building2,
  BrainCircuit,
  CheckCheck,
  MessageSquare,
  BookOpen,
  CalendarDays,
  Map as MapIcon,
  Globe,
  Clock3,
  Activity,
} from "lucide-react";
import { readAgentStream } from "@/features/assistant/sse";
import type { WorkflowRecord } from "@/lib/server/assistant/workflow-trace";
import { workflowNodes, workflowEdges, workflowSize } from "./graph";
import "./workflow.css";

const icons = {
  input: MessageSquare,
  shield: ShieldCheck,
  route: GitBranch,
  building: Building2,
  model: BrainCircuit,
  check: CheckCheck,
  output: ArrowRight,
  book: BookOpen,
  calendar: CalendarDays,
  map: MapIcon,
  globe: Globe,
};
const labels: Record<string, string> = {
  idle: "待命",
  running: "运行中",
  success: "完成",
  skipped: "未经过",
  error: "失败",
  stopped: "已停止",
  unconfirmed: "未确认",
};
type Status = "idle" | "running" | "success" | "error" | "stopped";
function nodeState(id: string, records: WorkflowRecord[], status: Status) {
  if (id === "output" && status === "success") return "success";
  const spans = new Map(
    records
      .filter(
        (record) => record.node === id && record.phase !== "evidence_check",
      )
      .map((record) => [record.span, record]),
  );
  const all = [...spans.values()];
  if (all.some((record) => record.state === "running"))
    return status === "error"
      ? "error"
      : status === "stopped"
        ? "stopped"
        : "running";
  if (all.some((record) => record.state === "error")) return "error";
  if (all.some((record) => record.state === "unconfirmed"))
    return "unconfirmed";
  if (all.some((record) => record.state === "success")) return "success";
  return all.length || ["success", "error", "stopped"].includes(status)
    ? "skipped"
    : "idle";
}
function recordStatus(record: WorkflowRecord) {
  if (record.phase === "evidence_check") {
    const result = record.data as { status?: string; supported?: boolean };
    if (record.state === "error") return result.status || "失败";
    if (record.state === "success") return result.supported ? "通过" : "未通过";
  }
  return labels[record.state];
}
const json = (value: unknown) => JSON.stringify(value, null, 2);
export function AgentWorkflow({ csrf }: { csrf: string }) {
  const [question, setQuestion] = useState("广外一饭有什么好吃的？"),
    [smartSearch, setSmartSearch] = useState(false);
  const [status, setStatus] = useState<Status>("idle"),
    [records, setRecords] = useState<WorkflowRecord[]>([]),
    [answer, setAnswer] = useState("");
  const [metrics, setMetrics] = useState<Record<string, unknown> | null>(null),
    [events, setEvents] = useState<
      { type: string; at: string; data: unknown }[]
    >([]),
    [error, setError] = useState("");
  const [selected, setSelected] = useState("route"),
    [tab, setTab] = useState<"test" | "node" | "events">("test");
  const [runtime, setRuntime] = useState<{
    chatAvailable: boolean;
    model: { model?: string; provider?: string; ready?: boolean };
  } | null>(null);
  const [positions, setPositions] = useState(defaultPositions);
  const [inspectorWidth, setInspectorWidth] = useState(390);
  const [saved, setSaved] = useState("");
  const [cards, setCards] = useState<AssistantCard[]>([]);
  const [runQuestion, setRunQuestion] = useState("");
  const conversationId = useRef<string | undefined>(undefined);
  const viewport = useRef({ zoom: 0.65, offset: { x: 30, y: 35 } });
  const nodeDrag = useRef<{
    id: string;
    x: number;
    y: number;
    px: number;
    py: number;
    moved: boolean;
  } | null>(null);
  const suppressClick = useRef(false);
  const paneDrag = useRef<{ x: number; width: number } | null>(null);
  const [zoom, setZoom] = useState(0.65),
    [offset, setOffset] = useState({ x: 30, y: 35 }),
    [elapsed, setElapsed] = useState(0);
  const canvas = useRef<HTMLDivElement>(null),
    abort = useRef<AbortController | null>(null),
    requestId = useRef(""),
    epoch = useRef(0),
    started = useRef(0);
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(
    null,
  );
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/agent/status", { cache: "no-store", signal: controller.signal })
      .then((r) => r.json())
      .then((body) => {
        if (body.ok)
          setRuntime({
            chatAvailable: body.data.chatAvailable,
            model: body.data.model?.model || {},
          });
        else setError(body.error?.message || "状态读取失败");
      })
      .catch((error) => {
        if (!controller.signal.aborted) setError(error.message);
      });
    return () => {
      controller.abort();
      abort.current?.abort();
    };
  }, []);
  useEffect(() => {
    if (status !== "running") return;
    const timer = setInterval(
      () => setElapsed(performance.now() - started.current),
      100,
    );
    return () => clearInterval(timer);
  }, [status]);
  useEffect(() => {
    viewport.current = { zoom, offset };
  }, [zoom, offset]);
  function fit() {
    const box = canvas.current!.getBoundingClientRect(),
      next = fitPositions(positions, box.width, box.height);
    setZoom(next.zoom);
    setOffset(next.offset);
    setSaved("");
  }
  useEffect(() => {
    void Promise.resolve().then(() => {
      let stored = null;
      try {
        stored = readLayout(localStorage.getItem(layoutKey));
      } catch {}
      const box = canvas.current!.getBoundingClientRect(),
        initial = stored || {
          ...fitPositions(defaultPositions, box.width, box.height),
          positions: defaultPositions,
          inspectorWidth: 390,
        };
      setPositions(initial.positions);
      setZoom(initial.zoom);
      setOffset(initial.offset);
      setInspectorWidth(initial.inspectorWidth);
    });
  }, []);
  useEffect(() => {
    const element = canvas.current!;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const box = element.getBoundingClientRect(),
        v = viewport.current;
      const delta =
        event.deltaY *
        (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? box.height : 1);
      const nextZoom = Math.max(
        minWorkflowZoom,
        Math.min(1.6, v.zoom * Math.exp(-delta * 0.0015)),
      );
      const x = event.clientX - box.left,
        y = event.clientY - box.top;
      const nextOffset = {
        x: x - ((x - v.offset.x) / v.zoom) * nextZoom,
        y: y - ((y - v.offset.y) / v.zoom) * nextZoom,
      };
      viewport.current = { zoom: nextZoom, offset: nextOffset };
      setZoom(nextZoom);
      setOffset(nextOffset);
      setSaved("");
    };
    element.addEventListener("wheel", wheel, { passive: false });
    return () => element.removeEventListener("wheel", wheel);
  }, []);
  function saveLayout() {
    try {
      localStorage.setItem(
        layoutKey,
        json({ positions, zoom, offset, inspectorWidth }),
      );
      setSaved("已保存");
    } catch {
      setSaved("保存失败，请重试");
    }
  }
  function resizePane(x: number) {
    if (!paneDrag.current) return;
    setInspectorWidth(
      Math.max(
        280,
        Math.min(
          900,
          window.innerWidth - 300,
          paneDrag.current.width + paneDrag.current.x - x,
        ),
      ),
    );
    setSaved("");
  }
  function stop() {
    const id = requestId.current;
    abort.current?.abort();
    void fetch("/api/agent/cancel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: json({ requestId: id }),
    });
  }
  async function run() {
    const current = ++epoch.current,
      controller = new AbortController();
    abort.current = controller;
    requestId.current = crypto.randomUUID();
    started.current = performance.now();
    setStatus("running");
    setRecords([]);
    setEvents([]);
    setCards([]);
    setAnswer("");
    setRunQuestion(question);
    setMetrics(null);
    setError("");
    setElapsed(0);
    setTab("test");
    try {
      const response = await fetch("/api/agent/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CampusOS-Workflow": "1",
          "X-Console-CSRF": csrf,
        },
        body: json({
          conversationId: conversationId.current,
          message: question,
          smartSearch,
          clientRequestId: requestId.current,
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        const body = await response.json();
        if (body.workflow) setRecords(body.workflow);
        throw Error(body.error?.message || "运行失败");
      }
      await readAgentStream(
        response,
        (event) => {
          if (current !== epoch.current) return;
          if (
            event.type === "artifact.ready" &&
            event.payload.started &&
            typeof event.payload.conversationId === "string"
          )
            conversationId.current = event.payload.conversationId;
          if (event.payload.cards)
            setCards(event.payload.cards as AssistantCard[]);
          if (event.payload.workflow) {
            setRecords((previous) => [
              ...previous,
              event.payload.workflow as WorkflowRecord,
            ]);
            return;
          }
          if (event.type === "message.delta")
            setAnswer(
              (previous) => previous + String(event.payload.text || ""),
            );
          if (event.type !== "message.delta")
            setEvents((previous) => [
              ...previous,
              { type: event.type, at: event.timestamp, data: event.payload },
            ]);
          if (event.type === "run.completed") {
            setStatus("success");
            setMetrics(
              (event.payload.metrics as Record<string, unknown>) || null,
            );
            setElapsed(performance.now() - started.current);
          }
          if (event.type === "run.failed") {
            setStatus("error");
            setMetrics(
              (event.payload.metrics as Record<string, unknown>) || null,
            );
            setError(
              (event.payload.error as { message: string })?.message ||
                "运行失败",
            );
            setElapsed(performance.now() - started.current);
          }
        },
        controller.signal,
      );
    } catch (error) {
      if (current === epoch.current) {
        setStatus(controller.signal.aborted ? "stopped" : "error");
        if (!controller.signal.aborted)
          setError(error instanceof Error ? error.message : "运行失败");
        setElapsed(performance.now() - started.current);
      }
    }
  }
  function reset() {
    epoch.current++;
    conversationId.current = undefined;
    abort.current?.abort();
    setRecords([]);
    setEvents([]);
    setCards([]);
    setAnswer("");
    setError("");
    setMetrics(null);
    setStatus("idle");
    setElapsed(0);
  }
  function download() {
    const layout = { positions, zoom, offset, inspectorWidth };
    const url = URL.createObjectURL(
      new Blob(
        [
          json(
            hasRun
              ? {
                  question,
                  smartSearch,
                  status,
                  answer,
                  cards,
                  error,
                  records,
                  events,
                  metrics,
                  layout,
                }
              : layout,
          ),
        ],
        { type: "application/json" },
      ),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = hasRun
      ? "campusos-agent-run.json"
      : "campusos-agent-layout.json";
    a.click();
    URL.revokeObjectURL(url);
  }
  function down(event: PointerEvent<HTMLDivElement>) {
    if ((event.target as HTMLElement).closest("button")) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = {
      x: event.clientX,
      y: event.clientY,
      ox: offset.x,
      oy: offset.y,
    };
  }
  const references = cards.flatMap((card, index) =>
    card.kind === "source" || card.kind === "external_source"
      ? [
          {
            number: index + 1,
            title: card.title,
            url: card.originalUrl,
            name: card.sourceName,
          },
        ]
      : card.kind === "place"
        ? [
            {
              number: index + 1,
              title: card.place.name,
              url: "/map?place=" + encodeURIComponent(card.place.placeId),
              name: "校园建筑",
            },
          ]
        : [],
  );
  const cited = new Set(
    [...answer.matchAll(/\[(?:来源\s*)?(\d+)\]/g)].map((match) =>
      Number(match[1]),
    ),
  );
  const usedReferences = references.some((reference) =>
    cited.has(reference.number),
  )
    ? references.filter((reference) => cited.has(reference.number))
    : references;
  const calendarLinks = [
    ...new Map(
      usedReferences.flatMap(({ number }) => {
        const card = cards[number - 1];
        return card?.kind === "source"
          ? (card.calendarLinks ?? []).map((link) => [link.href, link] as const)
          : [];
      }),
    ).values(),
  ];
  const node = workflowNodes.find((node) => node.id === selected)!,
    nodeRecords = records.filter((record) => record.node === selected);
  const completed = workflowNodes.filter(
    (node) => nodeState(node.id, records, status) === "success",
  ).length;
  const hasRun = !!(events.length || records.length || error);
  const exportLabel = hasRun ? "导出运行" : "导出布局";
  const evidenceCheck = records.findLast(
    (record) => record.phase === "evidence_check",
  );
  function nodeLabel(id: string, state: ReturnType<typeof nodeState>) {
    if (
      id === "model" &&
      state === "success" &&
      evidenceCheck?.state === "error"
    )
      return recordStatus(evidenceCheck) === "超时"
        ? "完成 · 核验超时"
        : "完成 · 核验未完成";
    return labels[state];
  }
  return (
    <main
      className="agent-studio"
      style={{ "--inspector-width": inspectorWidth + "px" } as CSSProperties}
    >
      <header className="studio-header">
        <Link href="/admin" className="studio-back" aria-label="返回总览">
          <ArrowLeft size={20} />
        </Link>
        <div className="studio-brand">
          <Workflow size={22} />
          <strong>CampusOS</strong>
          <span>/</span>
          <h1>Agent 工作流</h1>
        </div>
        <span className="studio-system">自研 Agent · D1</span>
        <div className="studio-header-actions">
          <span className="studio-save-status" role="status">
            {saved}
          </span>
          <button type="button" aria-label="保存节点布局" onClick={saveLayout}>
            <Save size={17} />
            <span>保存</span>
          </button>
          <button type="button" aria-label={exportLabel} onClick={download}>
            <Download size={17} />
            <span>{exportLabel}</span>
          </button>
          <button
            type="button"
            aria-label="新运行"
            onClick={reset}
            disabled={status === "running"}
          >
            <RotateCcw size={17} />
            <span>新运行</span>
          </button>
          <button
            type="button"
            aria-label={status === "running" ? "停止" : "运行"}
            className="studio-run"
            disabled={!question.trim()}
            onClick={() => (status === "running" ? stop() : void run())}
          >
            {status === "running" ? <Square size={16} /> : <Play size={16} />}
            <span>{status === "running" ? "停止" : "运行"}</span>
          </button>
        </div>
      </header>
      <section className="studio-workspace">
        <div className="studio-graph-wrap">
          <div className="studio-graph-heading">
            <span>
              <span className={"studio-status-dot " + status} />
              {status === "idle" ? "工作流拓扑" : labels[status]}
            </span>
            <span>
              <Clock3 size={14} />
              {(elapsed / 1000).toFixed(1)}s <i /> {completed} 个节点完成
            </span>
          </div>
          <div
            ref={canvas}
            className="studio-canvas"
            onPointerDown={down}
            onPointerMove={(event) => {
              if (drag.current)
                setOffset({
                  x: drag.current.ox + event.clientX - drag.current.x,
                  y: drag.current.oy + event.clientY - drag.current.y,
                });
            }}
            onPointerUp={() => {
              drag.current = null;
            }}
            onPointerCancel={() => {
              drag.current = null;
            }}
          >
            <div
              className="workflow-board"
              style={{
                width: workflowSize.width,
                height: workflowSize.height,
                transform: `translate(${offset.x}px,${offset.y}px) scale(${zoom})`,
              }}
            >
              <svg
                width={workflowSize.width}
                height={workflowSize.height}
                className="workflow-edges"
                aria-hidden="true"
              >
                <defs>
                  <marker
                    id="flow-arrow"
                    markerWidth="7"
                    markerHeight="7"
                    refX="6"
                    refY="3.5"
                    orient="auto-start-reverse"
                  >
                    <path d="M0,0 L7,3.5 L0,7" fill="currentColor" />
                  </marker>
                </defs>
                {workflowEdges.map(([from, to]) => {
                  const a = workflowNodes.find((n) => n.id === from)!,
                    b = workflowNodes.find((n) => n.id === to)!;
                  const bottom = b.y > a.y + 150;
                  const x1 = positions[a.id].x + 185,
                    y1 = positions[a.id].y + 53,
                    x2 = positions[b.id].x,
                    y2 = positions[b.id].y + 53;
                  return (
                    <path
                      key={from + to}
                      className="flow-edge"
                      markerEnd="url(#flow-arrow)"
                      markerStart={
                        bottom && from === "model"
                          ? "url(#flow-arrow)"
                          : undefined
                      }
                      d={`M${x1},${y1} C${x1 + 70},${y1} ${x2 - 70},${y2} ${x2},${y2}`}
                    />
                  );
                })}
              </svg>
              {workflowNodes.map((item) => {
                const Icon = icons[item.icon];
                const state = nodeState(item.id, records, status);
                const label = nodeLabel(item.id, state);
                const calls = records.filter(
                  (r) =>
                    r.node === item.id &&
                    r.state !== "running" &&
                    r.phase !== "evidence_check",
                );
                return (
                  <button
                    key={item.id}
                    type="button"
                    className={`workflow-node ${item.tone} ${state} ${selected === item.id ? "selected" : ""}`}
                    style={{
                      left: positions[item.id].x,
                      top: positions[item.id].y,
                    }}
                    onPointerDown={(event) => {
                      event.stopPropagation();
                      event.currentTarget.setPointerCapture(event.pointerId);
                      const p = positions[item.id];
                      nodeDrag.current = {
                        id: item.id,
                        x: event.clientX,
                        y: event.clientY,
                        px: p.x,
                        py: p.y,
                        moved: false,
                      };
                    }}
                    onPointerMove={(event) => {
                      const d = nodeDrag.current;
                      if (!d || d.id !== item.id) return;
                      const dx = (event.clientX - d.x) / zoom,
                        dy = (event.clientY - d.y) / zoom;
                      if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
                      if (d.moved) {
                        setPositions((previous) => ({
                          ...previous,
                          [d.id]: { x: d.px + dx, y: d.py + dy },
                        }));
                        setSaved("");
                      }
                    }}
                    onPointerUp={(event) => {
                      event.stopPropagation();
                      suppressClick.current = !!nodeDrag.current?.moved;
                      nodeDrag.current = null;
                    }}
                    onPointerCancel={() => {
                      nodeDrag.current = null;
                    }}
                    onClick={() => {
                      if (suppressClick.current) {
                        suppressClick.current = false;
                        return;
                      }
                      setSelected(item.id);
                      setTab("node");
                    }}
                    aria-label={item.title + "，" + label}
                    data-node={item.id}
                    data-state={state}
                  >
                    <span className="workflow-node-title">
                      <span className="workflow-node-icon">
                        <Icon size={20} />
                      </span>
                      <strong>{item.title}</strong>
                    </span>
                    <span className="workflow-node-subtitle">
                      {item.subtitle}
                    </span>
                    <span className="workflow-node-footer">
                      <span className={"node-state-dot " + state} />
                      {label}
                      <span>
                        {calls.length
                          ? calls.reduce((n, r) => n + (r.durationMs || 0), 0) +
                            " ms"
                          : ""}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
          <div className="studio-canvas-footer">
            <span
              className="studio-runtime"
              title="平台初选模型；本次实际模型见运行指标"
            >
              <span
                className={
                  "studio-status-dot " +
                  (runtime?.chatAvailable ? "success" : "idle")
                }
              />
              {runtime
                ? runtime.model.model || "平台模型未就绪"
                : error
                  ? "模型状态不可用"
                  : "读取模型状态…"}
            </span>
            <div className="studio-zoom">
              <button
                aria-label="缩小工作流"
                onClick={() =>
                  setZoom((z) => Math.max(minWorkflowZoom, z - 0.1))
                }
              >
                <Minus size={17} />
              </button>
              <span>{Math.round(zoom * 100)}%</span>
              <button
                aria-label="放大工作流"
                onClick={() => setZoom((z) => Math.min(1.6, z + 0.1))}
              >
                <Plus size={17} />
              </button>
              <button aria-label="适应画布" onClick={fit}>
                <Maximize2 size={17} />
              </button>
            </div>
          </div>
        </div>
        <aside className="studio-inspector">
          <div
            className="studio-resizer"
            role="separator"
            aria-label="调整侧栏宽度"
            aria-orientation="vertical"
            aria-valuemin={280}
            aria-valuemax={900}
            aria-valuenow={inspectorWidth}
            tabIndex={0}
            onPointerDown={(event) => {
              event.preventDefault();
              event.currentTarget.setPointerCapture(event.pointerId);
              paneDrag.current = {
                x: event.clientX,
                width:
                  event.currentTarget.parentElement!.getBoundingClientRect()
                    .width,
              };
            }}
            onPointerMove={(event) => resizePane(event.clientX)}
            onPointerUp={() => {
              paneDrag.current = null;
            }}
            onPointerCancel={() => {
              paneDrag.current = null;
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
                event.preventDefault();
                setInspectorWidth((w) =>
                  Math.max(
                    280,
                    Math.min(
                      900,
                      window.innerWidth - 300,
                      w + (event.key === "ArrowLeft" ? 30 : -30),
                    ),
                  ),
                );
                setSaved("");
              }
            }}
          />
          <nav aria-label="工作流面板">
            {(["test", "node", "events"] as const).map((value) => (
              <button
                key={value}
                className={tab === value ? "active" : ""}
                onClick={() => setTab(value)}
              >
                {value === "test"
                  ? "测试运行"
                  : value === "node"
                    ? "节点详情"
                    : "事件记录"}
              </button>
            ))}
          </nav>
          <div className="studio-inspector-body">
            {tab === "test" && (
              <>
                <div className="studio-panel-title">
                  <Activity size={18} />
                  <h2>测试校园助理</h2>
                </div>
                <label className="studio-input-label">
                  输入问题
                  <textarea
                    value={question}
                    disabled={status === "running"}
                    onChange={(event) => setQuestion(event.target.value)}
                    rows={4}
                  />
                </label>
                <label className="studio-search">
                  <input
                    type="checkbox"
                    checked={smartSearch}
                    disabled={status === "running"}
                    onChange={(event) => setSmartSearch(event.target.checked)}
                  />
                  智能搜索
                </label>
                <div className="studio-examples">
                  {[
                    "广外一饭有什么好吃的？",
                    "学术交流中心最近两周有什么活动？",
                    "图书馆借阅规则是什么？",
                  ].map((q) => (
                    <button
                      disabled={status === "running"}
                      key={q}
                      onClick={() => setQuestion(q)}
                    >
                      {q}
                    </button>
                  ))}
                </div>
                {error && (
                  <p className="studio-error" role="alert">
                    {error}
                  </p>
                )}
                <div className="studio-answer-heading">
                  <h2>回答</h2>
                  <span>{labels[status]}</span>
                </div>
                <div className="studio-answer" aria-live="polite">
                  {answer ? (
                    <AssistantMessageText
                      text={answer}
                      cards={cards}
                      question={runQuestion}
                    />
                  ) : (
                    <p className="studio-empty">
                      {status === "running"
                        ? "等待回答…"
                        : "运行后查看回答与实际路径"}
                    </p>
                  )}
                </div>
                {!!answer && usedReferences.length > 0 && (
                  <section className="studio-references" aria-label="引用来源">
                    <h3>引用来源</h3>
                    {calendarLinks.map((link) => (
                      <Link key={link.href} href={link.href}>
                        <span>{link.title}</span>
                        <small>活动日历</small>
                      </Link>
                    ))}
                    {usedReferences.map((reference) => (
                      <a
                        key={reference.url + reference.number}
                        href={reference.url}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <span>
                          [{reference.number}] {reference.title}
                        </span>
                        <small>{reference.name}</small>
                      </a>
                    ))}
                  </section>
                )}
                {metrics && (
                  <div className="studio-metrics">
                    <span>
                      模型<strong>{String(metrics.model || "—")}</strong>
                    </span>
                    <span>
                      调用次数<strong>{String(metrics.requests ?? "—")}</strong>
                    </span>
                    <span>
                      Token
                      <strong>
                        {metrics.usageComplete === false
                          ? "未返回"
                          : String(metrics.totalTokens ?? "—")}
                      </strong>
                    </span>
                    <span>
                      回答路径
                      <strong>{String(metrics.answerMode || "—")}</strong>
                    </span>
                  </div>
                )}
                <details className="studio-architecture">
                  <summary>当前数据与能力</summary>
                  <p>建筑：管理员简介与近两周以来的活动。</p>
                  <p>
                    RAG：自研 D1 文章正文、分类与分段检索，复验公开状态与版本。
                  </p>
                  <p>
                    地图：真实地点与本地步行路网。外部搜索按开关和问题需要执行。
                  </p>
                  <p>这里只展示本次请求的结构化执行信息。</p>
                </details>
              </>
            )}
            {tab === "node" && (
              <>
                <div className="studio-panel-title">
                  <Workflow size={18} />
                  <h2>{node.title}</h2>
                </div>
                <p className="studio-node-description">{node.subtitle}</p>
                <span
                  className={
                    "studio-state-badge " + nodeState(selected, records, status)
                  }
                >
                  {nodeLabel(selected, nodeState(selected, records, status))}
                </span>
                {!nodeRecords.length ? (
                  <p className="studio-empty">
                    {selected === "output" && status === "success"
                      ? "服务已返回结果，可在事件记录中查看终态信息。"
                      : "本次运行尚无该节点的执行记录。"}
                  </p>
                ) : (
                  nodeRecords.map((record, index) => (
                    <section className="studio-record" key={index}>
                      <header>
                        <strong>
                          {record.phase === "evidence_check"
                            ? "证据核验 · "
                            : ""}
                          {recordStatus(record)}
                        </strong>
                        <span>
                          +{record.elapsedMs} ms
                          {record.durationMs !== undefined
                            ? ` · ${record.durationMs} ms`
                            : ""}
                        </span>
                      </header>
                      <pre>{json(record.data)}</pre>
                    </section>
                  ))
                )}
              </>
            )}
            {tab === "events" && (
              <>
                <div className="studio-panel-title">
                  <Activity size={18} />
                  <h2>本次执行记录</h2>
                </div>
                {!records.length && !events.length && (
                  <p className="studio-empty">尚未运行</p>
                )}
                {records.map((record, index) => (
                  <button
                    className="studio-timeline-item"
                    key={index}
                    onClick={() => {
                      setSelected(record.node);
                      setTab("node");
                    }}
                  >
                    <span className={"node-state-dot " + record.state} />
                    <strong>
                      {record.phase === "evidence_check"
                        ? "证据核验"
                        : workflowNodes.find((n) => n.id === record.node)
                            ?.title}
                    </strong>
                    <span>
                      {recordStatus(record)} · +{record.elapsedMs} ms
                    </span>
                  </button>
                ))}
                {events.map((event, index) => (
                  <details className="studio-raw-event" key={index}>
                    <summary>
                      {event.type}
                      <time>
                        {new Date(event.at).toLocaleTimeString("zh-CN", {
                          timeZone: "Asia/Shanghai",
                        })}
                      </time>
                    </summary>
                    <pre>{json(event.data)}</pre>
                  </details>
                ))}
              </>
            )}
          </div>
        </aside>
      </section>
    </main>
  );
}
