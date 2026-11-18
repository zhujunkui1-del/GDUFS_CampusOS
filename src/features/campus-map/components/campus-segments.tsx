"use client";
import "./campus-segments.css";
export type CampusId = "university" | "baiyun";
export function CampusSegments({
  value,
  onChange,
  label = "选择校区",
}: {
  value: CampusId;
  onChange(value: CampusId): void;
  label?: string;
}) {
  return (
    <div
      className="campus-switcher"
      role="group"
      aria-label={label}
      data-campus={value}
    >
      <span className="campus-switcher-thumb" aria-hidden="true" />
      {(["university", "baiyun"] as const).map((campus) => (
        <button
          type="button"
          key={campus}
          aria-pressed={campus === value}
          onClick={() => onChange(campus)}
        >
          {campus === "university" ? "大学城校区" : "白云山校区"}
        </button>
      ))}
    </div>
  );
}
