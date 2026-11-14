const API = window.APP_CONFIG.API_BASE_URL;
let currentUser = null;
let docsCache = [];
let safetyCache = [];

const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const fmt = d => d ? new Date(d).toLocaleString() : "—";
const role = () => currentUser?.role;
const isManager = () => ["manager","hod"].includes(role());
const isHod = () => role() === "hod";

async function api(path, options={}) {
  const res = await fetch(API + path, {
    ...options,
    headers: {"Content-Type":"application/json", ...(options.headers||{})},
    credentials: "omit"
  });
  const data = await res.json().catch(()=>({error:"Invalid server response"}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}
function showMessage(id, msg, ok=false){ const el=$(id); if(el){el.textContent=msg;el.style.color=ok?"#16845b":"#c23d45";} }
function showApp(user){
  currentUser=user;
  $("loginView").classList.add("hidden"); $("appView").classList.remove("hidden");
  $("profileName").textContent=user.displayName; $("profileRole").textContent=user.role.toUpperCase();
  $("avatar").textContent=(user.displayName||"U").slice(0,1).toUpperCase();
  document.querySelectorAll(".manager-only").forEach(x=>x.classList.toggle("hidden",!isManager()));
  document.querySelectorAll(".hod-only").forEach(x=>x.classList.toggle("hidden",!isHod()));
  navigate("dashboard"); refreshAll();
}
function navigate(page){
  document.querySelectorAll(".page").forEach(p=>p.classList.add("hidden"));
  $("page-"+page)?.classList.remove("hidden");
  document.querySelectorAll(".nav-link").forEach(b=>b.classList.toggle("active",b.dataset.page===page));
  const titles={dashboard:"Dashboard",documents:"Document Repository",safety:"Safety Reporting",reports:"Safety Monitoring",approvals:"Document Approvals",admin:"Administration"};
  $("pageTitle").textContent=titles[page]||"Dashboard";
}
document.querySelectorAll(".nav-link").forEach(b=>b.addEventListener("click",()=>navigate(b.dataset.page)));
document.querySelectorAll("[data-goto]").forEach(b=>b.addEventListener("click",()=>navigate(b.dataset.goto)));

$("loginForm").addEventListener("submit",async e=>{
  e.preventDefault(); showMessage("loginMessage","Signing in…",true);
  try{const r=await api("/api/login",{method:"POST",body:JSON.stringify({username:$("username").value.trim(),password:$("password").value})});window.__tok=r.token;try{sessionStorage.setItem("sm_session",r.token);}catch{}showApp(r.user);}
  catch(err){showMessage("loginMessage",err.message);}
});
$("logoutBtn").addEventListener("click",()=>{window.__tok=null;try{sessionStorage.removeItem("sm_session");}catch{}currentUser=null;$("appView").classList.add("hidden");$("loginView").classList.remove("hidden");$("password").value="";});
async function authorized(path,options={}){
  const token=tok();
  return api(path,{...options,headers:{Authorization:`Bearer ${token}`,...(options.headers||{})}});
}
async function refreshAll(){
  try{
    const [d,s]=await Promise.all([authorized("/api/documents"),authorized("/api/safety")]);
    docsCache=d.documents||[]; safetyCache=s.reports||[];
    renderDocuments();renderSafety();renderApprovals();renderManagerSafety();renderDashboard();
    if(isHod()) renderUsers();
  }catch(e){console.error(e);toast(e.message,true);if(/session|token|unauthorized/i.test(e.message)) $("logoutBtn").click();}
}
function renderDashboard(){
  $("statPublished").textContent=docsCache.filter(x=>x.status==="published").length;
  $("statPending").textContent=docsCache.filter(x=>x.status==="pending").length;
  $("statOpen").textContent=safetyCache.filter(x=>x.status!=="Closed").length;
  $("statClosed").textContent=safetyCache.filter(x=>x.status==="Closed").length;
}
function docCard(d, actions=""){
 const publishedActions=d.status==="published"&&d.fileUrl
  ? `<button class="secondary" type="button" data-print-doc="${esc(d.id)}">Print Valid Document</button><a class="primary" target="_blank" rel="noopener" href="${esc(d.fileUrl)}">Open PDF</a>`
  : "";
 return `<article class="data-card"><div><h4>${esc(d.title)}</h4><p>${esc(d.category)} · ${esc(d.documentNumber||"No document number")} · Rev. ${esc(d.revision||"—")}</p><p>Submitted by ${esc(d.submittedByName)} · ${fmt(d.createdAt)}</p>${d.remarks?`<p>Remarks: ${esc(d.remarks)}</p>`:""}<div class="data-meta"><span class="pill ${d.status==="published"?"green":d.status==="rejected"?"red":"amber"}">${esc(d.status)}</span></div></div><div class="card-actions">${publishedActions}${actions}</div></article>`;
}
function renderDocuments(){
 const q=($("docSearch").value||"").toLowerCase(), f=$("docFilter").value;
 let arr=docsCache.filter(d=>(f==="all"|| (f==="mine"?d.submittedBy===currentUser.username:d.status==="published")) && `${d.title} ${d.category} ${d.documentNumber}`.toLowerCase().includes(q));
 $("documentList").innerHTML=arr.length?arr.map(d=>docCard(d)).join(""):`<div class="empty">No documents found.</div>`;
 $("documentList").querySelectorAll("[data-print-doc]").forEach(b=>b.onclick=()=>printValidDocument(b.dataset.printDoc));
}
async function printValidDocument(id){
 const doc=docsCache.find(d=>d.id===id&&d.status==="published"&&d.fileUrl);
 if(!doc)return alert("This document is not published or is no longer available.");
 // Open a tab immediately from the click to avoid popup blockers while the protected file is prepared.
 const printTab=window.open("about:blank","_blank");
 if(!printTab)return alert("Please allow pop-ups for this intranet site and try again.");
 printTab.document.write(`<!doctype html><html><head><title>Preparing valid document</title></head><body style="font:16px Arial;padding:32px;color:#263445">Preparing watermarked valid document…</body></html>`);
 try{
  if(!window.PDFLib)throw new Error("PDF processing library did not load. Refresh the page and retry.");
  const token=tok();
  const response=await fetch(doc.fileUrl,{headers:{Authorization:`Bearer ${token}`},credentials:"omit"});
  if(!response.ok)throw new Error(`Unable to retrieve document (${response.status}). Please sign in again or contact the administrator.`);
  const sourceBytes=await response.arrayBuffer();
  const pdf=await PDFLib.PDFDocument.load(sourceBytes);
  const font=await pdf.embedFont(PDFLib.StandardFonts.HelveticaBold);
  const pages=pdf.getPages();
  const stamp="VALID DOCUMENT";
  for(const page of pages){
   const {width,height}=page.getSize();
   const fontSize=Math.max(28,Math.min(58,Math.min(width,height)*0.105));
   const textWidth=font.widthOfTextAtSize(stamp,fontSize);
   page.drawText(stamp,{
    x:(width-textWidth)/2,
    y:height*0.48,
    size:fontSize,
    font,
    color:PDFLib.rgb(0.16,0.38,0.29),
    opacity:0.22,
    rotate:PDFLib.degrees(-32)
   });
   const footer=`Printed: ${new Date().toLocaleString()}  |  Document: ${doc.documentNumber||"—"}  |  Rev. ${doc.revision||"—"}`.replace(/[^\x20-\x7E]/g,"?");
   page.drawText(footer,{x:24,y:12,size:7,font,color:PDFLib.rgb(0.25,0.25,0.25),opacity:0.75});
  }
  const stampedBytes=await pdf.save();
  const blob=new Blob([stampedBytes],{type:"application/pdf"});
  const blobUrl=URL.createObjectURL(blob);
  printTab.location.href=blobUrl;
  // Keep the object URL alive while the PDF tab is open; revoke it when this page is closed.
  window.addEventListener("beforeunload",()=>URL.revokeObjectURL(blobUrl),{once:true});
 }catch(error){
  printTab.close();
  alert(error.message||"Unable to prepare the watermarked document.");
 }
}

function renderApprovals(){
 if(!isHod())return;
 const arr=docsCache.filter(d=>d.status==="pending");
 $("approvalList").innerHTML=arr.length?arr.map(d=>docCard(d,`<button class="primary" data-approve="${esc(d.id)}">Approve</button><button class="secondary" data-reject="${esc(d.id)}">Reject</button>`)).join(""):`<div class="empty">No documents are waiting for approval.</div>`;
 $("approvalList").querySelectorAll("[data-approve]").forEach(b=>b.onclick=()=>reviewDoc(b.dataset.approve,"approve"));
 $("approvalList").querySelectorAll("[data-reject]").forEach(b=>b.onclick=()=>reviewDoc(b.dataset.reject,"reject"));
}
async function reviewDoc(id,decision){
 const remarks=prompt(decision==="approve"?"Approval remarks (optional):":"Reason for rejection (required):","")||"";
 if(decision==="reject"&&!remarks.trim())return alert("Rejection reason is required.");
 try{await authorized("/api/documents/review",{method:"POST",body:JSON.stringify({id,decision,remarks})});await refreshAll();}
 catch(e){alert(e.message);}
}
$("showDocForm").onclick=()=>$("docForm").classList.remove("hidden");
$("cancelDoc").onclick=()=>$("docForm").classList.add("hidden");
$("docSearch").oninput=renderDocuments;$("docFilter").onchange=renderDocuments;
$("docForm").addEventListener("submit",async e=>{
 e.preventDefault();const file=$("docFile").files[0];if(!file)return;
 try{
  showMessage("docMessage","Preparing file…",true);
  const processed=await prepPdf(file);
  if(processed.size>8*1024*1024)throw new Error("Processed file exceeds 8 MB. Please reduce the file size.");
  const base64=await toBase64(processed);
  await authorized("/api/documents/submit",{method:"POST",body:JSON.stringify({category:$("docCategory").value,title:$("docTitle").value.trim(),documentNumber:$("docNumber").value.trim(),revision:$("docRevision").value.trim(),fileName:processed.name||"document.pdf",mimeType:"application/pdf",fileBase64:base64})});
  showMessage("docMessage","Submitted for HOD approval.",true);$("docForm").reset();$("docForm").classList.add("hidden");await refreshAll();
 }catch(err){showMessage("docMessage",err.message);}
});
function toBase64(file){return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result).split(",")[1]);r.onerror=reject;r.readAsDataURL(file);});}
async function imageToPdf(file){
 // Uses pdf-lib from CDN. The conversion is client-side; no image is sent to a third party.
 if(!window.PDFLib)throw new Error("PDF conversion library did not load. Refresh and retry.");
 const img=new Image(), url=URL.createObjectURL(file);
 try{
  await new Promise((res,rej)=>{img.onload=res;img.onerror=rej;img.src=url;});
  const scale=Math.min(1,1800/Math.max(img.width,img.height));const c=document.createElement("canvas");c.width=Math.round(img.width*scale);c.height=Math.round(img.height*scale);
  const cx=c.getContext("2d");cx.fillStyle="#fff";cx.fillRect(0,0,c.width,c.height);cx.drawImage(img,0,0,c.width,c.height);
  const png=await new Promise(r=>c.toBlob(r,"image/jpeg",0.72));
  const bytes=await png.arrayBuffer();const pdf=await PDFLib.PDFDocument.create();const embedded=await pdf.embedJpg(bytes);
  const page=pdf.addPage([embedded.width,embedded.height]);page.drawImage(embedded,{x:0,y:0,width:embedded.width,height:embedded.height});
  const out=await pdf.save();return new File([out],file.name.replace(/\.[^.]+$/,"")+".pdf",{type:"application/pdf"});
 }finally{URL.revokeObjectURL(url);}
}
$("showSafetyForm").onclick=()=>$("safetyForm").classList.remove("hidden");
$("cancelSafety").onclick=()=>$("safetyForm").classList.add("hidden");
$("safetySearch").oninput=renderSafety;$("safetyFilter").onchange=renderSafety;
$("safetyForm").addEventListener("submit",async e=>{
 e.preventDefault();
 try{
  showMessage("safetyMessage","Processing image…",true);
  let imageBase64=null;
  const file=$("safetyImage").files[0];
  if(file){if(file.size>8*1024*1024)throw new Error("Original image exceeds 8 MB.");const png=await imageToPng(file);imageBase64=await toBase64(png);}
  await authorized("/api/safety/create",{method:"POST",body:JSON.stringify({type:$("safetyType").value,location:$("safetyLocation").value.trim(),responsibility:$("safetyDept").value,priority:$("safetyPriority").value,description:$("safetyDescription").value.trim(),imageBase64})});
  showMessage("safetyMessage","Safety report submitted.",true);$("safetyForm").reset();$("safetyForm").classList.add("hidden");await refreshAll();
 }catch(err){showMessage("safetyMessage",err.message);}
});
async function imageToPng(file){
 const img=new Image(),url=URL.createObjectURL(file);
 try{await new Promise((r,j)=>{img.onload=r;img.onerror=j;img.src=url;});const scale=Math.min(1,1600/Math.max(img.width,img.height));const c=document.createElement("canvas");c.width=Math.round(img.width*scale);c.height=Math.round(img.height*scale);c.getContext("2d").drawImage(img,0,0,c.width,c.height);const blob=await new Promise(r=>c.toBlob(r,"image/png"));return new File([blob],file.name.replace(/\.[^.]+$/,"")+".png",{type:"image/png"});}finally{URL.revokeObjectURL(url);}
}
function safetyCard(r,manager=false){
 let buttons="";
 if(manager&&r.status!=="Closed")buttons=`<button class="primary" data-close="${esc(r.id)}">Close report</button><button class="secondary" data-progress="${esc(r.id)}">Mark in progress</button>`;
 return `<article class="data-card"><div><h4>${esc(r.id)} · ${esc(r.type)}</h4><p>${esc(r.location)} · Responsibility: ${esc(r.responsibility)} · Priority: ${esc(r.priority)}</p><p>${esc(r.description)}</p><p>Reported by ${esc(r.reportedByName)} · ${fmt(r.createdAt)}</p>${r.closureRemarks?`<p>Closure: ${esc(r.closureRemarks)}</p>`:""}<div class="data-meta"><span class="pill ${r.status==="Closed"?"green":r.status==="In Progress"?"amber":"red"}">${esc(r.status)}</span></div>${r.imageUrl?`<p><a href="${esc(r.imageUrl)}" target="_blank" rel="noopener">View observation image</a></p>`:""}${r.closureImageUrl?`<p><a href="${esc(r.closureImageUrl)}" target="_blank" rel="noopener">View closure image</a></p>`:""}</div><div class="card-actions">${buttons}</div></article>`;
}
function renderSafety(){
 const q=($("safetySearch").value||"").toLowerCase(),f=$("safetyFilter").value;
 let arr=safetyCache.filter(r=>(f==="all"||r.reportedBy===currentUser.username)&&`${r.id} ${r.location} ${r.description}`.toLowerCase().includes(q));
 $("safetyList").innerHTML=arr.length?arr.map(r=>safetyCard(r)).join(""):`<div class="empty">No safety reports found.</div>`;
}
function renderManagerSafety(){
 if(!isManager())return;
 let arr=safetyCache.filter(r=>isHod()||r.responsibility===currentUser.department);
 $("managerSafetyList").innerHTML=arr.length?arr.map(r=>safetyCard(r,true)).join(""):`<div class="empty">No reports assigned to your responsibility.</div>`;
 $("managerSafetyList").querySelectorAll("[data-close]").forEach(b=>b.onclick=()=>closeSafety(b.dataset.close,"Closed"));
 $("managerSafetyList").querySelectorAll("[data-progress]").forEach(b=>b.onclick=()=>closeSafety(b.dataset.progress,"In Progress"));
}
async function closeSafety(id,status){
 const remarks=prompt(status==="Closed"?"Enter rectification / closure remarks (required):":"Optional progress remarks:","");
 if(status==="Closed"&&!remarks?.trim())return alert("Closure remarks are required.");
 try{await authorized("/api/safety/update",{method:"POST",body:JSON.stringify({id,status,remarks:remarks||""})});await refreshAll();}
 catch(e){alert(e.message);}
}
$("refreshSafety").onclick=refreshAll;$("refreshDocs").onclick=refreshAll;
async function renderUsers(){
 try{const r=await authorized("/api/admin/users");$("userList").innerHTML=(r.users||[]).map(u=>`<article class="data-card"><div><h4>${esc(u.displayName)}</h4><p>${esc(u.username)} · ${esc(u.department)}</p><div class="data-meta"><span class="pill">${esc(u.role)}</span><span class="pill ${u.active?"green":"red"}">${u.active?"Active":"Inactive"}</span></div></div></article>`).join("")||`<div class="empty">No users found.</div>`;}
 catch(e){$("userList").innerHTML=`<div class="empty">${esc(e.message)}</div>`;}
}
(async()=>{const token=tok();if(!token)return;try{const r=await api("/api/me",{headers:{Authorization:`Bearer ${token}`}});showApp(r.user);}catch{sessionStorage.removeItem("sm_session");}})();

