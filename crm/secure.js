(() => {
  'use strict';
  const endpoint='https://kirpa-social-crm-api.ahamedroshanali.chatgpt.site';
  const key='kirpa-crm-session-v1';
  function session(){try{const s=JSON.parse(sessionStorage.getItem(key)||'null');return s?.expires>Date.now()?s:null;}catch{return null;}}
  function clear(){sessionStorage.removeItem(key);window.dispatchEvent(new Event('kirpa-crm-locked'));}
  async function request(path,options={}){
    const s=session();
    const r=await fetch(endpoint+path,{...options,headers:{'Content-Type':'application/json',...(s?{Authorization:`Bearer ${s.token}`}:{})},signal:AbortSignal.timeout(240000),cache:'no-store',credentials:'omit'});
    const data=await r.json();
    if(r.status===401&&path!=='/session')clear();
    if(!r.ok)throw new Error(data.error||'Secure CRM service is unavailable. Please try again.');
    return data;
  }
  async function login(password){const s=await request('/session',{method:'POST',body:JSON.stringify({password})});sessionStorage.setItem(key,JSON.stringify(s));window.dispatchEvent(new Event('kirpa-crm-unlocked'));return true;}
  async function logout(){try{await request('/session',{method:'DELETE'});}finally{clear();}}
  window.KirpaSecure={login,logout,request,isAuthenticated:()=>!!session()};
})();
