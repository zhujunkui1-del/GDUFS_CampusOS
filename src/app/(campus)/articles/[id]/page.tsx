import { ArticleReader } from "@/features/content/article-reader";
import type { Metadata } from "next";
export const metadata: Metadata = { title: "文章阅读 · CampusOS" };
export default async function ArticlePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ArticleReader id={id} />;
}
