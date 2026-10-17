"use client";
import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { ConsoleActor, SourceSummary } from "@/domain/console/contracts";
import {
  knowledgeCategories,
  radarCategories,
  rightsNames,
} from "@/domain/console/taxonomy";
type Client = <T>(path: string, method?: string, body?: unknown) => Promise<T>;
type Policy = { sourceVersion: number; effectiveRights: string };
export function ManualImportForm({
  request,
  actor,
}: {
  request: Client;
  actor: ConsoleActor;
}) {
  const router = useRouter();
  const [publishedExact, setPublishedExact] = useState(false);
  const [query, setQuery] = useState(""),
    [sources, setSources] = useState<SourceSummary[]>([]),
    [sourceId, setSource] = useState(""),
    [policy, setPolicy] = useState<Policy | null>(null),
    [title, setTitle] = useState(""),
    [url, setUrl] = useState(""),
    [publishedAt, setPublished] = useState(""),
    [body, setBody] = useState(""),
    [bodyStatus, setBodyStatus] = useState("not_provided"),
    [knowledgeCategory, setCategory] = useState(""),
    [radarCategory, setRadar] = useState(""),
    [summary, setSummary] = useState(""),
    [own, setOwn] = useState(false),
    [entries, setEntries] = useState(""),
    [expectedVersion, setVersion] = useState(""),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [rights, setRights] = useState("metadata_only"),
    [evidence, setEvidence] = useState(""),
    [note, setNote] = useState(""),
    [licenseConfirmed, setLicenseConfirmed] = useState(false);
  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => {
      request<{ items: SourceSummary[] }>(
        `sources?limit=50&verification=verified&permission=approved&enabled=1&q=${encodeURIComponent(query)}`,
      )
        .then((r) => {
          if (active) setSources(r.items);
        })
        .catch((e) => {
          if (active) setMessage(e.message);
        });
    }, 200);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [query, request]);
  useEffect(() => {
    let active = true;
    if (sourceId)
      request<Policy>(`sources/${sourceId}/import-policy`)
        .then((p) => {
          if (active) setPolicy(p);
        })
        .catch((e) => {
          if (active) setMessage(e.message);
        });
    return () => {
      active = false;
    };
  }, [sourceId, request]);
  async function work(action: () => Promise<void>) {
    setBusy(true);
    setMessage("");
    try {
      await action();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "导入未完成，请重试。");
    } finally {
      setBusy(false);
    }
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!policy) return;
    await work(async () => {
      const result = await request<{ items: { id: string }[] }>(
        "content/import",
        "POST",
        {
          commandId: crypto.randomUUID(),
          sourceId,
          sourceVersion: policy.sourceVersion,
          items: [
            {
              title,
              url,
              publishedAt: !publishedAt
                ? null
                : publishedExact
                  ? new Date(publishedAt + ":00+08:00").toISOString()
                  : publishedAt,
              campusScope: "unknown",
              contentType: "notice",
              knowledgeCategory: knowledgeCategory || null,
              radarCategory: radarCategory || null,
              body: bodyStatus === "not_provided" ? "" : body,
              bodyStatus,
              summary,
              ownNoteConfirmed: own,
              discoveryUrls: entries
                .split(/\n/)
                .map((s) => s.trim())
                .filter(Boolean),
              ...(expectedVersion
                ? { expectedVersion: Number(expectedVersion) }
                : {}),
            },
          ],
        },
      );
      router.replace(
        `/admin/content?record=${encodeURIComponent(result.items[0].id)}`,
      );
    });
  }
  const fullText =
    policy &&
    ["excerpt_and_link", "licensed_full_text"].includes(policy.effectiveRights);
  return (
    <>
      <Link className="console-back" href="/admin/content">
        返回内容记录
      </Link>
      <div className="console-heading">
        <h1>人工导入</h1>
      </div>
      {message && (
        <p className="console-feedback" role="status">
          {message}
        </p>
      )}
      {bodyStatus !== "not_provided" &&
        body.length >
          (policy?.effectiveRights === "excerpt_and_link" ? 500 : 50000) && (
          <p className="console-feedback" role="alert">
            正文超出当前许可或长度上限，请核对后调整。
          </p>
        )}
      <form className="console-card console-form" onSubmit={submit}>
        <label>
          查找信息源
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="名称或编号"
          />
        </label>
        <label>
          信息源
          <select
            required
            value={sourceId}
            onChange={(e) => {
              setSource(e.target.value);
              setPolicy(null);
              setBodyStatus("not_provided");
            }}
          >
            <option value="">请选择</option>
            {sources.map((s) => (
              <option key={s.id} value={s.id}>
                {s.displayName}
              </option>
            ))}
          </select>
        </label>
        <label className="console-wide">
          标题
          <input
            required
            maxLength={250}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <label className="console-wide">
          原文链接
          <input
            required
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
        </label>
        <label>
          原文发布日期
          <input
            type={publishedExact ? "datetime-local" : "date"}
            value={publishedAt}
            onChange={(e) => setPublished(e.target.value)}
          />
        </label>
        <label>
          <input
            type="checkbox"
            checked={publishedExact}
            onChange={(e) => {
              setPublishedExact(e.target.checked);
              setPublished("");
            }}
          />
          包含发布时间
        </label>
        <label>
          正文状态
          <select
            value={bodyStatus}
            onChange={(e) => setBodyStatus(e.target.value)}
          >
            <option value="not_provided">仅元数据</option>
            <option value="partial" disabled={!fullText}>
              部分正文
            </option>
            <option
              value="complete"
              disabled={policy?.effectiveRights !== "licensed_full_text"}
            >
              声明完整正文
            </option>
          </select>
        </label>
        {bodyStatus !== "not_provided" && (
          <label className="console-wide">
            正文
            <textarea
              required
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
          </label>
        )}
        <label>
          知识分类
          <select
            value={knowledgeCategory}
            onChange={(e) => setCategory(e.target.value)}
          >
            <option value="">未分类</option>
            {knowledgeCategories.map((c) => (
              <option key={c.code} value={c.code}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          雷达分类
          <select
            value={radarCategory}
            onChange={(e) => setRadar(e.target.value)}
          >
            <option value="">未分类</option>
            {radarCategories.map((c) => (
              <option key={c.code} value={c.code}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        <label className="console-wide">
          自有简短说明
          <textarea
            maxLength={250}
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
          />
        </label>
        {!!summary && (
          <label className="console-wide">
            <input
              type="checkbox"
              required
              checked={own}
              onChange={(e) => setOwn(e.target.checked)}
            />
            说明由我自行撰写
          </label>
        )}
        <label className="console-wide">
          发现栏目链接
          <textarea
            value={entries}
            onChange={(e) => setEntries(e.target.value)}
            placeholder="每行一个，最多5个"
          />
        </label>
        <label>
          更新版本（已有记录时）
          <input
            type="number"
            min="1"
            value={expectedVersion}
            onChange={(e) => setVersion(e.target.value)}
          />
        </label>
        <div className="console-actions console-wide">
          <button
            className="primary-button"
            disabled={
              busy ||
              !policy ||
              policy.effectiveRights === "expired" ||
              actor.role === "reviewer" ||
              (bodyStatus !== "not_provided" &&
                body.length >
                  (policy?.effectiveRights === "excerpt_and_link"
                    ? 500
                    : 50000))
            }
          >
            导入待审核
          </button>
        </div>
      </form>
      {actor.role === "admin" && sourceId && (
        <details className="console-card">
          <summary>核验导入用途</summary>
          <form
            className="console-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (!policy) return;
              void work(async () => {
                await request(`sources/${sourceId}/import-policy`, "POST", {
                  commandId: crypto.randomUUID(),
                  expectedVersion: policy.sourceVersion,
                  rightsScope: rights,
                  evidenceUrls: evidence
                    .split(/\n/)
                    .map((s) => s.trim())
                    .filter(Boolean),
                  note,
                  fullTextAuthorized: licenseConfirmed,
                });
                setPolicy(
                  await request<Policy>(`sources/${sourceId}/import-policy`),
                );
                setMessage("导入用途已保存");
              });
            }}
          >
            <label>
              使用范围
              <select
                value={rights}
                onChange={(e) => setRights(e.target.value)}
              >
                {[
                  "metadata_only",
                  "excerpt_and_link",
                  "licensed_full_text",
                ].map((r) => (
                  <option key={r} value={r}>
                    {rightsNames[r]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              许可证据链接
              <textarea
                required
                value={evidence}
                onChange={(e) => setEvidence(e.target.value)}
              />
            </label>
            <label className="console-wide">
              核验说明
              <textarea
                required
                minLength={5}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </label>
            {rights !== "metadata_only" && (
              <label className="console-wide">
                <input
                  type="checkbox"
                  required
                  checked={licenseConfirmed}
                  onChange={(e) => setLicenseConfirmed(e.target.checked)}
                />
                已核实相应正文使用许可
              </label>
            )}
            <button className="primary-button" disabled={busy || !policy}>
              保存导入用途
            </button>
          </form>
        </details>
      )}
    </>
  );
}
