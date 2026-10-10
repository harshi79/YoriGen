/**
 * Generator — mobile screen for the local synthetic fixture builder.
 *
 * All validation, generation and formatting comes from the shared modules
 * used by the web app (generator.ts, generator-input.ts, exports.ts). Nothing
 * on this screen performs a network request.
 */
import { Braces, Copy, FlaskConical, Layers, Minus, Plus, Share2, ShieldCheck, Trash2, Wand2, Zap } from "lucide";
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
  type OutputFormat,
} from "../../generator";
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
} from "../../generator-input";
import { fixtureExport, type ExportType } from "../../exports";
import type { ToolContext } from "../core/context";
import type { ToolDefinition, ToolScreen } from "../core/registry";
import { button, card, emptyState, field, iconButton, segmented, selectControl, toggle } from "../ui/components";
import { h, icon, plural, replace, scrollBehavior } from "../ui/dom";

export const FIXTURE_LABEL = "SYNTHETIC TEST FIXTURE";
const QUANTITY_PRESETS = [1, 5, 10, 25, 50, 100] as const;
type View = "builder" | "results";

export function defaultGeneratorValues(now = new Date()): GeneratorFormValues {
  return {
    binMode: "manual",
    prefix: "",
    network: "Auto",
    expiryMode: "auto",
    month: now.getMonth() + 1,
    year: now.getFullYear() + 1,
    cvvMode: "auto",
    cvvValue: "",
    quantity: 10,
  };
}

