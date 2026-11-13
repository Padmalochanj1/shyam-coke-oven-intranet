
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
  try{const r=await api("/api/login",{method:"POST",body:JSON.stringify({username:$("username").value.trim(),password:$("password").value})});sessionStorage.setItem("sm_session",r.token);showApp(r.user);}
  catch(err){showMessage("loginMessage",err.message);}
});
$("logoutBtn").addEventListener("click",()=>{sessionStorage.removeItem("sm_session");currentUser=null;$("appView").classList.add("hidden");$("loginView").classList.remove("hidden");$("password").value="";});
async function authorized(path,options={}){
  const token=sessionStorage.getItem("sm_session");
  return api(path,{...options,headers:{Authorization:`Bearer ${token}`,...(options.headers||{})}});
}
async function refreshAll(){
  try{
    const [d,s]=await Promise.all([authorized("/api/documents"),authorized("/api/safety")]);
    docsCache=d.documents||[]; safetyCache=s.reports||[];
    renderDocuments();renderSafety();renderApprovals();renderManagerSafety();renderDashboard();
    if(isHod()) renderUsers();
  }catch(e){console.error(e);if(/session|token|unauthorized/i.test(e.message)) $("logoutBtn").click();}
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
  const token=sessionStorage.getItem("sm_session");
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
  let processed=file;
  if(file.type.startsWith("image/")) processed=await imageToPdf(file);
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
  c.getContext("2d").drawImage(img,0,0,c.width,c.height);
  const png=await new Promise(r=>c.toBlob(r,"image/png",0.88));
  const bytes=await png.arrayBuffer();const pdf=await PDFLib.PDFDocument.create();const embedded=await pdf.embedPng(bytes);
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
(async()=>{const token=sessionStorage.getItem("sm_session");if(!token)return;try{const r=await api("/api/me",{headers:{Authorization:`Bearer ${token}`}});showApp(r.user);}catch{sessionStorage.removeItem("sm_session");}})();