/* ===== v2 additions ===== */
window.alert=m=>toast(m,true);
function toast(m,err){const e=document.createElement("div");e.className="toast"+(err?" err":"");e.textContent=m;$("toasts").append(e);setTimeout(()=>e.remove(),4000);}
function openModal(html){$("modalBox").innerHTML=html+'<p><button class="secondary" onclick="closeModal()">Close</button></p>';$("modal").classList.remove("hidden");}
function closeModal(){$("modal").classList.add("hidden");$("modalBox").innerHTML="";}
$("modal").addEventListener("click",e=>{if(e.target.id==="modal")closeModal();});
function askRemarks(title,required,onOk){openModal(`<h3>${title}</h3><textarea id="rmk" rows="3" placeholder="Remarks${required?" (required)":" (optional)"}"></textarea><button class="primary" id="rmkOk">Confirm</button>`);
 $("rmkOk").onclick=async()=>{const v=$("rmk").value.trim();if(required&&!v)return toast("Remarks are required",true);try{await onOk(v);closeModal();await refreshAll();}catch(e){toast(e.message,true);}};}
async function previewFile(url,kind){try{const t=tok(),r=await fetch(url,{headers:{Authorization:"Bearer "+t}});if(!r.ok)throw new Error("Unable to open file ("+r.status+")");const u=URL.createObjectURL(await r.blob());openModal(kind==="pdf"?`<iframe src="${u}"></iframe>`:`<img src="${u}">`);}catch(e){toast(e.message,true);}}
const b64=u8=>{let s="";for(let i=0;i<u8.length;i+=8192)s+=String.fromCharCode(...u8.subarray(i,i+8192));return btoa(s);};
async function prepPdf(file){
 if(!window.PDFLib)throw new Error("PDF library did not load. Refresh and retry.");
 let src;if(file.type==="application/pdf")src=await file.arrayBuffer();else if(file.type.startsWith("image/"))src=await (await imageToPdf(file)).arrayBuffer();
 else src=await officeToPdf(file);
 const pdf=await PDFLib.PDFDocument.load(src),f=await pdf.embedFont(PDFLib.StandardFonts.Helvetica);
 const t=`Uploaded: ${new Date().toLocaleString("en-IN")} | By: ${currentUser.displayName} (${currentUser.username})`.replace(/[^\x20-\x7E]/g,"?");
 pdf.getPages().forEach(p=>p.drawText(t,{x:20,y:8,size:7,font:f,color:PDFLib.rgb(.3,.3,.3)}));
 const out=await pdf.save({useObjectStreams:true});toast(`Compressed: ${(file.size/1024).toFixed(0)} KB → ${(out.length/1024).toFixed(0)} KB`);
 if(out.length>8*1024*1024)throw new Error("File exceeds 8 MB after compression.");
 return new File([out],file.name.replace(/\.[^.]+$/,"")+".pdf",{type:"application/pdf"});}
