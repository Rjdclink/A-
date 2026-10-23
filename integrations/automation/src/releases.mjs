import {all,first,run,now,parse} from './core.mjs';

/**
 * Immutable, tenant-scoped snapshots. A restoration is a new revision, never a
 * destructive rewrite of historical state. Webhook secrets are never stored.
 */
export function installReleaseHistory(db){
 db.exec(`
 CREATE TABLE IF NOT EXISTS workflow_revisions(
  workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  revision INTEGER NOT NULL CHECK(revision>=1),
  name TEXT NOT NULL,
  spec TEXT NOT NULL,
  trigger TEXT NOT NULL,
  enabled INTEGER NOT NULL,
  allow_external INTEGER NOT NULL,
  saved_at INTEGER NOT NULL,
  PRIMARY KEY(workflow_id,revision)
 );
 CREATE INDEX IF NOT EXISTS workflow_revisions_tenant ON workflow_revisions(tenant_id,workflow_id,revision DESC);
 `);
 // Existing installations get a baseline of the current state; historical
 // versions prior to installation cannot be reconstructed.
 for(const flow of all(db,'SELECT * FROM workflows WHERE NOT EXISTS (SELECT 1 FROM workflow_revisions v WHERE v.workflow_id=workflows.id)')){
  recordRevision(db,flow);
 }
}

const same=(v,w)=>v.name===w.name&&v.spec===w.spec&&v.trigger===w.trigger&&
 v.enabled===w.enabled&&v.allow_external===w.allow_external;

export function recordRevision(db,workflow){
 const latest=first(db,'SELECT * FROM workflow_revisions WHERE workflow_id=? ORDER BY revision DESC LIMIT 1',workflow.id);
 if(latest&&same(latest,workflow))return latest.revision;
 const revision=latest?latest.revision+1:1;
 run(db,'INSERT INTO workflow_revisions(workflow_id,tenant_id,revision,name,spec,trigger,enabled,allow_external,saved_at) VALUES (?,?,?,?,?,?,?,?,?)',
  workflow.id,workflow.tenant_id,revision,workflow.name,workflow.spec,workflow.trigger,
  workflow.enabled,workflow.allow_external,now());
 return revision;
}
export function revisionList(db,tenantId,workflowId){
 return all(db,`SELECT revision,name,enabled,allow_external,saved_at,
   spec FROM workflow_revisions WHERE tenant_id=? AND workflow_id=?
   ORDER BY revision DESC LIMIT 100`,tenantId,workflowId).map(({spec,...rest})=>({
  ...rest,enabled:Boolean(rest.enabled),allow_external:Boolean(rest.allow_external),
  step_count:parse(spec,{steps:[]}).steps?.length||0
 }));
}
export function getRevision(db,tenantId,workflowId,revision){
 const r=first(db,'SELECT * FROM workflow_revisions WHERE tenant_id=? AND workflow_id=? AND revision=?',tenantId,workflowId,revision);
 return r?{revision:r.revision,name:r.name,spec:parse(r.spec),
  trigger:parse(r.trigger),enabled:!!r.enabled,allow_external:!!r.allow_external,
  saved_at:r.saved_at}:null;
}
export function restoreRevision(db,workflow,revision){
 const version=first(db,'SELECT * FROM workflow_revisions WHERE workflow_id=? AND tenant_id=? AND revision=?',
  workflow.id,workflow.tenant_id,revision);
 if(!version)return null;
 // Transactions in callers guard against races with enqueue. Preserve the
 // current hook_hash and schedule so webhook credentials never rotate silently.
 run(db,'UPDATE workflows SET name=?,spec=?,enabled=?,allow_external=?,updated_at=? WHERE id=?',
  version.name,version.spec,version.enabled,version.allow_external,now(),workflow.id);
 return recordRevision(db,first(db,'SELECT * FROM workflows WHERE id=?',workflow.id));
}
