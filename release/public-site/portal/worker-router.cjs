'use strict';

const {createImportPortalHandler}=require('./operations.cjs');
const {createPortalCrypto}=require('./crypto.cjs');
const {createPrivateAttachmentService}=require('./attachments.cjs');
const {makeReplyDraft}=require('./reply-drafts.cjs');
const {createPortalExportHandler}=require('./export.cjs');
const {createTrafficHandler}=require('./traffic.cjs');
const {createOwnerArchiveHandler}=require('./archive-control.cjs');
const notificationService=require('./transactional-mail.cjs');

// Loaded only for the private portal namespace. Public catalog reads never
// initialize this module, call authentication, or access private R2 objects.
function createPortalRouter({resolveAccount,ownerMfaHandler,cryptoImpl=globalThis.crypto}={}) {
  if (typeof resolveAccount !== 'function' || typeof ownerMfaHandler !== 'function') throw new TypeError('Server-only authentication capabilities are required');
  const protection=createPortalCrypto({cryptoImpl});
  const attachmentService=createPrivateAttachmentService({protection,cryptoImpl});
  const personalExport=createPortalExportHandler({resolveAccount,protection,cryptoImpl});
  const traffic=createTrafficHandler(resolveAccount);
  const archive=createOwnerArchiveHandler(resolveAccount);
  const operations=createImportPortalHandler({resolveAccount,cryptoImpl,protect:protection.protect,unprotect:protection.unprotect,
    protectionConfigured:protection.configured,attachmentService,makeReplyDraft,notificationService});
  return async function route(request,env,context) {
    const path=new URL(request.url).pathname;
    if (path!=='/api/portal' && !path.startsWith('/api/portal/')) return null;
    // An AAL1 owner may configure TOTP, while operations stay locked to AAL2.
    const mfa=await ownerMfaHandler(request,env);
    return mfa || await traffic(request,env) || await archive(request,env) || await personalExport(request,env) || operations(request,env,context);
  };
}
module.exports={createPortalRouter};
