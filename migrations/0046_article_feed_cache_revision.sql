-- Invalidate the small metadata cache at actual visibility changes, not heartbeats.
CREATE TRIGGER article_feed_document_revision AFTER UPDATE ON knowledge_documents
WHEN NEW.version IS NOT OLD.version OR NEW.publication_status IS NOT OLD.publication_status
 OR NEW.workflow_status IS NOT OLD.workflow_status OR NEW.lifecycle_status IS NOT OLD.lifecycle_status
 OR NEW.input_hash IS NOT OLD.input_hash OR NEW.owner_user_id IS NOT OLD.owner_user_id
 OR NEW.data_domain IS NOT OLD.data_domain OR NEW.valid_until IS NOT OLD.valid_until
BEGIN
 UPDATE console_engine_settings SET public_visibility_revision=public_visibility_revision+1 WHERE id='console-v2-settings';
END;
CREATE TRIGGER article_feed_source_revision AFTER UPDATE ON knowledge_sources
WHEN NEW.enabled IS NOT OLD.enabled OR NEW.archived_at IS NOT OLD.archived_at
 OR NEW.permission_status IS NOT OLD.permission_status OR NEW.verification_status IS NOT OLD.verification_status
 OR NEW.official_status IS NOT OLD.official_status OR NEW.authorization_status IS NOT OLD.authorization_status
 OR NEW.channel_type IS NOT OLD.channel_type OR NEW.display_name IS NOT OLD.display_name
BEGIN
 UPDATE console_engine_settings SET public_visibility_revision=public_visibility_revision+1 WHERE id='console-v2-settings';
END;
CREATE TRIGGER article_feed_control_revision AFTER UPDATE ON console_document_controls
WHEN NEW.hold_reason IS NOT OLD.hold_reason OR NEW.review_hold IS NOT OLD.review_hold OR NEW.last_publication_mode IS NOT OLD.last_publication_mode
BEGIN
 UPDATE console_engine_settings SET public_visibility_revision=public_visibility_revision+1 WHERE id='console-v2-settings';
END;
CREATE TRIGGER article_feed_tombstone_revision AFTER INSERT ON console_cleanup_tombstones BEGIN
 UPDATE console_engine_settings SET public_visibility_revision=public_visibility_revision+1 WHERE id='console-v2-settings';
END;
CREATE TRIGGER article_feed_tombstone_release_revision AFTER UPDATE OF released_at ON console_cleanup_tombstones
WHEN NEW.released_at IS NOT OLD.released_at BEGIN
 UPDATE console_engine_settings SET public_visibility_revision=public_visibility_revision+1 WHERE id='console-v2-settings';
END;
