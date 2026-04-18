const AUTH_STORAGE_KEY = "split-circle-auth";
const REDIRECT_STORAGE_KEY = "split-circle-redirect";

function getAuthState() {
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (error) {
    return null;
  }
}

function getAuthToken() {
  return getAuthState()?.token || "";
}

function isAuthenticated() {
  return Boolean(getAuthToken());
}

function setAuthenticatedUser(authState) {
  localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({
    token: authState.token,
    user: authState.user
  }));
}

function clearAuthenticatedUser() {
  localStorage.removeItem(AUTH_STORAGE_KEY);
}

async function apiRequest(path, options = {}) {
  const headers = new Headers(options.headers || {});
  const token = getAuthToken();

  if (!headers.has("Content-Type") && options.body) {
    headers.set("Content-Type", "application/json");
  }

  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const response = await fetch(path, {
    ...options,
    headers
  });

  const contentType = response.headers.get("content-type") || "";
  const payload = contentType.includes("application/json")
    ? await response.json()
    : await response.text();

  if (!response.ok) {
    const message = typeof payload === "object" && payload?.error
      ? payload.error
      : "Request failed.";
    throw new Error(message);
  }

  return payload;
}

async function requireAuth() {
  if (!isAuthenticated()) {
    rememberRedirect(window.location.pathname.split("/").pop() || "app.html");
    window.location.href = "login.html";
    return false;
  }

  try {
    const payload = await apiRequest("/api/auth/me");
    setAuthenticatedUser({
      token: getAuthToken(),
      user: payload.user
    });
    return true;
  } catch (error) {
    clearAuthenticatedUser();
    rememberRedirect(window.location.pathname.split("/").pop() || "app.html");
    window.location.href = "login.html";
    return false;
  }
}

async function redirectIfAuthenticated() {
  if (!isAuthenticated()) {
    return false;
  }

  try {
    const payload = await apiRequest("/api/auth/me");
    setAuthenticatedUser({
      token: getAuthToken(),
      user: payload.user
    });
    window.location.href = consumeRedirect() || "app.html";
    return true;
  } catch (error) {
    clearAuthenticatedUser();
    return false;
  }
}

function setupLogoutLinks() {
  document.querySelectorAll(".nav-logout").forEach((link) => {
    link.addEventListener("click", async () => {
      clearAuthenticatedUser();
    });
  });
}

function setupProtectedLinks() {
  document.querySelectorAll("[data-protected-link]").forEach((link) => {
    link.addEventListener("click", (event) => {
      if (isAuthenticated()) {
        return;
      }

      event.preventDefault();
      const target = link.getAttribute("href") || "app.html";
      rememberRedirect(target);
      window.location.href = "login.html";
    });
  });
}

function syncNavAuthUI() {
  const authenticated = isAuthenticated();
  const loginLinks = document.querySelectorAll('a[href="login.html"]');
  const signupLinks = document.querySelectorAll('a[href="signup.html"]');
  const logoutLinks = document.querySelectorAll(".nav-logout");

  loginLinks.forEach((link) => {
    link.hidden = authenticated;
  });

  signupLinks.forEach((link) => {
    link.hidden = authenticated;
  });

  logoutLinks.forEach((link) => {
    link.hidden = !authenticated;
  });
}

document.addEventListener("DOMContentLoaded", () => {
  syncNavAuthUI();
});

function rememberRedirect(target) {
  const safeTarget = sanitizeRedirect(target);
  if (!safeTarget) {
    return;
  }

  localStorage.setItem(REDIRECT_STORAGE_KEY, safeTarget);
}

function consumeRedirect() {
  const target = localStorage.getItem(REDIRECT_STORAGE_KEY);
  localStorage.removeItem(REDIRECT_STORAGE_KEY);
  return sanitizeRedirect(target);
}

function sanitizeRedirect(target) {
  if (!target || typeof target !== "string") {
    return null;
  }

  const normalized = target.trim();
  const allowed = ["app.html", "index.html", "about.html", "contact.html"];
  return allowed.includes(normalized) ? normalized : null;
}
