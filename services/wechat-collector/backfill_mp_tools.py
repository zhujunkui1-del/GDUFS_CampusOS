"""Finite-scope, resumable backfill through the running MP Tools application.

Uses the existing local API, account and original history endpoint only. Rate
limits cause persisted waits; cached lists never advance a history cursor.
The date/account scope stays fixed, including when a job spans midnight.
"""
import argparse
from datetime import datetime, timedelta, timezone
import html
import json
import os
from pathlib import Path
import re
import time
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode, urlsplit, urlunsplit
from urllib.request import Request, urlopen

HOME = Path(r"D:\WeChat MP Tools")
DATA = HOME / "data"
RUN = DATA / "CampusOS_downloads/since-2026-10-01/resumable-backfill-2026-10-22"
TZ = timezone(timedelta(hours=8))
EXCLUDED = {"外环东路178号的猫", "广东外语外贸大学", "数智广外"}
START = int(datetime(2026, 10, 1, tzinfo=TZ).timestamp())
END = int(datetime(2026, 10, 22, 23, 59, 59, tzinfo=TZ).timestamp())
BASE = "http://127.0.0.1:5200"


def timestamp():
    return datetime.now(TZ).isoformat()


def canonical(url):
    parsed = urlsplit(str(url or ""))
    if parsed.hostname != "mp.weixin.qq.com":
        raise ValueError("Article URL outside requested publisher")
    if parsed.path.startswith("/s/"):
        return urlunsplit(("https", "mp.weixin.qq.com", parsed.path.replace("~", "_"), "", ""))
    return urlunsplit(("https", "mp.weixin.qq.com", parsed.path, parsed.query, ""))


def load_json(path, default):
    try:
        return json.loads(path.read_text(encoding="utf-8-sig"))
    except FileNotFoundError:
        return default


def inventory():
    found = {}
    root = DATA / "articles_full"
    for file in root.glob("*/*/reading.html"):
        if file.parent.parent.name in EXCLUDED:
            continue
        try:
            with file.open(encoding="utf-8-sig") as f:
                head = f.read(65536)
            match = re.search(r'<meta\s+name="campusos-article"\s+content="([^"]*)"', head)
            if not match:
                continue
            meta = json.loads(html.unescape(match.group(1)))
            url = canonical(meta["url"])
            found[(file.parent.parent.name, url)] = {"path": str(file), "publishTime": meta.get("publish_time"), "title": meta.get("title", "")}
        except (OSError, ValueError, KeyError):
            continue
    return found


class WaitForRateLimit(Exception):
    pass


class NeedAttention(Exception):
    pass


class LocalAppOffline(Exception):
    pass


def api(path, body=None):
    request = Request(BASE + path, data=json.dumps(body, ensure_ascii=False).encode("utf-8") if body is not None else None,
                      headers={"Content-Type": "application/json"}, method="POST" if body is not None else "GET")
    try:
        with urlopen(request, timeout=40) as response:
            return json.load(response)
    except HTTPError as error:
        try:
            result = json.loads(error.read().decode("utf-8"))
        except ValueError:
            result = {"error": "Local API HTTP " + str(error.code)}
        raise NeedAttention(str(result.get("error") or "Local API error")) from None
    except (URLError, TimeoutError, OSError):
        if body is not None:
            raise NeedAttention("本地提交结果未知，已停止自动重发；恢复前先核对下载历史") from None
        raise LocalAppOffline("MP Tools 本地服务未运行") from None
    except (ValueError, UnicodeError):
        raise NeedAttention("本地API响应无法解析，检查点已保留") from None


def pool_state():
    # Only return status fields. Credentials stay in the app's data directory and
    # are never copied to logs, state, requests, command arguments or this API.
    rows = load_json(DATA / "account_pool.json", [])
    return [{k: a.get(k) for k in ("status", "last_ret", "last_error", "last_used", "cooldown_until")}
            for a in rows if isinstance(a, dict)]


