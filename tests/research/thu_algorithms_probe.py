"""Offline research probes, not CampusOS product tests or upstream patches.

Run with a fresh stdlib-only Python venv and a pinned local clone:
  python tests/research/thu_algorithms_probe.py --upstream <clone> --output <json>
No accounts, SMTP, browser control, model calls, or real articles are used.
"""
from __future__ import annotations

import argparse
import dataclasses
import datetime as dt
import hashlib
import io
import json
import os
from pathlib import Path
import platform
import sqlite3
import sys
import tempfile
import time
import unittest
from contextlib import redirect_stderr, redirect_stdout
from unittest import mock

PIN = "19abc55134cf5691e575fbcc74cb88d3801c2b28"
TZ = dt.timezone(dt.timedelta(hours=8))
NOW = dt.datetime(2026, 10, 17, 9, tzinfo=TZ)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--upstream", required=True, type=Path)
    ap.add_argument("--output", required=True, type=Path)
    args = ap.parse_args()
    upstream = args.upstream.resolve()
    for key in list(os.environ):
        if key.startswith(("ND_", "SMTP_", "MAIL_", "NOTICE_DIGEST_")):
            os.environ.pop(key, None)
    os.environ["PYTHONDONTWRITEBYTECODE"] = "1"
    sys.dont_write_bytecode = True
    blocked: list[str] = []

    def prevent_io(event, event_args):
        if event in {
            "socket.connect", "socket.connect_ex", "socket.bind",
            "socket.getaddrinfo", "smtplib.connect", "smtplib.send",
            "subprocess.Popen", "os.system",
        }:
            blocked.append(event)
            raise RuntimeError("Research policy: network, listeners, SMTP and child processes disabled")

    sys.addaudithook(prevent_io)
    sys.path.insert(0, str(upstream))
    from notice_digest import config, feedback, gzh_source, render, score
    from notice_digest.enrich import parsed_for_item
    from notice_digest.store import Store
    from notice_digest.timeparse import parse_item_time, time_status

    result = {
        "checkedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
        "upstream": {"repository": "thu-lawyer/thu-push", "commit": PIN},
        "runtime": {"python": platform.python_version(), "platform": platform.system(),
                    "dependenciesInstalled": [], "freshVenv": sys.prefix != sys.base_prefix},
        "scope": "Synthetic fixtures and local temporary SQLite only; no article retrieval, SMTP, model or CDP calls.",
        "guards": {"networkListenersAndProcessesBlockedByAuditHook": True,
                   "credentialEnvironmentCleared": True},
        "sourceHashes": {}, "upstreamTests": {}, "probes": [],
    }
    for rel in ["LICENSE", "notice_digest/timeparse.py", "notice_digest/score.py",
                "notice_digest/render.py", "notice_digest/gzh_source.py",
                "notice_digest/mailer.py", "notice_digest/feedback.py",
                "tests/test_timeparse.py", "tests/test_score.py", "tests/test_gzh_merge.py"]:
        result["sourceHashes"][rel] = hashlib.sha256((upstream / rel).read_bytes()).hexdigest()

    # Exact requested test modules, but exclude the class that actually binds a
    # loopback HTTP server. No SMTP/model mock is confused with a live service.
    suites = ["tests.test_timeparse", "tests.test_score",
              "tests.test_gzh_merge.GzhSourceTests", "tests.test_gzh_merge.RenderGzhMergeTests"]
    for name in suites:
        log = io.StringIO()
        started = time.perf_counter()
        with redirect_stdout(log), redirect_stderr(log):
            suite = unittest.defaultTestLoader.loadTestsFromName(name)
            tested = unittest.TextTestRunner(stream=log, verbosity=1).run(suite)
        result["upstreamTests"][name] = {
            "run": tested.testsRun, "failures": len(tested.failures),
            "errors": len(tested.errors), "skipped": len(tested.skipped),
            "seconds": round(time.perf_counter() - started, 6),
            "passed": tested.wasSuccessful(),
            "output": log.getvalue()[-5000:],
        }
    result["upstreamTestsNotRun"] = {
        "tests.test_gzh_merge.FeedbackIcsHttpTests": {
            "count": 5, "reason": "Starts a real loopback HTTP server; excluded to keep this run offline and listener-free."
        },
        "fullSuite": "Not run: other modules include network/SMTP/model paths. This is not full upstream or CampusOS regression acceptance."
    }

    def parse(text, anchor=NOW, title="合成活动", body="", evidence=""):
        return parse_item_time(title, text, evidence, body, anchor)

    def add(name, fn):
        try:
            result["probes"].append({"name": name, "completed": True, **fn()})
        except Exception as exc:
            result["probes"].append({"name": name, "completed": False,
                                     "exception": type(exc).__name__, "message": str(exc)[:300]})

    cfg = config.Config(feedback_base="", hmac_secret="")
    basic = {"id": "synthetic:1", "title": "合成活动", "url": "https://example.invalid/source/1",
             "source_name": "合成来源", "category": "学术科研", "event_location": "合成地点"}

    def ics_for(item, parsed, single=False):
        if single:
            return render.build_single_event_ics(item, parsed, NOW)
        return render.render_ics([score.Scored(item=item)], {item["id"]: parsed}, cfg, NOW)

    add("explicit_datetime", lambda: {"input": "2026年10月20日14:30", "output": parse("2026年10月20日14:30").as_dict()})
    add("date_only_deadline_precision", lambda: {
        "input": "报名截止2026年10月20日",
        "output": parse("报名截止2026年10月20日").as_dict(),
        "timeStatus": time_status(parse("报名截止2026年10月20日")),
        "calendarEventCount": ics_for(basic, parse("报名截止2026年10月20日")).count("BEGIN:VEVENT"),
        "hasPrecisionOrInferenceMetadata": any(k in parse("报名截止2026年10月20日").as_dict() for k in ["precision", "inferred", "anchor", "verified"]),
    })
    add("range_end_becomes_deadline_without_registration", lambda: {
        "input": "2026年10月20日至2026年10月22日", "output": parse("2026年10月20日至2026年10月22日").as_dict(),
        "calendarDateLines": [l for l in ics_for(basic, parse("2026年10月20日至2026年10月22日")).splitlines() if l.startswith(("DTSTART;VALUE", "DTEND;VALUE"))],
    })
    add("missing_year_roll_forward", lambda: {"input": "1月5日", "anchor": NOW.isoformat(), "output": parse("1月5日").as_dict()})
    published = dt.datetime(2026, 10, 1, 10, tzinfo=TZ)
    add("relative_anchor_changes_result", lambda: {
        "input": "下周五14:00", "publishedAt": published.isoformat(), "fetchedAt": NOW.isoformat(),
        "usingPublishedAnchor": parse("下周五14:00", published).as_dict(),
        "usingFetchAnchor": parse("下周五14:00", NOW).as_dict(),
        "callerPublishedAtUsed": parsed_for_item({"title":"合成", "published_at":published.isoformat(), "detail":{"ai_event_time":"下周五14:00"}}, NOW).as_dict(),
    })
    add("vague_evening_invents_19", lambda: {"input":"今晚", "output":parse("今晚").as_dict(), "timeStatus":time_status(parse("今晚"))})
    add("evening_seven_ambiguity", lambda: {"input":"今晚7点", "output":parse("今晚7点").as_dict()})
    add("invalid_absolute_falls_back_day_only", lambda: {"input":"2026年2月30日", "output":parse("2026年2月30日").as_dict()})
    add("weekday_conflict_not_rejected", lambda: {"input":"2026年10月20日（周五）14:00", "output":parse("2026年10月20日（周五）14:00").as_dict()})
    add("same_day_clock_range", lambda: {"input":"2026年10月20日14:00-16:00", "output":parse("2026年10月20日14:00-16:00").as_dict()})
    add("multiple_events_only_first_point", lambda: {"input":"第一场2026年10月20日14:00；第二场2026年10月21日15:00", "output":parse("第一场2026年10月20日14:00；第二场2026年10月21日15:00").as_dict()})

    def ics_probes():
        timed = parse("2026年10月20日14:30")
        updated = parse("2026年10月21日15:30")
        old = ics_for({**basic, "sequence": 1, "updated_at": "2026-10-17T01:00:00Z"}, timed)
        new = ics_for({**basic, "sequence": 2, "updated_at": "2026-10-18T01:00:00Z"}, updated)
        single = ics_for({**basic, "sequence": 2}, updated, single=True)
        cancelled = ics_for({**basic, "status": "cancelled", "sequence": 3}, updated)
        injected = {**basic, "title": "标题\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:attack",
                    "event_location": "位置\nATTENDEE:evil", "url": "https://example.invalid/\r\nBEGIN:VEVENT"}
        attack = ics_for(injected, timed)
        long_ics = ics_for({**basic, "title": "合成汉字" * 100}, timed)
        uid = lambda text: next(l for l in text.splitlines() if l.startswith("UID:"))
        return {
            "stableUidAcrossTimeChange": uid(old) == uid(new),
            "batchHasSequenceAndLastModified": "SEQUENCE:2\r\n" in new and "LAST-MODIFIED:" in new,
            "singleHasSequence": "SEQUENCE:" in single,
            "singleHasLastModified": "LAST-MODIFIED:" in single,
            "cancelledOutputStatus": [l for l in cancelled.splitlines() if l.startswith(("STATUS:", "METHOD:"))],
            "literalNewlineCannotCreateExtraEvent": attack.count("\r\nBEGIN:VEVENT\r\n") == 1,
            "allPhysicalLinesAtMost75Bytes": max(len(l.encode()) for l in long_ics.split("\r\n")) <= 75,
            "crlfOnly": "\n" not in long_ics.replace("\r\n", ""),
            "tzidPresent": "DTSTART;TZID=Asia/Shanghai:" in old and "BEGIN:VTIMEZONE" in old,
            "unknownStartProducesNoEvent": ics_for(basic, parse("时间待定")).count("BEGIN:VEVENT") == 0,
            "verificationRequiredByRenderer": False,
        }
    add("ics_safety_update_cancel", ics_probes)

    def score_probes():
        items = [{**basic, "id": "b", "title":"合成讲座"}, {**basic, "id":"a", "title":"合成讲座"}]
        ranked = score.score_items(items, {}, cfg, NOW)
        configured = dataclasses.replace(cfg, weights_prior={"cat:学术科研":999})
        prior = score.merged_weights(cfg, {})["kw:讲座"]
        deltas = score.apply_feedback_deltas({}, score.merged_weights(cfg, {}), {**basic, "title":"讲座"}, cfg, NOW, reward=0.8)
        return {
            "deterministicTieOrder": [s.item_id for s in ranked],
            "contributionsSumToScore": all(abs(s.score - sum(v for _,v in s.reasons))<1e-8 for s in ranked),
            "asciiSubstringAiFalsePositive": "kw:AI" in score.features_of({**basic,"title":"chair"}, cfg, NOW),
            "configuredPriorCanExceedFive": score.merged_weights(configured, {})["cat:学术科研"],
            "storedWeightIsClamped": score.merged_weights(cfg, {"probe":999})["probe"],
            "priorForLecture": prior,
            "learnedDelta": deltas.get("kw:讲座"),
            "mergedAfterDelta": score.merged_weights(cfg, deltas).get("kw:讲座"),
            "mergedPriorPlusDeltaExpectedByComment": prior + deltas.get("kw:讲座",0),
        }
    add("deterministic_ranking_boundaries", score_probes)

    def gzh_probes():
        items=[{"title":"合成讲座", "mp":"合成来源", "url":"https://example.invalid/1"},
               {"title":"普通合成通知", "mp":"合成来源", "url":"https://example.invalid/2"}]
        logs=io.StringIO()
        # A mocked failure is explicitly not a real model test.
        with mock.patch.object(gzh_source,"zhipu_rank",return_value=None) as ranked:
            picked=gzh_source.rank(items,2,dataclasses.replace(cfg,gzh_zhipu_api_key="synthetic-not-a-key",gzh_llm_model="synthetic"))
        string_error=None
        try:string_epoch=gzh_source.to_epoch("2026-10-17 08:00:00")
        except Exception as exc:string_epoch=None;string_error=type(exc).__name__+": "+str(exc)
        with tempfile.TemporaryDirectory() as tmp:
            db=Path(tmp)/"synthetic.db"
            con=sqlite3.connect(db)
            con.executescript("CREATE TABLE articles(id INTEGER PRIMARY KEY,title TEXT,url TEXT,mp_id TEXT,publish_time INTEGER);CREATE TABLE feeds(id TEXT,name TEXT);")
            epoch=int(NOW.timestamp())
            con.executemany("INSERT INTO articles VALUES(?,?,?,?,?)",[(1,"合成过去文章","https://example.invalid/past","mp1",epoch-3600),(2,"合成未来文章","https://example.invalid/future","mp1",epoch+86400)])
            con.execute("INSERT INTO feeds VALUES('mp1','合成来源')");con.commit();con.close()
            con=gzh_source.open_db_ro(db)
            ro=False
            try:con.execute("DELETE FROM articles")
            except sqlite3.OperationalError:ro=True
            rows=gzh_source.fetch_recent(con,gzh_source.find_article_schema(con),gzh_source.find_feed_names(con),26,now_ts=epoch)
            con.close()
            corrupted=Path(tmp)/"broken.json";corrupted.write_text("not-json")
            no_time=sqlite3.connect(":memory:");no_time.execute("CREATE TABLE articles(id INTEGER,title TEXT,url TEXT,mp_id TEXT)")
            bad_mapping=gzh_source.find_article_schema(no_time)
            schema_error=None
            try:gzh_source.fetch_recent(no_time,bad_mapping,{},26,now_ts=epoch)
            except Exception as exc:schema_error=type(exc).__name__+": "+str(exc)
            no_time.close()
            return {
                "modelFailureWasMocked": ranked.called, "fallbackIndices": picked,
                "numericMillisecondsSupported":gzh_source.to_epoch(epoch*1000)==float(epoch),
                "stringTimestamp":string_epoch, "stringTimestampError":string_error,
                "readOnlySqliteEnforced":ro,
                "futureTimestampAccepted":any(r["ts"]>epoch for r in rows),
                "corruptLedgerBecomesEmpty":not gzh_source.load_state(corrupted),
                "missingDatabaseBecomesEmpty":gzh_source.collect(dataclasses.replace(cfg,gzh_db=str(Path(tmp)/"missing.db")))==[],
                "schemaAllowsMissingTime":bad_mapping["time"] is None,
                "missingTimeFetchError":schema_error,
                "trackingQueryChangesArticleIdentity":gzh_source.article_key("https://example.invalid/s/1")!=gzh_source.article_key("https://example.invalid/s/1?scene=1"),
                "punctuationDifferentTitlesMerge":gzh_source.normalize_title("合成甲-乙讲座")==gzh_source.normalize_title("合成甲乙讲座"),
            }
    add("gzh_readonly_and_failure_boundaries",gzh_probes)

    def feedback_probes():
        signed_cfg=dataclasses.replace(cfg,hmac_secret="synthetic-research-secret-not-a-runtime-key",feedback_base="https://example.invalid")
        links=render._feedback_links("synthetic:1",signed_cfg)
        from urllib.parse import parse_qs,urlparse
        query=parse_qs(urlparse(links["up"]).query)
        with tempfile.TemporaryDirectory() as tmp:
            st=Store(Path(tmp)/"synthetic.db");st.init_schema();st.upsert_items([basic])
            first=feedback.record_and_learn(st,signed_cfg,basic["id"],"up",NOW,token="synthetic-one")
            duplicate=feedback.record_and_learn(st,signed_cfg,basic["id"],"up",NOW,token="synthetic-one")
            unknown=feedback.record_and_learn(st,signed_cfg,"gzh-synthetic-unknown","up",NOW)
            feedback_rows=st.conn.execute("PRAGMA table_info(feedback)").fetchall()
            st.close()
        return {
            "renderedLinkHasExpiry": "exp" in query,
            "legacyNoExpirySignatureAccepted":feedback.verify_token(query["t"][0],"synthetic:1","up",signed_cfg),
            "missingExpiryNotExpired":not feedback.is_expired(None,NOW),
            "hmacBindsItemAndKind":not feedback.verify_token(query["t"][0],"synthetic:2","up",signed_cfg) and not feedback.verify_token(query["t"][0],"synthetic:1","down",signed_cfg),
            "feedbackColumns":[row[1] for row in feedback_rows],
            "firstLearned":first["learned"], "duplicateLearned":duplicate["learned"],
            "unknownGzhLearned":unknown["learned"], "unknownGzhReason":unknown.get("reason"),
            "isolationIsSingleLocalProfileNotMultiUser":True,
        }
    add("feedback_expiry_identity",feedback_probes)
    result["guards"]["blockedAttempts"] = blocked
    result["summary"] = {
        "upstreamTestsRun":sum(t["run"] for t in result["upstreamTests"].values()),
        "upstreamFailures":sum(t["failures"] for t in result["upstreamTests"].values()),
        "upstreamErrors":sum(t["errors"] for t in result["upstreamTests"].values()),
        "probesCompleted":sum(p["completed"] for p in result["probes"]),
        "probesTotal":len(result["probes"]),
        "meaning":"Probes observe pinned upstream behavior; completed does not mean CampusOS requirements pass.",
        "liveArticleRequests":0, "liveModelRequests":0, "liveSmtpSends":0,
    }
    args.output.parent.mkdir(parents=True,exist_ok=True)
    args.output.write_text(json.dumps(result,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    print(json.dumps(result["summary"],ensure_ascii=False,indent=2))
    return 0 if all(t["passed"] for t in result["upstreamTests"].values()) and all(p["completed"] for p in result["probes"]) and not blocked else 1


if __name__ == "__main__":
    raise SystemExit(main())
