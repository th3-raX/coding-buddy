/* ═══════════════════════════════════════════════════════════════════════════
   Code Review Assistant — Frontend Logic
   CodeMirror 6 editor, API interaction, results rendering, history
   ═══════════════════════════════════════════════════════════════════════════ */

console.log("App.js module started loading!");
// ── CodeMirror ESM Imports ────────────────────────────────────────────────
import { basicSetup } from "codemirror";
import { Compartment } from "@codemirror/state";
import { keymap, EditorView } from "@codemirror/view";
import { indentWithTab } from "@codemirror/commands";
import { javascript } from "@codemirror/lang-javascript";
import { python } from "@codemirror/lang-python";
import { css } from "@codemirror/lang-css";
import { html } from "@codemirror/lang-html";
import { sql } from "@codemirror/lang-sql";
import { oneDark } from "@codemirror/theme-one-dark";

// ── Constants ─────────────────────────────────────────────────────────────
const MAX_LINES = 200;
const COOLDOWN_MS = 5000;
const HISTORY_KEY = "code-review-history";
const MAX_HISTORY = 20;
const API_URL = "/api/review";

// ── Language Configuration ────────────────────────────────────────────────
const LANGUAGES = {
  javascript: {
    cm: () => javascript(),
    prism: "javascript",
    label: "JavaScript",
  },
  typescript: {
    cm: () => javascript({ typescript: true }),
    prism: "typescript",
    label: "TypeScript",
  },
  jsx: {
    cm: () => javascript({ jsx: true }),
    prism: "jsx",
    label: "React/JSX",
  },
  python: { cm: () => python(), prism: "python", label: "Python" },
  css: { cm: () => css(), prism: "css", label: "CSS" },
  html: { cm: () => html(), prism: "markup", label: "HTML" },
  sql: { cm: () => sql(), prism: "sql", label: "SQL" },
};

// ── State ─────────────────────────────────────────────────────────────────
let editor = null;
let languageCompartment = new Compartment();
let themeCompartment = new Compartment();
let isReviewing = false;
let cooldownTimeout = null;
let currentReview = null;

// ── DOM Elements ──────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);
const editorContainer = $("editor-container");
const themeToggle = $("theme-toggle");
const languageSelect = $("language-select");
const lineCount = $("line-count");
const reviewBtn = $("review-btn");
const reviewBtnText = $("review-btn-text");
const resultsSection = $("results-section");
const resultsCards = $("results-cards");
const loadingSection = $("loading-section");
const errorMessage = $("error-message");
const errorText = $("error-text");
const copyBtn = $("copy-btn");
const historyToggle = $("history-toggle");
const historyClose = $("history-close");
const historySidebar = $("history-sidebar");
const historyList = $("history-list");
const sidebarOverlay = $("sidebar-overlay");
const clearHistoryBtn = $("clear-history-btn");
const toastContainer = $("toast-container");

window.addEventListener("error", (e) => {
  errorText.textContent = e.message;
  errorMessage.classList.remove("hidden");
});

// ═══════════════════════════════════════════════════════════════════════════
// CODEMIRROR SETUP
// ═══════════════════════════════════════════════════════════════════════════

function initEditor() {
  const lang = languageSelect.value;
  const langExt = LANGUAGES[lang]?.cm() || javascript();

  editor = new EditorView({
    doc: "",
    extensions: [
      basicSetup,
      keymap.of([indentWithTab]),
      languageCompartment.of(langExt),
      themeCompartment.of(
        document.documentElement.getAttribute("data-theme") === "light"
          ? []
          : oneDark,
      ),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          updateLineCount();
          updateReviewButton();
        }
      }),
      EditorView.theme({
        "&": { height: "300px", fontSize: "14px" },
        ".cm-scroller": { overflow: "auto", fontFamily: "var(--font-code)" },
      }),
    ],
    parent: editorContainer,
  });

  updateLineCount();
}

function getEditorContent() {
  return editor ? editor.state.doc.toString() : "";
}

function getLineCount() {
  return editor ? editor.state.doc.lines : 0;
}

