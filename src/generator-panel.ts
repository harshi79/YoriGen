/**
 * ORIGEN Generator panel — the five-step synthetic fixture builder.
 *
 * BIN / IIN → Expiry → CVV → Quantity → Generate. Every step runs locally:
 * no payment verification, no card authorization, no external validation
 * service and no network request. Auto modes build synthetic values in the
 * page, and generated rows are labeled `SYNTHETIC TEST FIXTURE`.
 */
import {
  cardLengths,
  compatibleNetworks,
  cvvDigits,
  displayName,
  displayNumber,
  formatRecords,
  generateCards,
  lengthLabel,
  NETWORKS,
  type CardRecord,
  type GeneratorOptions,
  type OutputFormat,
} from "./generator";
import {
  effectivePrefix,
  hasFieldErrors,
  parseGeneratorInput,
  prepareGeneratorOptions,
  summarizeGeneratorForm,
  validateGeneratorForm,
  type GeneratorFieldErrors,
  type GeneratorFormValues,
  type ValueMode,
} from "./generator-input";
import { downloadFixtures, type ExportType } from "./exports";

export interface GeneratorPanelServices {
  icon: (name: string, cls?: string) => string;
  refreshIcons: () => void;
  toast: (message: string, kind?: "ok" | "error") => void;
  copy: (text: string, message: string) => Promise<void>;
  isActive: () => boolean;
}

const QUANTITY_PRESETS = [1, 5, 10, 25, 50, 100] as const;
/** Marks every row of the results table as synthetic test material. */
export const FIXTURE_LABEL = "SYNTHETIC TEST FIXTURE";

const year = new Date().getFullYear();

