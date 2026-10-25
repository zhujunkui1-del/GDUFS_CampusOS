import { articleThemeStyle } from "./article-theme";
import "./registration-badge.css";
export function RegistrationBadge({
  show,
  category,
}: {
  show?: boolean;
  category?: string | null;
}) {
  return show ? (
    <span
      className="article-registration-badge"
      style={articleThemeStyle(category || "unclassified")}
      title="文章包含报名事项"
      aria-label="文章包含报名事项"
    >
      报
    </span>
  ) : null;
}
