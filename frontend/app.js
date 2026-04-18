/**
 * app.js — Fake Account Detector
 * ─────────────────────────────────────────────────────────────
 * Architecture:
 *   CONFIG      → centralised constants
 *   api         → all network calls (fetch wrapper)
 *   validator   → client-side field validation
 *   ui          → every DOM mutation lives here
 *   formHandler → wires events to api + ui
 * ─────────────────────────────────────────────────────────────
 */

"use strict";

/* ═══════════════════════════════════════════════════════════════
   1. CONFIG
   ═══════════════════════════════════════════════════════════════ */
const CONFIG = Object.freeze({
  API_BASE:       window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'? 'http://127.0.0.1:5000/api':'render_backend_url',
  PREDICT_PATH:   "/predict",
  HEALTH_PATH:    "/health",
  TOAST_DURATION: 4500,   // ms
  DEBOUNCE_MS:    300,
});


/* ═══════════════════════════════════════════════════════════════
   2. API LAYER
   All fetch() calls live here. Nothing else touches the network.
   ═══════════════════════════════════════════════════════════════ */
const api = (() => {

  /**
   * Core fetch wrapper.
   * Throws a typed ApiError on non-2xx or network failure.
   */
  async function request(path, { method = "GET", body = null } = {}) {
    const url      = CONFIG.API_BASE + path;
    const options  = {
      method,
      headers: { "Content-Type": "application/json" },
    };
    if (body !== null) options.body = JSON.stringify(body);

    let response;
    try {
      response = await fetch(url, options);
    } catch (networkErr) {
      throw new ApiError(
        "Cannot reach the server. Make sure Flask is running on port 5000.",
        0,
        "NETWORK_ERROR"
      );
    }

    const json = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new ApiError(
        json.error || `Unexpected server error (HTTP ${response.status})`,
        response.status,
        "SERVER_ERROR"
      );
    }

    return json;
  }

  /**
   * POST /predict
   * @param {ProfilePayload} payload
   * @returns {Promise<PredictResponse>}
   */
  async function predict(payload) {
    return request(CONFIG.PREDICT_PATH, { method: "POST", body: payload });
  }

  /**
   * GET /health  — called once on page load
   * @returns {Promise<HealthResponse>}
   */
  async function health() {
    return request(CONFIG.HEALTH_PATH);
  }

  return { predict, health };
})();


/* ═══════════════════════════════════════════════════════════════
   3. CUSTOM ERROR CLASS
   ═══════════════════════════════════════════════════════════════ */
class ApiError extends Error {
  /**
   * @param {string} message   Human-readable message
   * @param {number} status    HTTP status (0 = network failure)
   * @param {string} code      Internal error code
   */
  constructor(message, status = 0, code = "UNKNOWN") {
    super(message);
    this.name   = "ApiError";
    this.status = status;
    this.code   = code;
  }
}


/* ═══════════════════════════════════════════════════════════════
   4. VALIDATOR
   Pure functions — no DOM side-effects.
   Returns null on success, string on failure.
   ═══════════════════════════════════════════════════════════════ */
const validator = (() => {

  const rules = {
    username:  (v) => v.trim().length > 0   ? null : "Username is required.",
    followers: (v) => isNonNegativeInt(v)   ? null : "Enter a valid number (≥ 0).",
    following: (v) => isNonNegativeInt(v)   ? null : "Enter a valid number (≥ 0).",
    posts:     (v) => isNonNegativeInt(v)   ? null : "Enter a valid number (≥ 0).",
  };

  function isNonNegativeInt(value) {
    if (value === "" || value === null || value === undefined) return false;
    const n = Number(value);
    return Number.isInteger(n) && n >= 0;
  }

  /**
   * Validate a full form data object.
   * @param {Object} data   Raw string values from the form
   * @returns {{ valid: boolean, errors: Object<string, string> }}
   */
  function validateAll(data) {
    const errors = {};
    for (const [field, rule] of Object.entries(rules)) {
      const msg = rule(data[field] ?? "");
      if (msg) errors[field] = msg;
    }
    return { valid: Object.keys(errors).length === 0, errors };
  }

  /** Validate a single field (used for live inline feedback). */
  function validateField(field, value) {
    return rules[field] ? rules[field](value) : null;
  }

  return { validateAll, validateField };
})();