function docCard(d,actions=""){const ok=d.fileUrl;
 const b=(d.status==="published"?`<button class="secondary" type="button" data-print-doc="${esc(d.id)}">Print Valid Document</button>`:"")+(ok?`<button class="primary" type="button" onclick="previewFile('${esc(d.fileUrl)}','pdf')">👁 Preview</button>`:"");
 return `<article class="data-card"><div><h4>${esc(d.title)}</h4><p>${esc(d.category)} · ${esc(d.documentNumber||"No document number")} · Rev. ${esc(d.revision||"—")}</p><p>Submitted by ${esc(d.submittedByName)} · ${fmt(d.createdAt)}</p>${d.remarks?`<p>Remarks: ${esc(d.remarks)}</p>`:""}<div class="data-meta"><span class="pill ${d.status==="published"?"green":d.status==="rejected"?"red":"amber"}">${esc(d.status)}</span></div></div><div class="card-actions">${b}${actions}</div></article>`;}
let docCat="All",monSt="All";
function chips(el,list,cur,set){$(el).innerHTML=list.map(c=>`<button type="button" class="chip ${c===cur?"on":""}" data-c="${c}">${c}</button>`).join("");$(el).querySelectorAll(".chip").forEach(b=>b.onclick=()=>{set(b.dataset.c);});}
function renderDocuments(){chips("docChips",["All","SOP","HIRA","SMP","Electrical Drawing","Maintenance Procedure","Checklist / Format","Other"],docCat,c=>{docCat=c;renderDocuments();});
 const q=($("docSearch").value||"").toLowerCase(),f=$("docFilter").value;
 const arr=docsCache.filter(d=>(f==="all"||(f==="mine"?d.submittedBy===currentUser.username:d.status==="published"))&&(docCat==="All"||d.category===docCat)&&`${d.title} ${d.category} ${d.documentNumber}`.toLowerCase().includes(q));
 $("documentList").innerHTML=arr.length?arr.map(d=>docCard(d)).join(""):`<div class="empty">No documents found.</div>`;
 $("documentList").querySelectorAll("[data-print-doc]").forEach(b=>b.onclick=()=>printValidDocument(b.dataset.printDoc));}
