const STORAGE_KEY="fnb-expiry-monitor-pwa-v2";
const NOTIFIED_KEY="fnb-expiry-notified-v2";
let deferredPrompt=null;

const demoProducts=[
{id:crypto.randomUUID(),name:"Fresh Milk 1L",batch:"FM-140926",category:"Dairy",location:"Chiller A",qty:4,unit:"botol",expiry:new Date(Date.now()+8*3600000).toISOString(),note:"Bar Station",reminders:[4320,1440,360,60],warningMinutes:10},
{id:crypto.randomUUID(),name:"Chicken Fillet",batch:"CF-140926",category:"Meat",location:"Chiller B",qty:6,unit:"pack",expiry:new Date(Date.now()+1.7*86400000).toISOString(),note:"Kitchen",reminders:[4320,1440],warningMinutes:10},
{id:crypto.randomUUID(),name:"Whipping Cream",batch:"WC-130926",category:"Dairy",location:"Chiller A",qty:3,unit:"pcs",expiry:new Date(Date.now()+5.5*86400000).toISOString(),note:"Pastry",reminders:[4320,1440],warningMinutes:10}
];

let products=JSON.parse(localStorage.getItem(STORAGE_KEY)||"null")||demoProducts;
let notified=JSON.parse(localStorage.getItem(NOTIFIED_KEY)||"{}");
let currentStatus="all",currentSearch="",currentSort="soonest";

const $=id=>document.getElementById(id);
const grid=$("productGrid"),template=$("productCardTemplate"),form=$("productForm"),modal=$("modal");

function persist(){localStorage.setItem(STORAGE_KEY,JSON.stringify(products));localStorage.setItem(NOTIFIED_KEY,JSON.stringify(notified));}
function getStatus(expiry){const d=new Date(expiry)-Date.now();if(d<=0)return"expired";if(d<=86400000)return"urgent";if(d<=259200000)return"warning";return"safe";}
function statusText(s){return{safe:"Aman",warning:"Warning",urgent:"Segera Expired",expired:"Expired"}[s];}
function reminderText(mins){if(mins===4320)return"H-3";if(mins===1440)return"H-1";if(mins===360)return"6 jam";if(mins===60)return"1 jam";return mins+" menit";}
function formatCountdown(expiry){let d=new Date(expiry)-Date.now();if(d<=0)return"00h : 00j : 00m : 00d";const days=Math.floor(d/86400000);d%=86400000;const h=Math.floor(d/3600000);d%=3600000;const m=Math.floor(d/60000),s=Math.floor(d%60000/1000),p=n=>String(n).padStart(2,"0");return`${p(days)}h : ${p(h)}j : ${p(m)}m : ${p(s)}d`;}
function formatDate(v){return new Intl.DateTimeFormat("id-ID",{dateStyle:"medium",timeStyle:"short"}).format(new Date(v));}

async function notify(title,body){
  if(Notification.permission!=="granted")return;
  if("serviceWorker" in navigator){
    const reg=await navigator.serviceWorker.ready;
    reg.showNotification(title,{body,icon:"icon.svg",badge:"icon.svg",vibrate:[250,100,250],tag:title+"-"+body});
  }else new Notification(title,{body});
}

async function requestNotifications(){
  if(!("Notification" in window)){alert("Browser ini belum mendukung notifikasi web.");return;}
  const p=await Notification.requestPermission();
  updateNotifUI();
  if(p==="granted") notify("Expiry Monitor aktif","Reminder produk sekarang diaktifkan.");
}

function updateNotifUI(){
  const p=("Notification" in window)?Notification.permission:"unsupported";
  let text="Belum diaktifkan.",label="Aktifkan";
  if(p==="granted"){text="Aktif. Reminder dapat muncul saat aplikasi/browser berjalan.";label="Aktif";}
  if(p==="denied"){text="Diblokir browser. Buka pengaturan situs untuk mengizinkan notifikasi.";label="Diblokir";}
  if(p==="unsupported"){text="Browser tidak mendukung notifikasi web.";label="Tidak tersedia";}
  $("notifStatus").textContent=text;$("notificationAction").textContent=label;
}

