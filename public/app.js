/* =========================================================
   ROUTEWISE — MAIN APPLICATION
   Prototype integration layer
   ========================================================= */


"use strict";

/* =========================================================
   CONFIGURATION
   ========================================================= */


/* =========================================================
   CONFIGURATION
   ========================================================= */

const RW_CONFIG = {
  appName: "RouteWise",

  storage: {
    users: "routewise_users",
    complaints: "routewise_complaints",
    session: "routewise_session",
    theme: "routewise_theme",
    notifications: "routewise_notifications",
    busLocation: "routewise_bus_location"
  },

  slaHours: {
    Low: 48,
    Medium: 24,
    High: 12,
    Urgent: 2
  },

  maxAttachmentSize: 2 * 1024 * 1024,

  routes: [
    "CB-101 · North Campus",
    "CB-205 · Main Gate Express",
    "CB-314 · East Hostel Loop"
  ],

  categories: [
    "Late arrival",
    "Overcrowding",
    "Driver behaviour",
    "Safety concern",
    "Route or stop issue",
    "Cleanliness",
    "Other"
  ],

  priorities: [
    "Low",
    "Medium",
    "High",
    "Urgent"
  ],

  statuses: [
    "New",
    "In review",
    "Resolved"
  ]
};


/* =========================================================
   DOM HELPERS
   ========================================================= */

const $ = (selector, root = document) =>
  root.querySelector(selector);

const $$ = (selector, root = document) =>
  [...root.querySelectorAll(selector)];

const byId = (id) =>
  document.getElementById(id);

const safeText = (value) =>
  String(value ?? "").trim();

async function apiFetch(url, options = {}) {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), 10000);

  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error("The server took too long to respond. Check your connection before trying again.");
    }

    throw error;
  } finally {
    window.clearTimeout(timeoutId);
  }
}


/* =========================================================
   STORAGE
   ========================================================= */

const STORE_REMOTE_MAP = {
  [RW_CONFIG.storage.users]: "users",
  [RW_CONFIG.storage.complaints]: "complaints",
  [RW_CONFIG.storage.notifications]: "notifications"
};

const Store = {

  async syncFromServer() {
    try {
      const response = await apiFetch("/api/init");

      if (!response.ok) {
        return false;
      }

      const data = await response.json();

      if (Array.isArray(data.users)) {
        localStorage.setItem(
          RW_CONFIG.storage.users,
          JSON.stringify(data.users)
        );
      }

      if (Array.isArray(data.complaints)) {
        localStorage.setItem(
          RW_CONFIG.storage.complaints,
          JSON.stringify(data.complaints)
        );
      }

      if (Array.isArray(data.notifications)) {
        localStorage.setItem(
          RW_CONFIG.storage.notifications,
          JSON.stringify(data.notifications)
        );
      }

      return true;
    } catch (error) {
      console.warn("RouteWise remote sync read failed:", error);
      return false;
    }
  },

  async syncToServer(key, value) {
    const endpoint = STORE_REMOTE_MAP[key];

    if (!endpoint) {
      return true;
    }

    try {
      const response = await apiFetch(`/api/${endpoint}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(value)
      });

      if (!response.ok) {
        throw new Error(`Sync failed: ${response.status}`);
      }

      return true;
    } catch (error) {
      console.warn("RouteWise remote sync write failed:", error);
      return false;
    }
  },

  async createOnServer(resource, value) {
    const response = await apiFetch(`/api/${resource}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(value)
    });
    const result = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(result.error || `Save failed: ${response.status}`);
    }

    return result;
  },

  get(key, fallback = null) {
    try {
      const value = localStorage.getItem(key);

      if (value === null) {
        return fallback;
      }

      return JSON.parse(value);

    } catch (error) {
      console.warn("RouteWise storage read error:", error);
      return fallback;
    }
  },


  set(key, value) {
    if (!Store.setLocal(key, value)) {
      return false;
    }

    if (STORE_REMOTE_MAP[key]) {
      Store.syncToServer(key, value);
    }

    return true;
  },


  setLocal(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (error) {
      console.warn("RouteWise storage write error:", error);
      return false;
    }
  },


  async setAndSync(key, value) {
    if (!Store.setLocal(key, value)) {
      return {
        local: false,
        synced: false
      };
    }

    const synced = STORE_REMOTE_MAP[key]
      ? Store.syncToServer(key, value)
      : true;

    return {
      local: true,
      synced: await synced
    };
  },


  remove(key) {
    localStorage.removeItem(key);
  },


  /* Legacy-compatible methods */

  read(key, fallback = null) {
    return this.get(key, fallback);
  },


  write(key, value) {
    return this.set(key, value);
  },


  users() {
    return this.get(
      RW_CONFIG.storage.users,
      []
    );
  },


  complaints() {
    return this.get(
      RW_CONFIG.storage.complaints,
      []
    );
  },


  session() {
    return this.get(
      RW_CONFIG.storage.session,
      null
    );
  },


  setSession(session) {
    return this.set(
      RW_CONFIG.storage.session,
      session
    );
  },


  clearSession() {
    this.remove(
      RW_CONFIG.storage.session
    );
  },


  notifications() {
    return this.get(
      RW_CONFIG.storage.notifications,
      []
    );
  }
};


/* =========================================================
   GENERAL UTILITIES
   ========================================================= */

function escapeHTML(value) {

  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}


function normalize(value) {
  return safeText(value).toLowerCase();
}


function ensureHostAccount() {
  const users = Store.users();
  const legacyAdminEmails = ["host@gmail.com", "admin@routewise.com"];
  const hostUser = users.find(user =>
    user.isHost === true ||
    legacyAdminEmails.includes(normalize(user.username)) ||
    legacyAdminEmails.includes(normalize(user.email))
  );

  if (hostUser) {
    hostUser.role = "admin";
    hostUser.isHost = true;
    hostUser.username = "admin@routewise.com";
    hostUser.email = "admin@routewise.com";
    hostUser.password = "admin123";
    Store.setLocal(RW_CONFIG.storage.users, users);
    return hostUser;
  }

  const defaultHost = {
    id: "HOST-1",
    name: "Host Admin",
    username: "admin@routewise.com",
    email: "admin@routewise.com",
    phone: "",
    password: "admin123",
    role: "admin",
    isHost: true,
    createdAt: new Date().toISOString()
  };

  users.push(defaultHost);
  Store.setLocal(RW_CONFIG.storage.users, users);
  return defaultHost;
}


function normalizeRoute(route) {

  const value = safeText(route);

  if (!value) {
    return "Other / Not known";
  }

  return value
    .replace(/\s*·\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}


function routeCode(route) {

  const match = safeText(route).match(
    /CB-\d+/i
  );

  return match
    ? match[0].toUpperCase()
    : "OTHER";
}


function formatDate(value) {

  if (!value) {
    return "—";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "—";
  }

  return new Intl.DateTimeFormat(
    "en-IN",
    {
      day: "2-digit",
      month: "short",
      year: "numeric"
    }
  ).format(date);
}


function formatDateTime(value) {

  if (!value) {
    return "—";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "—";
  }

  return new Intl.DateTimeFormat(
    "en-IN",
    {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    }
  ).format(date);
}


function timeAgo(value) {

  if (!value) {
    return "";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const seconds =
    Math.floor(
      (Date.now() - date.getTime()) / 1000
    );

  if (seconds < 60) {
    return "Just now";
  }

  const minutes =
    Math.floor(seconds / 60);

  if (minutes < 60) {
    return `${minutes}m ago`;
  }

  const hours =
    Math.floor(minutes / 60);

  if (hours < 24) {
    return `${hours}h ago`;
  }

  const days =
    Math.floor(hours / 24);

  if (days < 7) {
    return `${days}d ago`;
  }

  return formatDate(value);
}


function initials(name) {

  const parts =
    safeText(name)
      .split(/\s+/)
      .filter(Boolean);

  if (!parts.length) {
    return "U";
  }

  if (parts.length === 1) {
    return parts[0][0].toUpperCase();
  }

  return (
    parts[0][0] +
    parts[parts.length - 1][0]
  ).toUpperCase();
}


/* =========================================================
   AUTHENTICATION
   ========================================================= */

function currentUser() {

  const session = Store.session();

  if (!session) {
    return null;
  }

  const users = Store.users();

  return (
    users.find(
      user =>
        user.id === session.userId ||
        normalize(user.email) ===
        normalize(session.email)
    ) || session
  );
}


function requireLogin() {

  const user = currentUser();

  if (!user) {
    window.location.href = "index.html";
    return null;
  }

  return user;
}


function requireAdmin() {

  const user = currentUser();
  const session = Store.session();

  if (!user || user.role !== "admin" || session?.authenticated !== true) {
    Store.clearSession();
    window.location.href = "admin-login.html";
    return null;
  }

  return user;
}


function createUserId() {

  return (
    "USR-" +
    Date.now().toString(36) +
    "-" +
    Math.random()
      .toString(36)
      .slice(2, 7)
  ).toUpperCase();
}


async function handleLogin(event) {

  event.preventDefault();

  const form = event.currentTarget;

  const email =
    safeText(
      $("#loginEmail", form)?.value
    ).toLowerCase();

  const password =
    safeText(
      $("#loginPassword", form)?.value
    );

  const message =
    byId("authMessage");

  if (!email || !password) {
    setMessage(
      message,
      "Please enter your email and password.",
      "error"
    );
    return;
  }

  try {
    const response = await apiFetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password })
    });
    const result = await response.json().catch(() => ({}));

    if (!response.ok || !result.user) {
      setMessage(message, result.error || "Invalid email or password.", "error");
      return;
    }

    const user = result.user;
    const users = Store.users().filter(item => item.id !== user.id);
    Store.setLocal(RW_CONFIG.storage.users, [user, ...users]);

    const sessionSaved = Store.setSession({
      userId: user.id,
      name: user.name,
      email: user.email,
      role: user.role || "student",
      authenticated: true,
      loginAt: new Date().toISOString()
    });

    if (!sessionSaved) {
      setMessage(message, "Your browser could not save the login session. Enable site storage, then try again.", "error");
      return;
    }

    setMessage(message, "Login successful. Opening dashboard...", "success");
    setTimeout(() => {
      window.location.href = user.role === "admin" ? "admin.html" : "dashboard.html";
    }, 500);
  } catch (error) {
    setMessage(message, error.message || "Could not reach the shared server. Try again when it is available.", "error");
  }
}


function handleAdminLogin(event) {

  event.preventDefault();

  const form = event.currentTarget;
  const email = safeText($("#adminLoginEmail", form)?.value).toLowerCase();
  const password = safeText($("#adminLoginPassword", form)?.value);
  const message = byId("adminLoginMessage");

  if (!email || !password) {
    setMessage(message, "Enter your admin email and password.", "error");
    return;
  }

  apiFetch("/api/auth/admin-login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password })
  })
    .then(async response => {
      const result = await response.json();

      if (!response.ok) {
        setMessage(message, result.error || "Invalid admin email or password.", "error");
        return;
      }

      const user = result.user;
      const sessionSaved = Store.setSession({
        userId: user.id,
        name: user.name,
        email: user.email,
        role: "admin",
        authenticated: true,
        loginAt: new Date().toISOString()
      });

      if (!sessionSaved) {
        setMessage(message, "Your browser could not save the admin session. Enable site storage, then try again.", "error");
        return;
      }

      window.location.href = "admin.html";
    })
    .catch(() => {
      setMessage(message, "Could not reach the shared server. Open this page from the RouteWise server address.", "error");
    });
}