function reviewDoc(id,dec){askRemarks(dec==="approve"?"Approve & publish document":"Reject document",dec==="reject",async r=>{await authorized("/api/documents/review",{method:"POST",body:JSON.stringify({id,decision:dec,remarks:r})});toast(dec==="approve"?"Document published ✔":"Document rejected");});}
function closeSafety(id,status){askRemarks(status==="Closed"?"Close safety report":"Mark in progress",status==="Closed",async r=>{await authorized("/api/safety/update",{method:"POST",body:JSON.stringify({id,status,remarks:r})});toast("Report updated ✔");});}
function safetyCard(r,manager=false){let btn="";if(manager&&r.status!=="Closed")btn=(r.status==="Open"?`<button class="secondary" data-progress="${esc(r.id)}">Mark in progress</button>`:"")+`<button class="primary" data-close="${esc(r.id)}">Close report</button>`;
 return `<article class="data-card"><div><h4>${esc(r.id)} · ${esc(r.type)}</h4><p>${esc(r.location)} · Responsibility: ${esc(r.responsibility)} · Priority: ${esc(r.priority)}</p><p>${esc(r.description)}</p><p>Reported by ${esc(r.reportedByName)} · ${fmt(r.createdAt)}</p>${r.closureRemarks?`<p>Closure: ${esc(r.closureRemarks)}</p>`:""}<div class="data-meta"><span class="pill ${r.status==="Closed"?"green":r.status==="In Progress"?"amber":"red"}">${esc(r.status)}</span></div></div><div class="card-actions">${r.imageUrl?`<button class="secondary" onclick="previewFile('${esc(r.imageUrl)}','img')">🖼 Photo</button>`:""}${btn}</div></article>`;}