/* ═══════════════════════════════════════════════════════════════
   5. UI CONTROLLER
   Every DOM read/write lives here — keeps the rest of the code
   free of DOM concerns.
   ═══════════════════════════════════════════════════════════════ */
const ui = (() => {

  /* ── Element references ───────────────────────────────────── */
  const el = {
    form:       () => document.getElementById("mainForm"),
    submitBtn:  () => document.getElementById("submitBtn"),
    btnLabel:   () => document.querySelector("#submitBtn .btn-label"),
    btnSpinner: () => document.querySelector("#submitBtn .btn-spinner"),

    // Result card
    resultWrap: () => document.getElementById("resultWrap"),
    rStripe:    () => document.getElementById("rStripe"),
    rIcon:      () => document.getElementById("rIcon"),
    rLabel:     () => document.getElementById("rLabel"),
    rSub:       () => document.getElementById("rSub"),
    rPct:       () => document.getElementById("rPct"),
    rBar:       () => document.getElementById("rBar"),
    rChips:     () => document.getElementById("rChips"),

    // Toast
    toast:      () => document.getElementById("toast"),
    toastIcon:  () => document.getElementById("toastIcon"),
    toastText:  () => document.getElementById("toastText"),

    // Field error spans
    fieldErr:   (id) => document.getElementById(`e-${id}`),

    // Inputs
    input:      (id) => document.getElementById(id),
  };

  /* ── Loading state ────────────────────────────────────────── */
  function setLoading(on) {
    const btn = el.submitBtn();
    btn.disabled = on;
    btn.classList.toggle("loading", on);
    el.btnLabel().style.opacity  = on ? "0.45" : "";
    el.btnSpinner().style.display = on ? "block" : "";
  }

  /* ── Inline field errors ──────────────────────────────────── */
  function setFieldError(field, message) {
    const errEl = el.fieldErr(field);
    const input = el.input(field);
    if (!errEl || !input) return;
    errEl.textContent = message || "";
    input.classList.toggle("err-field", Boolean(message));
  }

  function clearFieldError(field) {
    setFieldError(field, "");
  }

  function showAllErrors(errors) {
    const allFields = ["username", "bio", "followers", "following", "posts"];
    allFields.forEach((f) => setFieldError(f, errors[f] || ""));
  }

  /* ── Toast notifications ──────────────────────────────────── */
  let toastTimer = null;

  function showToast(message, type = "info") {
    const t = el.toast();
    el.toastIcon().textContent = type === "error" ? "⚠" : "ℹ";
    el.toastText().textContent = message;

    t.className = ["toast", "show", type === "error" ? "error-toast" : ""].join(" ").trim();

    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("show"), CONFIG.TOAST_DURATION);
  }

  function hideToast() {
    el.toast().classList.remove("show");
  }

  /* ── Result card ──────────────────────────────────────────── */
  function showResult(prediction, confidence, is_fake, formData) {
    const cls = is_fake ? "fake" : "real";
    const pct = (confidence * 100).toFixed(1);

    // Stripe + icon + label
    el.rStripe().className = `r-stripe ${cls}`;
    el.rIcon().className   = `r-icon ${cls}`;
    el.rIcon().textContent = is_fake ? "✕" : "✓";
    el.rLabel().className  = `r-label ${cls}`;
    el.rLabel().textContent = prediction;
    el.rSub().textContent   = `${pct}% confidence · analysed just now`;

    // Confidence bar (animated)
    el.rPct().textContent  = `${pct}%`;
    el.rBar().className    = `conf-bar ${cls}`;
    el.rBar().style.width  = "0%";
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        el.rBar().style.width = `${confidence * 100}%`;
      })
    );

    // Chip summary
    _renderChips(formData);

    // Show & scroll into view
    const wrap = el.resultWrap();
    wrap.classList.add("show");
    wrap.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function hideResult() {
    el.resultWrap().classList.remove("show");
  }

  function _renderChips(formData) {
    const chips = [
      `@${formData.username}`,
      `${Number(formData.followers).toLocaleString()} followers`,
      `${Number(formData.following).toLocaleString()} following`,
      `${formData.posts} posts`,
      formData.bio
        ? `"${formData.bio.slice(0, 30)}${formData.bio.length > 30 ? "…" : ""}"`
        : "No bio",
    ];

    const container = el.rChips();
    container.innerHTML = "";
    chips.forEach((text) => {
      const span = document.createElement("span");
      span.className   = "chip";
      span.textContent = text;
      container.appendChild(span);
    });
  }

  /* ── Form helpers ─────────────────────────────────────────── */
  function getFormData() {
    return {
      username:  el.input("username").value,
      bio:       el.input("bio").value,
      followers: el.input("followers").value,
      following: el.input("following").value,
      posts:     el.input("posts").value,
    };
  }

  function buildPayload(raw) {
    return {
      username:  raw.username.trim(),
      bio:       raw.bio.trim(),
      followers: parseInt(raw.followers, 10),
      following: parseInt(raw.following, 10),
      posts:     parseInt(raw.posts, 10),
    };
  }

  return {
    setLoading,
    setFieldError,
    clearFieldError,
    showAllErrors,
    showToast,
    hideToast,
    showResult,
    hideResult,
    getFormData,
    buildPayload,
    el,
  };
})();


