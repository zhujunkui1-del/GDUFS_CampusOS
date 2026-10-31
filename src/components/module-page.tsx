import Link from "next/link";
import {
  Radar,
  BookOpen,
  Bookmark,
  UserRound,
  ArrowUpRight,
  ChevronDown,
} from "lucide-react";

const pages = {
  radar: {
    eyebrow: "CampusRadar",
    title: "校园雷达",
    text: "公告、讲座、竞赛与报名截止，来源和时间一并核对。",
    empty: "暂无已核验的活动",
    detail: "活动来源尚未接入。发布前会核对时间、校区与地点，并保留原文链接。",
    icon: Radar,
  },
  knowledge: {
    eyebrow: "校园知识",
    title: "校园知识",
    text: "校园政策、办事指南和官方通知，从原文开始。",
    empty: "知识来源尚未接入",
    detail: "经核验的官方资料接入后，可在此检索并查看原文及适用范围。",
    icon: BookOpen,
  },
  favorites: {
    eyebrow: "我的校园",
    title: "我的收藏",
    text: "常去地点、关注活动与常用办事入口。",
    empty: "收藏同步尚未开放",
    detail: "个人收藏将在后续阶段接入，公共校园功能仍可正常使用。",
    icon: Bookmark,
  },
  account: {
    eyebrow: "CampusOS",
    title: "我的账号",
    text: "公共地图和校园问答可作为游客使用。",
    empty: "账号服务正在接入",
    detail:
      "使用用户名和密码注册登录，可自主绑定验证邮箱。学校服务尚未获得正式第三方接口授权。",
    icon: UserRound,
  },
};

export function ModulePage({ page }: { page: keyof typeof pages }) {
  const content = pages[page];
  const Icon = content.icon;
  return (
    <section className="module-page">
      <div className="page-heading">
        <h1
          className="module-heading-title"
          aria-label={`广外通 CampusOS | ${content.title}`}
        >
          <Link className="module-brand" href="/map">
            广外通 <span>CampusOS</span>
          </Link>
          <span className="module-heading-separator" aria-hidden="true">
            {" | "}
          </span>
          <strong>{content.title}</strong>
        </h1>
        <p>{content.text}</p>
      </div>
      <div className="module-empty">
        <span className="empty-icon">
          <Icon size={29} strokeWidth={1.5} />
        </span>
        <h2>{content.empty}</h2>
        <p>{content.detail}</p>
        <Link className="text-link" href="/map">
          返回校园地图
          <ArrowUpRight size={16} strokeWidth={1.65} />
        </Link>
      </div>
      {page === "account" && (
        <Link className="account-favorites" href="/favorites">
          <Bookmark size={20} />
          <span>我的收藏</span>
          <ChevronDown size={17} />
        </Link>
      )}
    </section>
  );
}