function renderManagerSafety(){if(!isManager())return;chips("monChips",["All","Open","In Progress","Closed"],monSt,c=>{monSt=c;renderManagerSafety();});
 const arr=safetyCache.filter(r=>(isHod()||r.responsibility===currentUser.department)&&(monSt==="All"||r.status===monSt));
 $("managerSafetyList").innerHTML=arr.length?arr.map(r=>safetyCard(r,true)).join(""):`<div class="empty">No reports found.</div>`;
 $("managerSafetyList").querySelectorAll("[data-close]").forEach(b=>b.onclick=()=>closeSafety(b.dataset.close,"Closed"));
 $("managerSafetyList").querySelectorAll("[data-progress]").forEach(b=>b.onclick=()=>closeSafety(b.dataset.progress,"In Progress"));}
function countUp(el,n){let i=0;const s=Math.max(1,Math.ceil(n/25)),t=setInterval(()=>{i=Math.min(n,i+s);el.textContent=i;if(i>=n)clearInterval(t);},28);}
function renderDashboard(){const v={statPublished:docsCache.filter(x=>x.status==="published").length,statPending:docsCache.filter(x=>x.status==="pending").length,statOpen:safetyCache.filter(x=>x.status!=="Closed").length,statClosed:safetyCache.filter(x=>x.status==="Closed").length};
 Object.entries(v).forEach(([k,n])=>countUp($(k),n));
 const dep=["Operation","Electrical","Mechanical"].map(d=>[d,safetyCache.filter(r=>r.responsibility===d&&r.status!=="Closed").length]),mx=Math.max(1,...dep.map(x=>x[1]));
 $("chartBars").innerHTML=dep.map(d=>`<div><i style="height:0" data-h="${Math.max(4,d[1]/mx*100)}">${d[1]}</i>${d[0]}</div>`).join("");setTimeout(()=>$("chartBars").querySelectorAll("i").forEach(i=>i.style.height=i.dataset.h+"%"),60);
 const ev=[...docsCache.map(d=>({t:d.createdAt,x:`📄 ${esc(d.title)} — ${d.status}`})),...safetyCache.map(r=>({t:r.createdAt,x:`⚠ ${esc(r.type)} at ${esc(r.location)} — ${r.status}`}))].sort((a,b)=>new Date(b.t)-new Date(a.t)).slice(0,6);
 $("recentList").innerHTML=ev.map(e=>`<p>${e.x}<span>${new Date(e.t).toLocaleDateString()}</span></p>`).join("")||'<p>No activity yet.</p>';}
