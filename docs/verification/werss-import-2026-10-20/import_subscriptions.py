"""Import only the two account sections through the local, documented WeRSS API."""

import base64
import hashlib
import json
import re
import subprocess
import sys
import time
import unicodedata
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import quote
from urllib.request import Request, urlopen

sys.stdout.reconfigure(encoding="utf-8")


ROOT = Path(__file__).resolve().parents[3]
SOURCE = ROOT / "docs/微信公众号_服务号_小程序名称及待识别文章链接.md"
KEY_FILE = ROOT / "CampusOS_Codex_完整设计文档_v2/werss_key.md"
OUT = Path(__file__).resolve().parent
STATE_FILE = OUT / "results.json"
BASE = "http://localhost:8001/api/v1/wx"


def norm(value):
    return re.sub(r"\s+", "", unicodedata.normalize("NFKC", value)).casefold()


def stamp():
    return datetime.now(timezone.utc).isoformat()


secret_text = KEY_FILE.read_text(encoding="utf-8-sig")
ak = re.search(r"(?im)^\s*Access\s*Key\s*[:：=]\s*(\S+)\s*$", secret_text)
sk = re.search(r"(?im)^\s*Secret\s*Key\s*[:：=]\s*(\S+)\s*$", secret_text)
if not ak or not sk:
    raise SystemExit("Credential file format not recognized; no API request sent.")
AUTH = "AK-SK " + ak[1] + ":" + sk[1]
del secret_text, ak, sk


def api(method, path, body=None):
    payload = None if body is None else json.dumps(body, ensure_ascii=False).encode("utf-8")
    req = Request(BASE + path, data=payload, method=method,
                  headers={"Authorization": AUTH, "Content-Type": "application/json"})
    try:
        with urlopen(req, timeout=45) as response:
            result = json.load(response)
    except HTTPError as exc:
        raise RuntimeError("Local API HTTP " + str(exc.code)) from None
    if not isinstance(result, dict) or result.get("code") != 0:
        message = str(result.get("message", "invalid response"))[:200]
        raise RuntimeError("Local API: " + message)
    return result.get("data")


def list_feeds():
    rows = []
    offset = 0
    while True:
        data = api("GET", f"/mps?limit=100&offset={offset}")
        page = data.get("list") or []
        rows.extend({"id": r["id"], "name": r["mp_name"], "status": r["status"]} for r in page)
        if len(rows) >= data["total"] or not page:
            return rows
        offset += len(page)


source_bytes = SOURCE.read_bytes()
source_hash = hashlib.sha256(source_bytes).hexdigest()
targets = []
section = ""
for line in source_bytes.decode("utf-8-sig").splitlines():
    if line.startswith("## "):
        section = line[3:].strip()
    elif section in ("公众号", "服务号") and line.startswith("- "):
        name = line[2:].strip()
        if name and not any(norm(t["name"]) == norm(name) for t in targets):
            targets.append({"name": name, "section": section})

catalog = json.loads((ROOT / "data/console/source-catalog-2026-10-17.json").read_text(encoding="utf-8-sig"))
known_aliases = {norm(r["input"]["displayName"]): norm(r["input"]["wechatId"])
                 for r in catalog["records"]
                 if r["input"].get("wechatId") and r["input"]["sourceType"] in
                 ("wechat_subscription", "wechat_service")}

if STATE_FILE.exists():
    state = json.loads(STATE_FILE.read_text(encoding="utf-8"))
    if state["source_sha256"] != source_hash:
        raise SystemExit("Source changed since the saved operation; stopped before importing.")
else:
    state = {"started_at": stamp(), "source": str(SOURCE), "source_sha256": source_hash,
             "scope": ["公众号", "服务号"], "excluded_sections": ["小程序"],
             "targets": targets, "before": list_feeds(), "results": [], "searches": []}