function handleFirstAdminSetup(event) {

  event.preventDefault();

  const form = event.currentTarget;
  const name = safeText($("#adminSetupName", form)?.value);
  const email = safeText($("#adminSetupEmail", form)?.value).toLowerCase();
  const password = safeText($("#adminSetupPassword", form)?.value);
  const message = byId("adminSetupMessage");
  const users = Store.users();

  if (users.some(user => user.role === "admin" || user.isHost === true)) {
    byId("firstAdminSetup")?.classList.add("hidden");
    setMessage(message, "A host or admin account already exists for this app.", "error");
    return;
  }

  if (!name || !email || password.length < 6) {
    setMessage(message, "Enter your name, email, and a password with at least 6 characters.", "error");
    return;
  }

  let user = users.find(item => normalize(item.email) === email);

  if (user && user.password !== password) {
    setMessage(message, "That email already has an account. Enter its existing password to make it the first admin.", "error");
    return;
  }

  if (!user) {
    user = {
      id: createUserId(),
      name,
      email,
      phone: "",
      password,
      role: "admin",
      createdAt: new Date().toISOString()
    };
    users.push(user);
  } else {
    user.role = "admin";
  }

  Store.set(RW_CONFIG.storage.users, users);
  const sessionSaved = Store.setSession({
    userId: user.id,
    name: user.name,
    email: user.email,
    role: "admin",
    loginAt: new Date().toISOString()
  });

  if (!sessionSaved) {
    setMessage(message, "Your browser could not save the admin session. Enable site storage, then try again.", "error");
    return;
  }

  window.location.href = "admin.html";
}


async function handleRegister(event) {

  event.preventDefault();

  const form = event.currentTarget;

  const name =
    safeText(
      $("#registerName", form)?.value
    );

  const email =
    safeText(
      $("#registerEmail", form)?.value
    ).toLowerCase();

  const phone =
    safeText(
      $("#registerPhone", form)?.value
    );

  const password =
    safeText(
      $("#registerPassword", form)?.value
    );

  const message =
    byId("authMessage");

  if (!name || !email || !password) {

    setMessage(
      message,
      "Please complete all required fields.",
      "error"
    );

    return;
  }

  if (password.length < 6) {

    setMessage(
      message,
      "Password should contain at least 6 characters.",
      "error"
    );

    return;
  }

  const users = Store.users();
  const exists = users.some(user => normalize(user.email) === email);

  if (exists) {
    setMessage(message, "An account with this email already exists.", "error");
    return;
  }

  const user = {
    id: createUserId(),
    name,
    email,
    phone,
    password,
    role: "student",
    adminAccessStatus: "pending",
    createdAt: new Date().toISOString()
  };

  try {
    const savedUser = await Store.createOnServer("users", user);
    Store.setLocal(RW_CONFIG.storage.users, [savedUser, ...users]);

    const sessionSaved = Store.setSession({
      userId: savedUser.id,
      name: savedUser.name,
      email: savedUser.email,
      role: savedUser.role,
      loginAt: new Date().toISOString()
    });

    if (!sessionSaved) {
      setMessage(message, "Account created, but your browser could not save the session. Please sign in.", "error");
      return;
    }

    setMessage(message, "Account created successfully.", "success");
    setTimeout(() => {
      window.location.href = "dashboard.html";
    }, 500);
  } catch (error) {
    setMessage(message, error.message || "Could not save your account to the RouteWise server.", "error");
  }
}


function logout() {

  Store.clearSession();

  window.location.href =
    "index.html";
}


/* =========================================================
   MESSAGE HELPER
   ========================================================= */

function setMessage(
  element,
  text,
  type = ""
) {

  if (!element) {
    return;
  }

  element.textContent = text;

  element.classList.remove(
    "success",
    "error",
    "warning"
  );

  if (type) {
    element.classList.add(type);
  }
}


/* =========================================================
   SHELL / SIDEBAR
   ========================================================= */

function initShell() {

  const page =
    document.body.dataset.page;

  const user =
    currentUser();

  const accountName =
    byId("accountName") ||
    byId("sidebarUserName");

  const accountEmail =
    byId("accountEmail") ||
    byId("sidebarUserEmail");

  const accountAvatars = [
    byId("accountAvatar"),
    byId("topbarAvatar")
  ].filter(Boolean);

  if (user) {

    if (accountName) {
      accountName.textContent =
        user.name || "Student";
    }

    if (accountEmail) {
      accountEmail.textContent =
        user.email || "";
    }

    accountAvatars.forEach(
      avatar => {
        avatar.textContent =
          initials(user.name);
      }
    );

    const welcome =
      byId("welcomeName");

    if (welcome) {
      welcome.textContent =
        user.name?.split(" ")[0] ||
        "Student";
    }
  }

  const logoutButton =
    byId("logoutButton") ||
    byId("logoutBtn");

  if (logoutButton) {
    logoutButton.addEventListener(
      "click",
      logout
    );
  }

  const menuButton =
    byId("mobileMenuButton") ||
    byId("mobileMenuBtn");

  const sidebar =
    byId("sidebar");

  const overlay =
    byId("sidebarOverlay");

  function closeMenu() {

    sidebar?.classList.remove(
      "is-open"
    );

    overlay?.classList.remove(
      "is-visible"
    );
  }

  if (menuButton) {

    menuButton.addEventListener(
      "click",
      () => {

        sidebar?.classList.toggle(
          "is-open"
        );

        overlay?.classList.toggle(
          "is-visible"
        );

      }
    );
  }

  overlay?.addEventListener(
    "click",
    closeMenu
  );

  $$(".nav-item, .sidebar-nav a").forEach(
    link => {

      link.addEventListener(
        "click",
        closeMenu
      );

    }
  );


  /* Protect internal pages */

  if (
    ["dashboard", "complaint"]
      .includes(page)
  ) {

    requireLogin();

  }

  if (page === "admin") {
    requireAdmin();
  }

}


/* =========================================================
   THEME SYSTEM
   ========================================================= */

function applyTheme(theme) {

  const validThemes = [
    "light",
    "dark",
    "blue",
    "green"
  ];

  if (!validThemes.includes(theme)) {
    theme = "light";
  }

  document.body.dataset.theme =
    theme;

  Store.set(
    RW_CONFIG.storage.theme,
    theme
  );

  const selector =
    byId("themeSelect");

  if (selector) {
    selector.value = theme;
  }
}


function initTheme() {

  const saved =
    Store.get(
      RW_CONFIG.storage.theme,
      "light"
    );

  applyTheme(saved);

  const selector =
    byId("themeSelect");

  selector?.addEventListener(
    "change",
    event => {
      applyTheme(event.target.value);
    }
  );
}


/* =========================================================
   AUTH MODAL — LANDING PAGE
   ========================================================= */

function initAuthPage() {

  const dialog =
    byId("authDialog");

  if (!dialog) {
    return;
  }

  const loginPanel =
    byId("loginPanel");

  const registerPanel =
    byId("registerPanel");

  function openAuth(mode) {

    if (
      typeof dialog.showModal ===
      "function"
    ) {
      dialog.showModal();
    } else {
      dialog.setAttribute(
        "open",
        ""
      );
    }

    loginPanel?.classList.toggle(
      "hidden",
      mode !== "login"
    );

    registerPanel?.classList.toggle(
      "hidden",
      mode !== "register"
    );

    byId("authMessage").textContent =
      "";
  }


  $$("[data-open-auth]").forEach(
    button => {

      button.addEventListener(
        "click",
        event => {

          event.preventDefault();

          openAuth(
            button.dataset.openAuth
          );

        }
      );

    }
  );


  $("[data-auth-switch='login']")
    ?.addEventListener(
      "click",
      () => openAuth("login")
    );


  $("[data-auth-switch='register']")
    ?.addEventListener(
      "click",
      () => openAuth("register")
    );


  dialog.addEventListener(
    "click",
    event => {

      const rect =
        dialog.getBoundingClientRect();

      const inside =
        event.clientX >= rect.left &&
        event.clientX <= rect.right &&
        event.clientY >= rect.top &&
        event.clientY <= rect.bottom;

      if (!inside) {
        dialog.close();
      }

    }
  );


  byId("loginForm")
    ?.addEventListener(
      "submit",
      handleLogin
    );


  byId("registerForm")
    ?.addEventListener(
      "submit",
      handleRegister
    );

}


function initAdminLoginPage() {

  if (document.body.dataset.page !== "admin-login") {
    return;
  }

  byId("adminLoginForm")?.addEventListener("submit", handleAdminLogin);
}


/* =========================================================
   COMPLAINT ID
   ========================================================= */

function nextComplaintId() {

  const complaints =
    Store.complaints();

  let maxNumber = 0;

  complaints.forEach(
    complaint => {

      const match =
        safeText(
          complaint.reference ||
          complaint.id
        ).match(
          /RW-\d{4}-(\d+)/i
        );

      if (match) {
        maxNumber =
          Math.max(
            maxNumber,
            Number(match[1])
          );
      }

    }
  );

  const number =
    String(maxNumber + 1)
      .padStart(3, "0");

  return `RW-${new Date().getFullYear()}-${number}`;
}


/* =========================================================
   SLA ENGINE
   ========================================================= */

function getSlaHours(priority) {

  return (
    RW_CONFIG.slaHours[priority] ||
    RW_CONFIG.slaHours.Medium
  );
}


function calculateDueAt(
  createdAt,
  priority
) {

  const date =
    new Date(createdAt);

  date.setHours(
    date.getHours() +
    getSlaHours(priority)
  );

  return date.toISOString();
}


function getSlaInfo(complaint) {

  if (
    complaint.status ===
    "Resolved"
  ) {

    return {
      state: "resolved",
      label: "Resolved",
      percent: 100,
      dueAt: complaint.dueAt
    };

  }


  const createdAt =
    complaint.createdAt ||
    complaint.submittedAt ||
    new Date().toISOString();

  const dueAt =
    complaint.dueAt ||
    calculateDueAt(
      createdAt,
      complaint.priority || "Medium"
    );

  const start =
    new Date(createdAt).getTime();

  const due =
    new Date(dueAt).getTime();

  const now =
    Date.now();

  const total =
    Math.max(
      due - start,
      1
    );

  const remaining =
    due - now;

  const percentRemaining =
    Math.max(
      0,
      Math.min(
        100,
        Math.round(
          (remaining / total) * 100
        )
      )
    );


  if (remaining <= 0) {

    return {
      state: "overdue",
      label: "Overdue",
      percent: 0,
      dueAt
    };

  }


  const hoursRemaining =
    remaining /
    (1000 * 60 * 60);

  if (hoursRemaining <= 25) {

    return {
      state: "due-soon",
      label: "Due soon",
      percent: percentRemaining,
      dueAt
    };

  }


  return {
    state: "on-track",
    label: "On track",
    percent: percentRemaining,
    dueAt
  };

}


/* =========================================================
   AUTOMATIC ESCALATION
   ========================================================= */

function updateEscalations() {

  const complaints =
    Store.complaints();

  let changed = false;

  complaints.forEach(
    complaint => {

      if (
        complaint.status ===
        "Resolved"
      ) {
        return;
      }

      const sla =
        getSlaInfo(complaint);

      if (
        sla.state === "overdue" &&
        !complaint.escalated
      ) {

        complaint.escalated = true;

        complaint.escalatedAt =
          new Date().toISOString();

        complaint.timeline =
          complaint.timeline || [];

        complaint.timeline.push({
          type: "escalation",
          title: "Automatically escalated",
          description:
            "SLA deadline was exceeded.",
          at: complaint.escalatedAt
        });

        changed = true;

      }

    }
  );

  if (changed) {

    Store.set(
      RW_CONFIG.storage.complaints,
      complaints
    );

  }

  return complaints;
}


/* =========================================================
   SMART COMPLAINT CLASSIFICATION
   ========================================================= */

function analyzeComplaintText(
  description
) {

  const text =
    normalize(description);


  let category =
    "Other";

  let priority =
    "Medium";


  /* Category detection */

  if (
    /late|delay|delayed|waiting|didn't come|not arrived/
      .test(text)
  ) {

    category =
      "Late arrival";

  } else if (
    /crowd|crowded|overcrowd|full bus|packed|standing/
      .test(text)
  ) {

    category =
      "Overcrowding";

  } else if (
    /driver|conductor|rude|behaviour|behavior|driving/
      .test(text)
  ) {

    category =
      "Driver behaviour";

  } else if (
    /unsafe|safety|accident|danger|speed|emergency/
      .test(text)
  ) {

    category =
      "Safety concern";

  } else if (
    /route|stop|bus stop|wrong stop|missing stop/
      .test(text)
  ) {

    category =
      "Route or stop issue";

  } else if (
    /dirty|clean|cleanliness|garbage|waste|smell/
      .test(text)
  ) {

    category =
      "Cleanliness";

  }


  /* Priority detection */

  if (
    /emergency|accident|injury|danger|unsafe|threat|harassment/
      .test(text)
  ) {

    priority =
      "Urgent";

  } else if (
    /safety|speed|driver|stranded|missed|serious/
      .test(text)
  ) {

    priority =
      "High";

  } else if (
    /delay|late|crowded|full|dirty/
      .test(text)
  ) {

    priority =
      "Medium";

  } else {

    priority =
      "Low";

  }


  return {
    category,
    priority,
    summary:
      generateSummary(
        description,
        category,
        priority
      )
  };

}


