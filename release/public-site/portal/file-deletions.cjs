'use strict';
const {createPrivateAttachmentService}=require('./attachments.cjs');
const {createPortalCrypto}=require('./crypto.cjs');
async function purgeOne({env,attachmentService,row,now=()=>new Date().toISOString()}) {
  if(row.purged_at)return true;
  try {
    await attachmentService.remove({env,objectKey:row.object_key});
    await env.REXBID_DB.prepare('UPDATE import_order_file_deletions SET purged_at=?,object_key=NULL WHERE file_id=? AND purged_at IS NULL').bind(now(),row.file_id).run();
    return true;
  } catch { return false; }
}
async function retryPending(env) {
  const attachmentService=createPrivateAttachmentService({protection:createPortalCrypto()});
  if(!attachmentService.configured(env))return {attempted:0,purged:0};
  const rows=(await env.REXBID_DB.prepare('SELECT * FROM import_order_file_deletions WHERE purged_at IS NULL ORDER BY requested_at,file_id LIMIT 5').all()).results||[];
  let purged=0;for(const row of rows)if(await purgeOne({env,attachmentService,row}))purged++;
  return {attempted:rows.length,purged};
}
module.exports={purgeOne,retryPending};
