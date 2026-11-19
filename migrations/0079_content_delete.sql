-- 人工导入的文章可以被移除：记录删除时间，列表和详情不再返回该文章。
-- 行本身与版本、命令审计一起保留，供追溯；公开视图只认 published，因此删除即撤下。
ALTER TABLE knowledge_documents ADD COLUMN deleted_at TEXT;