function generateSummary(
  description,
  category,
  priority
) {

  const clean =
    safeText(description)
      .replace(/\s+/g, " ");

  const short =
    clean.length > 120
      ? clean.slice(0, 117) + "..."
      : clean;

  return `${category} issue reported with ${priority.toLowerCase()} priority: ${short}`;
}


/* =========================================================
   DUPLICATE DETECTION
   ========================================================= */

function similarityScore(
  first,
  second
) {

  const a =
    new Set(
      normalize(first)
        .split(/\W+/)
        .filter(
          word => word.length > 3
        )
    );

  const b =
    new Set(
      normalize(second)
        .split(/\W+/)
        .filter(
          word => word.length > 3
        )
    );

  if (!a.size || !b.size) {
    return 0;
  }

  let common = 0;

  a.forEach(
    word => {
      if (b.has(word)) {
        common++;
      }
    }
  );

  return common /
    Math.max(
      a.size,
      b.size
    );
}


function findDuplicateComplaint(
  complaintData
) {

  const complaints =
    Store.complaints();

  const recent =
    complaints.filter(
      complaint => {

        if (
          complaint.status ===
          "Resolved"
        ) {
          return false;
        }

        if (
          complaint.route !==
          complaintData.route
        ) {
          return false;
        }

        return true;

      }
    );

  let best = null;

  recent.forEach(
    complaint => {

      const score =
        similarityScore(
          complaint.description,
          complaintData.description
        );

      const sameLocation =
        normalize(
          complaint.location
        ) ===
        normalize(
          complaintData.location
        );

      const finalScore =
        score +
        (sameLocation ? 0.25 : 0);

      if (
        finalScore >= 0.55 &&
        (
          !best ||
          finalScore >
          best.score
        )
      ) {

        best = {
          complaint,
          score: finalScore
        };

      }

    }
  );

  return best;
}


/* =========================================================
   COMPLAINT TIMELINE
   ========================================================= */

function addTimeline(
  complaint,
  title,
  description,
  type = "update"
) {

  complaint.timeline =
    complaint.timeline || [];

  complaint.timeline.push({
    type,
    title,
    description,
    at: new Date().toISOString()
  });
}


/* =========================================================
   NOTIFICATIONS
   ========================================================= */

function createNotification(
  userId,
  title,
  message,
  complaintId = ""
) {

  const notifications =
    Store.notifications();

  notifications.unshift({
    id:
      "NT-" +
      Date.now() +
      Math.random()
        .toString(36)
        .slice(2, 6),

    userId,

    title,
    message,

    complaintId,

    read: false,

    createdAt:
      new Date().toISOString()
  });

  Store.set(
    RW_CONFIG.storage.notifications,
    notifications.slice(0, 100)
  );
}


function getUserNotifications(
  userId
) {

  return Store.notifications()
    .filter(
      notification =>
        notification.userId ===
        userId
    );
}


/* =========================================================
   PHOTO ATTACHMENT
   ========================================================= */

function readAttachment(file) {

  return new Promise(
    (resolve, reject) => {

      if (!file) {
        resolve(null);
        return;
      }

      if (
        file.size >
        RW_CONFIG.maxAttachmentSize
      ) {

        reject(
          new Error(
            "Photo must be smaller than 2 MB."
          )
        );

        return;
      }

      if (
        !file.type.startsWith(
          "image/"
        )
      ) {

        reject(
          new Error(
            "Please upload an image file."
          )
        );

        return;
      }

      const reader =
        new FileReader();

      reader.onload =
        () => resolve(
          reader.result
        );

      reader.onerror =
        () => reject(
          new Error(
            "Unable to read the image."
          )
        );

      reader.readAsDataURL(file);

    }
  );
}


/* =========================================================
   COMPLAINT FORM
   ========================================================= */

function initComplaintPage() {

  const form =
    byId("complaintForm");

  if (!form) {
    return;
  }

  const user =
    requireLogin();

  if (!user) {
    return;
  }


  const description =
    byId("description");

  const category =
    byId("category");

  const priority =
    byId("priority");

  const route =
    byId("route");

  const location =
    byId("location");

  const incidentAt =
    byId("incidentAt");

  const attachment =
    byId("attachment");


  /* Date defaults */

  if (incidentAt && !incidentAt.value) {

    const now =
      new Date();

    now.setMinutes(
      now.getMinutes() -
      now.getTimezoneOffset()
    );

    incidentAt.value =
      now.toISOString()
        .slice(0, 16);

  }


  /* Character counter */

  function updateCounter() {

    const counter =
      byId("descriptionCount");

    if (counter) {

      counter.textContent =
        `${description.value.length} / 1000`;

    }

  }

  description?.addEventListener(
    "input",
    () => {

      updateCounter();

      runSmartAnalysis();

    }
  );

  updateCounter();


  /* Smart analysis */

  function runSmartAnalysis() {

    const text =
      safeText(
        description?.value
      );

    const analysis =
      byId("smartAnalysis");

    if (
      !analysis ||
      text.length < 20
    ) {

      analysis?.classList.add(
        "hidden"
      );

      return;

    }

    const result =
      analyzeComplaintText(text);

    analysis.classList.remove(
      "hidden"
    );

    const suggestedCategory =
      byId("suggestedCategory");

    const suggestedPriority =
      byId("suggestedPriority");

    const suggestedSummary =
      byId("suggestedSummary");

    if (suggestedCategory) {
      suggestedCategory.textContent =
        result.category;
    }

    if (suggestedPriority) {
      suggestedPriority.textContent =
        result.priority;
    }

    if (suggestedSummary) {
      suggestedSummary.textContent =
        result.summary;
    }

    byId(
      "recommendedCategory"
    ).value =
      result.category;

    byId(
      "recommendedPriority"
    ).value =
      result.priority;


    /* Only suggest — don't silently override user choice */

    if (
      !category.value
    ) {
      category.value =
        result.category;
    }

    if (
      !priority.value
    ) {
      priority.value =
        result.priority;
    }

    updateSlaPreview();

    checkDuplicate();

  }


  /* Duplicate warning */

  function checkDuplicate() {

    const warning =
      byId("duplicateWarning");

    const warningText =
      byId("duplicateWarningText");

    if (
      !warning ||
      !description.value ||
      !route.value
    ) {
      return null;
    }

    const duplicate =
      findDuplicateComplaint({
        route: route.value,
        location: location?.value,
        description: description.value
      });

    if (!duplicate) {

      warning.classList.add(
        "hidden"
      );

      return null;
    }

    warning.classList.remove(
      "hidden"
    );

    const existing =
      duplicate.complaint;

    warningText.textContent =
      `${existing.reference || existing.id} reports a similar issue on ${normalizeRoute(existing.route)}.`;

    return duplicate;

  }


  description?.addEventListener(
    "input",
    checkDuplicate
  );

  route?.addEventListener(
    "change",
    checkDuplicate
  );

  location?.addEventListener(
    "input",
    checkDuplicate
  );


  /* SLA preview */

  function updateSlaPreview() {

    const preview =
      byId("slaPreviewText");

    const desc =
      byId("slaPreviewDescription");

    const selected =
      priority?.value;

    if (!preview) {
      return;
    }

    if (!selected) {

      preview.textContent =
        "Select a priority";

      if (desc) {
        desc.textContent =
          "The response deadline will be calculated automatically.";
      }

      return;
    }

    const hours =
      getSlaHours(selected);

    preview.textContent =
      `${hours} hour${hours === 1 ? "" : "s"}`;

    if (desc) {

      desc.textContent =
        `${selected} priority complaints receive a target response within ${hours} hours.`;

    }

  }

  priority?.addEventListener(
    "change",
    updateSlaPreview
  );

  updateSlaPreview();


  /* Photo */

  attachment?.addEventListener(
    "change",
    async event => {

      const file =
        event.target.files?.[0];

      const preview =
        byId("attachmentPreview");

      if (!preview) {
        return;
      }

      preview.innerHTML = "";

      if (!file) {

        preview.classList.add(
          "hidden"
        );

        return;
      }

      try {

        const data =
          await readAttachment(file);

        preview.classList.remove(
          "hidden"
        );

        preview.innerHTML = `
          <div class="attachment-preview-card">
            <img
              src="${data}"
              alt="Selected evidence"
            >

            <div>
              <strong>${escapeHTML(file.name)}</strong>
              <span>${Math.round(file.size / 1024)} KB</span>
            </div>

            <button
              type="button"
              class="attachment-remove"
              id="removeAttachment"
            >
              Remove
            </button>
          </div>
        `;

        byId(
          "removeAttachment"
        )?.addEventListener(
          "click",
          () => {

            attachment.value = "";

            preview.innerHTML = "";

            preview.classList.add(
              "hidden"
            );

          }
        );

      } catch (error) {

        attachment.value = "";

        setMessage(
          byId("complaintMessage"),
          error.message,
          "error"
        );

      }

    }
  );


  /* Duplicate submit state */

  let pendingSubmission =
    null;


  async function submitComplaint(
    allowDuplicate = false
  ) {

    const message =
      byId("complaintMessage");

    const submitButton =
      byId("submitComplaintButton");


    const categoryValue =
      category.value;

    const priorityValue =
      priority.value;

    const routeValue =
      route.value;

    const incidentValue =
      incidentAt.value;

    const locationValue =
      safeText(location.value);

    const descriptionValue =
      safeText(description.value);


    if (
      !categoryValue ||
      !priorityValue ||
      !routeValue ||
      !incidentValue ||
      !locationValue ||
      !descriptionValue
    ) {

      setMessage(
        message,
        "Please complete all required fields.",
        "error"
      );

      return;

    }


    if (
      descriptionValue.length < 20
    ) {

      setMessage(
        message,
        "Please provide at least 20 characters describing the issue.",
        "error"
      );

      return;

    }


    const duplicate =
      findDuplicateComplaint({
        route: routeValue,
        location: locationValue,
        description: descriptionValue
      });


    if (
      duplicate &&
      !allowDuplicate
    ) {

      pendingSubmission = {
        category: categoryValue,
        priority: priorityValue,
        route: routeValue,
        incidentAt: incidentValue,
        location: locationValue,
        description: descriptionValue
      };

      showDuplicateDialog(
        duplicate.complaint
      );

      return;

    }


    if (submitButton) {

      submitButton.disabled =
        true;

      submitButton.innerHTML =
        "Submitting...";

    }


    try {

      let attachmentData = null;

      if (attachment?.files?.[0]) {

        attachmentData =
          await readAttachment(
            attachment.files[0]
          );

      }


      const createdAt =
        new Date().toISOString();

      const reference =
        nextComplaintId();

      const complaint = {

        id: reference,

        reference,

        userId:
          user.id,

        studentName:
          user.name || "Student",

        studentEmail:
          user.email || "",

        category:
          categoryValue,

        priority:
          priorityValue,

        route:
          routeValue,

        incidentAt:
          new Date(
            incidentValue
          ).toISOString(),

        location:
          locationValue,

        description:
          descriptionValue,

        attachment:
          attachmentData,

        status:
          "New",

        assignedTeam:
          "",

        resolutionRemarks:
          "",

        createdAt,

        updatedAt:
          createdAt,

        dueAt:
          calculateDueAt(
            createdAt,
            priorityValue
          ),

        escalated:
          false,

        isDemo:
          false,

        aiAnalysis:
          analyzeComplaintText(
            descriptionValue
          ),

        timeline: []

      };


      addTimeline(
        complaint,
        "Complaint submitted",
        "Complaint was successfully received by RouteWise.",
        "created"
      );


      const savedComplaint = await Store.createOnServer("complaints", complaint);
      const complaints = Store.complaints();
      complaints.unshift(savedComplaint);
      Store.setLocal(RW_CONFIG.storage.complaints, complaints);


      createNotification(
        user.id,
        "Complaint submitted",
        `Your complaint ${reference} has been received.`,
        reference
      );


      /* Success */

      byId(
        "successReference"
      ).textContent =
        reference;

      byId(
        "successPriority"
      ).textContent =
        priorityValue;

      byId(
        "successSla"
      ).textContent =
        `${getSlaHours(priorityValue)} hours`;


      form.classList.add(
        "hidden"
      );

      byId(
        "complaintSuccess"
      )?.classList.remove(
        "hidden"
      );


    } catch (error) {

      console.error(error);

      setMessage(
        message,
        error.message ||
        "Unable to submit complaint.",
        "error"
      );

    } finally {

      if (submitButton) {

        submitButton.disabled =
          false;

        submitButton.innerHTML =
          "Submit complaint <span>→</span>";

      }

    }

  }


  form.addEventListener(
    "submit",
    event => {

      event.preventDefault();

      submitComplaint(false);

    }
  );


  /* Duplicate dialog */

  byId(
    "continueDuplicateSubmit"
  )?.addEventListener(
    "click",
    () => {

      closeDuplicateDialog();

      submitComplaint(true);

    }
  );


  byId(
    "cancelDuplicateSubmit"
  )?.addEventListener(
    "click",
    closeDuplicateDialog
  );


  byId(
    "closeDuplicateDialog"
  )?.addEventListener(
    "click",
    closeDuplicateDialog
  );


  /* New complaint */

  byId(
    "newComplaintButton"
  )?.addEventListener(
    "click",
    () => {

      window.location.reload();

    }
  );

}


