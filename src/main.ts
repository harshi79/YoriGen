import {
  createIcons,
  ArrowDownUp,
  ArrowRight,
  ArrowUpRight,
  Braces,
  Check,
  CircleAlert,
  CircleSlash,
  ClipboardPaste,
  CopyX,
  FileText,
  FileUp,
  ListFilter,
  ListRestart,
  Rows3,
  SortAsc,
  SortDesc,
  TextCursorInput,
  Wand2,
  ChevronDown,
  CircleHelp,
  Code2,
  Copy,
  CreditCard,
  Download,
  Fingerprint,
  FlaskConical,
  Github,
  Info,
  Layers,
  LoaderCircle,
  LockKeyhole,
  Moon,
  Plus,
  RotateCcw,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Sun,
  Terminal,
  Trash2,
  X,
  Zap,
} from "lucide";
import "./style.css";
import { generatorMarkup, mountGeneratorPanel } from "./generator-panel";
import { tabsMarkup, extraPanelsMarkup, mountWorkspace } from "./workspace";
const icons = {
  ArrowDownUp,
  ArrowRight,
  ArrowUpRight,
  Braces,
  Check,
  CircleAlert,
  CircleSlash,
  ClipboardPaste,
  CopyX,
  FileText,
  FileUp,
  ListFilter,
  ListRestart,
  Rows3,
  SortAsc,
  SortDesc,
  TextCursorInput,
  Wand2,
  ChevronDown,
  CircleHelp,
  Code2,
  Copy,
  CreditCard,
  Download,
  Fingerprint,
  FlaskConical,
  Github,
  Info,
  Layers,
  LoaderCircle,
  LockKeyhole,
  Moon,
  Plus,
  RotateCcw,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Sun,
  Terminal,
  Trash2,
  X,
  Zap,
};
const icon = (name: string, cls = "") =>
  `<i data-lucide="${name}" class="${cls}" aria-hidden="true"></i>`;
const TELEGRAM_CHANNEL = "https://t.me/+y8EekRvqpnQzNjZl";
/** Telegram paper-plane mark, drawn with currentColor so it adapts to the theme. */
const telegramIcon = `<svg class="telegram-mark" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false"><path d="M12 0a12 12 0 1 0 0 24 12 12 0 0 0 0-24Zm5.566 8.166c.09-.002.29.02.418.126a.456.456 0 0 1 .154.292c.014.084.032.276.018.425-.163 1.71-.866 5.857-1.224 7.771-.151.81-.449 1.082-.738 1.108-.627.058-1.103-.414-1.71-.812-.951-.624-1.488-1.012-2.411-1.62-1.067-.703-.375-1.09.232-1.72.16-.166 2.923-2.68 2.977-2.909.006-.028.012-.135-.05-.19-.063-.056-.157-.037-.225-.022-.095.022-1.613 1.026-4.554 3.01-.432.297-.822.442-1.172.434-.385-.008-1.126-.218-1.677-.397-.677-.22-1.214-.337-1.167-.71.024-.195.292-.394.803-.597 3.148-1.372 5.247-2.276 6.298-2.712 2.998-1.248 3.621-1.465 4.028-1.472Z"/></svg>`;
const refreshIcons = () => createIcons({ icons });
const $ = <T extends HTMLElement>(selector: string) =>
  document.querySelector<T>(selector)!;
let timer: ReturnType<typeof setTimeout>;
let savedTheme = "dark";
try {
  savedTheme = localStorage.getItem("origen-theme") ?? "dark";
} catch {
  /* Storage is optional. */
}
document.documentElement.dataset.theme =
  savedTheme === "light" ? "light" : "dark";