function setEditorContent(text) {
  if (!editor) return;
  editor.dispatch({
    changes: { from: 0, to: editor.state.doc.length, insert: text },
  });
}

function updateLineCount() {
  const count = getLineCount();
  lineCount.textContent = `${count} line${count !== 1 ? "s" : ""}`;
  lineCount.style.color = count > MAX_LINES ? "var(--error)" : "";
}

function updateReviewButton() {
  const code = getEditorContent().trim();
  const count = getLineCount();
  reviewBtn.disabled = !code || count > MAX_LINES || isReviewing;
}

// Language switching
languageSelect.addEventListener("change", () => {
  const lang = languageSelect.value;
  const langExt = LANGUAGES[lang]?.cm() || javascript();
  if (editor) {
    editor.dispatch({
      effects: languageCompartment.reconfigure(langExt),
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// API INTERACTION
// ═══════════════════════════════════════════════════════════════════════════

async function submitReview() {
  if (isReviewing) return;

  const code = getEditorContent().trim();
  const language = languageSelect.value;

  if (!code) {
    showError("Please paste some code to review.");
    return;
  }

  if (getLineCount() > MAX_LINES) {
    showError(
      `Code exceeds the ${MAX_LINES}-line limit. Please shorten your snippet.`,
    );
    return;
  }

  isReviewing = true;
  showLoading();
  hideError();
  hideResults();
  updateReviewButton();
  reviewBtnText.textContent = "Reviewing...";
  reviewBtn.classList.add("loading");

  try {
    const response = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, language }),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Failed to get review.");
    }

    currentReview = {
      code,
      language,
      review: data.review,
      timestamp: Date.now(),
    };
    renderResults(data.review, language);
    saveToHistory(currentReview);
    hideLoading();
    showResults();
  } catch (err) {
    hideLoading();
    showError(err.message || "Something went wrong. Please try again.");
  } finally {
    isReviewing = false;
    reviewBtn.classList.remove("loading");
    startCooldown();
  }
}

function startCooldown() {
  let remaining = COOLDOWN_MS / 1000;
  reviewBtn.disabled = true;
  reviewBtnText.textContent = `Wait ${remaining}s`;

  cooldownTimeout = setInterval(() => {
    remaining--;
    if (remaining <= 0) {
      clearInterval(cooldownTimeout);
      reviewBtnText.textContent = "Review Code";
      updateReviewButton();
    } else {
      reviewBtnText.textContent = `Wait ${remaining}s`;
    }
  }, 1000);
}

reviewBtn.addEventListener("click", submitReview);

// ═══════════════════════════════════════════════════════════════════════════
// RESULTS RENDERING
// ═══════════════════════════════════════════════════════════════════════════

function renderResults(review, language) {
  resultsCards.innerHTML = "";
  const prismLang = LANGUAGES[language]?.prism || "javascript";

  // Positive note card
  const positiveCard = createCard("positive", {
    icon: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>`,
    label: "What you did well",
    title: review.positive.title,
    description: review.positive.description,
  });
  resultsCards.appendChild(positiveCard);

  // Improvement cards
  review.improvements.forEach((imp, i) => {
    const card = createCard("improvement", {
      icon: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1.3.5 2.6 1.5 3.5.8.8 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/></svg>`,
      label: `Improvement ${i + 1}`,
      title: imp.title,
      description: imp.explanation,
      before: imp.before,
      after: imp.after,
      prismLang,
    });
    resultsCards.appendChild(card);
  });

  // Trigger Prism highlighting on new code blocks
  if (window.Prism) {
    window.Prism.highlightAllUnder(resultsCards);
  }
}