/** Maps the builder state onto the generator's option contract. */
export function generatorOptionsFor(values: GeneratorFormValues) {
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

function createGeneratorScreen(context: ToolContext): ToolScreen {
  const { ui } = context;
  const values = defaultGeneratorValues();
  const thisYear = new Date().getFullYear();
  let touched = false;
  let records: CardRecord[] = [];
  let generationMs = 0;
  let view: View = "builder";
  let format: OutputFormat = "pipe";

  // ---------- Step 1: BIN / IIN ----------
  const prefixInput = h("input", {
    id: "gen-prefix",
    class: "control mono",
    type: "text",
    inputmode: "text",
    autocomplete: "off",
    autocapitalize: "off",
    autocorrect: "off",
    spellcheck: "false",
    enterkeyhint: "done",
    // No maxlength: browsers truncate pasted text silently, and a pasted
    // complete card number must be rejected, never cut down to a prefix.
    placeholder: "424242 or 5279109907xxxxxx",
  });
  const prefixField = field({
    label: "BIN / IIN prefix",
    controlId: "gen-prefix",
    control: prefixInput,
    hint: "6–8 digits, or a masked template such as 5279109907xxxxxx.",
  });
  const autoSwitch = toggle({
    id: "gen-bin-auto",
    label: "Auto prefix — build a network-compatible prefix locally",
    onChange: (checked) => {
      values.binMode = checked ? "auto" : "manual";
      touched = true;
      sync();
    },
  });
  const detected = h("div", { class: "chips", id: "gen-detected", "aria-live": "polite" });
  const networkSelect = selectControl(
    "gen-network",
    [
      { value: "Auto", label: "Auto (detect from prefix)" },
      ...NETWORKS.map((network) => ({ value: network as string, label: displayName(network) })),
      { value: "Random", label: "Random compatible" },
    ],
    "Auto",
  );
  const networkField = field({ label: "Network", controlId: "gen-network", control: networkSelect });

  // ---------- Step 2: Expiry ----------
  const expirySegments = segmented<ValueMode>({
    label: "Expiry mode",
    id: "gen-expiry-mode",
    segments: [
      { value: "auto", label: "Auto" },
      { value: "custom", label: "Custom" },
    ],
    value: "auto",
    onChange: (mode) => {
      values.expiryMode = mode;
      touched = true;
      sync();
    },
  });
  const monthSelect = selectControl(
    "gen-month",
    Array.from({ length: 12 }, (_, index) => ({ value: String(index + 1), label: String(index + 1).padStart(2, "0") })),
    String(values.month),
  );
  const yearSelect = selectControl(
    "gen-year",
    Array.from({ length: 11 }, (_, index) => ({ value: String(thisYear + index), label: String(thisYear + index) })),
    String(values.year),
  );
  const expiryFields = h(
    "div",
    { class: "grid-2", hidden: true },
    h("div", { class: "field" }, h("label", { class: "field-label", for: "gen-month" }, "Month"), monthSelect),
    h("div", { class: "field" }, h("label", { class: "field-label", for: "gen-year" }, "Year"), yearSelect),
  );
  const expiryHint = h("p", { class: "hint" }, "Auto creates a synthetic future month and year.");
  const expiryError = h("p", { class: "field-error", id: "gen-expiry-error", role: "alert", hidden: true });

  // ---------- Step 3: CVV ----------
  const cvvSegments = segmented<ValueMode>({
    label: "CVV mode",
    id: "gen-cvv-mode",
    segments: [
      { value: "auto", label: "Auto" },
      { value: "custom", label: "Custom" },
    ],
    value: "auto",
    onChange: (mode) => {
      values.cvvMode = mode;
      touched = true;
      sync();
      if (mode === "custom") cvvInput.focus();
    },
  });
  const cvvInput = h("input", {
    id: "gen-cvv",
    class: "control mono",
    type: "text",
    inputmode: "numeric",
    autocomplete: "off",
    enterkeyhint: "done",
    placeholder: "000",
  });
  const cvvField = field({ label: "Custom CVV", controlId: "gen-cvv", control: cvvInput, hint: "Synthetic digits only. Stays on this device." });
  cvvField.element.hidden = true;
  const cvvHint = h("p", { class: "hint" });

  // ---------- Step 4: Quantity ----------
  const quantityInput = h("input", {
    id: "gen-quantity",
    class: "control mono quantity-input",
    type: "number",
    inputmode: "numeric",
    min: "1",
    max: "100",
    step: "1",
    value: String(values.quantity),
    enterkeyhint: "done",
  });
  const stepQuantity = (delta: number) => {
    const next = Math.min(100, Math.max(1, (Number.isInteger(values.quantity) ? values.quantity : 10) + delta));
    quantityInput.value = String(next);
    values.quantity = next;
    touched = true;
    sync();
  };
  const presetButtons = QUANTITY_PRESETS.map((count) =>
    h(
      "button",
      {
        type: "button",
        class: "chip-btn",
        "data-quantity": count,
        "aria-pressed": String(count === values.quantity),
        onClick: () => {
          quantityInput.value = String(count);
          values.quantity = count;
          touched = true;
          sync();
        },
      },
      String(count),
    ),
  );
  const quantityField = field({
    label: "Number of fixtures",
    controlId: "gen-quantity",
    control: quantityInput,
    hint: "Any whole number from 1 to 100.",
    inline: h(
      "div",
      { class: "stepper" },
      iconButton({ label: "Decrease quantity", iconNode: Minus, onClick: () => stepQuantity(-1) }),
      iconButton({ label: "Increase quantity", iconNode: Plus, onClick: () => stepQuantity(1) }),
    ),
  });

  // ---------- Builder layout ----------
  const builder = h(
    "div",
    { class: "view", id: "gen-builder" },
    h("div", { class: "notice" }, icon(ShieldCheck), h("span", {}, "Test data only — synthetic fixtures, never real payment cards.")),
    card(
      { title: "BIN / IIN", badge: "Step 1", iconNode: Wand2 },
      prefixField.element,
      autoSwitch.element,
      detected,
      networkField.element,
    ),
    card({ title: "Expiry", badge: "Step 2" }, expirySegments.element, expiryHint, expiryFields, expiryError),
    card({ title: "CVV", badge: "Step 3" }, cvvSegments.element, cvvHint, cvvField.element),
    card({ title: "Quantity", badge: "Step 4" }, h("div", { class: "chips", role: "group", "aria-label": "Quantity presets" }, ...presetButtons), quantityField.element),
    h("p", { class: "footnote" }, "Generated locally with Luhn check digits. No network calls, no verification, no accounts."),
  );

  const summary = h("p", { class: "action-summary", id: "gen-summary", "aria-live": "polite" });
  const formError = h("p", { class: "action-error", id: "gen-form-error", role: "alert", hidden: true });
  const generateButton = h(
    "button",
    { type: "button", class: "btn btn-primary btn-block", id: "gen-generate", onClick: () => generate() },
    icon(Zap),
    h("span", {}, "Generate test data"),
  );
  const builderBar = h("div", { class: "action-bar" }, summary, formError, generateButton);

  // ---------- Results ----------
  const resultsList = h("ol", { class: "fixture-list", id: "gen-results-list", "aria-label": "Generated synthetic test fixtures" });
  const resultsMeta = h("p", { class: "results-meta", id: "gen-results-meta" });
  const formatSelect = selectControl<OutputFormat>(
    "gen-format",
    [
      { value: "pipe", label: "Pipe  number | MM/YY | CVV" },
      { value: "csv", label: "CSV  number,MM,YY,CVV" },
      { value: "json", label: "JSON" },
    ],
    format,
  );
  const resultsBody = h("div", { class: "results-body" });
  const results = h("div", { class: "view", id: "gen-results", hidden: true }, resultsBody);
  const resultsBar = h(
    "div",
    { class: "action-bar action-bar-row", hidden: true },
    button({ label: "Copy all", iconNode: Copy, variant: "primary", id: "gen-copy-all", onClick: () => copyAll() }),
    button({ label: "Export", iconNode: Share2, id: "gen-export", onClick: () => openExport() }),
    iconButton({ label: "Clear results", iconNode: Trash2, onClick: () => void clearResults() }),
  );

  // ---------- Top-level view switcher ----------
  const viewTabs = segmented<View>({
    label: "Generator view",
    id: "gen-view",
    segments: [
      { value: "builder", label: "Builder" },
      { value: "results", label: "Results" },
    ],
    value: "builder",
    onChange: (next) => showView(next),
  });
  const resultsTab = viewTabs.element.querySelector<HTMLButtonElement>('[data-value="results"]')!;

  const scroller = h("div", { class: "screen-scroll" }, h("div", { class: "screen-sticky" }, viewTabs.element), builder, results);
  const root = h("div", { class: "screen", "data-tool": "generator" }, scroller, builderBar, resultsBar);

  // ---------- Behaviour ----------
  function readValues() {
    values.prefix = prefixInput.value;
    values.network = networkSelect.value as GeneratorFormValues["network"];
    values.month = Number(monthSelect.value);
    values.year = Number(yearSelect.value);
    values.cvvValue = cvvInput.value;
    values.quantity = quantityInput.value === "" ? Number.NaN : Number(quantityInput.value);
  }

  function renderDetected() {
    replace(detected);
    if (values.binMode === "auto") {
      detected.append(h("span", { class: "chip" }, "Auto prefix — any compatible network"));
      return;
    }
    if (!values.prefix) {
      detected.append(h("span", { class: "chip chip-muted" }, "Waiting for a prefix, or turn on Auto"));
      return;
    }
    let parsed: ReturnType<typeof parseGeneratorInput>;
    try {
      parsed = parseGeneratorInput(values.prefix);
    } catch {
      return;
    }
    const networks = compatibleNetworks(parsed.generatorPrefix).filter(
      (network) => parsed.templateLength === undefined || cardLengths(network).includes(parsed.templateLength),
    );
    if (!networks.length) {
      detected.append(h("span", { class: "chip chip-muted" }, "No supported network matches"));
      return;
    }
    for (const network of networks)
      detected.append(h("span", { class: "chip" }, `${displayName(network)} · ${lengthLabel(parsed.templateLength ? [parsed.templateLength] : cardLengths(network))}`));
    if (parsed.templateLength)
      detected.append(
        h("span", { class: "chip chip-muted" }, `${parsed.templateLength - parsed.generatorPrefix.length} masked positions filled locally`),
      );
  }

  function renderErrors(errors: GeneratorFieldErrors) {
    const show = touched;
    prefixField.setError(show ? errors.prefix : undefined);
    networkField.setError(show ? errors.network : undefined);
    expiryError.textContent = show ? errors.expiry ?? "" : "";
    expiryError.hidden = !(show && errors.expiry);
    cvvField.setError(show ? errors.cvv : undefined);
    quantityField.setError(show ? errors.quantity : undefined);
  }

  function sync() {
    readValues();
    const manual = values.binMode === "manual";
    prefixInput.disabled = !manual;
    autoSwitch.input.checked = !manual;
    renderDetected();

    const customExpiry = values.expiryMode === "custom";
    expiryFields.hidden = !customExpiry;
    expiryHint.textContent = customExpiry
      ? "Choose a month after the current one, up to 10 years ahead."
      : "Auto creates a synthetic future month and year.";

    const networks = compatibleNetworks(effectivePrefix(values));
    const widths = [...new Set(networks.map(cvvDigits))];
    const lengths = widths.length === 1 ? widths : [3, 4];
    const customCvv = values.cvvMode === "custom";
    cvvField.element.hidden = !customCvv;
    cvvInput.placeholder = "0".repeat(lengths[0]);
    cvvHint.textContent = customCvv
      ? `Allowed length here: ${lengths.join(" or ")} digits.`
      : widths.length === 1
        ? `Auto matches the network: ${lengths[0]} digits.`
        : "Auto matches each network: 4 digits for Amex, 3 for the rest.";

    for (const preset of presetButtons) preset.setAttribute("aria-pressed", String(Number(preset.dataset.quantity) === values.quantity));

    summary.textContent = summarizeGeneratorForm(values);
    renderErrors(validateGeneratorForm(values));
    formError.hidden = true;
  }

  function generate() {
    touched = true;
    readValues();
    const errors = validateGeneratorForm(values);
    renderErrors(errors);
    if (hasFieldErrors(errors)) {
      formError.textContent = "Check the highlighted fields — nothing was generated.";
      formError.hidden = false;
      root.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
      return;
    }
    try {
      const start = performance.now();
      records = generateCards(generatorOptionsFor(values));
      generationMs = performance.now() - start;
    } catch (error) {
      formError.textContent = (error as Error).message;
      formError.hidden = false;
      return;
    }
    renderResults();
    showView("results");
    ui.toast(`${plural(records.length, "synthetic test fixture")} generated`);
  }

  function renderResults() {
    resultsTab.textContent = records.length ? `Results · ${records.length}` : "Results";
    if (!records.length) {
      replace(
        resultsBody,
        emptyState({
          iconNode: Layers,
          eyebrow: "A clean slate",
          title: "No fixtures yet",
          body: "Configure the builder and tap Generate. Fixtures are created on this device.",
          action: button({ label: "Open builder", iconNode: Wand2, variant: "primary", onClick: () => showView("builder") }),
        }),
      );
      resultsBar.hidden = true;
      return;
    }
    resultsMeta.textContent = `${plural(records.length, "fixture")} · ${generationMs < 1 ? "< 1" : Math.round(generationMs)} ms · Luhn compatible`;
    replace(
      resultsList,
      ...records.map((record, index) =>
        h(
          "li",
          { class: "fixture" },
          h(
            "div",
            { class: "fixture-main" },
            h("span", { class: "fixture-number mono" }, displayNumber(record)),
            h(
              "span",
              { class: "fixture-meta" },
              h("span", { class: `network-dot network-${record.network.toLowerCase().replaceAll(" ", "-")}`, "aria-hidden": "true" }),
              `${displayName(record.network)} · ${record.month}/${record.year} · CVV ${record.cvv}`,
            ),
            h("span", { class: "fixture-tag" }, FIXTURE_LABEL),
          ),
          iconButton({
            label: `Copy synthetic test fixture ${index + 1}`,
            iconNode: Copy,
            onClick: () => void ui.copy(formatRecords([record], format), "Synthetic test fixture copied"),
          }),
        ),
      ),
    );
    replace(
      resultsBody,
      h("div", { class: "notice notice-accent" }, icon(FlaskConical), h("span", {}, `${FIXTURE_LABEL} — every row is locally generated test data.`)),
      h("div", { class: "results-head" }, resultsMeta, h("div", { class: "field" }, h("label", { class: "field-label", for: "gen-format" }, "Copy format"), formatSelect)),
      resultsList,
    );
    resultsBar.hidden = view !== "results";
  }

  function showView(next: View) {
    view = next;
    viewTabs.set(next);
    builder.hidden = next !== "builder";
    results.hidden = next !== "results";
    builderBar.hidden = next !== "builder";
    resultsBar.hidden = next !== "results" || !records.length;
    scroller.scrollTop = 0;
  }

  function copyAll() {
    if (!records.length) return;
    void ui.copy(formatRecords(records, format), `${plural(records.length, "synthetic test fixture")} copied`);
  }

  function openExport() {
    if (!records.length) return;
    const choices: { type: ExportType; label: string; detail: string }[] = [
      { type: "txt", label: "Text (.txt)", detail: "number | MM/YY | CVV per line" },
      { type: "csv", label: "CSV (.csv)", detail: "number,MM,YY,CVV per line" },
      { type: "json", label: "JSON (.json)", detail: "Records with synthetic: true" },
    ];
    ui.sheets.open({
      title: "Export fixtures",
      description: `${plural(records.length, "synthetic test fixture")}. The file is created on this device and opened in the share sheet so you can save it or send it to an app.`,
      content: [
        h(
          "div",
          { class: "option-list" },
          ...choices.map((choice) =>
            h(
              "button",
              {
                type: "button",
                class: "option",
                "data-export": choice.type,
                onClick: async (event: Event) => {
                  const dialog = (event.currentTarget as HTMLElement).closest("dialog");
                  dialog?.close();
                  await ui.exportFile(fixtureExport(records, choice.type), "Synthetic test fixtures exported");
                },
              },
              icon(Braces),
              h("span", { class: "option-text" }, h("strong", {}, choice.label), h("span", {}, choice.detail)),
            ),
          ),
        ),
      ],
    });
  }

  async function clearResults() {
    if (!records.length) return;
    const confirmed = await ui.sheets.confirm({
      title: "Clear generated fixtures?",
      message: `${plural(records.length, "fixture")} will be removed from this screen. Builder settings are kept.`,
      confirmLabel: "Clear",
      destructive: true,
    });
    if (!confirmed) return;
    records = [];
    generationMs = 0;
    renderResults();
    showView("builder");
    ui.toast("Test fixtures cleared");
  }

  // Inputs update state live; selects and toggles use change events.
  for (const control of [prefixInput, cvvInput, quantityInput])
    control.addEventListener("input", () => {
      touched = true;
      sync();
    });
  for (const control of [networkSelect, monthSelect, yearSelect])
    control.addEventListener("change", () => {
      touched = true;
      sync();
    });
  formatSelect.addEventListener("change", () => {
    format = formatSelect.value as OutputFormat;
  });
  for (const control of [prefixInput, cvvInput, quantityInput])
    control.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        control.blur();
      }
    });

  sync();
  renderResults();
  showView("builder");

  return {
    root,
    handleBack() {
      if (view === "results") {
        showView("builder");
        return true;
      }
      return false;
    },
    reselect() {
      scroller.scrollTo({ top: 0, behavior: scrollBehavior() });
    },
  };
}

export const generatorTool: ToolDefinition = {
  id: "generator",
  navLabel: "Generator",
  title: "Generator",
  description: "Build synthetic, Luhn-valid payment test fixtures on this device.",
  icon: Zap,
  network: "none",
  create: createGeneratorScreen,
};
