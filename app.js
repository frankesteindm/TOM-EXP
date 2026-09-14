const CONFIG = window.SUPABASE_CONFIG || {};
const CONFIG_READY =
  CONFIG.url &&
  CONFIG.anonKey &&
  !CONFIG.url.includes("PASTE_") &&
  !CONFIG.anonKey.includes("PASTE_");

const sb = CONFIG_READY
  ? window.supabase.createClient(CONFIG.url, CONFIG.anonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    })
  : null;

let currentUser = null;
let currentWorkspace = null;
let products = [];
let realtimeChannel = null;
let audioCtx = null;
let alarmTimer = null;
let currentAlarm = null;
const alarmAck = JSON.parse(localStorage.getItem("expiry-alarm-ack") || "{}");
const snoozedUntil = JSON.parse(localStorage.getItem("expiry-snoozed") || "{}");

const $ = (s, root=document) => root.querySelector(s);
const $$ = (s, root=document) => [...root.querySelectorAll(s)];
const authGate = $("#authGate");
const loginForm = $("#loginForm");
const authMessage = $("#authMessage");
const accountPanel = $("#accountPanel");
const workspaceNameEl = $("#workspaceName");
const currentUserEmailEl = $("#currentUserEmail");
const logoutBtn = $("#logoutBtn");

function saveAlarmState(){
  localStorage.setItem("expiry-alarm-ack", JSON.stringify(alarmAck));
  localStorage.setItem("expiry-snoozed", JSON.stringify(snoozedUntil));
}

function setAuthMessage(message, ok=false){
  if (!authMessage) return;
  authMessage.textContent = message || "";
  authMessage.style.color = ok ? "#23774d" : "#b42318";
}

function normalizeLoginId(value){
  const v = String(value || "").trim();
  if (!v) return v;
  // Supabase password auth is email-based in this template.
  // If staff types only an ID, map it to an internal pseudo-email.
  return v.includes("@") ? v : `${v.toLowerCase()}@expiry.local`;
}