function createCard(type, data) {
  const card = document.createElement("div");
  card.className = `review-card ${type}`;

  let codeHTML = "";
  if (data.before || data.after) {
    codeHTML = `
      <div class="code-comparison">
        <div class="code-block before">
          <div class="code-block-label">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg> Before
          </div>
          <pre><code class="language-${data.prismLang}">${escapeHtml(data.before)}</code></pre>
        </div>
        <div class="code-block after">
          <div class="code-block-label">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg> After
          </div>
          <pre><code class="language-${data.prismLang}">${escapeHtml(data.after)}</code></pre>
        </div>
      </div>`;
  }

  card.innerHTML = `
    <div class="card-header">
      <span class="card-icon">${data.icon}</span>
      <div>
        <div class="card-label">${data.label}</div>
        <div class="card-title">${escapeHtml(data.title)}</div>
      </div>
    </div>
    <div class="card-description">${escapeHtml(data.description)}</div>
    ${codeHTML}`;

  return card;
}

function escapeHtml(text) {
  if (!text) return "";
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

// ═══════════════════════════════════════════════════════════════════════════
// COPY TO CLIPBOARD (Markdown)
// ═══════════════════════════════════════════════════════════════════════════

copyBtn.addEventListener("click", async () => {
  if (!currentReview) return;

  const { review, language } = currentReview;
  const langLabel = LANGUAGES[language]?.label || language;

  let md = `# Code Review — ${langLabel}\n\n`;
  md += `## ✅ ${review.positive.title}\n${review.positive.description}\n\n`;

  review.improvements.forEach((imp, i) => {
    md += `## 💡 Improvement ${i + 1}: ${imp.title}\n`;
    md += `${imp.explanation}\n\n`;
    if (imp.before) {
      md += `### Before\n\`\`\`${language}\n${imp.before}\n\`\`\`\n\n`;
    }
    if (imp.after) {
      md += `### After\n\`\`\`${language}\n${imp.after}\n\`\`\`\n\n`;
    }
  });

  try {
    await navigator.clipboard.writeText(md.trim());
    copyBtn.classList.add("copied");
    copyBtn.querySelector("span").textContent = "Copied!";
    showToast("Review copied as Markdown!", "success");
    setTimeout(() => {
      copyBtn.classList.remove("copied");
      copyBtn.querySelector("span").textContent = "Copy";
    }, 2000);
  } catch {
    showToast("Failed to copy to clipboard.", "error");
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// HISTORY (localStorage)
// ═══════════════════════════════════════════════════════════════════════════

function getHistory() {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY)) || [];
  } catch {
    return [];
  }
}

function saveToHistory(entry) {
  const history = getHistory();
  history.unshift({
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    code: entry.code.substring(0, 500),
    language: entry.language,
    review: entry.review,
    timestamp: entry.timestamp,
  });
  // Cap at MAX_HISTORY
  if (history.length > MAX_HISTORY) history.length = MAX_HISTORY;
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
}

function deleteHistoryItem(id) {
  const history = getHistory().filter((h) => h.id !== id);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
  renderHistory();
}

function clearHistory() {
  localStorage.removeItem(HISTORY_KEY);
  renderHistory();
  showToast("History cleared.", "success");
}

function renderHistory() {
  const history = getHistory();

  if (history.length === 0) {
    historyList.innerHTML =
      '<div class="history-empty">No reviews yet.<br>Your past reviews will appear here.</div>';
    return;
  }

  historyList.innerHTML = history
    .map(
      (item) => `
    <div class="history-item" data-id="${item.id}">
      <div class="history-item-info" data-action="load" data-id="${item.id}">
        <div class="history-item-lang">${LANGUAGES[item.language]?.label || item.language}</div>
        <div class="history-item-preview">${escapeHtml(item.code.split("\n")[0])}</div>
        <div class="history-item-time">${timeAgo(item.timestamp)}</div>
      </div>
      <button class="history-delete" data-action="delete" data-id="${item.id}" aria-label="Delete">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
      </button>
    </div>`,
    )
    .join("");
}

function loadHistoryItem(id) {
  const history = getHistory();
  const item = history.find((h) => h.id === id);
  if (!item) return;

  languageSelect.value = item.language;
  languageSelect.dispatchEvent(new Event("change"));
  setEditorContent(item.code);
  currentReview = {
    code: item.code,
    language: item.language,
    review: item.review,
    timestamp: item.timestamp,
  };
  renderResults(item.review, item.language);
  hideError();
  showResults();
  closeSidebar();
}

historyList.addEventListener("click", (e) => {
  const target = e.target.closest("[data-action]");
  if (!target) return;
  const action = target.dataset.action;
  const id = target.dataset.id;
  if (action === "delete") {
    e.stopPropagation();
    deleteHistoryItem(id);
  } else if (action === "load") {
    loadHistoryItem(id);
  }
});

clearHistoryBtn.addEventListener("click", clearHistory);

function timeAgo(timestamp) {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return "Just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "Yesterday";
  if (days < 30) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString();
}

// ═══════════════════════════════════════════════════════════════════════════
// SIDEBAR TOGGLE
// ═══════════════════════════════════════════════════════════════════════════

function openSidebar() {
  renderHistory();
  historySidebar.classList.remove("hidden");
  sidebarOverlay.classList.remove("hidden");
  // Trigger reflow for transition
  requestAnimationFrame(() => {
    historySidebar.classList.add("visible");
    sidebarOverlay.classList.add("visible");
  });
}

function closeSidebar() {
  historySidebar.classList.remove("visible");
  sidebarOverlay.classList.remove("visible");
  setTimeout(() => {
    historySidebar.classList.add("hidden");
    sidebarOverlay.classList.add("hidden");
  }, 400);
}

historyToggle.addEventListener("click", openSidebar);
historyClose.addEventListener("click", closeSidebar);
sidebarOverlay.addEventListener("click", closeSidebar);

// ═══════════════════════════════════════════════════════════════════════════
// UI STATE HELPERS
// ═══════════════════════════════════════════════════════════════════════════

function showLoading() {
  loadingSection.classList.remove("hidden");
}
function hideLoading() {
  loadingSection.classList.add("hidden");
}
function showResults() {
  resultsSection.classList.remove("hidden");
}
function hideResults() {
  resultsSection.classList.add("hidden");
}

function showError(msg) {
  errorText.textContent = msg;
  errorMessage.classList.remove("hidden");
}
function hideError() {
  errorMessage.classList.add("hidden");
}

function showToast(message, type = "success") {
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.textContent = message;
  toastContainer.appendChild(toast);

  setTimeout(() => {
    toast.classList.add("exiting");
    toast.addEventListener("animationend", () => toast.remove());
  }, 2500);
}

// ═══════════════════════════════════════════════════════════════════════════
// THEME HANDLING
// ═══════════════════════════════════════════════════════════════════════════

function initTheme() {
  const savedTheme = localStorage.getItem("theme");
  const osPrefersDark = window.matchMedia(
    "(prefers-color-scheme: dark)",
  ).matches;

  let isLight = false;
  if (savedTheme) {
    isLight = savedTheme === "light";
  } else {
    isLight = !osPrefersDark; // Heavily respect OS preference initially
  }

  applyTheme(isLight, false);

  themeToggle.addEventListener("click", () => {
    document.documentElement.classList.add("theme-transition");
    const currentIsLight =
      document.documentElement.getAttribute("data-theme") === "light";
    applyTheme(!currentIsLight, true);
    // Remove transition class after transition finishes to prevent layout jumping bugs later
    setTimeout(
      () => document.documentElement.classList.remove("theme-transition"),
      400,
    );
  });
}

function applyTheme(isLight, animate) {
  document.documentElement.setAttribute(
    "data-theme",
    isLight ? "light" : "dark",
  );
  themeToggle.classList.toggle("light-mode-active", isLight);
  localStorage.setItem("theme", isLight ? "light" : "dark");

  const prismTheme = $("prism-theme");
  if (prismTheme) {
    prismTheme.href = isLight
      ? "https://cdn.jsdelivr.net/npm/prismjs@1.29.0/themes/prism.min.css"
      : "https://cdn.jsdelivr.net/npm/prismjs@1.29.0/themes/prism-tomorrow.min.css";
  }

  if (editor) {
    editor.dispatch({
      effects: themeCompartment.reconfigure(isLight ? [] : oneDark),
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════════════════════

initTheme();
initEditor();