$("#app").innerHTML = `
<header class="site-header"><div class="header-inner">
  <a class="brand" href="./" aria-label="ORIGEN home"><span class="brand-icon">${icon("braces")}</span>ORIGEN<span class="brand-dot">.</span></a>
  <span class="header-divider"></span><span class="workspace-label">DEVELOPER TOOLS</span>
  <nav aria-label="Main navigation"><a class="nav-active" id="generator-link" href="#generator" aria-label="Generator" aria-current="page">${icon("credit-card")} <span class="nav-text">Generator</span></a><button type="button" class="nav-link" id="guide" aria-label="Quick guide">${icon("code-2")} <span class="nav-text">Quick guide</span> ${icon("arrow-up-right")}</button></nav>
  <div class="header-right"><span class="version">v1.3</span><a class="telegram-button" href="${TELEGRAM_CHANNEL}" target="_blank" rel="noopener noreferrer" aria-label="Join Channel on Telegram (opens in a new tab)">${telegramIcon}<span class="telegram-label">Join Channel</span></a><button type="button" class="icon-button" id="theme" aria-label="Switch to light theme">${icon("sun")}</button></div>
</div></header>
<main>
  <section class="intro"><div><div class="eyebrow"><span></span> THE PAYMENT TESTING TOOLKIT</div><h1>Payment card generator<span>.</span></h1><p>Realistic fixtures. Zero real-world stakes. Build better payment experiences.</p></div><div class="local-badge">${icon("shield-check")}<div><strong>Generation stays local</strong><span>Optional BIN metadata. No card verification.</span></div></div></section>
  ${tabsMarkup}
  ${generatorMarkup}
  ${extraPanelsMarkup}
  <div class="safety-note">${icon("info")}<p>Synthetic data is for development only. Numbers are not issued test accounts and may coincide with real card numbers. Use your payment provider’s official fixtures for gateway sandbox flows.</p></div>
  <footer><span><span class="footer-brand">ORIGEN.</span> Small tools. Better builds.</span><span>${icon("lock-keyhole")} Client-side only <span class="footer-dot">/</span> Built for developers</span></footer>
</main>
<div id="toast" class="toast" role="status" aria-live="polite" hidden></div>
<dialog id="guide-dialog"><div class="dialog-heading"><span class="eyebrow">ORIGEN / DOCS</span><button type="button" id="close-guide" class="icon-button" aria-label="Close quick guide">${icon("x")}</button></div><h2>A small tool for better tests.</h2><p>Generate fictional, format-compatible payment-card fixtures without leaving your browser.</p><ol><li><strong>Set your BIN.</strong> Type 6–8 prefix digits, enter a masked synthetic template such as <code>5279109907xxxxxx</code>, or turn on Auto. Visible digits are retained and each x position is generated locally; nothing is looked up.</li><li><strong>Choose expiry and CVV.</strong> Auto builds synthetic future dates and network-correct CVV widths locally. Custom values stay in this page and are never sent anywhere.</li><li><strong>Generate up to 100 fixtures.</strong> Nine networks are supported: Visa, Mastercard, Amex, Discover, JCB, Diners, UnionPay, Maestro and RuPay. Amex uses 15 digits, Diners 14 and up, and the rest 16 and up. All include a calculated Luhn check digit and are labeled <code>SYNTHETIC TEST FIXTURE</code>.</li><li><strong>Copy into your test suite.</strong> Use pipe-separated lines, CSV-style lines or JSON. JSON explicitly includes <code>synthetic: true</code>.</li></ol><div class="dialog-warning">A valid checksum does not mean an active account. These numbers are not guaranteed reserved test numbers. Never submit them to live payment systems. For gateway sandboxes, use that provider’s official test fixtures.</div><p class="hint">No payment processing, authorization, balance checking, account verification, or saved card data. BIN Lookup sends only a 6–8 digit prefix to Guison for range metadata. History is page-memory only. The theme is the only persisted setting.</p><button type="button" class="generate-button" id="guide-done">Got it. Let’s build. ${icon("arrow-right")}</button></dialog>
`;
function toast(message: string, kind: "ok" | "error" = "ok") {
  clearTimeout(timer);
  $("#toast").innerHTML = `${icon(kind === "error" ? "circle-alert" : "check")}<span></span>`;
  $("#toast span").textContent = message;
  $("#toast").classList.toggle("toast-error", kind === "error");
  $("#toast").hidden = false;
  refreshIcons();
  timer = setTimeout(() => {
    $("#toast").hidden = true;
  }, 3200);
}
async function copy(text: string, message: string) {
  try {
    if (navigator.clipboard?.writeText)
      await navigator.clipboard.writeText(text);
    else {
      const previous = document.activeElement as HTMLElement | null;
      const area = document.createElement("textarea");
      area.value = text;
      area.style.cssText = "position:fixed;left:-9999px;top:0";
      document.body.append(area);
      area.select();
      const success = document.execCommand("copy");
      area.remove();
      previous?.focus();
      if (!success) throw new Error("Clipboard unavailable");
    }
    toast(message);
  } catch {
    toast(
      "Clipboard unavailable. Select text in code view or the full metadata response to copy manually.",
      "error",
    );
  }
}
function syncTheme() {
  const light = document.documentElement.dataset.theme === "light";
  $("#theme").innerHTML = icon(light ? "moon" : "sun");
  $("#theme").setAttribute(
    "aria-label",
    `Switch to ${light ? "dark" : "light"} theme`,
  );
  $<HTMLSelectElement>("#settings-theme").value = light ? "light" : "dark";
  refreshIcons();
}
function setTheme(theme: "light" | "dark") {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem("origen-theme", theme);
  } catch {
    /* Storage is optional. */
  }
  syncTheme();
}
$("#theme").addEventListener("click", () => {
  const theme =
    document.documentElement.dataset.theme === "light" ? "dark" : "light";
  setTheme(theme);
});
const dialog = $<HTMLDialogElement>("#guide-dialog");
$("#guide").addEventListener("click", () => dialog.showModal());
$("#close-guide").addEventListener("click", () => dialog.close());
$("#guide-done").addEventListener("click", () => dialog.close());
dialog.addEventListener("click", (event) => {
  if (event.target === dialog) {
    const rect = dialog.getBoundingClientRect();
    if (
      event.clientX < rect.left ||
      event.clientX > rect.right ||
      event.clientY < rect.top ||
      event.clientY > rect.bottom
    )
      dialog.close();
  }
});
const workspace = mountWorkspace({ icon, refreshIcons, toast, copy, setTheme });
mountGeneratorPanel({
  icon,
  refreshIcons,
  toast,
  copy,
  isActive: () => workspace.activeTab() === "generator",
});
syncTheme();