/* =========================================================
   DUPLICATE DIALOG
   ========================================================= */

function showDuplicateDialog(
  complaint
) {

  const dialog =
    byId("duplicateDialog");

  const content =
    byId("duplicateDialogContent");

  if (!dialog || !content) {
    return;
  }

  content.innerHTML = `

    <div class="duplicate-existing-case">

      <div class="duplicate-case-top">

        <span class="status-pill ${
          statusClass(
            complaint.status
          )
        }">
          ${escapeHTML(
            complaint.status || "New"
          )}
        </span>

        <strong>
          ${escapeHTML(
            complaint.reference ||
            complaint.id
          )}
        </strong>

      </div>

      <h3>
        ${escapeHTML(
          complaint.category ||
          "Transport issue"
        )}
      </h3>

      <p>
        ${escapeHTML(
          complaint.description ||
          ""
        )}
      </p>

      <div class="duplicate-meta">

        <span>
          Route:
          ${escapeHTML(
            normalizeRoute(
              complaint.route
            )
          )}
        </span>

        <span>
          Location:
          ${escapeHTML(
            complaint.location
          )}
        </span>

        <span>
          Reported:
          ${escapeHTML(
            timeAgo(
              complaint.createdAt
            )
          )}
        </span>

      </div>

    </div>

  `;


  if (
    typeof dialog.showModal ===
    "function"
  ) {

    dialog.showModal();

  } else {

    dialog.setAttribute(
      "open",
      ""
    );

  }

}


function closeDuplicateDialog() {

  const dialog =
    byId("duplicateDialog");

  if (!dialog) {
    return;
  }

  if (
    typeof dialog.close ===
    "function"
  ) {

    dialog.close();

  } else {

    dialog.removeAttribute(
      "open"
    );

  }

}


/* =========================================================
   STATUS / PRIORITY CLASSES
   ========================================================= */

function statusClass(status) {

  switch (
    normalize(status)
  ) {

    case "new":
      return "new";

    case "in review":
      return "review";

    case "resolved":
      return "resolved";

    default:
      return "new";

  }

}


function priorityClass(priority) {

  return normalize(
    priority
  ) || "medium";

}


/* =========================================================
   COMPLAINT FILTERING
   ========================================================= */

function filterComplaints(
  complaints,
  search,
  status,
  priority,
  route
) {

  const searchValue =
    normalize(search);

  return complaints.filter(
    complaint => {

      const searchable = [
        complaint.reference,
        complaint.id,
        complaint.category,
        complaint.priority,
        complaint.route,
        complaint.location,
        complaint.description,
        complaint.studentName
      ]
        .join(" ")
        .toLowerCase();


      if (
        searchValue &&
        !searchable.includes(
          searchValue
        )
      ) {

        return false;

      }


      if (
        status &&
        status !== "all"
      ) {

        if (
          status === "Urgent" &&
          complaint.priority !==
          "Urgent"
        ) {
          return false;
        }

        if (
          status === "Overdue" &&
          getSlaInfo(
            complaint
          ).state !== "overdue"
        ) {
          return false;
        }

        if (
          status === "Escalated" &&
          !complaint.escalated
        ) {
          return false;
        }

        if (
          ["New", "In review", "Resolved"]
            .includes(status) &&
          complaint.status !== status
        ) {
          return false;
        }

      }


      if (
        priority &&
        priority !== "all" &&
        complaint.priority !== priority
      ) {

        return false;

      }


      if (
        route &&
        route !== "all" &&
        route !== "Other"
      ) {

        if (
          routeCode(
            complaint.route
          ) !== route
        ) {

          return false;

        }

      }


      if (
        route === "Other" &&
        routeCode(
          complaint.route
        ) !== "OTHER"
      ) {

        return false;

      }


      return true;

    }
  );

}


/* =========================================================
   DASHBOARD
   ========================================================= */

function initDashboard() {

  if (
    document.body.dataset.page !==
    "dashboard"
  ) {
    return;
  }

  const user =
    requireLogin();

  if (!user) {
    return;
  }

  updateEscalations();

  renderDashboard(user);

  initDashboardEvents(user);

  renderNotifications(user);

  renderStudentActivity(user);

  renderStudentSla(user);

  renderStudentInsights(user);

  renderRouteHealth(
    user,
    "studentRouteHealth"
  );

  renderStudentGps();

  window.setInterval(renderStudentGps, 5000);

  window.addEventListener("storage", event => {
    if (event.key === RW_CONFIG.storage.busLocation) {
      renderStudentGps();
    }
  });

}


const liveBusMaps = new Map();


function renderLiveBusMap(mapId, wrapperId, location) {

  const wrapper = byId(wrapperId);
  const container = byId(mapId);
  const latitude = Number(location?.latitude);
  const longitude = Number(location?.longitude);

  if (
    !wrapper ||
    !container ||
    !location?.active ||
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    Math.abs(latitude) > 90 ||
    Math.abs(longitude) > 180
  ) {
    wrapper?.classList.add("hidden");
    return false;
  }

  wrapper.classList.remove("hidden");

  if (!window.L) {
    container.textContent = "Map unavailable. Use Open full map to view the bus location.";
    return false;
  }

  const point = [latitude, longitude];
  let mapState = liveBusMaps.get(mapId);

  if (!mapState) {
    const map = window.L.map(container, {
      scrollWheelZoom: false
    }).setView(point, 15);

    window.L.tileLayer(
      "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
      {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
      }
    ).addTo(map);

    const marker = window.L.marker(point, {
      title: "Live bus location"
    }).addTo(map);

    mapState = { map, marker };
    liveBusMaps.set(mapId, mapState);
  } else {
    mapState.marker.setLatLng(point);

    if (!mapState.map.getBounds().contains(point)) {
      mapState.map.panTo(point, { animate: true });
    }
  }

  window.requestAnimationFrame(() => mapState.map.invalidateSize());
  return true;
}


function renderStudentGps() {

  const status = byId("studentGpsStatus");

  if (!status) {
    return;
  }

  const location = Store.get(RW_CONFIG.storage.busLocation, null);
  const details = byId("studentGpsDetails");
  const mapLink = byId("studentGpsMapLink");
  const age = location?.updatedAt
    ? Date.now() - new Date(location.updatedAt).getTime()
    : Infinity;

  if (!location?.active || age > 60000) {
    status.textContent = location?.active
      ? "Bus location is out of date. Waiting for a fresh GPS update."
      : "No bus location is being shared right now.";
    details.textContent = "Location sharing will appear here when the bus device starts GPS tracking.";
    byId("studentGpsMapWrap")?.classList.add("hidden");
    mapLink?.classList.add("hidden");
    return;
  }

  status.textContent = `${location.route} · Updated ${formatDateTime(location.updatedAt)}`;
  details.textContent = "The map follows the bus as new location updates arrive.";
  renderLiveBusMap("studentBusMap", "studentGpsMapWrap", location);
  mapLink.href = `https://maps.google.com/?q=${location.latitude},${location.longitude}`;
  mapLink.textContent = "Open full map";
  mapLink.classList.remove("hidden");
}


let busLocationWatchId = null;


function setGpsStatus(text) {
  setText("busGpsStatus", text);
}