function checkReminders(){
  const now=Date.now();
  products.forEach(p=>{
    const exp=new Date(p.expiry).getTime();
    (p.reminders||[]).forEach(mins=>{
      const trigger=exp-mins*60000, key=`${p.id}-${mins}`;
      if(now>=trigger && now<exp && !notified[key]){
        notified[key]=true; persist();
        notify(`⚠️ ${p.name} mendekati expired`,`${reminderText(mins)} lagi • Batch ${p.batch} • ${p.location}`);
      }
    });
    const expKey=`${p.id}-expired`;
    if(now>=exp && !notified[expKey]){
      notified[expKey]=true; persist();
      notify(`🚨 ${p.name} sudah expired`,`Batch ${p.batch} • ${p.location}`);
    }
  });
}

function filtered(){
  const q=currentSearch.toLowerCase().trim();
  let list=products.filter(p=>{const s=getStatus(p.expiry),hay=`${p.name} ${p.batch} ${p.category} ${p.location} ${p.note}`.toLowerCase();return(currentStatus==="all"||currentStatus===s)&&(!q||hay.includes(q));});
  list.sort((a,b)=>currentSort==="name"?a.name.localeCompare(b.name):currentSort==="latest"?new Date(b.expiry)-new Date(a.expiry):new Date(a.expiry)-new Date(b.expiry));
  return list;
}

function render(){
  grid.innerHTML="";
  const list=filtered();
  list.forEach(p=>{
    const n=template.content.cloneNode(true),s=getStatus(p.expiry);
    n.querySelector(".product-card").dataset.status=s;
    n.querySelector(".category-badge").textContent=p.category;
    n.querySelector(".product-name").textContent=p.name;
    n.querySelector(".product-meta").textContent=`Batch ${p.batch}`;
    const pill=n.querySelector(".status-pill");pill.textContent=statusText(s);pill.classList.add(s);
    n.querySelector(".countdown").textContent=formatCountdown(p.expiry);
    n.querySelector(".expiry-date").textContent=formatDate(p.expiry);
    n.querySelector(".location").textContent=p.location;
    n.querySelector(".stock").textContent=`${p.qty} ${p.unit}`;
    n.querySelector(".reminder-list").textContent=`${p.warningMinutes || 10} menit sebelum expired`;
    n.querySelector(".test-btn").onclick=()=>notify(`Test: ${p.name}`,`Batch ${p.batch} • ${p.location}`);
    n.querySelector(".used-btn").onclick=()=>{products=products.filter(x=>x.id!==p.id);persist();render();};
    n.querySelector(".delete-btn").onclick=()=>{if(confirm(`Hapus ${p.name}?`)){products=products.filter(x=>x.id!==p.id);persist();render();}};
    grid.appendChild(n);
  });
  $("emptyState").classList.toggle("hidden",list.length>0);
  const st=products.map(p=>getStatus(p.expiry));
  $("totalCount").textContent=products.length;
  $("warningCount").textContent=st.filter(s=>s==="warning"||s==="urgent").length;
  $("urgentCount").textContent=st.filter(s=>s==="urgent").length;
  $("expiredCount").textContent=st.filter(s=>s==="expired").length;
}

function openModal(){
  modal.classList.remove("hidden");
  const e=form.elements.expiry;
  if(!e.value){const d=new Date(Date.now()+86400000);d.setMinutes(d.getMinutes()-d.getTimezoneOffset());e.value=d.toISOString().slice(0,16);}
}
function closeModal(){modal.classList.add("hidden");}

$("openModalBtn").onclick=openModal;$("jumpAdd").onclick=openModal;$("closeModalBtn").onclick=closeModal;$("cancelBtn").onclick=closeModal;$("modalBackdrop").onclick=closeModal;
["enableNotif","notifTopBtn","notificationAction"].forEach(id=>$(id).onclick=requestNotifications);
$("searchInput").oninput=e=>{currentSearch=e.target.value;render();};
$("statusFilter").onchange=e=>{currentStatus=e.target.value;render();};
$("sortSelect").onchange=e=>{currentSort=e.target.value;render();};

form.onsubmit=e=>{
  e.preventDefault();const fd=new FormData(form);
  products.push({id:crypto.randomUUID(),name:fd.get("name").trim(),batch:fd.get("batch").trim(),category:fd.get("category"),location:fd.get("location").trim(),qty:Number(fd.get("qty")),unit:fd.get("unit").trim(),expiry:new Date(fd.get("expiry")).toISOString(),note:fd.get("note").trim(),reminders:[],warningMinutes:Number(fd.get("warningMinutes") || 10)});
  persist();form.reset();closeModal();render();checkReminders();
};

