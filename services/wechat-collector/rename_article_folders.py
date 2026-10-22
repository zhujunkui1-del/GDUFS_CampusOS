"""Rename our existing hash folders within one explicitly selected account.

Keeps article bytes unchanged and updates only matching local path references.
Original JSON files and a reversible move manifest stay in MP Tools' data.
"""
import argparse
from datetime import datetime, timezone, timedelta
import hashlib
import json
from pathlib import Path
import sqlite3
import subprocess

from mp_tools_reading_export import campusos_article_metadata, campusos_folder_name, _campusos_article_key

TOOLS = Path(r"D:\WeChat MP Tools")
DATA = TOOLS / "data"


def digest(file):
    return hashlib.sha256(file.read_bytes()).hexdigest()


def rewrite_paths(value, moves, count):
    if isinstance(value, str):
        normalized = value.replace("/", "\\")
        for old, new in moves:
            previous = str(old).replace("/", "\\")
            if normalized.lower() == previous.lower() or normalized.lower().startswith(previous.lower() + "\\"):
                count[0] += 1
                result = str(new) + normalized[len(previous):]
                return result.replace("\\", "/") if "\\" not in value else result
        return value
    if isinstance(value, list):
        return [rewrite_paths(item, moves, count) for item in value]
    if isinstance(value, dict):
        return {key: rewrite_paths(item, moves, count) for key, item in value.items()}
    return value


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    root = args.root.resolve()
    if root.parent != (DATA / "articles_full").resolve() or args.root.is_symlink():
        raise RuntimeError("Select exactly one account directory in MP Tools articles_full")
    names = {p.name.lower() for p in root.iterdir()}
    plan = []
    for previous in sorted(root.glob("campusos-*")):
        if not previous.is_dir() or previous.is_symlink():
            continue
        meta = campusos_article_metadata(previous)
        key = _campusos_article_key(meta.get("url"))
        if not key or not meta.get("title"):
            continue
        short = hashlib.sha256(key.encode()).hexdigest()
        for suffix in ("", " ["+short[:8]+"]", " ["+short[:16]+"]", " ["+short[:32]+"]"):
            name = campusos_folder_name(meta["title"], root, suffix)
            if name.lower() not in names:
                break
        else:
            raise RuntimeError("All title names are occupied")
        following = root / name
        if previous.resolve().parent != root or following.resolve().parent != root or following.exists():
            raise RuntimeError("Unsafe or occupied rename target")
        names.add(name.lower())
        plan.append({"old":str(previous),"new":str(following),"htmlSha256":digest(previous/"reading.html")})
    moves = [(Path(row["old"]), Path(row["new"])) for row in plan]
    updates = []
    for file in (DATA/"download_history.json", DATA/"rss_articles.json"):
        if not file.is_file():
            continue
        original = file.read_bytes()
        parsed = json.loads(original.decode("utf-8-sig"))
        count = [0]
        updated = rewrite_paths(parsed, moves, count)
        if count[0]:
            updates.append((file,original,(json.dumps(updated,ensure_ascii=False,indent=2)+"\n").encode(),count[0]))
    state_file = DATA/"CampusOS_collector/state.sqlite3"
    state_paths = []
    if state_file.is_file():
        with sqlite3.connect(state_file.as_uri()+"?mode=ro",uri=True) as db:
            for old,new in moves:
                for (path,) in db.execute("SELECT path FROM files WHERE path=? OR path LIKE ?", (str(old),str(old)+"\\%")):
                    state_paths.append((path,str(new)+path[len(str(old)):]))
    if not args.apply:
        print(json.dumps({"mode":"plan","folders":plan,"historyPaths":sum(x[3] for x in updates),"collectorPaths":len(state_paths)},ensure_ascii=False))
        return
    running = subprocess.run(["powershell.exe","-NoProfile","-Command","@(Get-Process -Name 'WeChat MP Tools' -ErrorAction SilentlyContinue).Count"],capture_output=True,text=True,check=True)
    if int(running.stdout.strip() or "0"):
        raise RuntimeError("Close MP Tools before renaming download history paths")
    backup = DATA/"patches/title-folders-2026-10-22"/datetime.now(timezone(timedelta(hours=8))).strftime("%Y%m%d-%H%M%S")
    backup.mkdir(parents=True,exist_ok=False)
    for file,original,_,_ in updates:
        (backup/file.name).write_bytes(original)
    report = {"mode":"apply","root":str(root),"folders":plan,"historyPaths":sum(x[3] for x in updates),"collectorPaths":len(state_paths),"complete":False}
    (backup/"report.json").write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding="utf-8")
    moved, written = [], []
    state = None
    try:
        if state_paths:
            state = sqlite3.connect(state_file,timeout=10)
            with sqlite3.connect(backup/"state.before.sqlite3") as before:
                state.backup(before)
            state.execute("BEGIN IMMEDIATE")
            for old,new in state_paths:
                if state.execute("SELECT 1 FROM files WHERE path=?",(new,)).fetchone():
                    raise RuntimeError("The collector already contains the new path")
                state.execute("UPDATE files SET path=? WHERE path=?",(new,old))
        for row,(old,new) in zip(plan,moves):
            # Both resolved absolute targets are verified before each directory move.
            if old.is_symlink() or old.resolve().parent != root or new.resolve().parent != root or new.exists() or digest(old/"reading.html") != row["htmlSha256"]:
                raise RuntimeError("Article paths changed during preparation")
            old.rename(new)
            moved.append((old,new))
            if digest(new/"reading.html") != row["htmlSha256"]:
                raise RuntimeError("Article bytes changed")
        for file,original,updated,_ in updates:
            if file.read_bytes() != original:
                raise RuntimeError("History changed during preparation")
            pending = file.with_name(file.name+".title-folders.tmp")
            pending.write_bytes(updated)
            pending.replace(file)
            written.append((file,original,updated))
        if state:
            state.commit()
        report["complete"] = True
    except Exception:
        if state:
            state.rollback()
        for file,original,updated in reversed(written):
            if file.read_bytes() == updated:
                pending=file.with_name(file.name+".title-folders.tmp")
                pending.write_bytes(original)
                pending.replace(file)
        for old,new in reversed(moved):
            if new.resolve().parent == root and old.resolve().parent == root and not old.exists():
                new.rename(old)
        raise
    finally:
        if state:
            state.close()
        (backup/"report.json").write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding="utf-8")
    print(json.dumps({"renamed":len(plan),"historyPaths":report["historyPaths"],"collectorPaths":len(state_paths),"articleBytesUnchanged":True,"reportPath":str(backup/"report.json"),"names":[new.name for _,new in moves]},ensure_ascii=False))


if __name__ == "__main__":
    main()
