import {WorkerEntrypoint} from 'cloudflare:workers';
import backup from './catalog-backup.cjs';
import stored from '../staging/d1-primary-reads.cjs';

export function refreshCatalogBackup(env){
  const catalogEnv={...env,REXBID_DB:env.REXBID_ACTIVE_CATALOG};
  return backup.refresh(env,request=>stored.handleStoredRead(request,catalogEnv));
}

// This entrypoint is addressed by the import Worker service binding.
export class CatalogBackup extends WorkerEntrypoint{
  async refresh(){
    return refreshCatalogBackup(this.env);
  }
}