window.addEventListener("beforeinstallprompt",e=>{e.preventDefault();deferredPrompt=e;$("installApp").hidden=false;});
$("installApp").onclick=async()=>{if(!deferredPrompt)return;deferredPrompt.prompt();await deferredPrompt.userChoice;deferredPrompt=null;$("installApp").hidden=true;};

if("serviceWorker" in navigator){window.addEventListener("load",()=>navigator.serviceWorker.register("service-worker.js"));}
updateNotifUI();render();checkReminders();
setInterval(()=>{render();checkReminders();$("lastUpdated").textContent="Update "+new Date().toLocaleTimeString("id-ID");},1000);

// ===== KITCHEN ALARM SYSTEM =====
let kitchenAudioContext = null;
let kitchenAlarmTimer = null;
let kitchenAlarmEnabled = localStorage.getItem("kitchen-alarm-enabled") === "true";
let kitchenAlarmSound = localStorage.getItem("kitchen-alarm-sound") || "siren";
let alarmAck = JSON.parse(localStorage.getItem("kitchen-alarm-ack") || "{}");
let alarmSnooze = JSON.parse(localStorage.getItem("kitchen-alarm-snooze") || "{}");
let activeAlarm = null;


function updateKitchenAlarmUI(){
  const btns = [
    document.getElementById("enableSoundAlarm"),
    document.getElementById("alarmReadyAction")
  ];
  document.getElementById("alarmSoundSelect").value = kitchenAlarmSound;

  const card = document.getElementById("alarmReadyCard");
  const text = document.getElementById("alarmReadyText");

  if(kitchenAlarmEnabled){
    card.classList.add("enabled");
    text.textContent = "Alarm aktif. Waktu warning mengikuti pilihan pada masing-masing produk.";
    btns.forEach(btn => {
      btn.textContent = "✓ Alarm Aktif";
      btn.classList.add("active");
    });
  } else {
    card.classList.remove("enabled");
    text.textContent = "Aktifkan alarm agar warning dan expired bisa memicu suara saat halaman tetap terbuka.";
    btns.forEach(btn => {
      btn.textContent = btn.id === "enableSoundAlarm" ? "🔊 Aktifkan Alarm Suara" : "🔊 Aktifkan Alarm";
      btn.classList.remove("active");
    });
  }
}