/* ═══════════════════════════════════════════════════════════════
   6. FORM HANDLER
   Orchestrates: collect → validate → call API → render
   ═══════════════════════════════════════════════════════════════ */
const formHandler = (() => {

  /* ── Submit ───────────────────────────────────────────────── */
  async function handleSubmit(event) {
    event.preventDefault();
    ui.hideResult();
    ui.hideToast();

    const rawData = ui.getFormData();

    // Client-side validation
    const { valid, errors } = validator.validateAll(rawData);
    if (!valid) {
      ui.showAllErrors(errors);
      return;
    }
    ui.showAllErrors({});  // clear any previous errors

    const payload = ui.buildPayload(rawData);

    ui.setLoading(true);
    try {
      const result = await api.predict(payload);
      ui.showResult(result.prediction, result.confidence, result.is_fake, rawData);
    } catch (err) {
      ui.showToast(err.message, "error");
      console.error("[ShieldScan]", err.code, err.message);
    } finally {
      ui.setLoading(false);
    }
  }

  /* ── Live inline validation ───────────────────────────────── */
  function handleLiveValidation(field) {
    return debounce((event) => {
      const msg = validator.validateField(field, event.target.value);
      // Only show live errors once the field has been touched (non-empty)
      if (event.target.value.length > 0) {
        ui.setFieldError(field, msg || "");
      } else {
        ui.clearFieldError(field);
      }
    }, CONFIG.DEBOUNCE_MS);
  }

  /* ── Wire events ──────────────────────────────────────────── */
  function init() {
    const form = document.getElementById("mainForm");
    if (!form) {
      console.error("[ShieldScan] #mainForm not found in DOM.");
      return;
    }

    // Submit
    form.addEventListener("submit", handleSubmit);

    // Live validation on validated fields
    ["username", "followers", "following", "posts"].forEach((id) => {
      const input = document.getElementById(id);
      if (input) {
        input.addEventListener("input", handleLiveValidation(id));
        // Clear error immediately on focus
        input.addEventListener("focus", () => ui.clearFieldError(id));
      }
    });

    // Health check — warn if model isn't loaded
    checkHealth();
  }

  /* ── Health check ─────────────────────────────────────────── */
  async function checkHealth() {
    try {
      const { model_loaded } = await api.health();
      if (!model_loaded) {
        ui.showToast(
          "Backend running but model.pkl not found. Place your model file in the backend folder.",
          "error"
        );
      }
    } catch {
      // Silent — error will surface naturally on first submit attempt
    }
  }

  return { init };
})();


/* ═══════════════════════════════════════════════════════════════
   7. UTILITIES
   ═══════════════════════════════════════════════════════════════ */

/**
 * Debounce — delays fn execution until after `wait` ms of inactivity.
 * @param {Function} fn
 * @param {number}   wait
 * @returns {Function}
 */
function debounce(fn, wait) {
  let timer;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), wait);
  };
}


/* ═══════════════════════════════════════════════════════════════
   8. BOOT
   ═══════════════════════════════════════════════════════════════ */
document.addEventListener("DOMContentLoaded", () => {
  formHandler.init();
  console.info("[ShieldScan] Initialised. API →", CONFIG.API_BASE);
});
