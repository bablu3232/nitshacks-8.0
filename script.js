// --- Config (change BACKEND_BASE to your backend URL) -----------------
const BACKEND_BASE = "http://localhost:4000"; // backend that serves nonce & verifies signature
const JWT_STORAGE_KEY = "sp_jwt";

// --- Existing demo storage helpers -----------------------------------
const STORAGE_KEY = "skills_passport_chain";

function loadChain() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function saveChain(chain) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(chain));
}

// Simple non-cryptographic hash just for demo (NOT secure)
function simpleHash(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0; // Convert to 32bit integer
  }
  return "0x" + (hash >>> 0).toString(16).padStart(8, "0");
}

function generateCredentialId() {
  const rand = Math.floor(Math.random() * 9000) + 1000;
  return `CERT-${Date.now()}-${rand}`;
}

function computeStatus(cred) {
  if (!cred) return "notfound";
  if (cred.status === "revoked") return "revoked";
  if (cred.expiryDate) {
    const today = new Date().setHours(0, 0, 0, 0);
    const exp = new Date(cred.expiryDate).setHours(0, 0, 0, 0);
    if (exp < today) return "expired";
  }
  return "active";
}

// --- UI helpers ------------------------------------------------------
function showSection(id) {
  document.querySelectorAll(".section").forEach((sec) => {
    sec.classList.remove("active");
  });
  document.getElementById(id).classList.add("active");
}

function showIssuerOnlyUI(show) {
  document.querySelectorAll(".issuer-only").forEach(el => {
    if (show) el.classList.remove("hidden");
    else el.classList.add("hidden");
  });
  // show/hide login/logout buttons
  document.getElementById("issuerLoginBtn").classList.toggle("hidden", show);
  document.getElementById("logoutBtn").classList.toggle("hidden", !show);
}

// --- MetaMask & Auth state -------------------------------------------
let provider = null;
let signer = null;
let userAddress = null;

async function initMetaMaskButtons() {
  const connectBtn = document.getElementById("connectWalletBtn");
  const loginBtn = document.getElementById("issuerLoginBtn");
  const logoutBtn = document.getElementById("logoutBtn");

  connectBtn.addEventListener("click", async () => {
    await connectWallet();
  });

  loginBtn.addEventListener("click", async () => {
    await metaMaskIssuerLogin();
  });

  logoutBtn.addEventListener("click", () => {
    logout();
  });

  // restore session if any
  await restoreIssuerSession();
}

async function connectWallet() {
  try {
    if (!window.ethereum) {
      alert("MetaMask not found — please install MetaMask extension.");
      return;
    }
    await window.ethereum.request({ method: "eth_requestAccounts" });
    provider = new ethers.BrowserProvider(window.ethereum);
    signer = await provider.getSigner();
    userAddress = await signer.getAddress();
    document.getElementById("walletAddr").textContent = userAddress;
    // show login button (if not already authenticated)
    const token = sessionStorage.getItem(JWT_STORAGE_KEY);
    if (!token) {
      document.getElementById("issuerLoginBtn").classList.remove("hidden");
      document.getElementById("logoutBtn").classList.add("hidden");
    } else {
      document.getElementById("issuerLoginBtn").classList.add("hidden");
      document.getElementById("logoutBtn").classList.remove("hidden");
      showIssuerOnlyUI(true);
    }
  } catch (e) {
    console.error("connectWallet error", e);
    alert("Could not connect wallet: " + (e.message || e));
  }
}

async function metaMaskIssuerLogin() {
  try {
    if (!signer) {
      await connectWallet();
      if (!signer) return;
    }
    userAddress = await signer.getAddress();

    // 1) get nonce from backend
    const r1 = await fetch(`${BACKEND_BASE}/api/nonce?address=${userAddress}`);
    if (!r1.ok) {
      const j = await r1.json().catch(()=>({error:'unknown'}));
      alert("Could not fetch nonce: " + (j.error || JSON.stringify(j)));
      return;
    }
    const { nonce } = await r1.json();

    // 2) sign the nonce
    const signature = await signer.signMessage(nonce);

    // 3) send signature to /api/auth/wallet
    const r2 = await fetch(`${BACKEND_BASE}/api/auth/wallet`, {
      method: "POST",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify({ address: userAddress, signature })
    });

    const j2 = await r2.json();
    if (!r2.ok) {
      alert("Authentication failed: " + (j2.error || JSON.stringify(j2)));
      return;
    }

    // store JWT & show issuer UI
    sessionStorage.setItem(JWT_STORAGE_KEY, j2.token);
    document.getElementById("walletAddr").textContent = userAddress;
    document.getElementById("issuerLoginBtn").classList.add("hidden");
    document.getElementById("logoutBtn").classList.remove("hidden");
    showIssuerOnlyUI(true);
    alert("Logged in as issuer: " + userAddress);
  } catch (e) {
    console.error("metaMaskIssuerLogin error", e);
    alert("Login failed: " + (e.message || e));
  }
}