async function unlockKitchenAudio(){
  try{
    if(!kitchenAudioContext){
      kitchenAudioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
    if(kitchenAudioContext.state === "suspended"){
      await kitchenAudioContext.resume();
    }
    const osc = kitchenAudioContext.createOscillator();
    const gain = kitchenAudioContext.createGain();
    osc.frequency.value = 880;
    gain.gain.value = 0.08;
    osc.connect(gain);
    gain.connect(kitchenAudioContext.destination);
    osc.start();
    osc.stop(kitchenAudioContext.currentTime + 0.12);

    kitchenAlarmEnabled = true;
    localStorage.setItem("kitchen-alarm-enabled", "true");
    updateKitchenAlarmUI();
  } catch(e){
    alert("Audio tidak dapat diaktifkan. Cek volume media dan izin browser.");
  }
}

function tone(ctx, start, freq, duration, volume=0.22, type="square"){
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(volume, start + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(start);
  osc.stop(start + duration + 0.02);
}

function playPattern(level="expired"){
  if(!kitchenAlarmEnabled) return;
  if(!kitchenAudioContext){
    kitchenAudioContext = new (window.AudioContext || window.webkitAudioContext)();
  }
  const ctx = kitchenAudioContext;
  if(ctx.state === "suspended") ctx.resume().catch(()=>{});
  const t = ctx.currentTime;

  if(kitchenAlarmSound === "beep"){
    const seq = level === "expired" ? [980,980,980,760,980,980] : [760,760,620];
    seq.forEach((f,i)=>tone(ctx,t+i*0.16,f,0.12,level==="expired"?0.30:0.20,"square"));
  } else if(kitchenAlarmSound === "bell"){
    const seq = level === "expired" ? [1046,784,1046,784] : [784,659];
    seq.forEach((f,i)=>tone(ctx,t+i*0.32,f,0.28,level==="expired"?0.27:0.17,"sine"));
  } else {
    // Siren alternates pitch for a more noticeable kitchen alarm.
    const seq = level === "expired" ? [720,1080,720,1080,720,1080] : [600,820,600,820];
    seq.forEach((f,i)=>tone(ctx,t+i*0.20,f,0.18,level==="expired"?0.32:0.20,"sawtooth"));
  }
}

function alarmKey(product, level){
  return `${product.id}-${level}`;
}

function isSnoozed(product, level){
  const until = Number(alarmSnooze[alarmKey(product, level)] || 0);
  return Date.now() < until;
}

function showKitchenAlarm(product, level){
  activeAlarm = { product, level };
  const overlay = document.getElementById("expiryAlarmOverlay");
  overlay.classList.remove("hidden");
  overlay.classList.toggle("warning-mode", level === "warning");

  document.getElementById("alarmIcon").textContent = level === "warning" ? "⚠️" : "🚨";
  document.getElementById("alarmKicker").textContent =
    level === "warning"
      ? `WARNING — ${product.warningMinutes || 10} MENIT LAGI`
      : "PRODUK EXPIRED";
  document.getElementById("alarmProductName").textContent = product.name;
  document.getElementById("alarmProductDetail").textContent =
    `Batch ${product.batch} • ${product.location} • Expired ${formatDate(product.expiry)}`;
  document.getElementById("alarmPulse").textContent = level === "warning" ? "WARNING AKTIF" : "ALARM EXPIRED AKTIF";

  playPattern(level);
  clearInterval(kitchenAlarmTimer);
  kitchenAlarmTimer = setInterval(()=>playPattern(level), level === "expired" ? 1400 : 2600);

  if("vibrate" in navigator){
    navigator.vibrate(level === "expired" ? [500,150,500,150,800] : [250,150,250]);
  }
}

function dismissKitchenAlarm(snooze=false){
  clearInterval(kitchenAlarmTimer);
  kitchenAlarmTimer = null;

  if(activeAlarm){
    const key = alarmKey(activeAlarm.product, activeAlarm.level);
    if(snooze){
      alarmSnooze[key] = Date.now() + 5 * 60 * 1000;
      localStorage.setItem("kitchen-alarm-snooze", JSON.stringify(alarmSnooze));
    } else {
      alarmAck[key] = true;
      localStorage.setItem("kitchen-alarm-ack", JSON.stringify(alarmAck));
    }
  }

  activeAlarm = null;
  document.getElementById("expiryAlarmOverlay").classList.add("hidden");
  document.getElementById("expiryAlarmOverlay").classList.remove("warning-mode");
  if("vibrate" in navigator) navigator.vibrate(0);
  setTimeout(checkKitchenAlarms, 400);
}

function checkKitchenAlarms(){
  if(!kitchenAlarmEnabled || activeAlarm) return;

  const now = Date.now();
  const sorted = [...products].sort((a,b)=>new Date(a.expiry)-new Date(b.expiry));

  // Expired gets top priority.
  for(const p of sorted){
    const exp = new Date(p.expiry).getTime();
    const key = alarmKey(p, "expired");
    if(now >= exp && !alarmAck[key] && !isSnoozed(p,"expired")){
      showKitchenAlarm(p, "expired");
      return;
    }
  }

  // Warning: configurable per product.
  for(const p of sorted){
    const exp = new Date(p.expiry).getTime();
    const key = alarmKey(p, "warning");
    const diff = exp - now;
    const warningMs = Number(p.warningMinutes || 10) * 60 * 1000;
    if(diff > 0 && diff <= warningMs && !alarmAck[key] && !isSnoozed(p,"warning")){
      showKitchenAlarm(p, "warning");
      return;
    }
  }
}

document.getElementById("enableSoundAlarm").addEventListener("click", unlockKitchenAudio);
document.getElementById("alarmReadyAction").addEventListener("click", unlockKitchenAudio);

document.getElementById("alarmSoundSelect").addEventListener("change", e=>{
  kitchenAlarmSound = e.target.value;
  localStorage.setItem("kitchen-alarm-sound", kitchenAlarmSound);
});

document.getElementById("testAlarmBtn").addEventListener("click", async ()=>{
  if(!kitchenAlarmEnabled) await unlockKitchenAudio();
  playPattern("expired");
});

document.getElementById("stopAlarmBtn").addEventListener("click", ()=>dismissKitchenAlarm(false));
document.getElementById("snoozeAlarmBtn").addEventListener("click", ()=>dismissKitchenAlarm(true));

updateKitchenAlarmUI();
checkKitchenAlarms();
setInterval(checkKitchenAlarms, 1000);