function wireDrop(id){const inp=$(id),box=inp.closest("label");box.classList.add("drop");
 ["dragover","dragleave","drop"].forEach(ev=>box.addEventListener(ev,e=>{e.preventDefault();box.classList.toggle("over",ev==="dragover");if(ev==="drop"){inp.files=e.dataTransfer.files;inp.dispatchEvent(new Event("change"));}}));
 inp.addEventListener("change",()=>{box.querySelector(".pv")?.remove();const f=inp.files[0];if(!f)return;const d=document.createElement("div");d.className="pv";d.innerHTML=`<small>${esc(f.name)} · ${(f.size/1024).toFixed(0)} KB</small>`;if(f.type.startsWith("image/")){const i=document.createElement("img");i.src=URL.createObjectURL(f);d.append(i);}box.append(d);});}
wireDrop("docFile");wireDrop("safetyImage");
setInterval(()=>{if(currentUser&&!document.hidden)refreshAll();},60000);

/* ===== Word / Excel -> PDF (runs in the browser, no third party) ===== */
const loadImg=s=>new Promise((r,j)=>{const i=new Image();i.onload=()=>r(i);i.onerror=j;i.src=s;});
async function officeToPdf(file){
 const ext=file.name.toLowerCase().split(".").pop();
 if(!["docx","xlsx","xls","csv"].includes(ext))throw new Error("Supported: PDF, images, Word (.docx), Excel (.xlsx/.xls/.csv). Save .doc/.pptx as PDF or .docx first.");
 if(!(window.jspdf&&window.mammoth&&window.XLSX))throw new Error("Converter libraries did not load. Refresh and retry.");
 const {jsPDF}=window.jspdf;let out;
 if(ext==="docx"){
  const html=(await mammoth.convertToHtml({arrayBuffer:await file.arrayBuffer()})).value,root=new DOMParser().parseFromString(html,"text/html").body;
  const d=new jsPDF({unit:"pt",format:"a4",compress:true}),M=40,mw=515;let y=M;
  const need=h=>{if(y+h>802){d.addPage();y=M;}};
  const text=(t,sz,b,ind=0)=>{if(!t)return;d.setFont("helvetica",b?"bold":"normal").setFontSize(sz);d.splitTextToSize(t,mw-ind).forEach(l=>{need(sz*1.4);d.text(l,M+ind,y+sz);y+=sz*1.4;});y+=4;};
  const walk=async nodes=>{for(const n of nodes){const tg=n.tagName||"";
   if(/^H[1-6]$/.test(tg))text(n.textContent.trim(),20-tg[1]*2,true);
   else if(tg==="UL"||tg==="OL")[...n.querySelectorAll(":scope>li")].forEach((li,i)=>text((tg==="OL"?(i+1)+". ":"\u2022 ")+li.textContent.trim(),11,false,14));
   else if(tg==="TABLE"){need(40);d.autoTable({startY:y,margin:{left:M,right:M},body:[...n.rows].map(r=>[...r.cells].map(c=>c.textContent.trim())),theme:"plain",styles:{fontSize:9,lineWidth:.5,lineColor:90,textColor:20,cellPadding:3}});y=d.lastAutoTable.finalY+10;}
   else if(tg==="P"){for(const im of n.querySelectorAll("img")){try{const i=await loadImg(im.src),k=Math.min(mw/i.width,300/i.height,1),w=i.width*k,h=i.height*k;need(h);d.addImage(im.src,/png/.test(im.src.slice(0,20))?"PNG":"JPEG",M,y,w,h);y+=h+6;}catch{}}text(n.textContent.trim(),11,false);}
   else if(n.children?.length)await walk(n.children);else text((n.textContent||"").trim(),11,false);}};
  await walk(root.children);out=d.output("arraybuffer");
 }else{
  const wb=XLSX.read(await file.arrayBuffer(),{type:"array"}),d=new jsPDF({unit:"pt",format:"a4",orientation:"landscape",compress:true});let first=true;
  wb.SheetNames.forEach(s=>{const rows=XLSX.utils.sheet_to_json(wb.Sheets[s],{header:1,raw:false,defval:""}).slice(0,3000);if(!rows.length)return;
   if(!first)d.addPage();first=false;d.setFont("helvetica","bold").setFontSize(12).text(s,30,26);
   d.autoTable({startY:34,margin:30,body:rows,theme:"plain",horizontalPageBreak:true,styles:{fontSize:7,cellPadding:2,lineWidth:.3,lineColor:150,textColor:20}});});
  if(first)throw new Error("The spreadsheet is empty.");out=d.output("arraybuffer");}
 toast("Converted "+file.name+" to PDF");return out;
}

function tok(){try{return window.__tok||sessionStorage.getItem("sm_session");}catch{return window.__tok||null;}}