export const generatorMarkup = `
<section id="panel-generator" role="tabpanel" aria-labelledby="tab-generator" tabindex="0">
  <div class="workspace" id="generator">
  <section class="panel config-panel builder-panel" aria-labelledby="config-title"><div class="panel-heading"><div><i data-lucide="wand-2" aria-hidden="true"></i><h2 id="config-title">Fixture builder</h2></div><span class="step-tag">5 STEPS</span></div>
    <form id="config" novalidate>
      <section class="builder-step">
        <h3 class="step-head"><span class="step-index" aria-hidden="true">01</span><label for="prefix">BIN / IIN</label><span class="tiny-badge">SYNTHETIC</span></h3>
        <div class="bin-row">
          <div class="input-with-icon"><i data-lucide="fingerprint" aria-hidden="true"></i><input id="prefix" name="prefix" type="text" inputmode="text" autocomplete="off" placeholder="e.g. 424242 or 5279109907xxxxxx" aria-describedby="prefix-hint prefix-error"/><span class="input-end">6–8 / masked</span></div>
          <label class="auto-switch" for="bin-auto"><input type="checkbox" id="bin-auto" name="binAuto"/><span class="switch-track" aria-hidden="true"></span><span class="switch-text">Auto</span></label>
        </div>
        <p class="hint" id="prefix-hint">Enter a 6–8 digit synthetic prefix or a masked template with visible digits followed by x characters. Masked positions are generated locally.</p>
        <p class="field-error" id="prefix-error" hidden></p>
        <div class="sub-field"><label for="network">Network</label><div class="select-wrap no-icon"><select id="network" name="network"><option value="Auto">Auto</option>${NETWORKS.map((n) => `<option value="${n}">${displayName(n)}</option>`).join("")}<option value="Random">Random</option></select><i data-lucide="chevron-down" aria-hidden="true"></i></div></div>
        <p class="hint" id="network-hint">Auto detects the network from your BIN with local rules. Random picks any network compatible with it.</p>
        <p class="field-error" id="network-error" hidden></p>
        <p class="detected" id="detected" hidden></p>
      </section>
      <section class="builder-step">
        <h3 class="step-head"><span class="step-index" aria-hidden="true">02</span><label for="expiry-mode">Expiry</label><span class="tiny-badge">FUTURE ONLY</span></h3>
        <div class="select-wrap no-icon"><select id="expiry-mode" name="expiryMode"><option value="auto">Auto</option><option value="custom">Custom month + year</option></select><i data-lucide="chevron-down" aria-hidden="true"></i></div>
        <p class="hint" id="expiry-hint">Auto creates a synthetic future expiry locally.</p>
        <div class="custom-fields" id="expiry-fields" hidden>
          <div><label for="month">Month</label><div class="select-wrap no-icon"><select id="month" name="month">${Array.from({ length: 12 }, (_, i) => `<option value="${i + 1}">${String(i + 1).padStart(2, "0")}</option>`).join("")}</select><i data-lucide="chevron-down" aria-hidden="true"></i></div></div>
          <div><label for="year">Year</label><div class="select-wrap no-icon"><select id="year" name="year">${Array.from({ length: 11 }, (_, i) => `<option ${i === 1 ? "selected" : ""}>${year + i}</option>`).join("")}</select><i data-lucide="chevron-down" aria-hidden="true"></i></div></div>
        </div>
        <p class="field-error" id="expiry-error" hidden></p>
      </section>
      <section class="builder-step">
        <h3 class="step-head"><span class="step-index" aria-hidden="true">03</span><label for="cvv-mode">CVV</label><span class="tiny-badge">STAYS LOCAL</span></h3>
        <div class="select-wrap no-icon"><select id="cvv-mode" name="cvv"><option value="auto">Auto</option><option value="custom">Custom</option></select><i data-lucide="chevron-down" aria-hidden="true"></i></div>
        <p class="hint" id="cvv-hint">Auto matches the network: 3 digits for most networks, 4 for Amex.</p>
        <div class="custom-fields" id="cvv-fields" hidden>
          <div class="cvv-field"><label for="cvv-value">Custom CVV</label><div class="input-with-icon"><i data-lucide="lock-keyhole" aria-hidden="true"></i><input id="cvv-value" name="cvvValue" type="text" inputmode="numeric" autocomplete="off" placeholder="000" aria-describedby="cvv-value-hint cvv-error"/><span class="input-end" id="cvv-length">3 digits</span></div><p class="hint" id="cvv-value-hint">Synthetic digits only. Never sent anywhere.</p></div>
        </div>
        <p class="field-error" id="cvv-error" hidden></p>
      </section>
      <section class="builder-step">
        <h3 class="step-head"><span class="step-index" aria-hidden="true">04</span><label for="quantity">Quantity</label><span class="tiny-badge">MAX 100</span></h3>
        <div class="quantity-row"><input id="quantity" name="quantity" type="number" min="1" max="100" step="1" value="10" inputmode="numeric" aria-describedby="quantity-hint quantity-error"/><div class="presets" aria-label="Quantity presets">${QUANTITY_PRESETS.map((n) => `<button type="button" data-quantity="${n}" aria-pressed="${n === 10}" class="${n === 10 ? "selected" : ""}">${n}</button>`).join("")}</div></div>
        <p class="hint" id="quantity-hint">Any whole number from 1 to 100.</p>
        <p class="field-error" id="quantity-error" hidden></p>
      </section>
      <section class="builder-step step-generate">
        <h3 class="step-head"><span class="step-index" aria-hidden="true">05</span><span class="step-title">Generate</span></h3>
        <p class="build-summary" id="summary" aria-live="polite"></p>
        <div id="error" class="error" role="alert" hidden></div>
        <button class="generate-button" id="generate" type="submit"><i data-lucide="zap" aria-hidden="true"></i>Generate Test Data<i data-lucide="arrow-right" aria-hidden="true"></i></button>
        <div class="shortcut">Ready when you are <kbd>⌘ / Ctrl</kbd><kbd>↵</kbd></div>
      </section>
    </form>
    <div class="config-footnote"><i data-lucide="lock-keyhole" aria-hidden="true"></i>No API keys. No accounts. No verification. No network calls.</div>
  </section>
  <section class="panel results-panel" aria-labelledby="results-title"><div class="panel-heading"><div><i data-lucide="layers" aria-hidden="true"></i><h2 id="results-title">Generated data</h2><span class="count-badge" id="count">0</span></div><div class="view-toggle" aria-label="Results view"><button type="button" id="table-view" class="active" aria-label="Table view" aria-pressed="true"><i data-lucide="layers" aria-hidden="true"></i></button><button type="button" id="code-view" aria-label="Code view" aria-pressed="false"><i data-lucide="code-2" aria-hidden="true"></i></button></div></div>
    <div class="test-banner"><i data-lucide="shield-check" aria-hidden="true"></i><span>TEST DATA ONLY — NOT REAL PAYMENT CARDS</span><span class="banner-dot"></span></div>
    <div class="fixture-banner" id="fixture-banner" hidden><i data-lucide="flask-conical" aria-hidden="true"></i><span class="fixture-chip">${FIXTURE_LABEL}</span><span>Every row below is locally generated test data — never a real account.</span></div>
    <div class="results-toolbar"><div class="format-selector"><label for="format">Format</label><div class="select-wrap no-icon"><select id="format"><option value="pipe">Pipe separated</option><option value="csv">Comma separated</option><option value="json">JSON</option></select><i data-lucide="chevron-down" aria-hidden="true"></i></div></div><div class="result-actions"><button type="button" class="subtle-button" id="clear" aria-label="Clear" disabled><i data-lucide="trash-2" aria-hidden="true"></i><span>Clear</span></button><button type="button" class="secondary-button" id="copy-all" disabled><i data-lucide="copy" aria-hidden="true"></i>Copy all</button></div></div>
    <div id="results-content" class="results-content"></div>
    <div class="results-bottom"><div class="stats"><span><span class="status-dot"></span><strong id="stat-records">0</strong> records</span><span><i data-lucide="zap" aria-hidden="true"></i><strong id="stat-time">—</strong></span><span class="luhn-stat"><i data-lucide="check" aria-hidden="true"></i>Luhn compatible</span><span class="fixture-stat" id="fixture-stat" hidden><i data-lucide="flask-conical" aria-hidden="true"></i>${FIXTURE_LABEL}</span></div><div class="export-actions"><button type="button" id="copy-text" disabled>Copy text</button><span>·</span><button type="button" id="copy-json" disabled>Copy JSON <i data-lucide="braces" aria-hidden="true"></i></button></div></div>
    <div class="download-toolbar"><span><i data-lucide="download" aria-hidden="true"></i>Download synthetic fixtures</span><div>${(["txt", "csv", "json"] as const).map((type) => `<button type="button" class="secondary-button" data-export="${type}" aria-label="Export ${type.toUpperCase()}" disabled>${type.toUpperCase()}</button>`).join("")}</div></div>
  </section>
  </div>
  <section class="benefits" aria-label="How it works"><article><div class="benefit-icon"><i data-lucide="terminal" aria-hidden="true"></i></div><div><h3>Made for your sandbox</h3><p>Fixtures for forms, QA flows, and UI validation.</p></div><span>01</span></article><article><div class="benefit-icon"><i data-lucide="shield-check" aria-hidden="true"></i></div><div><h3>Format-valid. Never verified.</h3><p>Luhn-compatible numbers. No account lookups.</p></div><span>02</span></article><article><div class="benefit-icon"><i data-lucide="braces" aria-hidden="true"></i></div><div><h3>Generate. Copy. Build.</h3><p>Clean output that fits right into your workflow.</p></div><span>03</span></article></section>
</section>`;

