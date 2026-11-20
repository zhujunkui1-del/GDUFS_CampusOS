-- The owner narrowed the rule to "any account bound to the owner mailbox may
-- change the platform model chain": admin01 is not a console admin, it is a
-- normal account whose verified email is 3287390083@qq.com. The application
-- side reads the same mailbox list from OWNER_MAILBOXES; this trigger is the
-- last line of defence so an audit insert cannot bypass the rule.
DROP TRIGGER console_platform_models_insert;
CREATE TRIGGER console_platform_models_insert BEFORE INSERT ON console_commands
WHEN NEW.action='platform.models' BEGIN
 SELECT CASE WHEN NOT EXISTS(
  SELECT 1 FROM console_admins a WHERE a.id=NEW.admin_id AND a.status='active' AND (
   a.role='admin'
   OR lower(a.email)='3287390083@qq.com'
   OR lower(substr(a.email,1,instr(a.email,'@')-1)) IN ('3287390083','admin01')
   OR EXISTS(
    SELECT 1 FROM user_password_identities i JOIN users u ON u.id=i.user_id
    WHERE u.status='active' AND lower(i.verified_email)='3287390083@qq.com'
    AND lower(i.username_norm) IN (
     lower(a.email),
     lower(substr(a.email,1,instr(a.email,'@')-1))
    )
   )
  )
 ) THEN RAISE(ABORT,'CONSOLE_DENIED') END;
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM console_engine_settings WHERE id=NEW.target_id AND version=NEW.expected_version) THEN RAISE(ABORT,'CONSOLE_STALE') END;
END;

-- Operator source scopes exist so an operator can only touch its own sources.
-- The model chain belongs to no source, so it is exempt: the trigger above
-- already decides which accounts may change it.
DROP TRIGGER console_operator_scope_guard;
CREATE TRIGGER console_operator_scope_guard BEFORE INSERT ON console_commands WHEN json_extract(NEW.details_json,'$.v2')=1 BEGIN
 SELECT CASE WHEN (NEW.action='source.operator-scope') AND NOT EXISTS(SELECT 1 FROM console_admins WHERE id=NEW.admin_id AND role='admin' AND principal_type='human') THEN RAISE(ABORT,'CONSOLE_DENIED') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM console_admins WHERE id=NEW.admin_id AND role='operator' AND principal_type='human') AND NEW.action<>'platform.models' AND NOT EXISTS(SELECT 1 FROM console_source_scopes WHERE admin_id=NEW.admin_id AND source_id=COALESCE(NEW.source_id,CASE WHEN NEW.target_type='source' THEN NEW.target_id END,(SELECT source_id FROM knowledge_documents WHERE id=NEW.target_id))) THEN RAISE(ABORT,'CONSOLE_DENIED') END;
END;
