// OpenNext 1.20 serializes .env files into next-env.mjs. Only public build
// variables belong in the distributable; server values come from bindings.
export function publicWorkerEnvironment(source) {
  const modes = ["production", "development", "test"];
  const lines = source.trim().split(/\r?\n/);
  if (lines.length !== modes.length)
    throw new Error("Unexpected OpenNext environment output");
  const privateValues = [];
  const content =
    lines
      .map((line, index) => {
        const match = line.match(
          /^export const (production|development|test) = (.*);$/,
        );
        if (!match || match[1] !== modes[index])
          throw new Error("Unexpected OpenNext environment export");
        const values = JSON.parse(match[2]);
        if (
          !values ||
          typeof values !== "object" ||
          Array.isArray(values) ||
          Object.values(values).some((v) => typeof v !== "string")
        )
          throw new Error("Invalid OpenNext environment values");
        const publicValues = {};
        for (const [key, value] of Object.entries(values)) {
          const secretName =
            /(?:^|_)(?:KEY|TOKEN|SECRET|PASSWORD)(?:_|$)/.test(key) ||
            key === "AMAP_SECURITY_JS_CODE";
          if (key.startsWith("NEXT_PUBLIC_")) {
            if (secretName)
              throw new Error(
                "Secret-like public variable must be reviewed before building",
              );
            publicValues[key] = value;
          } else if (secretName && value.length > 7) privateValues.push(value);
        }
        return `export const ${match[1]} = ${JSON.stringify(publicValues)};`;
      })
      .join("\n") + "\n";
  return { content, privateValues: [...new Set(privateValues)] };
}