def save():
    state["updated_at"] = stamp()
    STATE_FILE.write_text(json.dumps(state, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def search_issue(since):
    logs = subprocess.run(["docker", "logs", "--since", since, "we-mp-rss"],
                          capture_output=True, encoding="utf-8", errors="replace", timeout=15)
    text = (logs.stdout + logs.stderr).lower()
    if any(x in text for x in ("200013", "frequencey control", "frequency control")):
        return "平台频控，停止后续查询"
    if any(x in text for x in ("200003", "invalid session", "请先扫码登录公众号平台")):
        return "公众号授权失效，停止后续查询"
    return None


def candidates():
    unique = {}
    for search in state["searches"]:
        for item in search["candidates"]:
            unique[item["fakeid"]] = item
    return list(unique.values())


def select(name):
    pool = candidates()
    exact = [c for c in pool if norm(c["nickname"]) == norm(name)]
    if len(exact) == 1:
        return exact[0], "名称精确匹配"
    alias = known_aliases.get(norm(name))
    matched = [c for c in pool if alias and norm(c.get("alias", "")) == alias]
    if not exact and len(matched) == 1:
        return matched[0], "原目录微信号匹配"
    return None, None


feeds = list_feeds()
last_search = 0.0
done = {r["requested_name"] for r in state["results"]}
save()
for index, target in enumerate(targets, start=1):
    name = target["name"]
    if name in done:
        continue
    row = {"requested_name": name, "section": target["section"], "at": stamp()}
    existing = [f for f in feeds if norm(f["name"]) == norm(name)]
    try:
        if len(existing) == 1:
            row.update(status="existing", id=existing[0]["id"], actual_name=existing[0]["name"])
        else:
            chosen, reason = select(name)
            if chosen is None:
                delay = 8 - (time.monotonic() - last_search)
                if delay > 0:
                    time.sleep(delay)
                since = stamp()
                data = api("GET", "/mps/search/" + quote(name, safe="") + "?limit=10&offset=0")
                last_search = time.monotonic()
                found = [{k: item.get(k, "") for k in
                          ("fakeid", "nickname", "alias", "round_head_img", "signature", "service_type")}
                         for item in (data.get("list") or [])]
                state["searches"].append({"query": name, "at": since, "candidates": found})
                if not found:
                    issue = search_issue(since)
                    if issue:
                        state["stopped_reason"] = issue
                        row.update(status="blocked", reason=issue)
                        state["results"].append(row)
                        save()
                        print(f"[{index}/{len(targets)}] BLOCKED {name}: {issue}", flush=True)
                        break
                chosen, reason = select(name)
            if chosen is None:
                search = next((s for s in reversed(state["searches"]) if s["query"] == name), None)
                row.update(status="unmatched", reason="无唯一精确名称或已知微信号匹配",
                           candidates=[{"name": c["nickname"], "alias": c["alias"]}
                                       for c in (search or {}).get("candidates", [])])
            else:
                decoded = base64.b64decode(chosen["fakeid"]).decode("ascii")
                if not decoded.isdigit():
                    raise RuntimeError("Search returned an invalid account ID")
                feed_id = "MP_WXS_" + decoded
                same_id = next((f for f in feeds if f["id"] == feed_id), None)
                if same_id:
                    row.update(status="existing", id=feed_id, actual_name=same_id["name"], match=reason)
                else:
                    created = api("POST", "/mps", {"mp_name": chosen["nickname"], "mp_id": chosen["fakeid"],
                                  "avatar": chosen["round_head_img"], "mp_cover": chosen["round_head_img"],
                                  "mp_intro": str(chosen["signature"])[:255]})
                    verified = api("GET", "/mps/" + quote(feed_id, safe=""))
                    if created.get("id") != feed_id or verified.get("id") != feed_id or norm(verified["mp_name"]) != norm(chosen["nickname"]):
                        raise RuntimeError("Created account verification did not match")
                    feeds.append({"id": feed_id, "name": verified["mp_name"], "status": verified["status"]})
                    row.update(status="added", id=feed_id, actual_name=verified["mp_name"], match=reason)
    except Exception as exc:
        row.update(status="failed", reason=str(exc)[:200] if isinstance(exc, RuntimeError) else type(exc).__name__)
        state["stopped_reason"] = "请求失败，暂停以免重复写入或持续请求"
        state["results"].append(row)
        save()
        print(f"[{index}/{len(targets)}] FAILED {name}: {row['reason']}", flush=True)
        break
    state["results"].append(row)
    save()
    print(f"[{index}/{len(targets)}] {row['status'].upper()} {name}" +
          (" -> " + row["actual_name"] if row.get("actual_name") and row["actual_name"] != name else ""), flush=True)

if "--extra-searches" in sys.argv:
    extras = json.loads((OUT / "extra-searches.json").read_text(encoding="utf-8"))
    for extra in extras:
        if any(s["query"] == extra["query"] for s in state["searches"]):
            continue
        delay = 8 - (time.monotonic() - last_search)
        if delay > 0:
            time.sleep(delay)
        since = stamp()
        data = api("GET", "/mps/search/" + quote(extra["query"], safe="") + "?limit=10&offset=0")
        last_search = time.monotonic()
        found = [{k: item.get(k, "") for k in
                  ("fakeid", "nickname", "alias", "round_head_img", "signature", "service_type")}
                 for item in (data.get("list") or [])]
        state["searches"].append({"query": extra["query"], "requested_name": extra["requested_name"],
                                  "reason": extra["reason"], "at": since, "candidates": found})
        save()
        print("EXTRA " + extra["query"] + ": " + ", ".join(c["nickname"] for c in found), flush=True)
        if not found:
            issue = search_issue(since)
            if issue:
                state["stopped_reason"] = issue
                save()
                break

if "--review" in sys.argv:
    reviewed = json.loads((OUT / "reviewed-matches.json").read_text(encoding="utf-8"))
    feeds = list_feeds()
    for mapping in reviewed:
        row = next(r for r in state["results"] if r["requested_name"] == mapping["requested_name"])
        if row["status"] in ("added", "existing"):
            continue
        chosen = next((c for c in candidates() if c["fakeid"] == mapping["fakeid"] and
                       c["nickname"] == mapping["actual_name"]), None)
        if chosen is None:
            raise RuntimeError("Reviewed match not present in actual search responses")
        decoded = base64.b64decode(chosen["fakeid"]).decode("ascii")
        if not decoded.isdigit():
            raise RuntimeError("Invalid reviewed account ID")
        feed_id = "MP_WXS_" + decoded
        existing = next((f for f in feeds if f["id"] == feed_id), None)
        if existing:
            new_status = "existing"
        else:
            api("POST", "/mps", {"mp_name": chosen["nickname"], "mp_id": chosen["fakeid"],
                                  "avatar": chosen["round_head_img"], "mp_cover": chosen["round_head_img"],
                                  "mp_intro": str(chosen["signature"])[:255]})
            checked = api("GET", "/mps/" + quote(feed_id, safe=""))
            if checked["id"] != feed_id or checked["mp_name"] != chosen["nickname"]:
                raise RuntimeError("Reviewed account verification did not match")
            feeds.append({"id": feed_id, "name": checked["mp_name"], "status": checked["status"]})
            new_status = "added"
        row["initial_status"] = row["status"]
        row.update(status=new_status, id=feed_id, actual_name=chosen["nickname"],
                   match="简称/现名复核", reason=mapping["reason"], reviewed_at=stamp())
        save()
        print("REVIEW " + row["requested_name"] + " -> " + chosen["nickname"] + " (" + new_status + ")", flush=True)

state["after"] = list_feeds()
state["finished_at"] = stamp()
save()
counts = {status: sum(r["status"] == status for r in state["results"])
          for status in ("added", "existing", "unmatched", "blocked", "failed")}
print(json.dumps({"counts": counts, "total_feeds": len(state["after"]),
                  "processed": len(state["results"]), "targets": len(targets),
                  "stopped_reason": state.get("stopped_reason")}, ensure_ascii=False), flush=True)
