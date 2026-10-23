export function robotsAllow(body: string, path: string) {
  const groups: {
    agents: string[];
    rules: { allow: boolean; pattern: string }[];
  }[] = [];
  let group = {
    agents: [] as string[],
    rules: [] as { allow: boolean; pattern: string }[],
  };
  for (const line of body.split(/\r?\n/)) {
    const pair = line.split("#")[0].match(/^\s*([\w-]+)\s*:\s*(.*?)\s*$/);
    if (!pair) continue;
    const [, key, value] = pair;
    if (key.toLowerCase() === "user-agent") {
      if (group.rules.length) {
        groups.push(group);
        group = { agents: [], rules: [] };
      }
      group.agents.push(value.toLowerCase());
    } else if (["allow", "disallow"].includes(key.toLowerCase()) && value)
      group.rules.push({
        allow: key.toLowerCase() === "allow",
        pattern: value,
      });
  }
  groups.push(group);
  const specific = groups.filter((g) =>
    g.agents.some((a) => a !== "*" && "campusos-research".includes(a)),
  );
  const active = specific.length
    ? specific
    : groups.filter((g) => g.agents.includes("*"));
  let best = -1,
    allowed = true;
  for (const r of active.flatMap((g) => g.rules)) {
    const pattern = r.pattern
      .replace(/[.+?^{}()|[\]\\]/g, "\\$&")
      .replace(/\*/g, ".*")
      .replace(/\$$/, "$");
    if (
      new RegExp("^" + pattern).test(path) &&
      (r.pattern.length > best || (r.pattern.length === best && r.allow))
    ) {
      best = r.pattern.length;
      allowed = r.allow;
    }
  }
  return allowed;
}

export function robotsCrawlDelay(body: string) {
  const values = body
    .split(/\r?\n/)
    .map((line) => line.split("#")[0].match(/^\s*crawl-delay\s*:\s*(\d+(?:\.\d+)?)\s*$/i)?.[1])
    .filter(Boolean)
    .map((value) => Number(value) * 1000)
    .filter((value) => Number.isFinite(value) && value >= 0 && value <= 300000);
  return values.length ? Math.max(...values) : 0;
}
