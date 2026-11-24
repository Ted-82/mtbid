'use strict';

const {readCookie}=require('./session.js');
const COOKIE='__Host-rexbid_traffic_off';

function ownerTrafficPreference(request,env,user) {
  if (new URL(request.url).origin!=='https://rexbid.pl' || !user?.id || user.id!==env.REXBID_OWNER_USER_ID
    || isTrafficExcludedBrowser(request)) return [];
  // A constant preference for this browser, independent of the login session.
  return [`${COOKIE}=1; Path=/; Max-Age=31536000; Secure; HttpOnly; SameSite=Lax`];
}

function isTrafficExcludedBrowser(request) {
  return readCookie(request,COOKIE)==='1';
}

module.exports={ownerTrafficPreference,isTrafficExcludedBrowser};