function initBusGpsControls() {

  const startButton = byId("startGpsButton");
  const stopButton = byId("stopGpsButton");

  const savedLocation = Store.get(RW_CONFIG.storage.busLocation, null);
  const savedAge = savedLocation?.updatedAt
    ? Date.now() - new Date(savedLocation.updatedAt).getTime()
    : Infinity;

  if (savedLocation?.active && savedAge <= 60000) {
    renderLiveBusMap("adminBusMap", "adminGpsMapWrap", savedLocation);
    setGpsStatus(`Sharing ${savedLocation.route} location. Last update ${formatDateTime(savedLocation.updatedAt)}.`);
    if (stopButton) stopButton.disabled = false;
  }

  startButton?.addEventListener("click", () => {
    if (!navigator.geolocation) {
      setGpsStatus("This device does not support browser GPS.");
      return;
    }

    if (busLocationWatchId !== null) {
      navigator.geolocation.clearWatch(busLocationWatchId);
    }

    setGpsStatus("Waiting for device location permission...");
    startButton.disabled = true;

    busLocationWatchId = navigator.geolocation.watchPosition(
      position => {
        const location = {
          active: true,
          route: byId("gpsRouteSelect")?.value || "CB-101 · North Campus",
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          updatedAt: new Date().toISOString()
        };

        Store.set(RW_CONFIG.storage.busLocation, location);
        renderLiveBusMap("adminBusMap", "adminGpsMapWrap", location);
        setGpsStatus(`Sharing ${location.route} location. Last update ${formatDateTime(location.updatedAt)}.`);
        startButton.disabled = false;
        if (stopButton) stopButton.disabled = false;
      },
      error => {
        const messages = {
          1: "Location permission was denied. Allow it in the browser to start tracking.",
          2: "The device location is unavailable.",
          3: "GPS timed out. Try starting location sharing again."
        };
        setGpsStatus(messages[error.code] || "Could not read this device's location.");
        startButton.disabled = false;
        if (stopButton) stopButton.disabled = true;
        busLocationWatchId = null;
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
    );
  });

  stopButton?.addEventListener("click", () => {
    if (busLocationWatchId !== null) {
      navigator.geolocation.clearWatch(busLocationWatchId);
      busLocationWatchId = null;
    }

    Store.set(RW_CONFIG.storage.busLocation, { active: false });
    byId("adminGpsMapWrap")?.classList.add("hidden");
    setGpsStatus("GPS sharing is stopped.");
    if (startButton) startButton.disabled = false;
    stopButton.disabled = true;
  });
}


/* =========================================================
   DASHBOARD RENDER
   ========================================================= */

function getUserComplaints(
  user
) {

  return Store.complaints()
    .filter(
      complaint =>
        complaint.userId ===
        user.id ||
        normalize(
          complaint.studentEmail
        ) ===
        normalize(
          user.email
        )
    );

}


function renderDashboard(
  user
) {

  const complaints =
    getUserComplaints(user);

  const open =
    complaints.filter(
      complaint =>
        complaint.status !==
        "Resolved"
    );

  const progress =
    complaints.filter(
      complaint =>
        complaint.status ===
        "In review"
    );

  const resolved =
    complaints.filter(
      complaint =>
        complaint.status ===
        "Resolved"
    );

  const overdue =
    complaints.filter(
      complaint =>
        getSlaInfo(
          complaint
        ).state === "overdue"
    );


  setText(
    "openCount",
    open.length
  );

  setText(
    "progressCount",
    progress.length
  );

  setText(
    "resolvedCount",
    resolved.length
  );

  const slaPercent =
    complaints.length
      ? Math.round(
          ((complaints.length - overdue.length) /
            complaints.length) *
          100
        )
      : 100;

  setText(
    "studentSlaCount",
    `${slaPercent}%`
  );


  renderStudentComplaints(
    complaints
  );

}


function setText(
  id,
  value
) {

  const element =
    byId(id);

  if (element) {
    element.textContent =
      value;
  }

}


/* =========================================================
   STUDENT COMPLAINT LIST
   ========================================================= */

function renderStudentComplaints(
  complaints
) {

  const list =
    byId("complaintList");

  if (!list) {
    return;
  }

  if (!complaints.length) {

    list.innerHTML = `
      <div class="dashboard-empty">
        <div class="empty-icon">✓</div>

        <h3>No complaints yet</h3>

        <p>
          Your submitted transport complaints will appear here.
        </p>
      </div>
    `;

    return;

  }


  list.innerHTML =
    complaints
      .slice(0, 20)
      .map(
        complaint =>
          studentComplaintHTML(
            complaint
          )
      )
      .join("");


  $$(".complaint-view-btn", list)
    .forEach(
      button => {

        button.addEventListener(
          "click",
          () => {

            const complaint =
              complaints.find(
                item =>
                  (
                    item.reference ||
                    item.id
                  ) ===
                  button.dataset.id
              );

            if (complaint) {
              showStudentComplaintDetail(
                complaint
              );
            }

          }
        );

      }
    );

}


function studentComplaintHTML(
  complaint
) {

  const sla =
    getSlaInfo(complaint);

  return `

    <div class="complaint-row">

      <div class="complaint-main">

        <div class="complaint-title">
          ${escapeHTML(
            complaint.category ||
            "Transport complaint"
          )}
        </div>

        <div class="complaint-ref">
          ${escapeHTML(
            complaint.reference ||
            complaint.id
          )}
        </div>

      </div>


      <div class="complaint-route">
        ${escapeHTML(
          normalizeRoute(
            complaint.route
          )
        )}
      </div>


      <div>

        <span class="status-pill ${
          statusClass(
            complaint.status
          )
        }">
          ${escapeHTML(
            complaint.status ||
            "New"
          )}
        </span>

      </div>


      <div class="complaint-date">

        ${
          sla.state === "overdue"
            ? `<span class="priority urgent">SLA overdue</span>`
            : escapeHTML(
                timeAgo(
                  complaint.updatedAt ||
                  complaint.createdAt
                )
              )
        }

      </div>


      <div class="complaint-actions">

        <button
          type="button"
          class="complaint-view-btn"
          data-id="${escapeHTML(
            complaint.reference ||
            complaint.id
          )}"
        >
          View
        </button>

      </div>

    </div>

  `;

}


/* =========================================================
   STUDENT DASHBOARD EVENTS
   ========================================================= */

function initDashboardEvents(
  user
) {

  const search =
    byId("dashboardSearch");

  const filter =
    byId("dashboardFilter");


  function refresh() {

    let complaints =
      getUserComplaints(user);

    const searchValue =
      normalize(
        search?.value
      );

    const filterValue =
      filter?.value ||
      "all";


    complaints =
      complaints.filter(
        complaint => {

          const searchable = [
            complaint.reference,
            complaint.category,
            complaint.route,
            complaint.location,
            complaint.description
          ]
            .join(" ")
            .toLowerCase();


          if (
            searchValue &&
            !searchable.includes(
              searchValue
            )
          ) {

            return false;

          }


          if (
            filterValue !== "all" &&
            !matchesComplaintFilter(
              complaint,
              filterValue
            )
          ) {

            return false;

          }


          return true;

        }
      );


    renderStudentComplaints(
      complaints
    );

  }


  search?.addEventListener(
    "input",
    refresh
  );

  filter?.addEventListener(
    "change",
    refresh
  );


  byId(
    "viewActiveComplaints"
  )?.addEventListener(
    "click",
    () => {

      if (filter) {
        filter.value =
          "new";
      }

      refresh();

    }
  );


  byId(
    "viewResolvedComplaints"
  )?.addEventListener(
    "click",
    () => {

      if (filter) {
        filter.value =
          "resolved";
      }

      refresh();

    }
  );


  byId(
    "loadDashboardSample"
  )?.addEventListener(
    "click",
    () => {

      createDemoData(
        user
      );

      window.location.reload();

    }
  );


  byId(
    "notificationButton"
  )?.addEventListener(
    "click",
    event => {

      const button =
        event.currentTarget;

      const panel =
        byId("notificationPanel");

      const willOpen =
        panel?.classList.contains("hidden");

      panel?.classList.toggle(
        "hidden"
      );

      button.setAttribute(
        "aria-expanded",
        String(Boolean(willOpen))
      );

    }
  );


  byId(
    "markNotificationsRead"
  )?.addEventListener(
    "click",
    () => {

      const notifications =
        Store.notifications();

      notifications.forEach(
        notification => {

          if (
            notification.userId ===
            user.id
          ) {

            notification.read =
              true;

          }

        }
      );

      Store.set(
        RW_CONFIG.storage.notifications,
        notifications
      );

      renderNotifications(user);

    }
  );

}


function matchesComplaintFilter(
  complaint,
  filterValue
) {

  if (filterValue === "overdue") {
    return getSlaInfo(complaint).state ===
      "overdue";
  }

  if (filterValue === "escalated") {
    return Boolean(complaint.escalated);
  }

  const statusMap = {
    new: "New",
    review: "In review",
    resolved: "Resolved"
  };

  return normalize(complaint.status) ===
    normalize(
      statusMap[filterValue] || filterValue
    );

}


/* =========================================================
   STUDENT DETAIL
   ========================================================= */

function showStudentComplaintDetail(
  complaint
) {

  const dialog =
    byId(
      "complaintDetailDialog"
    );

  if (!dialog) {
    return;
  }

  setText(
    "detailComplaintTitle",
    complaint.category ||
    "Transport complaint"
  );

  setText(
    "detailComplaintRef",
    complaint.reference ||
    complaint.id
  );


  const content =
    byId(
      "complaintDetailContent"
    );

  if (!content) {
    return;
  }


  const sla =
    getSlaInfo(complaint);


  content.innerHTML = `

    <div class="detail-grid">

      <div class="detail-field">

        <label>Status</label>

        <p>
          <span class="status-pill ${
            statusClass(
              complaint.status
            )
          }">
            ${escapeHTML(
              complaint.status ||
              "New"
            )}
          </span>
        </p>

      </div>


      <div class="detail-field">

        <label>Priority</label>

        <p class="priority ${
          priorityClass(
            complaint.priority
          )
        }">
          ${escapeHTML(
            complaint.priority ||
            "Medium"
          )}
        </p>

      </div>


      <div class="detail-field">

        <label>Route</label>

        <p>
          ${escapeHTML(
            normalizeRoute(
              complaint.route
            )
          )}
        </p>

      </div>


      <div class="detail-field">

        <label>Location</label>

        <p>
          ${escapeHTML(
            complaint.location
          )}
        </p>

      </div>


      <div class="detail-field">

        <label>Reported</label>

        <p>
          ${escapeHTML(
            formatDateTime(
              complaint.createdAt
            )
          )}
        </p>

      </div>


      <div class="detail-field">

        <label>SLA</label>

        <p>
          ${escapeHTML(
            sla.label
          )}
          ·
          ${escapeHTML(
            formatDateTime(
              sla.dueAt
            )
          )}
        </p>

      </div>


      <div class="detail-field full">

        <label>Description</label>

        <p>
          ${escapeHTML(
            complaint.description
          )}
        </p>

      </div>


      ${
        complaint.resolutionRemarks
          ? `
            <div class="detail-field full">

              <label>Resolution remarks</label>

              <p>
                ${escapeHTML(
                  complaint.resolutionRemarks
                )}
              </p>

            </div>
          `
          : ""
      }


      <div class="detail-field full">

        <label>Complaint timeline</label>

        ${timelineHTML(
          complaint
        )}

      </div>


      ${
        complaint.attachment
          ? `
            <div class="detail-field full">

              <label>Evidence</label>

              <img
                src="${complaint.attachment}"
                alt="Complaint evidence"
                style="
                  width:100%;
                  max-height:280px;
                  object-fit:contain;
                  border-radius:12px;
                  border:1px solid var(--line);
                "
              >

            </div>
          `
          : ""
      }

    </div>

  `;


  dialog.showModal?.();

  byId(
    "closeComplaintDetail"
  )?.addEventListener(
    "click",
    () => dialog.close(),
    {
      once: true
    }
  );

}


/* =========================================================
   TIMELINE
   ========================================================= */

function timelineHTML(
  complaint
) {

  const timeline =
    complaint.timeline || [];


  if (!timeline.length) {

    return `
      <p class="activity-empty">
        No timeline activity yet.
      </p>
    `;

  }


  return `
    <div class="timeline">

      ${
        timeline
          .slice()
          .reverse()
          .map(
            item => `

              <div class="timeline-item">

                <div class="timeline-dot">
                  ✓
                </div>

                <div>

                  <strong>
                    ${escapeHTML(
                      item.title
                    )}
                  </strong>

                  <p>
                    ${escapeHTML(
                      item.description
                    )}
                  </p>

                  <small>
                    ${escapeHTML(
                      formatDateTime(
                        item.at
                      )
                    )}
                  </small>

                </div>

              </div>

            `
          )
          .join("")
      }

    </div>
  `;

}


/* =========================================================
   STUDENT NOTIFICATIONS
   ========================================================= */

function renderNotifications(
  user
) {

  const list =
    byId("notificationList");

  const count =
    byId("notificationCount");

  if (!list) {
    return;
  }


  const notifications =
    getUserNotifications(
      user.id
    );


  const unread =
    notifications.filter(
      notification =>
        !notification.read
    ).length;

  const markReadButton =
    byId("markNotificationsRead");

  if (markReadButton) {
    markReadButton.disabled = unread === 0;
  }


  if (count) {

    count.textContent =
      unread;

    count.classList.toggle(
      "hidden",
      unread === 0
    );

  }


  if (!notifications.length) {

    list.innerHTML = `
      <div class="notification-empty">
        <span aria-hidden="true">✓</span>
        <strong>All caught up</strong>
        <p>New complaint updates will appear here.</p>
      </div>
    `;

    return;

  }


  list.innerHTML =
    notifications
      .slice(0, 10)
      .map(
        notification => `

          <div class="notification-item ${notification.read ? "" : "is-unread"}">

            <div class="notification-item-icon">
              ${notification.read ? "✓" : "!"}
            </div>

            <div class="notification-item-content">

              <strong>
                ${escapeHTML(
                  notification.title
                )}
              </strong>

              <p>
                ${escapeHTML(
                  notification.message
                )}
              </p>

              <time
                class="notification-time"
                datetime="${escapeHTML(notification.createdAt || "")}">
                ${escapeHTML(formatDateTime(notification.createdAt))}
              </time>

            </div>

          </div>

        `
      )
      .join("");

}


/* =========================================================
   STUDENT SLA
   ========================================================= */

function renderStudentSla(
  user
) {

  const complaints =
    getUserComplaints(user);

  const active =
    complaints.filter(
      complaint =>
        complaint.status !==
        "Resolved"
    );


  const onTrack =
    active.filter(
      complaint =>
        getSlaInfo(
          complaint
        ).state === "on-track"
    ).length;


  const dueSoon =
    active.filter(
      complaint =>
        getSlaInfo(
          complaint
        ).state === "due-soon"
    ).length;


  const overdue =
    active.filter(
      complaint =>
        getSlaInfo(
          complaint
        ).state === "overdue"
    ).length;


  const total =
    active.length;


  const percent =
    total
      ? Math.round(
          (onTrack / total) *
          100
        )
      : 100;


  setText(
    "studentSlaPercent",
    `${percent}%`
  );

  setText(
    "studentSlaOnTrack",
    onTrack
  );

  setText(
    "studentSlaDueSoon",
    dueSoon
  );

  setText(
    "studentSlaOverdue",
    overdue
  );


  const ring =
    byId("studentSlaRing");

  if (ring) {

    ring.style.setProperty(
      "--sla-progress",
      `${percent}%`
    );

  }

}


/* =========================================================
   STUDENT ACTIVITY
   ========================================================= */

function renderStudentActivity(
  user
) {

  const list =
    byId("studentActivityList");

  if (!list) {
    return;
  }


  const complaints =
    getUserComplaints(user);


  const events = [];


  complaints.forEach(
    complaint => {

      (
        complaint.timeline ||
        []
      ).forEach(
        event => {

          events.push({
            ...event,
            reference:
              complaint.reference ||
              complaint.id
          });

        }
      );

    }
  );


  events.sort(
    (a, b) =>
      new Date(b.at) -
      new Date(a.at)
  );


  if (!events.length) {

    list.innerHTML = `
      <div class="activity-empty">
        Your recent complaint activity will appear here.
      </div>
    `;

    return;

  }


  list.innerHTML =
    events
      .slice(0, 8)
      .map(
        event => `

          <div class="activity-item">

            <div class="activity-icon">
              ✓
            </div>

            <div class="activity-content">

              <strong>
                ${escapeHTML(
                  event.title
                )}
              </strong>

              <p>
                ${escapeHTML(
                  event.description
                )}
              </p>

              <div class="activity-time">
                ${escapeHTML(
                  event.reference
                )}
                ·
                ${escapeHTML(
                  timeAgo(event.at)
                )}
              </div>

            </div>

          </div>

        `
      )
      .join("");

}


/* =========================================================
   SMART STUDENT INSIGHTS
   ========================================================= */

function renderStudentInsights(
  user
) {

  const complaints =
    getUserComplaints(user);

  const insight =
    byId(
      "studentSmartInsight"
    );

  if (!insight) {
    return;
  }


  if (!complaints.length) {

    insight.innerHTML = `
      Submit your first complaint to receive
      <strong>smart transport insights</strong>.
    `;

    return;

  }


  const overdue =
    complaints.filter(
      complaint =>
        getSlaInfo(
          complaint
        ).state === "overdue"
    ).length;


  const urgent =
    complaints.filter(
      complaint =>
        complaint.priority ===
        "Urgent"
    ).length;


  const routeCounts = {};

  complaints.forEach(
    complaint => {

      const route =
        routeCode(
          complaint.route
        );

      routeCounts[route] =
        (routeCounts[route] || 0) + 1;

    }
  );


  const topRoute =
    Object.entries(
      routeCounts
    )
      .sort(
        (a, b) => b[1] - a[1]
      )[0];


  if (overdue > 0) {

    insight.innerHTML = `
      You currently have
      <strong>${overdue}</strong>
      complaint${overdue > 1 ? "s" : ""}
      past the SLA target.
      Check the complaint timeline for updates.
    `;

  } else if (urgent > 0) {

    insight.innerHTML = `
      You have
      <strong>${urgent}</strong>
      urgent complaint${urgent > 1 ? "s" : ""}.
      RouteWise is prioritizing these cases.
    `;

  } else if (topRoute) {

    insight.innerHTML = `
      Your most frequently reported route is
      <strong>${escapeHTML(
        topRoute[0]
      )}</strong>
      with
      <strong>${topRoute[1]}</strong>
      complaint${topRoute[1] > 1 ? "s" : ""}.
    `;

  } else {

    insight.innerHTML = `
      Your transport complaint activity is
      currently <strong>stable</strong>.
    `;

  }

}


/* =========================================================
   ROUTE HEALTH
   ========================================================= */

function calculateRouteHealth(
  complaints
) {

  const routeData = {};


  complaints.forEach(
    complaint => {

      const code =
        routeCode(
          complaint.route
        );

      if (!routeData[code]) {

        routeData[code] = {
          total: 0,
          urgent: 0,
          overdue: 0,
          resolved: 0
        };

      }

      routeData[code].total++;

      if (
        complaint.priority ===
        "Urgent"
      ) {

        routeData[code].urgent++;

      }

      if (
        getSlaInfo(
          complaint
        ).state === "overdue"
      ) {

        routeData[code].overdue++;

      }

      if (
        complaint.status ===
        "Resolved"
      ) {

        routeData[code].resolved++;

      }

    }
  );


  return Object.entries(
    routeData
  ).map(
    ([route, data]) => {

      let score = 100;

      score -=
        data.total * 4;

      score -=
        data.urgent * 8;

      score -=
        data.overdue * 7;

      score +=
        data.resolved * 2;

      score =
        Math.max(
          0,
          Math.min(
            100,
            score
          )
        );

      return {
        route,
        ...data,
        score
      };

    }
  ).sort(
    (a, b) =>
      b.score - a.score
  );

}


function renderRouteHealth(
  userOrComplaints,
  targetId
) {

  const target =
    byId(targetId);

  if (!target) {
    return;
  }


  const complaints =
    Array.isArray(
      userOrComplaints
    )
      ? userOrComplaints
      : getUserComplaints(
          userOrComplaints
        );


  const health =
    calculateRouteHealth(
      complaints
    );


  if (!health.length) {

    target.innerHTML = `
      <div class="route-health-empty">
        No route data available yet.
      </div>
    `;

    return;

  }


  target.innerHTML =
    health
      .map(
        item => `

          <div class="route-health-row">

            <div class="route-health-top">

              <span class="route-health-name">
                ${escapeHTML(
                  item.route
                )}
              </span>

              <span class="route-health-score">
                ${item.score}/100
              </span>

            </div>

            <div class="route-health-bar">

              <span
                style="width:${item.score}%"
              ></span>

            </div>

          </div>

        `
      )
      .join("");

}


/* =========================================================
   ADMIN PAGE
   ========================================================= */

function renderAdminAccountRequests() {

  const panel = byId("adminAccountRequestsPanel");
  const list = byId("adminAccountRequests");
  const host = currentUser();

  if (!panel || !list) {
    return;
  }

  if (host?.isHost !== true) {
    panel.classList.add("hidden");
    return;
  }

  panel.classList.remove("hidden");
  const accounts = Store.users().filter(user => user.id !== host.id && user.isHost !== true);

  if (!accounts.length) {
    list.innerHTML = "<p>No other accounts have registered yet.</p>";
    return;
  }

  list.innerHTML = accounts.map(user => {
    const isAdmin = user.role === "admin";
    const status = isAdmin
      ? "Administrator"
      : user.adminAccessStatus === "denied"
        ? "Admin access denied"
        : "Pending review";
    const buttons = isAdmin
      ? `<button class="btn btn-secondary btn-small" type="button" data-admin-access-user="${escapeHTML(user.id)}" data-admin-access-decision="deny">Deny admin</button>`
      : `<button class="btn btn-primary btn-small" type="button" data-admin-access-user="${escapeHTML(user.id)}" data-admin-access-decision="grant">Grant admin</button><button class="btn btn-secondary btn-small" type="button" data-admin-access-user="${escapeHTML(user.id)}" data-admin-access-decision="deny">Deny</button>`;

    return `<div class="admin-complaint-row"><div class="admin-complaint-main"><div class="admin-complaint-title">${escapeHTML(user.name || "User")}</div><div class="admin-complaint-meta">${escapeHTML(user.email)} · ${status}</div></div><div class="admin-complaint-actions">${buttons}</div></div>`;
  }).join("");

  $$('[data-admin-access-user]', list).forEach(button => {
    button.addEventListener("click", handleAdminAccessDecision);
  });
}


async function handleAdminAccessDecision(event) {

  const button = event.currentTarget;
  const host = currentUser();

  if (host?.isHost !== true) {
    return;
  }

  const decision = button.dataset.adminAccessDecision;
  const currentPassword = window.prompt(`Enter your host password to ${decision} admin access:`);

  if (!currentPassword) {
    return;
  }

  button.disabled = true;

  try {
    const response = await apiFetch("/api/auth/admin-access", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        hostEmail: host.email,
        currentPassword,
        userId: button.dataset.adminAccessUser,
        decision
      })
    });
    const result = await response.json();

    if (!response.ok) {
      setMessage(byId("adminAccessDecisionMessage"), result.error || "Could not update admin access.", "error");
      return;
    }

    await Store.syncFromServer();
    setMessage(byId("adminAccessDecisionMessage"), decision === "grant" ? "Admin access granted." : "Admin access denied. The account remains a regular user.", "success");
    renderAdminAccountRequests();
  } catch (error) {
    setMessage(byId("adminAccessDecisionMessage"), "Could not reach the shared server. Try again when it is available.", "error");
  } finally {
    button.disabled = false;
  }
}


