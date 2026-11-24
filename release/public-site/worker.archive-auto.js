import archive from './sync/auction-archive-intake.cjs';
import budget from './sync/auction-archive-budget.cjs';
import state from './sync/auction-archive-state.cjs';

export default {
  async scheduled(controller,env){
    if(controller.cron!=='*/5 * * * *'||env.ARCHIVE_ENABLED!=='yes')return;
    try {
      const started=Date.now();
      const allowance=await budget.archiveAllowance(env,{maximum:state.MAX_ARCHIVE_BYTES});
      // One bounded gallery batch per scheduled tick avoids three successive
      // historical catch-up bursts consuming the whole storage reserve at night.
      // This changes only photo archiving; offer import has its own worker/queue.
      for(let pass=0;pass<1 && Date.now()-started<70_000;pass++){
        const result=await archive.runArchive(env,{maximumBytes:allowance.maximumBytes});
        console.info('REXBID archive',JSON.stringify({...result,storageBudget:allowance}));
        if(!['partial','complete'].includes(result.status)||!result.saved&&result.retried>0) break;
      }
      const storage=await budget.recordStorageStatus(env,allowance);
      if(storage.warning)console.warn('REXBID archive storage',JSON.stringify({warning:storage.warning,remainingBytes:storage.remainingBytes,trend:storage.trend}));
    } catch(err) {
      const code=String(err?.message||'');
      console.warn('REXBID archive',/^archive_[a-z_]+$/.test(code)?code:'archive_run_failed');
    }
  },
  async fetch(){return new Response('Not found',{status:404});}
};
