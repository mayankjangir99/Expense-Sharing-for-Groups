setupLogoutLinks();
setupProtectedLinks();

const loginForm = document.getElementById("loginForm");
const signupForm = document.getElementById("signupForm");
const contactForm = document.getElementById("contactForm");
const googleLoginSection = document.getElementById("googleLoginSection");
const googleLoginButton = document.getElementById("googleLoginButton");

if (loginForm || signupForm) {
  redirectIfAuthenticated();
}

if (loginForm) {
  void setupGoogleLogin();
}

setupPasswordToggles();

if (loginForm) {
  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const email = document.getElementById("loginEmail").value.trim();
    const password = document.getElementById("loginPassword").value;
    const message = document.getElementById("loginMessage");
    const submitButton = document.getElementById("loginSubmit");

    try {
      setFormMessage(message, "");
      setBusyState(submitButton, true, "Logging in...");
      const payload = await apiRequest("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password })
      });

      setAuthenticatedUser(payload);
      const nextPage = consumeRedirect() || "app.html";
      setFormMessage(message, `Logged in as ${payload.user.email}. Continuing...`, "success");
      window.setTimeout(() => {
        window.location.href = nextPage;
      }, 600);
    } catch (error) {
      setFormMessage(message, error.message, "error");
      setBusyState(submitButton, false, "Log In");
    }
  });
}

if (signupForm) {
  signupForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const name = document.getElementById("signupName").value.trim();
    const email = document.getElementById("signupEmail").value.trim();
    const password = document.getElementById("signupPassword").value;
    const message = document.getElementById("signupMessage");
    const submitButton = document.getElementById("signupSubmit");

    try {
      setFormMessage(message, "");
      setBusyState(submitButton, true, "Creating account...");
      const payload = await apiRequest("/api/auth/signup", {
        method: "POST",
        body: JSON.stringify({ name, email, password })
      });

      setAuthenticatedUser(payload);
      const nextPage = consumeRedirect() || "app.html";
      setFormMessage(message, `Welcome ${payload.user.name}. Your account has been created. Continuing...`, "success");
      window.setTimeout(() => {
        window.location.href = nextPage;
      }, 700);
    } catch (error) {
      setFormMessage(message, error.message, "error");
      setBusyState(submitButton, false, "Sign Up");
    }
  });
}

if (contactForm) {
  contactForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const name = document.getElementById("contactName").value.trim();
    const email = document.getElementById("contactEmail").value.trim();
    const messageInput = document.getElementById("contactMessageInput").value.trim();
    const message = document.getElementById("contactMessage");
    const submitButton = contactForm.querySelector('button[type="submit"]');

    try {
      setFormMessage(message, "");
      setBusyState(submitButton, true, "Sending...");
      await apiRequest("/api/contact", {
        method: "POST",
        body: JSON.stringify({
          name,
          email,
          message: messageInput
        })
      });

      contactForm.reset();
      setFormMessage(message, "Your message has been sent successfully. We will get back to you soon.", "success");
    } catch (error) {
      setFormMessage(message, error.message, "error");
    } finally {
      setBusyState(submitButton, false, "Send Message");
    }
  });
}

async function setupGoogleLogin() {
  if (!googleLoginSection || !googleLoginButton) {
    return;
  }

  googleLoginSection.classList.remove("hidden");

  try {
    const config = await apiRequest("/api/config");
    if (!config.googleClientId) {
      googleLoginButton.innerHTML = '<div class="google-login-fallback">Google sign-in is not configured yet.</div>';
      return;
    }

    const available = await waitForGoogleIdentity();
    if (!available) {
      googleLoginButton.innerHTML = '<div class="google-login-fallback">Google sign-in could not load right now.</div>';
      return;
    }

    window.google.accounts.id.initialize({
      client_id: config.googleClientId,
      callback: handleGoogleCredential
    });
    window.google.accounts.id.renderButton(googleLoginButton, {
      theme: "outline",
      size: "large",
      shape: "pill",
      text: "continue_with",
      width: 320
    });
  } catch (error) {
    googleLoginButton.innerHTML = '<div class="google-login-fallback">Google sign-in is unavailable right now.</div>';
    const message = document.getElementById("loginMessage");
    if (message) {
      setFormMessage(message, "Google sign-in is unavailable right now.", "error");
    }
  }
}

async function handleGoogleCredential(response) {
  const message = document.getElementById("loginMessage");
  const submitButton = document.getElementById("loginSubmit");

  try {
    setFormMessage(message, "");
    setBusyState(submitButton, true, "Continuing...");
    const payload = await apiRequest("/api/auth/google", {
      method: "POST",
      body: JSON.stringify({ credential: response.credential })
    });

    setAuthenticatedUser(payload);
    const nextPage = consumeRedirect() || "app.html";
    setFormMessage(message, `Logged in as ${payload.user.email}. Continuing...`, "success");
    window.setTimeout(() => {
      window.location.href = nextPage;
    }, 600);
  } catch (error) {
    setFormMessage(message, error.message, "error");
    setBusyState(submitButton, false, "Log In");
  }
}

function setFormMessage(element, text, type) {
  if (!element) {
    return;
  }

  element.textContent = text || "";
  element.classList.remove("is-success", "is-error");
  if (type === "success") {
    element.classList.add("is-success");
  }
  if (type === "error") {
    element.classList.add("is-error");
  }
}

function setBusyState(button, busy, label) {
  if (!button) {
    return;
  }

  button.disabled = Boolean(busy);
  button.dataset.originalLabel = button.dataset.originalLabel || button.textContent || "";
  button.textContent = label || (busy ? "Working..." : button.dataset.originalLabel);
}

function setupPasswordToggles() {
  document.querySelectorAll("[data-toggle-password]").forEach((button) => {
    button.addEventListener("click", () => {
      const targetId = button.getAttribute("data-target");
      const input = targetId ? document.getElementById(targetId) : null;
      if (!input) {
        return;
      }

      const nextType = input.type === "password" ? "text" : "password";
      input.type = nextType;
      button.textContent = nextType === "password" ? "Show" : "Hide";
      button.setAttribute("aria-label", nextType === "password" ? "Show password" : "Hide password");
    });
  });
}

async function waitForGoogleIdentity() {
  if (window.google?.accounts?.id) {
    return true;
  }

  const timeoutMs = 3500;
  const pollEveryMs = 100;
  const started = Date.now();

  while (Date.now() - started < timeoutMs) {
    if (window.google?.accounts?.id) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, pollEveryMs));
  }

  return false;
}