function initAdmin() {

  if (
    document.body.dataset.page !==
    "admin"
  ) {
    return;
  }

  const user = requireAdmin();

  if (!user) {
    return;
  }


  updateEscalations();

  renderAdmin();

  if (user.isHost === true) {
    renderAdminAccountRequests();
    window.setInterval(async () => {
      if (!document.hidden && await Store.syncFromServer()) {
        renderAdminAccountRequests();
      }
    }, 10000);
  }

  initAdminEvents();

  initBusGpsControls();

  setText("adminAccountAvatar", initials(user.name));
  setText("adminAccountName", user.name);
  setText("adminAccountEmail", user.email);

}


/* =========================================================
   ADMIN RENDER
   ========================================================= */

function renderAdmin() {

  const complaints =
    updateEscalations();


  /* Quick counts */

  const newCount =
    complaints.filter(
      complaint =>
        complaint.status === "New"
    ).length;


  const reviewCount =
    complaints.filter(
      complaint =>
        complaint.status ===
        "In review"
    ).length;


  const urgentCount =
    complaints.filter(
      complaint =>
        complaint.priority ===
        "Urgent" &&
        complaint.status !==
        "Resolved"
    ).length;


  const overdueCount =
    complaints.filter(
      complaint =>
        getSlaInfo(
          complaint
        ).state === "overdue"
    ).length;


  setText(
    "adminNewCount",
    newCount
  );

  setText(
    "adminReviewCount",
    reviewCount
  );

  setText(
    "adminUrgentCount",
    urgentCount
  );

  setText(
    "adminOverdueCount",
    overdueCount
  );


  /* KPIs */

  const total =
    complaints.length;

  const resolved =
    complaints.filter(
      complaint =>
        complaint.status ===
        "Resolved"
    ).length;

  const escalated =
    complaints.filter(
      complaint =>
        complaint.escalated
    ).length;

  const slaApplicable =
    complaints.filter(
      complaint =>
        complaint.status ===
        "Resolved" ||
        complaint.dueAt
    );

  const slaGood =
    slaApplicable.filter(
      complaint => {

        if (
          complaint.status ===
          "Resolved"
        ) {
          return true;
        }

        return (
          getSlaInfo(
            complaint
          ).state !==
          "overdue"
        );

      }
    ).length;


  setText(
    "analyticsTotal",
    total
  );

  setText(
    "analyticsResolutionRate",
    `${total ? Math.round(
      (resolved / total) * 100
    ) : 0}%`
  );

  setText(
    "analyticsSlaRate",
    `${slaApplicable.length
      ? Math.round(
          (slaGood /
            slaApplicable.length) *
          100
        )
      : 0}%`
  );

  setText(
    "analyticsEscalated",
    escalated
  );


  renderAdminCharts(
    complaints
  );

  renderAdminSla(
    complaints
  );

  renderAdminInsights(
    complaints
  );

  renderAdminTrend(
    complaints
  );

  renderRouteHealth(
    complaints,
    "adminRouteHealth"
  );

  renderAdminQueue(
    complaints
  );

  renderTeamCounts(
    complaints
  );

}


/* =========================================================
   ADMIN CHARTS
   ========================================================= */

function countBy(
  complaints,
  key
) {

  const result = {};

  complaints.forEach(
    complaint => {

      const value =
        safeText(
          complaint[key]
        ) ||
        "Other";

      result[value] =
        (result[value] || 0) + 1;

    }
  );

  return Object.entries(
    result
  )
    .sort(
      (a, b) => b[1] - a[1]
    );

}


function renderSimpleChart(
  id,
  entries
) {

  const target =
    byId(id);

  if (!target) {
    return;
  }


  if (!entries.length) {

    target.innerHTML = `
      <div class="chart-empty">
        No data available yet.
      </div>
    `;

    return;

  }


  const max =
    Math.max(
      ...entries.map(
        item => item[1]
      )
    );


  target.innerHTML =
    entries
      .slice(0, 7)
      .map(
        ([label, value]) => `

          <div class="chart-row">

            <div class="chart-row-top">

              <span>
                ${escapeHTML(
                  normalizeRoute(label)
                )}
              </span>

              <strong>
                ${value}
              </strong>

            </div>

            <div class="chart-bar">

              <span
                style="width:${Math.round(
                  (value / max) * 100
                )}%"
              ></span>

            </div>

          </div>

        `
      )
      .join("");

}