def verified_page(result, pool):
    if result.get("list_origin") == "upstream_history" and result.get("directory_complete") is True:
        articles = result.get("articles")
        if not isinstance(articles, list):
            raise NeedAttention("真实目录页缺少文章数组")
        if result.get("can_msg_continue") not in (0, 1, False, True):
            raise NeedAttention("真实目录页缺少有效分页标记")
        if any(not isinstance(a, dict) or not isinstance(a.get("title"), str) or not isinstance(a.get("link"), str) for a in articles):
            raise NeedAttention("真实目录页文章字段无效")
        return articles
    reason = str(result.get("warning") or result.get("error") or "历史目录未恢复")
    codes = {a.get("last_ret") for a in pool}
    if "-2014" in reason or (-2014 in codes and "冷却" in reason) or ("HTTP 429" in reason):
        raise WaitForRateLimit(reason)
    raise NeedAttention(reason)


def new_state(accounts):
    if isinstance(accounts, dict):
        accounts = accounts.get("accounts", [])
    names = {a["nickname"] for a in accounts}
    if len(accounts) != 78 or not EXCLUDED.issubset(names):
        raise NeedAttention("公众号名录已变化，请先核对78个账号与三个排除账号")
    targets = [a for a in accounts if a["nickname"] not in EXCLUDED]
    previous = load_json(DATA / "patches/history-directory-2026-10-22/resume-missing-state.json", {})
    priority = {"广外信息青年", "广外信息科学与技术学院", "广外light志愿者协会", "广外研究生会", "广东外语外贸大学学报", "广外欧家", "广外外校", "广外外校国际部", "广外云山语培北", "广外多语课堂", "广外公开学院艺术设计与信息管理系", "Oasis Music", "广外就业", "广外就业中心"}
    targets.sort(key=lambda a: a["nickname"] not in priority)
    return {"createdAt": timestamp(), "updatedAt": timestamp(), "status": "ready", "completed": False,
            "since": "2026-10-01", "through": "2026-10-22", "excluded": sorted(EXCLUDED),
            "nextAttemptAt": 0, "consecutiveFrequencyLimits": 0, "newDownloads": [], "unavailable": [],
            "initialKnownArticleCount": previous.get("existingInRangeCount"),
            "jobs": [{"name": a["nickname"], "fakeid": a["fakeid"], "offset": 0, "status": "pending", "pages": 0,
                      "fingerprints": [], "downloaded": 0, "alreadyPresent": 0, "outOfRange": 0} for a in targets]}