async function restoreIssuerSession() {
  const token = sessionStorage.getItem(JWT_STORAGE_KEY);
  if (!token) {
    showIssuerOnlyUI(false);
    return;
  }
  // validate token with backend
  try {
    const r = await fetch(`${BACKEND_BASE}/api/me`, {
      headers: { "Authorization": "Bearer " + token }
    });
    if (!r.ok) {
      sessionStorage.removeItem(JWT_STORAGE_KEY);
      showIssuerOnlyUI(false);
      return;
    }
    const j = await r.json();
    // j.address available
    document.getElementById("walletAddr").textContent = j.address;
    userAddress = j.address;
    // ensure we have a signer if user has metamask connected
    if (window.ethereum) {
      provider = new ethers.BrowserProvider(window.ethereum);
      signer = await provider.getSigner().catch(()=>null);
    }
    showIssuerOnlyUI(true);
  } catch (e) {
    console.warn("restoreIssuerSession error", e);
    sessionStorage.removeItem(JWT_STORAGE_KEY);
    showIssuerOnlyUI(false);
  }
}

function logout() {
  sessionStorage.removeItem(JWT_STORAGE_KEY);
  document.getElementById("walletAddr").textContent = "";
  showIssuerOnlyUI(false);
  document.getElementById("issuerLoginBtn").classList.remove("hidden");
  document.getElementById("logoutBtn").classList.add("hidden");
  alert("Logged out");
}

// --- Issuer gating helper: require issuer login ---------------------
function isIssuerLoggedIn() {
  const token = sessionStorage.getItem(JWT_STORAGE_KEY);
  return !!token;
}

// --- Rendering / table updates (unchanged from your code) -----------
function renderIssuerTable() {
  const chain = loadChain();
  const tbody = document.querySelector("#issuerTable tbody");
  tbody.innerHTML = "";

  chain.forEach((cred, index) => {
    const tr = document.createElement("tr");

    const status = computeStatus(cred);

    tr.innerHTML = `
      <td>${cred.id}</td>
      <td>${cred.studentName}</td>
      <td>${cred.studentWallet}</td>
      <td>${cred.courseName}</td>
      <td>
        <span class="status-pill ${ status === "active" ? "status-active" : status === "revoked" ? "status-revoked" : "status-expired" }">
          ${status.toUpperCase()}
        </span>
      </td>
      <td>${cred.hash}</td>
      <td>
        ${ status === "revoked" ? "<small>Already revoked</small>" : `<button class="action-btn secondary" data-index="${index}">Revoke</button>` }
      </td>
    `;

    tbody.appendChild(tr);
  });

  // Attach revoke handlers
  tbody.querySelectorAll("button[data-index]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const idx = Number(e.target.getAttribute("data-index"));
      // require issuer login to revoke
      if (!isIssuerLoggedIn()) { alert("Only logged-in issuers can revoke. Click 'Connect Wallet' -> 'Login as Issuer'."); return; }
      revokeCredential(idx);
    });
  });
}