function renderAdminCharts(
  complaints
) {

  renderSimpleChart(
    "categoryChart",
    countBy(
      complaints,
      "category"
    )
  );


  renderSimpleChart(
    "priorityChart",
    countBy(
      complaints,
      "priority"
    )
  );


  const routeCounts = {};

  complaints.forEach(
    complaint => {

      const route =
        routeCode(
          complaint.route
        );

      routeCounts[route] =
        (routeCounts[route] || 0) + 1;

    }
  );


  renderSimpleChart(
    "routeChart",
    Object.entries(
      routeCounts
    ).sort(
      (a, b) => b[1] - a[1]
    )
  );

}


/* =========================================================
   ADMIN SLA
   ========================================================= */

function renderAdminSla(
  complaints
) {

  const active =
    complaints.filter(
      complaint =>
        complaint.status !==
        "Resolved"
    );


  const onTrack =
    active.filter(
      complaint =>
        getSlaInfo(
          complaint
        ).state ===
        "on-track"
    ).length;


  const dueSoon =
    active.filter(
      complaint =>
        getSlaInfo(
          complaint
        ).state ===
        "due-soon"
    ).length;


  const overdue =
    active.filter(
      complaint =>
        getSlaInfo(
          complaint
        ).state ===
        "overdue"
    ).length;


  const total =
    active.length;


  const percent =
    total
      ? Math.round(
          (onTrack / total) *
          100
        )
      : 100;


  setText(
    "slaRingValue",
    `${percent}%`
  );

  setText(
    "slaOnTrack",
    onTrack
  );

  setText(
    "slaDueSoon",
    dueSoon
  );

  setText(
    "slaOverdue",
    overdue
  );


  const ring =
    byId("slaRing");

  if (ring) {

    ring.style.setProperty(
      "--sla-progress",
      `${percent}%`
    );

  }

}


/* =========================================================
   ADMIN INSIGHTS
   ========================================================= */

function renderAdminInsights(
  complaints
) {

  const locations = {};

  const routes = {};

  complaints.forEach(
    complaint => {

      const location =
        safeText(
          complaint.location
        );

      if (location) {

        locations[location] =
          (locations[location] || 0) +
          1;

      }


      const route =
        routeCode(
          complaint.route
        );

      routes[route] =
        (routes[route] || 0) + 1;

    }
  );


  const hotspot =
    Object.entries(
      locations
    ).sort(
      (a, b) => b[1] - a[1]
    )[0];


  const topRoute =
    Object.entries(
      routes
    ).sort(
      (a, b) => b[1] - a[1]
    )[0];


  if (hotspot) {

    setText(
      "hotspotLocation",
      hotspot[0]
    );

    setText(
      "hotspotDescription",
      `${hotspot[1]} complaint(s) reported from this location.`
    );

  }


  if (topRoute) {

    setText(
      "mostReportedRoute",
      topRoute[0]
    );

    setText(
      "mostReportedRouteCount",
      topRoute[1]
    );

  }


  const urgent =
    complaints.filter(
      complaint =>
        complaint.priority ===
        "Urgent" &&
        complaint.status !==
        "Resolved"
    ).length;


  const overdue =
    complaints.filter(
      complaint =>
        getSlaInfo(
          complaint
        ).state === "overdue"
    ).length;


  if (
    overdue > 0
  ) {

    setText(
      "priorityAlert",
      `${overdue} SLA overdue`
    );

    setText(
      "priorityAlertDescription",
      "Immediate review is recommended."
    );

  } else if (
    urgent > 0
  ) {

    setText(
      "priorityAlert",
      `${urgent} urgent case${urgent > 1 ? "s" : ""}`
    );

    setText(
      "priorityAlertDescription",
      "Urgent complaints require priority attention."
    );

  } else {

    setText(
      "priorityAlert",
      "No major alert"
    );

    setText(
      "priorityAlertDescription",
      "No urgent pattern detected."
    );

  }

}


/* =========================================================
   TREND PREDICTION
   ========================================================= */

function renderAdminTrend(
  complaints
) {

  const direction =
    byId("trendDirection");

  const description =
    byId("trendDescription");

  const meter =
    byId("trendMeter");


  if (!direction) {
    return;
  }


  if (
    complaints.length < 3
  ) {

    direction.textContent =
      "Stable";

    if (description) {

      description.textContent =
        "Not enough historical data for a strong prediction yet.";

    }

    if (meter) {
      meter.style.width =
        "35%";
    }

    return;

  }


  const now =
    Date.now();

  const recent =
    complaints.filter(
      complaint =>
        now -
        new Date(
          complaint.createdAt ||
          Date.now()
        ).getTime()
        <=
        7 * 24 * 60 * 60 * 1000
    ).length;


  const previous =
    complaints.filter(
      complaint => {

        const age =
          now -
          new Date(
            complaint.createdAt ||
            Date.now()
          ).getTime();

        return (
          age >
          7 * 24 * 60 * 60 * 1000 &&
          age <=
          14 * 24 * 60 * 60 * 1000
        );

      }
    ).length;


  if (
    recent > previous
  ) {

    direction.textContent =
      "Increasing";

    if (description) {

      description.textContent =
        "Complaint activity is higher than the previous 7-day period.";

    }

    if (meter) {
      meter.style.width =
        "78%";
    }

  } else if (
    recent < previous
  ) {

    direction.textContent =
      "Decreasing";

    if (description) {

      description.textContent =
        "Complaint activity is lower than the previous 7-day period.";

    }

    if (meter) {
      meter.style.width =
        "28%";
    }

  } else {

    direction.textContent =
      "Stable";

    if (description) {

      description.textContent =
        "Complaint activity is similar to the previous period.";

    }

    if (meter) {
      meter.style.width =
        "50%";
    }

  }

}


/* =========================================================
   ADMIN QUEUE
   ========================================================= */

function renderAdminQueue(
  complaints
) {

  const list =
    byId(
      "adminComplaintList"
    );

  if (!list) {
    return;
  }


  const search =
    byId(
      "adminSearch"
    )?.value || "";


  const status =
    byId(
      "adminFilter"
    )?.value || "all";


  const priority =
    byId(
      "adminPriorityFilter"
    )?.value || "all";


  const route =
    byId(
      "adminRouteFilter"
    )?.value || "all";


  const filtered =
    filterComplaints(
      complaints,
      search,
      status,
      priority,
      route
    );


  setText(
    "queueVisibleCount",
    filtered.length
  );


  byId(
    "adminEmptyState"
  )?.classList.toggle(
    "hidden",
    filtered.length !== 0
  );


  if (!filtered.length) {

    list.innerHTML = "";

    return;

  }


  list.innerHTML =
    filtered
      .map(
        complaint =>
          adminComplaintHTML(
            complaint
          )
      )
      .join("");


  $$(".admin-open-complaint", list)
    .forEach(
      button => {

        button.addEventListener(
          "click",
          () => {

            const complaint =
              complaints.find(
                item =>
                  (
                    item.reference ||
                    item.id
                  ) ===
                  button.dataset.id
              );

            if (complaint) {

              openAdminComplaint(
                complaint
              );

            }

          }
        );

      }
    );


  $$("[data-status-id]", list)
    .forEach(
      select => {

        select.addEventListener(
          "change",
          () => {

            updateComplaintStatus(
              select.dataset.statusId,
              select.value
            );

          }
        );

      }
    );

}


function adminComplaintHTML(
  complaint
) {

  const sla =
    getSlaInfo(
      complaint
    );


  const slaClass =
    sla.state === "overdue"
      ? "danger"
      : sla.state === "due-soon"
        ? "warning"
        : "good";


  return `

    <div
      class="admin-complaint-row ${
        complaint.escalated
          ? "is-escalated"
          : ""
      }"
    >

      <div class="admin-complaint-main">

        <div class="admin-complaint-title">

          ${
            complaint.escalated
              ? `<span class="escalation-badge">ESCALATED</span>`
              : ""
          }

          ${escapeHTML(
            complaint.category ||
            "Transport issue"
          )}

        </div>

        <div class="admin-complaint-meta">

          ${escapeHTML(
            complaint.reference ||
            complaint.id
          )}

          ·

          ${escapeHTML(
            complaint.studentName ||
            "Student"
          )}

          ·

          ${escapeHTML(
            normalizeRoute(
              complaint.route
            )
          )}

        </div>

      </div>


      <div>

        <span class="priority ${
          priorityClass(
            complaint.priority
          )
        }">

          ${escapeHTML(
            complaint.priority ||
            "Medium"
          )}

        </span>

      </div>


      <div>

        <span class="admin-sla ${slaClass}">

          ${escapeHTML(
            sla.label
          )}

          <small>
            ${escapeHTML(
              formatDateTime(
                sla.dueAt
              )
            )}
          </small>

        </span>

      </div>


      <div>

        <select
          class="admin-status-select"
          data-status="${escapeHTML(
            complaint.status || "New"
          )}"
          data-status-id="${escapeHTML(
            complaint.reference ||
            complaint.id
          )}"
        >

          ${
            RW_CONFIG.statuses
              .map(
                status => `
                  <option
                    value="${escapeHTML(status)}"
                    ${
                      complaint.status === status
                        ? "selected"
                        : ""
                    }
                  >
                    ${escapeHTML(status)}
                  </option>
                `
              )
              .join("")
          }

        </select>

      </div>


      <div class="admin-queue-actions">

        <button
          type="button"
          class="admin-open-complaint"
          data-id="${escapeHTML(
            complaint.reference ||
            complaint.id
          )}"
        >
          Manage
        </button>

      </div>

    </div>

  `;

}


/* =========================================================
   ADMIN STATUS UPDATE
   ========================================================= */

async function updateComplaintStatus(
  id,
  status
) {

  const complaints =
    Store.complaints();

  const complaint =
    complaints.find(
      item =>
        (
          item.reference ||
          item.id
        ) === id
    );

  if (!complaint) {
    return;
  }


  const oldStatus =
    complaint.status;

  if (
    oldStatus === status
  ) {
    return;
  }


  complaint.status =
    status;

  complaint.updatedAt =
    new Date().toISOString();


  addTimeline(
    complaint,
    `Status changed to ${status}`,
    `Complaint status was updated from ${oldStatus || "New"} to ${status}.`,
    "status"
  );


  if (
    status ===
    "Resolved"
  ) {

    complaint.resolvedAt =
      new Date().toISOString();

    complaint.escalated =
      false;

  }


  const saveResult = await Store.setAndSync(
    RW_CONFIG.storage.complaints,
    complaints
  );


  if (complaint.userId) {

    createNotification(
      complaint.userId,
      "Complaint updated",
      `${complaint.reference || complaint.id} is now ${status}.`,
      complaint.reference ||
      complaint.id
    );

  }


  const saveStatus = byId("adminQueueSaveStatus");
  if (saveStatus) {
    saveStatus.textContent = saveResult.synced
      ? "Changes saved"
      : saveResult.local
        ? "Saved on this device; server sync unavailable"
        : "Could not save changes";
    saveStatus.dataset.state = saveResult.synced
      ? "saved"
      : saveResult.local
        ? "local"
        : "error";
  }

  renderAdmin();

}


/* =========================================================
   ADMIN DETAIL MODAL
   ========================================================= */

let activeAdminComplaintId =
  null;


