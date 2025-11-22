CERT-12345-ABC

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

// Generate unique credential ID
function generateCredentialId() {
  const rand = Math.floor(Math.random() * 9000) + 1000;
  return `CERT-${Date.now()}-${rand}`;
}

// Compute status considering expiry
function computeStatus(cred) {
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
        <span class="status-pill ${
          status === "active"
            ? "status-active"
            : status === "revoked"
            ? "status-revoked"
            : "status-expired"
        }">
          ${status.toUpperCase()}
        </span>
      </td>
      <td>${cred.hash}</td>
      <td>
        ${
          status === "revoked"
            ? "<small>Already revoked</small>"
            : `<button class="action-btn secondary" data-index="${index}">Revoke</button>`
        }
      </td>
    `;

    tbody.appendChild(tr);
  });

  // Attach revoke handlers
  tbody.querySelectorAll("button[data-index]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const idx = Number(e.target.getAttribute("data-index"));
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
        <span class="status-pill ${
          status === "active"
            ? "status-active"
            : status === "revoked"
            ? "status-revoked"
            : "status-expired"
        }">
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

  // To respect "privacy", we do not show full details (grades, etc.)
  extra = `
    <p><strong>Institution:</strong> ${cred.institutionName}</p>
    <p><strong>Course / Skill:</strong> ${cred.courseName}</p>
    <p><strong>Issued To Wallet:</strong> ****${cred.studentWallet.slice(
      -6
    )}</p>
    <p><strong>Issue Date:</strong> ${cred.issueDate || "-"}</p>
    <p><strong>Expiry Date:</strong> ${cred.expiryDate || "—"}</p>
  `;

  box.innerHTML = line1 + extra;
}

// --- Core operations -------------------------------------------------

function mintCredential(data) {
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

  // Issuer form
  const issuerForm = document.getElementById("issuerForm");
  const issuerMsg = document.getElementById("issuerMessage");

  issuerForm.addEventListener("submit", (e) => {
    e.preventDefault();

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

    issuerMsg.textContent = `✅ Credential minted with ID: ${cred.id}`;
    issuerForm.reset();
    renderIssuerTable();
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
