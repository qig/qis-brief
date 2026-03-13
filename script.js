// ── Configuration ──────────────────────────────────
// Change this to your backend URL (must be publicly reachable)
const API_BASE = "https://api.qiguo.dev";

// ── Form handling ──────────────────────────────────
const form = document.getElementById("hero-form");
const emailInput = document.getElementById("hero-email");
const messageEl = document.getElementById("hero-message");
const submitBtn = form.querySelector("button[type=submit]");

form.addEventListener("submit", async (e) => {
  e.preventDefault();

  const email = emailInput.value.trim();
  if (!email) return;

  submitBtn.disabled = true;
  submitBtn.textContent = "Subscribing\u2026";
  messageEl.hidden = true;

  try {
    const res = await fetch(`${API_BASE}/newsletter/subscribe`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });

    const data = await res.json();

    if (res.ok) {
      messageEl.textContent = "Check your inbox for a verification email.";
      messageEl.className = "form-message success";
      emailInput.value = "";
    } else {
      messageEl.textContent = data.detail || "Something went wrong. Please try again.";
      messageEl.className = "form-message error";
    }
  } catch {
    messageEl.textContent = "Network error. Please check your connection.";
    messageEl.className = "form-message error";
  }

  messageEl.hidden = false;
  submitBtn.disabled = false;
  submitBtn.textContent = "Subscribe";
});
