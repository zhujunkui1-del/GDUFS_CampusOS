export type ArticlePublicationState = "published" | "pending";
export const articlePublicationNames: Record<ArticlePublicationState, string> =
  {
    published: "已发布",
    pending: "未发布",
  };