function renderStudentTable(wallet) {
  const chain = loadChain();
  const tbody = document.querySelector("#studentTable tbody");
  tbody.innerHTML = "";

  const myCreds = chain.filter(
    (c) => c.studentWallet.toLowerCase() === wallet.toLowerCase()
  );

  if (myCreds.length === 0) {
    const tr = document.createElement("tr");
    tr.innerHTML =
      '<td colspan="6">No credentials found for this wallet.</td>';
    tbody.appendChild(tr);
    return;
  }

  myCreds.forEach((cred) => {
    const status = computeStatus(cred);
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${cred.id}</td>
      <td>${cred.institutionName}</td>
      <td>${cred.courseName}</td>
      <td>${cred.issueDate || "-"}</td>
      <td>${cred.expiryDate || "—"}</td>
      <td>
        <span class="status-pill ${ status === "active" ? "status-active" : status === "revoked" ? "status-revoked" : "status-expired" }">
          ${status.toUpperCase()}
        </span>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

function showVerifyResult(cred) {
  const box = document.getElementById("verifyResult");
  if (!cred) {
    box.innerHTML =
      '<p class="title verify-bad">❌ Credential not found</p><p>This ID does not exist on our registry.</p>';
    return;
  }

  const status = computeStatus(cred);
  let line1 = "";
  let extra = "";

  if (status === "active") {
    line1 =
      '<p class="title verify-ok">✅ VALID: Credential is authentic</p>';
  } else if (status === "expired") {
    line1 =
      '<p class="title verify-bad">⚠️ EXPIRED: Credential is no longer valid</p>';
  } else if (status === "revoked") {
    line1 =
      '<p class="title verify-bad">❌ REVOKED: Credential has been revoked by the issuer</p>';
  }

  extra = `
    <p><strong>Institution:</strong> ${cred.institutionName}</p>
    <p><strong>Course / Skill:</strong> ${cred.courseName}</p>
    <p><strong>Issued To Wallet:</strong> ****${cred.studentWallet.slice(-6)}</p>
    <p><strong>Issue Date:</strong> ${cred.issueDate || "-"}</p>
    <p><strong>Expiry Date:</strong> ${cred.expiryDate || "—"}</p>
  `;

  box.innerHTML = line1 + extra;
}

// --- Core operations (mint, revoke) ----------------------------------
function mintCredential(data) {
  // require issuer login
  if (!isIssuerLoggedIn()) {
    alert("Only logged-in issuers can mint credentials. Click 'Login as Issuer'.");
    return null;
  }

  const chain = loadChain();

  const id = generateCredentialId();
  const previousHash = chain.length ? chain[chain.length - 1].hash : "GENESIS";

  const payload = JSON.stringify({
    id,
    ...data,
    previousHash,
  });

  const hash = simpleHash(payload);

  const credential = {
    id,
    ...data,
    previousHash,
    hash,
    status: "active",
    createdAt: new Date().toISOString(),
  };

  chain.push(credential);
  saveChain(chain);

  return credential;
}

function revokeCredential(index) {
  const chain = loadChain();
  if (!chain[index]) return;
  chain[index].status = "revoked";
  saveChain(chain);
  renderIssuerTable();
}

// --- Event Listeners -------------------------------------------------
document.addEventListener("DOMContentLoaded", () => {
  renderIssuerTable();

  // wire metamask buttons & session
  initMetaMaskButtons().catch(console.error);

  // Issuer form
  const issuerForm = document.getElementById("issuerForm");
  const issuerMsg = document.getElementById("issuerMessage");

  issuerForm.addEventListener("submit", (e) => {
    e.preventDefault();

    // require login
    if (!isIssuerLoggedIn()) {
      alert("Only logged-in issuers can mint. Please login as issuer first.");
      return;
    }

    const institutionName = document.getElementById("institutionName").value;
    const studentName = document.getElementById("studentName").value;
    const studentWallet = document.getElementById("studentWallet").value;
    const courseName = document.getElementById("courseName").value;
    const issueDate = document.getElementById("issueDate").value;
    const expiryDate = document.getElementById("expiryDate").value;

    const cred = mintCredential({
      institutionName,
      studentName,
      studentWallet,
      courseName,
      issueDate,
      expiryDate,
    });

    if (cred) {
      issuerMsg.textContent = `✅ Credential minted with ID: ${cred.id}`;
      issuerForm.reset();
      renderIssuerTable();
    }
  });

  // Student search form
  const studentSearchForm = document.getElementById("studentSearchForm");
  studentSearchForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const wallet = document.getElementById("studentWalletSearch").value;
    renderStudentTable(wallet);
  });

  // Verify form
  const verifyForm = document.getElementById("verifyForm");
  verifyForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const id = document.getElementById("verifyId").value.trim();
    const chain = loadChain();
    const cred = chain.find((c) => c.id === id);
    showVerifyResult(cred);
  });
});