export function mountGeneratorPanel(services: GeneratorPanelServices): void {
  const { icon, refreshIcons, toast, copy, isActive } = services;
  const $ = <T extends HTMLElement>(selector: string) =>
    document.querySelector<T>(selector)!;
  let records: CardRecord[] = [];
  let generationMs = 0;
  let view: "table" | "code" = "table";
  let busy = false;
  /**
   * Inline errors only appear after the developer interacts with the form, so
   * a freshly loaded page never looks broken.
   */
  let touched = false;

  const controls = {
    prefix: "#prefix",
    network: "#network",
    expiry: "#expiry-mode",
    cvvMode: "#cvv-mode",
    cvvValue: "#cvv-value",
    quantity: "#quantity",
  } as const;
  const errorNodes = {
    prefix: "#prefix-error",
    network: "#network-error",
    expiry: "#expiry-error",
    cvv: "#cvv-error",
    quantity: "#quantity-error",
  } as const;

  function formValues(): GeneratorFormValues {
    return {
      binMode: $<HTMLInputElement>("#bin-auto").checked ? "auto" : "manual",
      prefix: $<HTMLInputElement>("#prefix").value,
      network: $<HTMLSelectElement>("#network")
        .value as GeneratorFormValues["network"],
      expiryMode: $<HTMLSelectElement>("#expiry-mode").value as ValueMode,
      month: Number($<HTMLSelectElement>("#month").value),
      year: Number($<HTMLSelectElement>("#year").value),
      cvvMode: $<HTMLSelectElement>("#cvv-mode").value as ValueMode,
      cvvValue: $<HTMLInputElement>("#cvv-value").value,
      quantity: Number($<HTMLInputElement>("#quantity").value),
    };
  }
  function optionsFor(values: GeneratorFormValues): GeneratorOptions {
    return prepareGeneratorOptions({
      prefix: values.binMode === "auto" ? "" : values.prefix,
      network: values.network,
      quantity: values.quantity,
      expiryMode: values.expiryMode,
      month: values.month,
      year: values.year,
      cvv: values.cvvMode === "custom" ? "custom" : "auto",
      cvvValue: values.cvvValue,
    });
  }
  /** The field that should carry aria-invalid for a given error key. */
  const invalidControl: Record<string, keyof typeof controls> = {
    prefix: "prefix",
    network: "network",
    expiry: "expiry",
    cvv: "cvvValue",
    quantity: "quantity",
  };
  function renderErrors(errors: GeneratorFieldErrors, show = true) {
    for (const field of Object.keys(errorNodes) as (keyof GeneratorFieldErrors)[]) {
      const node = $(errorNodes[field]);
      const message = show ? errors[field] ?? "" : "";
      node.textContent = message;
      node.hidden = !message;
    }
    for (const field of Object.keys(controls) as (keyof typeof controls)[]) {
      const selector = controls[field];
      const control = document.querySelector(selector);
      const invalid = Object.entries(invalidControl).some(
        ([key, target]) => target === field && Boolean(errors[key as keyof GeneratorFieldErrors]),
      );
      if (invalid && show) control?.setAttribute("aria-invalid", "true");
      else control?.removeAttribute("aria-invalid");
    }
    $("#summary").classList.toggle("summary-blocked", hasFieldErrors(errors));
  }
  function syncSummary() {
    $("#summary").textContent = summarizeGeneratorForm(formValues());
  }
  function syncBinStep() {
    const auto = $<HTMLInputElement>("#bin-auto").checked;
    const prefix = $<HTMLInputElement>("#prefix");
    prefix.disabled = auto;
    const detected = $("#detected");
    const values = formValues();
    let parsed: ReturnType<typeof parseGeneratorInput> | undefined;
    if (values.prefix && !auto) {
      try {
        parsed = parseGeneratorInput(values.prefix);
      } catch {
        parsed = undefined;
      }
    }
    const compatible = parsed?.generatorPrefix
      ? compatibleNetworks(parsed.generatorPrefix)
      : [];
    detected.hidden = false;
    if (auto) {
      detected.textContent = "Auto · a network-compatible synthetic prefix is built locally";
      detected.dataset.state = "auto";
    } else if (!values.prefix) {
      detected.textContent = "Waiting for a BIN / IIN, or turn on Auto";
      detected.dataset.state = "idle";
    } else if (!parsed) {
      detected.textContent = "Enter a valid 6–8 digit prefix or masked template";
      detected.dataset.state = "warn";
    } else if (compatible.length) {
      const templateNote = parsed.templateLength
        ? ` · ${parsed.templateLength - parsed.generatorPrefix.length} synthetic positions`
        : "";
      detected.textContent = `Detected locally${templateNote} · ${compatible.map(displayName).join(", ")}`;
      detected.dataset.state = "ok";
    } else {
      detected.textContent = "No supported test network matches these digits";
      detected.dataset.state = "warn";
    }
    const hint = $("#prefix-hint");
    hint.textContent = auto
      ? "Auto mode: a network-compatible synthetic prefix is generated for each fixture."
      : parsed?.templateLength
        ? `${parsed.generatorPrefix.length} visible digits are retained; ${parsed.templateLength - parsed.generatorPrefix.length} x positions are generated locally as synthetic digits.`
        : "Enter a 6–8 digit synthetic prefix or a masked template with visible digits followed by x characters.";
  }
  function syncExpiryStep() {
    const custom = $<HTMLSelectElement>("#expiry-mode").value === "custom";
    $("#expiry-fields").hidden = !custom;
    $("#expiry-hint").textContent = custom
      ? "Pick a synthetic future month and year."
      : "Auto creates a synthetic future expiry locally.";
  }
  function syncNetworkStep() {
    const hint = $("#network-hint");
    const selected = $<HTMLSelectElement>("#network").value;
    const pinned = NETWORKS.find((network) => network === selected);
    hint.textContent = pinned
      ? `${displayName(pinned)} · ${lengthLabel(cardLengths(pinned))} · ${cvvDigits(pinned)}-digit CVV. Detected locally from your BIN.`
      : "Auto detects the network from your BIN with local rules. Random picks any network compatible with it.";
  }
  function syncCvvStep() {
    const custom = $<HTMLSelectElement>("#cvv-mode").value === "custom";
    $("#cvv-fields").hidden = !custom;
    const networks = compatibleNetworks(effectivePrefix(formValues()));
    const widths = [...new Set(networks.map(cvvDigits))];
    const lengths = widths.length === 1 ? widths : [3, 4];
    $("#cvv-length").textContent = `${lengths[0]} digits`;
    $<HTMLInputElement>("#cvv-value").placeholder = "0".repeat(lengths[0]);
    $("#cvv-hint").textContent = custom
      ? `Custom values stay in this page. Allowed length here: ${lengths.join(" or ")} digits.`
      : widths.length === 1
        ? `Auto matches the network: ${lengths[0]} digits${networks.length === 1 ? ` for ${displayName(networks[0])}` : ""}.`
        : "Auto matches each network: 4 digits for Amex, 3 for the rest.";
  }
  function syncQuantity() {
    const quantity = $<HTMLInputElement>("#quantity").value;
    document
      .querySelectorAll<HTMLButtonElement>("[data-quantity]")
      .forEach((button) => {
        const selected = button.dataset.quantity === quantity;
        button.classList.toggle("selected", selected);
        button.setAttribute("aria-pressed", String(selected));
      });
  }
  function syncAll() {
    syncBinStep();
    syncNetworkStep();
    syncExpiryStep();
    syncCvvStep();
    syncQuantity();
    syncSummary();
    renderErrors(validateGeneratorForm(formValues()), touched);
  }
  function reportErrors() {
    renderErrors(validateGeneratorForm(formValues()), touched);
  }
  function format(): OutputFormat {
    return $<HTMLSelectElement>("#format").value as OutputFormat;
  }
  function render() {
    $("#count").textContent = String(records.length);
    $("#stat-records").textContent = String(records.length);
    $("#stat-time").textContent = records.length
      ? `${generationMs < 1 ? "< 1" : Math.round(generationMs)} ms`
      : "—";
    $("#fixture-banner").hidden = !records.length;
    $("#fixture-stat").hidden = !records.length;
    for (const id of ["clear", "copy-all", "copy-text", "copy-json"])
      $<HTMLButtonElement>(`#${id}`).disabled = !records.length || busy;
    document
      .querySelectorAll<HTMLButtonElement>("[data-export]")
      .forEach((button) => {
        button.disabled = !records.length || busy;
      });
    $("#results-content").classList.toggle("has-records", !!records.length);
    if (!records.length) {
      $("#results-content").innerHTML = `<div class="empty-state"><div class="card-illustration"><div class="ghost-card"></div><div class="mock-card"><div class="mock-top"><span class="chip">${icon("braces")}</span>${icon("sparkles")}</div><div class="mock-number">•••• &nbsp;•••• &nbsp;•••• &nbsp;••••</div><div class="mock-bottom"><span>SYNTHETIC / TEST ONLY</span><span>MM/YY</span></div></div><span class="card-plus">${icon("plus")}</span></div><span class="empty-eyebrow">A CLEAN SLATE</span><h3>Your next test starts here.</h3><p>Configure your fixtures and hit generate. We’ll handle the digits. You handle the build.</p><div class="empty-code"><span>$</span> origen.generate() <span class="cursor">▌</span></div></div>`;
      refreshIcons();
    } else if (view === "code") {
      $("#results-content").innerHTML = `<div class="code-label">// SYNTHETIC TEST FIXTURE · NOT REAL PAYMENT CARDS</div><pre id="code-output" tabindex="0" aria-label="Generated synthetic test fixtures"></pre>`;
      $("#code-output").textContent = formatRecords(records, format());
    } else {
      $("#results-content").innerHTML = `<table><caption class="sr-only">Synthetic payment-card test fixtures. Not real payment cards.</caption><thead><tr><th class="row-num">#</th><th>Card number</th><th>Expiry</th><th>CVV</th><th>Network</th><th>Fixture</th><th><span class="sr-only">Copy record</span></th></tr></thead><tbody>${records
        .map(
          (r, i) =>
            `<tr><td class="row-num">${String(i + 1).padStart(2, "0")}</td><td class="card-number">${displayNumber(r)}</td><td class="mono">${r.month}/${r.year}</td><td class="mono cvv-cell">${r.cvv}</td><td><span class="network-badge ${r.network.toLowerCase().replaceAll(" ", "-")}"><span></span>${displayName(r.network)}</span></td><td class="fixture-cell"><span class="fixture-badge">${FIXTURE_LABEL}</span></td><td><button type="button" class="row-copy icon-button" data-copy="${i}" aria-label="Copy synthetic test fixture ${i + 1}">${icon("copy")}</button></td></tr>`,
        )
        .join("")}</tbody></table>`;
      refreshIcons();
    }
  }
  $("#results-content").addEventListener("click", (event) => {
    const button = (event.target as Element | null)?.closest<HTMLButtonElement>("[data-copy]");
    if (!button) return;
    const row = records[Number(button.dataset.copy)];
    if (row)
      void copy(formatRecords([row], format()), "Synthetic test fixture copied");
  });
  function toastMessage(message: string, kind: "ok" | "error" = "ok") {
    toast(message, kind);
  }
  function clearFormError() {
    $("#error").hidden = true;
  }
  async function generate() {
    if (busy) return;
    clearFormError();
    touched = true;
    const values = formValues();
    const errors = validateGeneratorForm(values);
    renderErrors(errors, true);
    if (hasFieldErrors(errors)) {
      $("#summary").textContent = summarizeGeneratorForm(values);
      $("#error").textContent =
        "Check the highlighted fields — nothing was generated.";
      $("#error").hidden = false;
      const firstInvalid = document.querySelector<HTMLElement>('[aria-invalid="true"]');
      firstInvalid?.focus();
      return;
    }
    let settings: GeneratorOptions;
    try {
      settings = optionsFor(values);
    } catch (error) {
      $("#error").textContent = (error as Error).message;
      $("#error").hidden = false;
      return;
    }
    busy = true;
    const button = $<HTMLButtonElement>("#generate");
    button.disabled = true;
    button.innerHTML = `${icon("loader-circle", "spin")} Generating fixtures…`;
    $("#results-content").setAttribute("aria-busy", "true");
    refreshIcons();
    await new Promise((resolve) => setTimeout(resolve, 220));
    try {
      const start = performance.now();
      records = generateCards(settings);
      generationMs = performance.now() - start;
      toast(`${records.length} synthetic test fixtures generated`);
    } catch (error) {
      $("#error").textContent = (error as Error).message;
      $("#error").hidden = false;
    } finally {
      busy = false;
      button.disabled = false;
      button.innerHTML = `${icon("zap")} Generate Test Data ${icon("arrow-right")}`;
      $("#results-content").removeAttribute("aria-busy");
      render();
      refreshIcons();
    }
  }
  $("#config").addEventListener("submit", (event) => {
    event.preventDefault();
    void generate();
  });
  document.addEventListener("keydown", (event) => {
    if (
      (event.metaKey || event.ctrlKey) &&
      event.key === "Enter" &&
      isActive() &&
      !document.querySelector<HTMLDialogElement>("#guide-dialog")?.open
    ) {
      event.preventDefault();
      $<HTMLFormElement>("#config").requestSubmit();
    }
  });
  /** Local, offline network detection feedback for the BIN step. */
  function syncPrefixHint() {
    const values = formValues();
    if (values.binMode !== "manual" || !values.prefix) return;
    let parsed: ReturnType<typeof parseGeneratorInput>;
    try {
      parsed = parseGeneratorInput(values.prefix);
    } catch {
      return;
    }
    if (parsed.templateLength) {
      $("#prefix-hint").textContent = `${parsed.generatorPrefix.length} visible digits are retained; ${parsed.templateLength - parsed.generatorPrefix.length} x positions are generated locally as synthetic digits. Nothing is sent anywhere.`;
      return;
    }
    const compatible = compatibleNetworks(parsed.generatorPrefix);
    $("#prefix-hint").textContent = compatible.length
      ? `Detected locally: ${compatible.map(displayName).join(", ")}. Nothing is sent anywhere.`
      : "No supported test network matches these digits.";
  }
  // Live validation: errors appear while typing, never as a surprise on blur.
  $("#config").addEventListener("input", (event) => {
    clearFormError();
    touched = true;
    const target = event.target as HTMLElement;
    if (target.id === "prefix") {
      syncBinStep();
      syncPrefixHint();
      // The networks compatible with the typed prefix decide the CVV width and
      // the custom-CVV placeholder, so they must be re-derived while typing.
      syncCvvStep();
    }
    if (target.id === "quantity") syncQuantity();
    reportErrors();
    syncSummary();
  });
  $("#config").addEventListener("change", () => {
    clearFormError();
    touched = true;
    syncAll();
  });
  $("#bin-auto").addEventListener("change", () => {
    clearFormError();
    touched = true;
    syncAll();
  });
  $("#network").addEventListener("change", () => {
    clearFormError();
    syncAll();
  });
  $("#expiry-mode").addEventListener("change", () => {
    clearFormError();
    syncAll();
  });
  $("#cvv-mode").addEventListener("change", () => {
    clearFormError();
    syncAll();
  });
  document.querySelectorAll<HTMLButtonElement>("[data-quantity]").forEach((button) =>
    button.addEventListener("click", () => {
      $<HTMLInputElement>("#quantity").value = button.dataset.quantity!;
      clearFormError();
      touched = true;
      syncQuantity();
      reportErrors();
      syncSummary();
    }),
  );
  $("#format").addEventListener("change", () => {
    if (view === "code" && records.length) {
      const code = document.querySelector<HTMLElement>("#code-output");
      if (code) code.textContent = formatRecords(records, format());
    }
  });
  for (const mode of ["table", "code"] as const)
    $(`#${mode}-view`).addEventListener("click", () => {
      view = mode;
      for (const m of ["table", "code"]) {
        $(`#${m}-view`).classList.toggle("active", m === mode);
        $(`#${m}-view`).setAttribute("aria-pressed", String(m === mode));
      }
      render();
    });
  $("#copy-all").addEventListener("click", () =>
    void copy(
      formatRecords(records, format()),
      `${records.length} synthetic test fixtures copied`,
    ),
  );
  $("#copy-text").addEventListener("click", () =>
    void copy(
      formatRecords(records, format() === "csv" ? "csv" : "pipe"),
      "Synthetic test fixtures copied as plain text",
    ),
  );
  $("#copy-json").addEventListener("click", () =>
    void copy(formatRecords(records, "json"), "Synthetic test fixtures copied as JSON"),
  );
  $("#clear").addEventListener("click", () => {
    records = [];
    generationMs = 0;
    render();
    toastMessage("Test fixtures cleared");
  });
  document
    .querySelectorAll<HTMLButtonElement>("[data-export]")
    .forEach((button) =>
      button.addEventListener("click", () => {
        if (!records.length) return;
        try {
          downloadFixtures(records, button.dataset.export as ExportType);
          toastMessage("Synthetic test fixtures exported");
        } catch {
          toastMessage(
            "Export unavailable. You can still copy the test fixtures.",
            "error",
          );
        }
      }),
    );
  syncAll();
  render();
}
