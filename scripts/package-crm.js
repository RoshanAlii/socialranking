'use strict';
// Generate a data-free static Bitrix24 app. Never include live CRM records.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),cp=require('node:child_process');
const root=path.resolve(__dirname,'..');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'kirpa-social-crm-'));
for(const file of ['index.html','metrics.js','client.js','style.css','config.json']) fs.copyFileSync(path.join(root,'crm',file),path.join(dir,file));
const registry=JSON.parse(fs.readFileSync(path.join(root,'handles.json'),'utf8'));
const minimal={employees:registry.employees.filter(p=>p.confirmed&&!p.optOut).map(p=>({name:p.name,confirmed:true,handles:{instagram:p.handles.instagram}})),brandAccounts:registry.brandAccounts};
fs.writeFileSync(path.join(dir,'roster.json'),JSON.stringify(minimal));
const zip=path.join(dir,'kirpa-social-results.zip');
cp.execFileSync('zip',['-q',zip,'index.html','metrics.js','client.js','style.css','config.json','roster.json'],{cwd:dir});
console.log(zip);
