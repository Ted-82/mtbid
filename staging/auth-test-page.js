const AUTH_TEST_HTML = String.raw`<!doctype html>
<html lang="pl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>REX.Bid — staging Auth E2E</title>
<style>:root{color-scheme:dark;font:16px/1.5 system-ui,sans-serif;background:#101216;color:#f5f5f5}*{box-sizing:border-box}body{margin:0;padding:24px;background:#101216}.wrap{max-width:760px;margin:auto}.flag{padding:12px 16px;border:1px solid #b58b13;border-radius:10px;background:#27200c;color:#ffe18a;font-weight:700}.card{margin-top:16px;padding:20px;border:1px solid #34383f;border-radius:14px;background:#191c21}h1,h2{margin:0 0 12px}h1{font-size:1.5rem}h2{font-size:1.1rem}.status{display:inline-block;padding:4px 10px;border-radius:999px;background:#333;color:#fff;font-weight:700}.row{display:flex;gap:10px;flex-wrap:wrap;margin-top:12px}label{display:block;flex:1 1 220px}input,select,button{font:inherit;border-radius:8px;padding:10px 12px}input,select{display:block;width:100%;margin-top:5px;background:#101216;border:1px solid #565b64;color:#fff}button{border:0;background:#f4c430;color:#161616;font-weight:700;cursor:pointer}button.secondary{background:#343941;color:#fff}button:disabled{opacity:.5;cursor:wait}.message{min-height:1.5em;color:#ddd}.facts{white-space:pre-wrap;overflow-wrap:anywhere;color:#bbb}.note{color:#aaa;font-size:.92rem}ul{padding-left:22px}</style></head>
<body><main class="wrap"><div class="flag">STAGING ONLY — rexbid-auth-test. Nie używaj prawdziwego hasła ani konta klienta.</div>
<section class="card"><h1>Test Supabase Auth / BFF</h1><p>Status: <span id="auth-state" class="status">Anonymous</span></p><p id="auth-message" class="message" role="status" aria-live="polite">Sprawdzam sesję…</p><p id="signup-diagnostic" class="message note" role="status" aria-live="polite">Ready</p><div id="me-facts" class="facts"></div></section>
<section class="card"><h2>Testowe konto</h2><form id="credentials" autocomplete="off"><div class="row"><label>Testowy e-mail<input id="email" type="email" autocomplete="off" required maxlength="320"></label><label>Testowe hasło<input id="password" type="password" autocomplete="new-password" required minlength="8" maxlength="1024"></label></div><div class="row"><button id="signup" type="button">Sign up</button><button id="login" type="button" class="secondary">Log in</button><button id="refresh" type="button" class="secondary">Refresh session</button><button id="logout" type="button" class="secondary">Log out</button></div></form><p class="note">Hasło jest wysyłane wyłącznie w HTTPS POST do stagingowego BFF. Strona go nie zapisuje ani nie wyświetla.</p></section>
<section class="card"><h2>Test ulubionych</h2><p class="note">Tworzy wyłącznie sztuczny wpis LOT w testowej D1. Nie jest to rzeczywisty pojazd.</p><div class="row"><label>LOT testowy<input id="favorite-lot" maxlength="80"></label><label>Platforma<select id="favorite-platform"><option value="copart">Copart</option><option value="iaai">IAAI</option></select></label></div><div class="row"><button id="favorite-add" type="button">Dodaj testowe favorite</button><button id="favorite-list" type="button" class="secondary">Pobierz favorites</button><button id="favorite-delete" type="button" class="secondary">Usuń testowe favorite</button><button id="favorite-merge" type="button" class="secondary">Merge test local favorite</button></div><p id="favorite-message" class="message" role="status" aria-live="polite"></p><ul id="favorite-list-output"></ul></section>
<p class="note">Auth tokens are HttpOnly-cookie-only; this page never reads cookies, tokens or localStorage. Do not share screenshots containing your test e-mail.</p></main>
<script src="/rexbid-auth.js"></script><script>
(() => {
  const requiredHost = "rexbid-auth-test.tedn828.workers.dev";
  const byId = id => document.getElementById(id);
  if (location.hostname !== requiredHost) { document.body.textContent = "Ta strona jest dostępna wyłącznie na stagingowym Workerze Rex.Bid."; return; }
  const auth = window.RexBidAuth;
  if (!auth?.enabled) { byId("auth-message").textContent = "Wspólny klient Auth jest niedostępny."; return; }
  const stateNode=byId("auth-state"), message=byId("auth-message"), diagnostic=byId("signup-diagnostic"), facts=byId("me-facts"), favoriteMessage=byId("favorite-message"), favoriteList=byId("favorite-list-output");
  const buttons=["signup","login","refresh","logout","favorite-add","favorite-list","favorite-delete","favorite-merge"].map(byId);
  let actionNumber=0, lastFavorite=null;
  const setState=value=>{stateNode.textContent=value;stateNode.dataset.state=value;};
  const clearPrivate=()=>{facts.textContent="";favoriteList.replaceChildren();favoriteMessage.textContent="";};
  function render(){
    if(auth.status!=="authenticated"){
      setState("Anonymous"); clearPrivate();
      if(message.textContent==="Sprawdzam sesję…") message.textContent="Brak aktywnej sesji.";
      return;
    }
    setState("Authenticated"); const user=auth.user||{};
    facts.textContent="Rex.Bid user ID: "+String(user.id||"—")+"\nProvider: "+String(user.auth_provider||"—")+"\nE-mail verified: "+String(user.email_verified===true);
    favoriteList.replaceChildren(); for(const item of auth.getFavorites()){const li=document.createElement("li");li.textContent=String(item.id||"—")+" · "+String(item.platform||"—");favoriteList.append(li);}
  }
  window.addEventListener("rexbid:auth-state",render);
  async function run(label, operation){
    const n=++actionNumber; diagnostic.textContent=label+" #"+n+": preparing"; message.textContent=""; clearPrivate(); buttons.forEach(b=>b.disabled=true);
    try{diagnostic.textContent=label+" #"+n+": sending";const result=await operation();diagnostic.textContent=label+" #"+n+": response HTTP "+String(result?.status??"—")+(result?.requestId?" · Request: "+result.requestId:"")+(result?.setCookiePresent?" · Set-Cookie: present":"");render();return result;}
    catch(error){diagnostic.textContent=label+" #"+n+": UI exception ("+( /^[A-Za-z][A-Za-z0-9]{0,39}$/.test(String(error?.name||""))?error.name:"Error")+")";message.textContent="Operacja jest chwilowo niedostępna.";render();return null;}
    finally{byId("password").value="";buttons.forEach(b=>b.disabled=false);}
  }
  byId("credentials").addEventListener("submit",event=>event.preventDefault());
  byId("signup").addEventListener("click",()=>run("Signup",async()=>{const email=byId("email").value.trim(),password=byId("password").value;if(!email||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||!password||password.length<8){message.textContent="Wpisz prawidłowy testowy e-mail i hasło (minimum 8 znaków).";return {status:0};}const r=await auth.signup(email,password);message.textContent=r.ok?(r.confirmationRequired?"Sprawdź pocztę i potwierdź adres e-mail.":"Konto zostało utworzone."):"Rejestracja nie powiodła się. Sprawdź ustawienia staging Auth.";if(r.ok&&r.confirmationRequired)setState("Awaiting email confirmation");return r;}));
  byId("login").addEventListener("click",()=>run("Login",async()=>{const email=byId("email").value.trim(),password=byId("password").value;if(!email||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||!password){message.textContent="Wpisz prawidłowy testowy e-mail i hasło.";return {status:0};}const r=await auth.login(email,password);message.textContent=r.ok?"Zalogowano.":"Logowanie nie powiodło się. Potwierdź e-mail i sprawdź dane.";return r;}));
  byId("refresh").addEventListener("click",()=>run("Refresh",async()=>{const r=await auth.refreshSession();message.textContent=r.ok?"Sesja odświeżona.":"Odświeżenie sesji nie powiodło się.";return r;}));
  byId("logout").addEventListener("click",()=>run("Logout",async()=>{await auth.logout();message.textContent="Wylogowano.";return {status:200};}));
  function favoriteInput(){const lot=byId("favorite-lot").value.trim().toUpperCase(),platform=byId("favorite-platform").value;if(!lot)throw new Error("LOT required");return {lot,platform};}
  byId("favorite-add").addEventListener("click",()=>run("Favorite add",async()=>{lastFavorite=favoriteInput();const r=await auth.addFavoriteIdentity(lastFavorite);favoriteMessage.textContent=r.ok?"Dodano testowe favorite.":"Operacja ulubionych nie powiodła się.";return {status:r.status|| (r.ok?200:400)};}));
  byId("favorite-list").addEventListener("click",()=>run("Favorite list",async()=>{await auth.bootstrap();const cars=auth.getFavorites();favoriteMessage.textContent="Liczba wpisów: "+cars.length;render();return {status:200};}));
  byId("favorite-delete").addEventListener("click",()=>run("Favorite delete",async()=>{const item=lastFavorite||favoriteInput();const key="lot:"+item.platform+":"+item.lot;const ok=await auth.removeFavorite(key);favoriteMessage.textContent=ok?"Usunięto testowe favorite.":"Operacja ulubionych nie powiodła się.";return {status:ok?200:400};}));
  byId("favorite-merge").addEventListener("click",()=>run("Favorite merge",async()=>{const item=favoriteInput();const r=await auth.mergeFavoriteIdentities([item]);lastFavorite=item;favoriteMessage.textContent=r.ok?"Merge zakończony. Scalono wpisów: "+String(r.merged):"Operacja ulubionych nie powiodła się.";return {status:r.status|| (r.ok?200:400)};}));
  auth.ready.then(render).catch(()=>{setState("Anonymous");message.textContent="Nie udało się sprawdzić sesji.";});
})();
</script></body></html>`;

export default AUTH_TEST_HTML;
