import type { CSSProperties } from "react";
export function articleThemeStyle(code: string): CSSProperties {
  let hash = 0;
  for (const char of code) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  const hue = hash % 360;
  return {
    "--feed-accent": `hsl(${hue} 43% 38%)`,
    "--feed-tint": `hsl(${hue} 58% 96%)`,
  } as CSSProperties;
}