class Backfill:
    def __init__(self, state, directory=RUN):
        self.state = state
        self.directory = directory
        self.directory.mkdir(parents=True, exist_ok=True)
        self.known = inventory()
        self.last_request_at = 0.0

    def save(self):
        self.state["updatedAt"] = timestamp()
        target = self.directory / "state.json"
        pending = target.with_suffix(".pending")
        pending.write_text(json.dumps(self.state, ensure_ascii=False, indent=2), encoding="utf-8")
        os.replace(pending, target)
        self.report()

    def report(self):
        state = self.state
        lines = ["# MP Tools 缺失文章补抓进度", "", "更新时间：" + state["updatedAt"],
                 "", "范围：2026-10-01 至 2026-10-22；目标75个账号，排除外环东路178号的猫、广东外语外贸大学、数智广外。",
                 "", "状态：" + state["status"], "", "已核对完成账号：" + str(sum(j["status"] == "completed" for j in state["jobs"])) + "/75",
                 "新联网下载：" + str(len(state["newDownloads"])) + " 篇；不可访问文章：" + str(len(state["unavailable"])) + " 篇。"]
        if state.get("nextAttemptAt"):
            lines += ["", "下一次正常目录检查（北京时间）：" + datetime.fromtimestamp(state["nextAttemptAt"], TZ).strftime("%Y-%m-%d %H:%M:%S")]
        if state.get("message"):
            lines += ["", state["message"]]
        lines += ["", "| 公众号 | 状态 | 已扫描页 | 下次偏移 | 已有文章 | 新下载 |", "| --- | --- | ---: | ---: | ---: | ---: |"]
        lines += ["| " + " | ".join(str(j.get(k, "")) for k in ("name", "status", "pages", "offset", "alreadyPresent", "downloaded")) + " |" for j in state["jobs"]]
        (self.directory / "进度.md").write_text("\n".join(lines) + "\n", encoding="utf-8")

    def event(self, kind, **fields):
        message = {"at": timestamp(), "event": kind, **fields}
        with (self.directory / "events.jsonl").open("a", encoding="utf-8") as f:
            f.write(json.dumps(message, ensure_ascii=False) + "\n")
        print(json.dumps(message, ensure_ascii=False), flush=True)

    def wait(self, seconds):
        deadline = time.monotonic() + seconds
        while time.monotonic() < deadline:
            if (self.directory / "STOP").exists():
                raise NeedAttention("收到停止请求，检查点已保留")
            time.sleep(min(5.0, max(0.0, deadline - time.monotonic())))

    def schedule_frequency_wait(self, reason):
        number = self.state.get("consecutiveFrequencyLimits", 0) + 1
        self.state["consecutiveFrequencyLimits"] = number
        delay = min(3600, 900 * (2 ** min(number - 1, 2)))
        upstream_deadline = max([0] + [a.get("cooldown_until") or 0 for a in pool_state()])
        self.state.update(status="waiting_for_upstream", message=str(reason),
                          nextAttemptAt=max(time.time() + delay, upstream_deadline))
        self.save()
        self.event("rate_limit_wait", seconds=int(self.state["nextAttemptAt"] - time.time()), reason=str(reason))

    def download(self, job, article):
        url = canonical(article["link"])
        self.known.update(inventory())
        if any(r["account"] == job["name"] and r["url"] == url for r in self.state["unavailable"]):
            return
        active = self.state.get("activeDownload")
        same_active = active and active.get("account") == job["name"] and active.get("url") == url
        if (job["name"], url) in self.known:
            if same_active:
                self.record_download(job, article, self.known[(job["name"], url)], True)
                self.state.pop("activeDownload", None)
                self.save()
                return
            if url not in job.setdefault("presentURLs", []):
                job["presentURLs"].append(url)
                job["alreadyPresent"] += 1
            return
        # The shipped downloader removes its initial title directory on an
        # acquisition failure. Do not send a missing URL with an occupied hint
        # directory until that collision is reviewed; preserve existing files.
        safe_hint = re.sub(r'[\\/*?:"<>|]', "_", article["title"].strip())[:60].rstrip("_") or "article"
        account_root = (DATA / "articles_full" / job["name"]).resolve()
        if account_root.parent != (DATA / "articles_full").resolve():
            raise NeedAttention("账号目录超出本次下载范围")
        if (account_root / safe_hint).exists():
            raise NeedAttention("缺失文章与已有标题目录重名，已保留现存文件和检查点：" + article["title"])
        if active and not same_active:
            raise NeedAttention("仍有另一个下载任务未核对，未重复提交")
        if same_active:
            task_id = active["taskId"]
        else:
            result = api("/api/articles/download", {"account_name": job["name"], "articles": [{"title": article["title"], "link": url, "id": article.get("id", "")} ]})
            task_id = result.get("task_id")
        if not task_id:
            raise NeedAttention("下载任务没有返回任务编号，未重发")
        self.state["activeDownload"] = {"account": job["name"], "url": url, "taskId": task_id}
        self.save()
        while True:
            try:
                task = api("/api/articles/download-status/" + quote(task_id, safe=""))
            except NeedAttention as error:
                if same_active and "任务不存在" in str(error):
                    self.state.pop("activeDownload", None)
                    self.save()
                    return self.download(job, article)
                raise
            if task.get("status") in ("completed", "failed", "cancelled"):
                break
            if task.get("status") not in ("running", "cancelling"):
                raise NeedAttention(str(task.get("error") or "下载任务状态无效，未重复提交"))
            self.wait(3)
        successful = [r for r in task.get("results", []) if r.get("success")]
        if successful:
            self.known.update(inventory())
            saved = self.known.get((job["name"], url))
            if not saved:
                raise NeedAttention("工具报告下载成功，但未找到对应阅读HTML，已保留检查点")
            self.record_download(job, article, saved, False)
            self.event("article_downloaded", account=job["name"], title=article["title"])
        else:
            errors = [str(r.get("error") or "") for r in task.get("results", []) if not r.get("success")]
            reason = "; ".join(errors) or str(task.get("stop_reason") or "下载未完成")
            if any(s in reason for s in ("内部分享", "作者已删除", "内容已被", "链接已过期")):
                self.state["unavailable"].append({"account": job["name"], "url": url, "title": article["title"], "reason": reason})
                self.event("article_unavailable", account=job["name"], title=article["title"], reason=reason)
            else:
                raise NeedAttention(reason)
        self.state.pop("activeDownload", None)
        self.save()
        self.wait(3)

    def record_download(self, job, article, saved, resumed):
        url = canonical(article["link"])
        if not any(r["account"] == job["name"] and r["url"] == url for r in self.state["newDownloads"]):
            self.state["newDownloads"].append({"account": job["name"], "url": url, "title": article["title"],
                                                "recoveredAfterInterrupt": resumed, **saved})
            job["downloaded"] += 1

    def page(self, job):
        # Metadata requests remain serial and spaced; every upstream frequency
        # failure schedules a much longer wait, with no identity or route change.
        remaining = 30.0 - (time.monotonic() - self.last_request_at)
        if remaining > 0:
            self.wait(remaining)
        self.last_request_at = time.monotonic()
        params = urlencode({"begin": job["offset"], "count": 20, "keyword": ""})
        response = api("/api/articles/list/" + quote(job["fakeid"], safe="") + "?" + params)
        articles = verified_page(response, pool_state())
        fingerprint = sorted(canonical(a["link"]) for a in articles)
        if fingerprint and fingerprint in job["fingerprints"]:
            raise NeedAttention("目录翻页返回了重复内容，未判定为完整")
        job["status"] = "running"
        self.state.update(status="downloading", nextAttemptAt=0, consecutiveFrequencyLimits=0,
                          message="正在核对 " + job["name"] + " 的真实历史目录")
        self.save()
        old = 0
        for article in articles:
            try:
                published = int(article.get("update_time") or 0)
            except (ValueError, TypeError):
                raise NeedAttention("目录发布时间格式无效，未推进检查点") from None
            known = self.known.get((job["name"], canonical(article["link"])))
            if known and known.get("publishTime"):
                published = int(known["publishTime"])
            if published and published < START:
                old += 1
                ignored = job.setdefault("ignoredURLs", [])
                ignored_url = canonical(article["link"])
                if ignored_url not in ignored:
                    ignored.append(ignored_url)
                    job["outOfRange"] += 1
                continue
            if published and published > END:
                continue
            self.download(job, article)
        job["fingerprints"].append(fingerprint)
        job["pages"] += 1
        if not response.get("can_msg_continue") or (articles and old == len(articles)):
            job["status"] = "completed"
            job["finishedAt"] = timestamp()
        else:
            job["offset"] += 20
        self.save()
        self.event("page_checked", account=job["name"], pages=job["pages"], status=job["status"], downloaded=job["downloaded"])

    def run(self):
        self.event("worker_started", targetAccounts=len(self.state["jobs"]), existingFiles=len(self.known))
        while True:
            job = next((j for j in self.state["jobs"] if j["status"] != "completed"), None)
            if job is None:
                self.state.update(status="completed", completed=True, nextAttemptAt=0, message="75个账号真实目录与日期边界已逐一核对")
                self.save()
                self.event("backfill_completed", newDownloads=len(self.state["newDownloads"]), unavailable=len(self.state["unavailable"]))
                return
            until = self.state.get("nextAttemptAt", 0)
            if until > time.time():
                self.wait(min(30, until - time.time()))
                continue
            try:
                self.page(job)
            except WaitForRateLimit as error:
                self.schedule_frequency_wait(error)
            except LocalAppOffline:
                self.state.update(status="waiting_for_mp_tools", message="等待MP Tools本地服务；未向上游发送请求")
                self.save()
                self.wait(30)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--run", action="store_true")
    parser.add_argument("--stop", action="store_true")
    args = parser.parse_args()
    RUN.mkdir(parents=True, exist_ok=True)
    if args.stop:
        (RUN / "STOP").write_text(timestamp(), encoding="utf-8")
        print("Stop requested; the worker will preserve its cursor.")
        return
    state = load_json(RUN / "state.json", None)
    created = state is None
    if state is None:
        state = new_state(load_json(DATA / "accounts.json", []))
    worker = Backfill(state)
    if not args.run:
        if created:
            worker.save()
        print(json.dumps({"targetAccounts": len(state["jobs"]), "alreadyKnownFiles": len(worker.known),
                          "excluded": state["excluded"], "networkRequests": 0, "stateFile": str(RUN / "state.json")}, ensure_ascii=False))
        return
    if (RUN / "STOP").exists():
        raise SystemExit("STOP marker exists. Inspect the previous reason before restarting.")
    import msvcrt
    lock = (RUN / "worker.lock").open("a+b")
    if lock.tell() == 0:
        lock.write(b"0"); lock.flush()
    lock.seek(0)
    try:
        msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1)
    except OSError:
        raise SystemExit("A backfill worker is already running.")
    state["pid"] = os.getpid()
    # Explicitly inaccessible old results are not retried through a different
    # route. Transport and previous output-patch failures are not permanent.
    target_names = {j["name"] for j in state["jobs"]}
    for row in load_json(DATA / "download_history.json", []):
        reason = str(row.get("error") or "")
        if row.get("success") or row.get("account") not in target_names:
            continue
        if not any(s in reason for s in ("隐私保护，仅内部分享可见", "作者已删除", "内容已被微信屏蔽", "链接已过期")):
            continue
        try:
            link = canonical(row.get("link"))
        except ValueError:
            continue
        if not any(r["account"] == row["account"] and r["url"] == link for r in state["unavailable"]):
            state["unavailable"].append({"account": row["account"], "url": link, "title": row.get("title", ""),
                                         "reason": reason, "origin": "previous_download_history"})
    if not state.get("nextAttemptAt"):
        rows = pool_state()
        recent = [a for a in rows if a.get("last_ret") == -2014]
        if recent:
            last_failure = max(a.get("last_used") or 0 for a in recent)
            state.update(status="waiting_for_upstream", nextAttemptAt=max(time.time(), last_failure + 900),
                         message="已记录目录频率限制，先留出15分钟安静窗口，再作一次正常读取")
    worker.save()
    try:
        worker.run()
    except (NeedAttention, KeyboardInterrupt) as error:
        state.update(status="needs_attention", completed=False, message=str(error), nextAttemptAt=0)
        worker.save()
        worker.event("worker_stopped", reason=str(error))
        raise SystemExit(2)
    except Exception as error:
        state.update(status="needs_attention", completed=False, message="补抓进程异常：" + type(error).__name__, nextAttemptAt=0)
        worker.save()
        worker.event("worker_stopped", reason=state["message"])
        raise SystemExit(2) from None
    finally:
        lock.seek(0)
        msvcrt.locking(lock.fileno(), msvcrt.LK_UNLCK, 1)
        lock.close()


if __name__ == "__main__":
    main()