async function signIn(emailOrId, password){
  if (!CONFIG_READY) {
    throw new Error("Supabase belum dikonfigurasi. Isi supabase-config.js terlebih dahulu.");
  }
  const email = normalizeLoginId(emailOrId);
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

async function signOut(){
  if (realtimeChannel) {
    await sb.removeChannel(realtimeChannel);
    realtimeChannel = null;
  }
  await sb.auth.signOut();
  currentUser = null;
  currentWorkspace = null;
  products = [];
  if (accountPanel) accountPanel.hidden = true;
  authGate.hidden = false;
  renderProducts();
}

async function resolveWorkspace(){
  const { data, error } = await sb
    .from("workspace_members")
    .select("workspace_id, role, workspaces(id,name)")
    .eq("user_id", currentUser.id)
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  if (!data || !data.workspace_id) {
    throw new Error("Akun ini belum terhubung ke workspace/outlet.");
  }

  currentWorkspace = {
    id: data.workspace_id,
    name: data.workspaces?.name || "Outlet",
    role: data.role || "staff"
  };

  if (workspaceNameEl) workspaceNameEl.textContent = currentWorkspace.name;
  if (currentUserEmailEl) currentUserEmailEl.textContent = currentUser.email || currentUser.id;
  if (accountPanel) accountPanel.hidden = false;
}

async function loadProducts(){
  if (!currentWorkspace) return;
  const { data, error } = await sb
    .from("products")
    .select("*")
    .eq("workspace_id", currentWorkspace.id)
    .order("expiry_at", { ascending: true });

  if (error) throw error;
  products = data || [];
  renderProducts();
}

async function startRealtime(){
  if (realtimeChannel) await sb.removeChannel(realtimeChannel);

  realtimeChannel = sb
    .channel(`products-${currentWorkspace.id}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "products",
        filter: `workspace_id=eq.${currentWorkspace.id}`
      },
      async () => {
        await loadProducts();
      }
    )
    .subscribe((status) => {
      console.log("Supabase Realtime:", status);
    });
}

async function bootAuthenticated(session){
  currentUser = session.user;
  await resolveWorkspace();
  await loadProducts();
  await startRealtime();
  authGate.hidden = true;
  startAlarmLoop();
}

loginForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  setAuthMessage("Login...");
  const submit = $("button[type=submit]", loginForm);
  if (submit) submit.disabled = true;
  try {
    await signIn($("#loginEmail").value, $("#loginPassword").value);
  } catch (err) {
    console.error(err);
    setAuthMessage(err.message || "Login gagal.");
  } finally {
    if (submit) submit.disabled = false;
  }
});

logoutBtn?.addEventListener("click", signOut);

if (sb) {
  sb.auth.onAuthStateChange(async (_event, session) => {
    try {
      if (session?.user) {
        await bootAuthenticated(session);
      } else {
        authGate.hidden = false;
      }
    } catch (err) {
      console.error(err);
      authGate.hidden = false;
      setAuthMessage(err.message || "Gagal memuat akun.");
    }
  });

  sb.auth.getSession().then(async ({ data }) => {
    if (data.session?.user) {
      try { await bootAuthenticated(data.session); }
      catch (err) { setAuthMessage(err.message); authGate.hidden = false; }
    } else {
      authGate.hidden = false;
    }
  });
} else {
  authGate.hidden = false;
  setAuthMessage("Isi Project URL dan anon/publishable key di supabase-config.js.");
}

/* ------------------------------
   Product CRUD
-------------------------------- */

function getProductForm(){
  return $("#productForm") || $("form[data-product-form]") || $(".product-form");
}

function fieldValue(form, ...names){
  for (const name of names) {
    const el = form?.elements?.[name] || $(`[name="${name}"]`, form || document);
    if (el) return el.value;
  }
  return "";
}

function toIsoFromLocal(value){
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

async function addProductFromForm(form){
  if (!currentWorkspace) throw new Error("Workspace belum siap.");
  const expiryInput = fieldValue(form, "expiry", "expiry_at", "expiryAt");
  const payload = {
    workspace_id: currentWorkspace.id,
    name: fieldValue(form, "name", "productName").trim(),
    batch: fieldValue(form, "batch").trim() || null,
    category: fieldValue(form, "category").trim() || null,
    location: fieldValue(form, "location").trim() || null,
    qty: Number(fieldValue(form, "qty", "quantity") || 0),
    unit: fieldValue(form, "unit").trim() || null,
    expiry_at: toIsoFromLocal(expiryInput),
    note: fieldValue(form, "note").trim() || null,
    warning_minutes: Number(fieldValue(form, "warningMinutes", "warning_minutes") || 10),
    status: "active",
    created_by: currentUser.id,
    updated_by: currentUser.id
  };

  if (!payload.name) throw new Error("Nama produk wajib diisi.");
  if (!payload.expiry_at) throw new Error("Tanggal/jam expiry wajib diisi.");

  const { error } = await sb.from("products").insert(payload);
  if (error) throw error;
  form.reset();
}

const productForm = getProductForm();
productForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const button = $("button[type=submit]", productForm);
  if (button) button.disabled = true;
  try {
    await addProductFromForm(productForm);
    closeProductModalIfAny();
  } catch (err) {
    console.error(err);
    alert(err.message || "Gagal menambahkan produk.");
  } finally {
    if (button) button.disabled = false;
  }
});

async function setProductStatus(id, status){
  const { error } = await sb
    .from("products")
    .update({
      status,
      updated_by: currentUser.id,
      updated_at: new Date().toISOString()
    })
    .eq("id", id)
    .eq("workspace_id", currentWorkspace.id);
  if (error) throw error;
}

async function deleteProduct(id){
  const { error } = await sb
    .from("products")
    .delete()
    .eq("id", id)
    .eq("workspace_id", currentWorkspace.id);
  if (error) throw error;
}

/* ------------------------------
   Existing dashboard rendering
-------------------------------- */

function remainingMs(p){ return new Date(p.expiry_at).getTime() - Date.now(); }

function statusFor(p){
  if (p.status === "used") return {label:"Used", cls:"safe"};
  if (p.status === "discarded") return {label:"Discarded", cls:"expired"};
  const diff = remainingMs(p);
  if (diff <= 0) return {label:"Expired", cls:"expired"};
  if (diff <= (Number(p.warning_minutes || 10) * 60 * 1000)) return {label:"Warning", cls:"urgent"};
  if (diff <= 24 * 60 * 60 * 1000) return {label:"Segera Expired", cls:"warning"};
  return {label:"Aman", cls:"safe"};
}

function formatRemaining(ms){
  if (ms <= 0) return "EXPIRED";
  const totalMin = Math.floor(ms / 60000);
  const days = Math.floor(totalMin / 1440);
  const hours = Math.floor((totalMin % 1440) / 60);
  const mins = totalMin % 60;
  if (days) return `${days}h ${hours}j ${mins}m`;
  if (hours) return `${hours}j ${mins}m`;
  return `${mins} menit`;
}

function esc(v){
  return String(v ?? "").replace(/[&<>"']/g, ch => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
  }[ch]));
}

function productCardHtml(p){
  const st = statusFor(p);
  const dt = new Date(p.expiry_at);
  return `
    <article class="product-card ${st.cls}" data-id="${p.id}">
      <div class="product-main">
        <div class="product-title-row">
          <div>
            <span class="category-badge">${esc(p.category || "Produk")}</span>
            <h3>${esc(p.name)}</h3>
          </div>
          <span class="status-badge ${st.cls}">${st.label}</span>
        </div>
        <div class="product-meta">
          <span>Batch: ${esc(p.batch || "-")}</span>
          <span>Lokasi: ${esc(p.location || "-")}</span>
          <span>Qty: ${esc(p.qty ?? "-")} ${esc(p.unit || "")}</span>
        </div>
        <div class="countdown-box">
          <strong>${formatRemaining(remainingMs(p))}</strong>
          <span>${dt.toLocaleString("id-ID")}</span>
          <small>Warning ${Number(p.warning_minutes || 10)} menit sebelum expired</small>
        </div>
        ${p.note ? `<p class="subtle">${esc(p.note)}</p>` : ""}
        <div class="card-actions">
          ${p.status === "active" ? `<button class="used-btn" data-action="used" data-id="${p.id}">Used</button>
          <button class="danger-btn" data-action="discarded" data-id="${p.id}">Discard</button>` : ""}
          <button class="icon-btn" data-action="delete" data-id="${p.id}" title="Hapus">🗑</button>
        </div>
      </div>
    </article>`;
}

function findProductContainer(){
  return $("#productList") || $("#productsList") || $(".product-list") || $(".products-grid") || $("#productGrid");
}

function renderProducts(){
  const container = findProductContainer();
  if (container) {
    const query = ($("#searchInput")?.value || "").toLowerCase();
    let list = products.filter(p =>
      !query ||
      (p.name || "").toLowerCase().includes(query) ||
      (p.batch || "").toLowerCase().includes(query) ||
      (p.category || "").toLowerCase().includes(query)
    );
    container.innerHTML = list.length
      ? list.map(productCardHtml).join("")
      : `<div class="empty-state"><strong>Belum ada produk</strong><p>Tambahkan produk untuk mulai memantau expiry.</p></div>`;
  }
  updateStats();
}

function updateStats(){
  const active = products.filter(p => p.status === "active");
  const expired = active.filter(p => remainingMs(p) <= 0).length;
  const warning = active.filter(p => {
    const d = remainingMs(p);
    return d > 0 && d <= Number(p.warning_minutes || 10) * 60000;
  }).length;

  const mappings = [
    [["#totalProducts","#totalCount","[data-stat='total']"], active.length],
    [["#warningCount","#warningProducts","[data-stat='warning']"], warning],
    [["#expiredCount","#expiredProducts","[data-stat='expired']"], expired]
  ];
  mappings.forEach(([selectors,val])=>{
    selectors.some(s=>{
      const el=$(s); if(el){el.textContent=val; return true;} return false;
    });
  });
}

document.addEventListener("click", async (e)=>{
  const btn = e.target.closest("[data-action][data-id]");
  if (!btn || !currentWorkspace) return;
  const {action,id} = btn.dataset;
  try {
    if (action === "used") await setProductStatus(id,"used");
    if (action === "discarded") await setProductStatus(id,"discarded");
    if (action === "delete" && confirm("Hapus produk ini?")) await deleteProduct(id);
  } catch(err) {
    alert(err.message || "Aksi gagal.");
  }
});

$("#searchInput")?.addEventListener("input", renderProducts);

function closeProductModalIfAny(){
  const modal = $("#productModal") || $(".modal");
  if (modal) {
    modal.classList.remove("open","show","active");
    if (modal.hasAttribute("open")) modal.removeAttribute("open");
  }
}

/* ------------------------------
   Alarm / sound
-------------------------------- */

function ensureAudio(){
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === "suspended") audioCtx.resume();
}

function beep(freq=880, duration=.18, volume=.18){
  ensureAudio();
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.frequency.value = freq;
  gain.gain.value = volume;
  osc.connect(gain).connect(audioCtx.destination);
  osc.start();
  gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);
  osc.stop(audioCtx.currentTime + duration);
}

function soundPattern(level){
  if (level === "expired") {
    beep(980,.22,.3);
    setTimeout(()=>beep(720,.22,.3),260);
    setTimeout(()=>beep(980,.25,.3),520);
  } else {
    beep(760,.16,.2);
    setTimeout(()=>beep(920,.16,.2),220);
  }
  navigator.vibrate?.(level === "expired" ? [300,120,300,120,600] : [200,100,200]);
}

function alarmKey(p, level){
  return `${p.id}:${level}:${p.expiry_at}`;
}

function isSnoozed(p, level){
  return Number(snoozedUntil[alarmKey(p,level)] || 0) > Date.now();
}

function acknowledgeAlarm(p, level){
  alarmAck[alarmKey(p,level)] = true;
  saveAlarmState();
}

function showAlarm(p, level){
  if (currentAlarm) return;
  currentAlarm = {p,level};
  soundPattern(level);

  const old = $("#sharedExpiryAlarm");
  old?.remove();

  const wrap = document.createElement("div");
  wrap.id = "sharedExpiryAlarm";
  wrap.className = "kitchen-alarm-overlay";
  wrap.innerHTML = `
    <div class="kitchen-alarm-card ${level}">
      <div class="alarm-kicker">${level === "expired" ? "PRODUK EXPIRED" : `WARNING — ${Number(p.warning_minutes||10)} MENIT LAGI`}</div>
      <h2>${esc(p.name)}</h2>
      <p>${esc(p.location || "")}${p.batch ? ` • Batch ${esc(p.batch)}` : ""}</p>
      <div class="alarm-actions">
        <button id="sharedSnooze" class="secondary-btn">SNOOZE 5 MENIT</button>
        <button id="sharedStop" class="primary-btn">HENTIKAN ALARM</button>
      </div>
    </div>`;
  document.body.appendChild(wrap);

  let repeat = setInterval(()=>soundPattern(level), level === "expired" ? 1800 : 3500);

  $("#sharedStop")?.addEventListener("click", ()=>{
    clearInterval(repeat);
    acknowledgeAlarm(p,level);
    wrap.remove();
    currentAlarm = null;
  });
  $("#sharedSnooze")?.addEventListener("click", ()=>{
    clearInterval(repeat);
    snoozedUntil[alarmKey(p,level)] = Date.now() + 5*60*1000;
    saveAlarmState();
    wrap.remove();
    currentAlarm = null;
  });
}

function checkAlarms(){
  if (!currentWorkspace || currentAlarm) return;
  const active = products.filter(p=>p.status==="active");

  // Expired first
  for (const p of active) {
    const key = alarmKey(p,"expired");
    if (remainingMs(p) <= 0 && !alarmAck[key] && !isSnoozed(p,"expired")) {
      showAlarm(p,"expired");
      return;
    }
  }
  for (const p of active) {
    const diff = remainingMs(p);
    const warningMs = Number(p.warning_minutes||10)*60000;
    const key = alarmKey(p,"warning");
    if (diff > 0 && diff <= warningMs && !alarmAck[key] && !isSnoozed(p,"warning")) {
      showAlarm(p,"warning");
      return;
    }
  }
}

function startAlarmLoop(){
  if (alarmTimer) clearInterval(alarmTimer);
  alarmTimer = setInterval(()=>{
    renderProducts();
    checkAlarms();
  },1000);
}

// Existing alarm enable/test buttons can unlock Web Audio.
document.addEventListener("click",(e)=>{
  const txt=(e.target.textContent||"").toLowerCase();
  if (txt.includes("aktifkan alarm") || txt.includes("test alarm")) {
    try { ensureAudio(); beep(880,.12,.12); } catch{}
  }
});
