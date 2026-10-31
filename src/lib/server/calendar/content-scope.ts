// Reuse effective content-use scope; collection-verification/expiry is not a read gate.
export function calendarBodyAllowedSql(alias = "d") {
  if (!/^[a-z]$/.test(alias)) throw Error("SQL alias");
  return `${alias}.rights_scope IN('excerpt_and_link','licensed_full_text') AND NOT EXISTS(SELECT 1 FROM knowledge_sources sp LEFT JOIN source_collection_policies p ON p.source_id=sp.id WHERE sp.id=${alias}.source_id AND ((sp.manual_policy_version>0 AND sp.manual_rights_scope NOT IN('excerpt_and_link','licensed_full_text')) OR (sp.manual_policy_version=0 AND p.source_id IS NOT NULL AND p.rights_scope NOT IN('excerpt_and_link','licensed_full_text'))))`;
}