function openAdminComplaint(
  complaint
) {

  const dialog =
    byId(
      "adminComplaintDialog"
    );

  if (!dialog) {
    return;
  }


  activeAdminComplaintId =
    complaint.reference ||
    complaint.id;


  setText(
    "adminDetailTitle",
    complaint.category ||
    "Transport complaint"
  );

  setText(
    "adminDetailRef",
    `${complaint.reference || complaint.id} · ${complaint.studentName || "Student"}`
  );


  const content =
    byId(
      "adminDetailContent"
    );

  if (!content) {
    return;
  }


  const sla =
    getSlaInfo(
      complaint
    );


  const ai =
    complaint.aiAnalysis ||
    analyzeComplaintText(
      complaint.description
    );


  content.innerHTML = `

    <div class="detail-grid">


      <div class="detail-field">

        <label>Status</label>

        <p>

          <span class="status-pill ${
            statusClass(
              complaint.status
            )
          }">

            ${escapeHTML(
              complaint.status ||
              "New"
            )}

          </span>

        </p>

      </div>


      <div class="detail-field">

        <label>Priority</label>

        <p class="priority ${
          priorityClass(
            complaint.priority
          )
        }">

          ${escapeHTML(
            complaint.priority ||
            "Medium"
          )}

        </p>

      </div>


      <div class="detail-field">

        <label>Route</label>

        <p>
          ${escapeHTML(
            normalizeRoute(
              complaint.route
            )
          )}
        </p>

      </div>


      <div class="detail-field">

        <label>Location</label>

        <p>
          ${escapeHTML(
            complaint.location
          )}
        </p>

      </div>


      <div class="detail-field">

        <label>Student</label>

        <p>
          ${escapeHTML(
            complaint.studentName ||
            "Student"
          )}
        </p>

      </div>


      <div class="detail-field">

        <label>Reported</label>

        <p>
          ${escapeHTML(
            formatDateTime(
              complaint.createdAt
            )
          )}
        </p>

      </div>


      <div class="detail-field">

        <label>SLA</label>

        <p>
          ${escapeHTML(
            sla.label
          )}
          ·
          ${escapeHTML(
            formatDateTime(
              sla.dueAt
            )
          )}
        </p>

      </div>


      <div class="detail-field">

        <label>Assigned team</label>

        <p>
          ${escapeHTML(
            complaint.assignedTeam ||
            "Unassigned"
          )}
        </p>

      </div>


      <div class="detail-field full">

        <label>Description</label>

        <p>
          ${escapeHTML(
            complaint.description
          )}
        </p>

      </div>


      <div class="detail-field full ai-detail-box">

        <label>
          Smart classification
        </label>

        <p>
          Suggested category:
          <strong>
            ${escapeHTML(
              ai.category
            )}
          </strong>
        </p>

        <p>
          Suggested priority:
          <strong>
            ${escapeHTML(
              ai.priority
            )}
          </strong>
        </p>

        <p>
          Summary:
          ${escapeHTML(
            ai.summary
          )}
        </p>

      </div>


      ${
        complaint.attachment
          ? `

            <div class="detail-field full">

              <label>
                Evidence
              </label>

              <img
                src="${complaint.attachment}"
                alt="Complaint evidence"
                style="
                  width:100%;
                  max-height:300px;
                  object-fit:contain;
                  border-radius:12px;
                  border:1px solid var(--line);
                "
              >

            </div>

          `
          : ""
      }


      <div class="detail-field full">

        <label>
          Complaint timeline
        </label>

        ${timelineHTML(
          complaint
        )}

      </div>

    </div>

  `;


  const statusSelect =
    byId(
      "adminStatusSelect"
    );

  const assignSelect =
    byId(
      "adminAssignSelect"
    );

  const remarks =
    byId(
      "adminResolutionRemarks"
    );


  if (statusSelect) {

    statusSelect.value =
      complaint.status ||
      "New";

  }


  if (assignSelect) {

    assignSelect.value =
      complaint.assignedTeam ||
      "";

  }


  if (remarks) {

    remarks.value =
      complaint.resolutionRemarks ||
      "";

  }


  dialog.showModal?.();

}


/* =========================================================
   ADMIN SAVE
   ========================================================= */

function saveAdminComplaint() {

  if (!activeAdminComplaintId) {
    return;
  }


  const complaints =
    Store.complaints();


  const complaint =
    complaints.find(
      item =>
        (
          item.reference ||
          item.id
        ) ===
        activeAdminComplaintId
    );


  if (!complaint) {
    return;
  }

  const newStatus =
    byId(
      "adminStatusSelect"
    )?.value ||
    complaint.status;


  const newTeam =
    byId(
      "adminAssignSelect"
    )?.value ||
    "";


  const remarks =
    safeText(
      byId(
        "adminResolutionRemarks"
      )?.value
    );


  const oldStatus =
    complaint.status;


  const oldTeam =
    complaint.assignedTeam ||
    "";


  complaint.status =
    newStatus;

  complaint.assignedTeam =
    newTeam;

  complaint.resolutionRemarks =
    remarks;

  complaint.updatedAt =
    new Date().toISOString();


  if (
    oldStatus !== newStatus
  ) {

    addTimeline(
      complaint,
      `Status changed to ${newStatus}`,
      `Admin updated the complaint status.`,
      "status"
    );

  }


  if (
    oldTeam !== newTeam
  ) {

    addTimeline(
      complaint,
      newTeam
        ? `Assigned to ${newTeam}`
        : "Assignment removed",
      newTeam
        ? "Complaint was assigned to a transport operations team."
        : "Complaint is currently unassigned.",
      "assignment"
    );

  }


  if (remarks) {

    addTimeline(
      complaint,
      "Admin remarks updated",
      remarks,
      "remark"
    );

  }


  if (
    newStatus ===
    "Resolved"
  ) {

    complaint.resolvedAt =
      new Date().toISOString();

    complaint.escalated =
      false;

  }


  Store.set(
    RW_CONFIG.storage.complaints,
    complaints
  );


  if (complaint.userId) {

    createNotification(
      complaint.userId,
      "Complaint updated",
      `${complaint.reference || complaint.id} has been updated by the transport team.`,
      complaint.reference ||
      complaint.id
    );

  }


  byId(
    "adminComplaintDialog"
  )?.close();


  renderAdmin();

}


/* =========================================================
   ADMIN ESCALATION
   ========================================================= */

function manuallyEscalate() {

  if (!activeAdminComplaintId) {
    return;
  }


  const complaints =
    Store.complaints();


  const complaint =
    complaints.find(
      item =>
        (
          item.reference ||
          item.id
        ) ===
        activeAdminComplaintId
    );


  if (!complaint) {
    return;
  }


  complaint.escalated =
    true;

  complaint.escalatedAt =
    new Date().toISOString();

  complaint.updatedAt =
    new Date().toISOString();


  addTimeline(
    complaint,
    "Complaint escalated",
    "An administrator manually escalated this case for immediate attention.",
    "escalation"
  );


  Store.set(
    RW_CONFIG.storage.complaints,
    complaints
  );


  if (complaint.userId) {

    createNotification(
      complaint.userId,
      "Complaint escalated",
      `${complaint.reference || complaint.id} has been escalated for priority attention.`,
      complaint.reference ||
      complaint.id
    );

  }


  renderAdmin();

  openAdminComplaint(
    complaint
  );

}


/* =========================================================
   ADMIN EVENTS
   ========================================================= */

function initAdminEvents() {

  const search =
    byId("adminSearch");

  const filter =
    byId("adminFilter");

  const priority =
    byId("adminPriorityFilter");

  const route =
    byId("adminRouteFilter");


  function refresh() {
    renderAdmin();
  }


  search?.addEventListener(
    "input",
    refresh
  );

  filter?.addEventListener(
    "change",
    refresh
  );

  priority?.addEventListener(
    "change",
    refresh
  );

  route?.addEventListener(
    "change",
    refresh
  );


  byId(
    "loadAdminSample"
  )?.addEventListener(
    "click",
    () => {

      createDemoData();

      renderAdmin();

    }
  );


  byId(
    "closeAdminComplaintDialog"
  )?.addEventListener(
    "click",
    () => {

      byId(
        "adminComplaintDialog"
      )?.close();

    }
  );


  byId(
    "adminSaveComplaint"
  )?.addEventListener(
    "click",
    saveAdminComplaint
  );


  byId(
    "adminEscalateButton"
  )?.addEventListener(
    "click",
    manuallyEscalate
  );

}


/* =========================================================
   TEAM WORKLOAD
   ========================================================= */

function renderTeamCounts(
  complaints
) {

  const counts = {
    "Transport Admin": 0,
    "Route Operations": 0,
    "Safety Team": 0,
    "Driver Operations": 0
  };


  complaints.forEach(
    complaint => {

      const team =
        complaint.assignedTeam;

      if (
        team &&
        counts[
          team
        ] !== undefined
      ) {

        counts[team]++;

      }

    }
  );


  setText(
    "teamAdminCount",
    counts[
      "Transport Admin"
    ]
  );

  setText(
    "teamRouteCount",
    counts[
      "Route Operations"
    ]
  );

  setText(
    "teamSafetyCount",
    counts[
      "Safety Team"
    ]
  );

  setText(
    "teamDriverCount",
    counts[
      "Driver Operations"
    ]
  );

}


/* =========================================================
   DEMO DATA
   ========================================================= */

function createDemoData(
  user = currentUser()
) {

  const complaints =
    Store.complaints();


  const now =
    Date.now();


  const demo = [

    {
      category:
        "Late arrival",

      priority:
        "Medium",

      route:
        "CB-205 · Main Gate Express",

      location:
        "Main Gate",

      description:
        "The bus arrived around 25 minutes late during the morning college rush.",

      status:
        "New",

      assignedTeam:
        "Route Operations",

      ageHours:
        3

    },


    {
      category:
        "Overcrowding",

      priority:
        "High",

      route:
        "CB-101 · North Campus",

      location:
        "North Campus Stop",

      description:
        "The bus was completely full and several students could not board.",

      status:
        "In review",

      assignedTeam:
        "Transport Admin",

      ageHours:
        8

    },


    {
      category:
        "Safety concern",

      priority:
        "Urgent",

      route:
        "CB-314 · East Hostel Loop",

      location:
        "East Hostel",

      description:
        "Students reported an unsafe driving situation near the hostel loop.",

      status:
        "In review",

      assignedTeam:
        "Safety Team",

      ageHours:
        1

    },


    {
      category:
        "Cleanliness",

      priority:
        "Low",

      route:
        "CB-205 · Main Gate Express",

      location:
        "Main Gate",

      description:
        "The seats and floor of the bus require better cleaning.",

      status:
        "Resolved",

      assignedTeam:
        "Transport Admin",

      ageHours:
        30

    }

  ];


  demo.forEach(
    item => {

      const created =
        new Date(
          now -
          item.ageHours *
          60 *
          60 *
          1000
        ).toISOString();


      const reference =
        nextComplaintId();


      const complaint = {

        id: reference,

        reference,

        userId:
          user?.id ||
          "demo-student",

        studentName:
          user?.name ||
          "Demo Student",

        studentEmail:
          user?.email ||
          "demo@student.edu",

        category:
          item.category,

        priority:
          item.priority,

        route:
          item.route,

        incidentAt:
          created,

        location:
          item.location,

        description:
          item.description,

        attachment:
          null,

        status:
          item.status,

        assignedTeam:
          item.assignedTeam,

        resolutionRemarks:
          item.status ===
          "Resolved"
            ? "Issue reviewed and corrective action completed."
            : "",

        createdAt:
          created,

        updatedAt:
          created,

        dueAt:
          calculateDueAt(
            created,
            item.priority
          ),

        escalated:
          false,

        isDemo:
          true,

        aiAnalysis:
          analyzeComplaintText(
            item.description
          ),

        timeline: []

      };


      addTimeline(
        complaint,
        "Demo complaint created",
        "Sample complaint added for RouteWise demonstration.",
        "created"
      );


      if (
        item.status ===
        "In review"
      ) {

        addTimeline(
          complaint,
          "Complaint moved to review",
          `Assigned to ${item.assignedTeam}.`,
          "assignment"
        );

      }


      if (
        item.status ===
        "Resolved"
      ) {

        complaint.resolvedAt =
          new Date(
            now -
            4 *
            60 *
            60 *
            1000
          ).toISOString();


        addTimeline(
          complaint,
          "Complaint resolved",
          "Sample issue marked as resolved.",
          "status"
        );

      }


      complaints.push(
        complaint
      );

    }
  );


  Store.set(
    RW_CONFIG.storage.complaints,
    complaints
  );


  if (user) {

    createNotification(
      user.id,
      "Demo data loaded",
      "Sample transport complaints are now available in your dashboard.",
      ""
    );

  }

}


/* =========================================================
   LEGACY / COMPATIBILITY HELPERS
   ========================================================= */

function sampleComplaints() {
  createDemoData();
}


function loadSampleData() {
  createDemoData();
}


/* =========================================================
   INITIALIZATION
   ========================================================= */

document.addEventListener(
  "DOMContentLoaded",
  () => {

    ensureHostAccount();

    initTheme();
    initShell();
    initAuthPage();
    initAdminLoginPage();
    initComplaintPage();
    initDashboard();
    initAdmin();

    Store.syncFromServer();

  }
);