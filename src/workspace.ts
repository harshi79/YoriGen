import { validateBin } from './bin';
import { mountSorterPanel, sorterMarkup } from './sorter-panel';
import { checkApiStatus, formatMetadata, lookupBin, LookupError, LookupHistory, metadataEntries, type BinMetadata } from './guison';
type Tab = 'generator' | 'lookup' | 'sorter' | 'settings';
interface WorkspaceServices {
  icon: (name: string, cls?: string) => string;
  refreshIcons: () => void;
  toast: (message: string, kind?: 'ok' | 'error') => void;
  copy: (text: string, message: string) => Promise<void>;
  setTheme: (theme: 'light' | 'dark') => void;
}
export const tabsMarkup = `<div class="workspace-tabs" role="tablist" aria-label="Developer tools">
  <button type="button" id="tab-generator" role="tab" aria-controls="panel-generator" aria-selected="true" tabindex="0"><i data-lucide="zap" aria-hidden="true"></i>Generator<span class="tab-key">01</span></button>
  <button type="button" id="tab-lookup" role="tab" aria-controls="panel-lookup" aria-selected="false" tabindex="-1"><i data-lucide="fingerprint" aria-hidden="true"></i>BIN Lookup<span class="tab-key">02</span></button>
  <button type="button" id="tab-sorter" role="tab" aria-controls="panel-sorter" aria-selected="false" tabindex="-1"><i data-lucide="list-filter" aria-hidden="true"></i>Card Sorter<span class="tab-key">03</span></button>
  <button type="button" id="tab-settings" role="tab" aria-controls="panel-settings" aria-selected="false" tabindex="-1"><i data-lucide="sliders-horizontal" aria-hidden="true"></i>Settings<span class="tab-key">04</span></button>
  <span class="tabs-status"><span class="status-dot"></span> A WORKSPACE FOR TESTING, NOT TRANSACTING</span>
</div>`;
export const extraPanelsMarkup = `
<section id="panel-lookup" role="tabpanel" aria-labelledby="tab-lookup" tabindex="0" hidden>
  <div class="lookup-layout">
    <div class="lookup-sidebar">
      <section class="panel"><div class="panel-heading"><div><i data-lucide="fingerprint" aria-hidden="true"></i><h2>Look up a prefix</h2></div><span class="tiny-badge">METADATA ONLY</span></div>
        <form id="lookup-form" novalidate>
          <div class="field"><label for="lookup-bin">BIN / IIN to look up</label><div class="input-with-icon"><i data-lucide="fingerprint" aria-hidden="true"></i><input id="lookup-bin" type="text" inputmode="numeric" autocomplete="off" placeholder="e.g. 45717360" aria-describedby="lookup-hint lookup-error"/><span class="input-end">6–8 digits</span></div><p class="hint" id="lookup-hint">Prefix only. Complete card numbers are rejected, never shortened or sent.</p></div>
          <div class="lookup-consent"><i data-lucide="arrow-up-right" aria-hidden="true"></i><p>Lookup sends <strong>only this prefix</strong> to Guison. No generated cards, CVVs or expiry dates are shared. Your IP is visible to the service.</p></div>
          <p id="lookup-error" class="error" role="alert" hidden></p>
          <button class="generate-button" id="lookup-submit" type="submit"><i data-lucide="fingerprint" aria-hidden="true"></i>Lookup metadata<i data-lucide="arrow-right" aria-hidden="true"></i></button>
          <p class="lookup-service-note">Powered by Guison · No API key required</p>
        </form>
      </section>
      <section class="panel recent-panel" aria-labelledby="recent-title"><div class="panel-heading"><div><i data-lucide="layers" aria-hidden="true"></i><h2 id="recent-title">Recent lookups</h2><span class="count-badge" id="history-count">0</span></div></div><div id="lookup-history"></div><p class="history-note">This page session only · Up to 10 prefixes. Cleared on reload. Click an entry to view it offline.</p></section>
      <div class="lookup-reassurance"><i data-lucide="shield-check" aria-hidden="true"></i><p><strong>Context, not verification.</strong> BIN metadata describes an issuing range, not an account, balance or card status.</p></div>
    </div>
    <section class="panel metadata-panel" aria-labelledby="metadata-title">
      <div class="panel-heading"><div><i data-lucide="braces" aria-hidden="true"></i><h2 id="metadata-title">BIN metadata</h2></div><span class="tiny-badge" id="metadata-source">GUISON API</span></div>
      <div class="metadata-banner"><i data-lucide="info" aria-hidden="true"></i><span>RANGE METADATA ONLY — NOT CARD VERIFICATION</span><span class="banner-dot"></span></div>
      <div class="metadata-toolbar"><p id="lookup-result-status" role="status" aria-live="polite">Waiting for a prefix</p><button type="button" class="subtle-button" id="lookup-clear" aria-label="Clear lookup"><i data-lucide="trash-2" aria-hidden="true"></i><span>Clear</span></button></div>
      <div id="metadata-content"></div>
      <div class="metadata-footer"><span>Unknown means not supplied. Never inferred.</span><div><button type="button" class="secondary-button" id="copy-metadata" disabled><i data-lucide="copy" aria-hidden="true"></i>Copy metadata</button><button type="button" class="secondary-button" id="copy-metadata-json" disabled><i data-lucide="braces" aria-hidden="true"></i>Copy JSON</button></div></div>
    </section>
  </div>
  <p class="attribution">Metadata source: Guison · <a href="https://github.com/venelinkochev/bin-list-data" target="_blank" rel="noopener noreferrer">venelinkochev/bin-list-data</a> · CC BY 4.0. Community data may be incomplete or outdated. Not authoritative payment information.</p>
</section>
${sorterMarkup}
<section id="panel-settings" role="tabpanel" aria-labelledby="tab-settings" tabindex="0" hidden>
  <div class="settings-grid">
    <section class="panel settings-panel"><div class="panel-heading"><div><i data-lucide="sliders-horizontal" aria-hidden="true"></i><h2>Workspace preferences</h2></div><span class="step-tag">LOCAL</span></div>
      <div class="setting-row"><div><h3>Appearance</h3><p>A quieter workspace, day or night. Only your theme preference is saved.</p></div><div class="select-wrap no-icon"><label class="sr-only" for="settings-theme">Theme</label><select id="settings-theme"><option value="dark">Dark</option><option value="light">Light</option></select><i data-lucide="chevron-down" aria-hidden="true"></i></div></div>
      <div class="setting-row history-setting"><div><h3>Session lookup history</h3><p><span id="settings-history-count">0</span> recent prefixes in page memory. Never saved to browser storage.</p></div><button type="button" class="secondary-button" id="clear-history" disabled><i data-lucide="trash-2" aria-hidden="true"></i>Clear history</button></div>
      <div class="settings-footnote"><i data-lucide="lock-keyhole" aria-hidden="true"></i>No sign-in. No tracking. No saved card data.</div>
    </section>
    <section class="panel settings-panel"><div class="panel-heading"><div><i data-lucide="arrow-up-right" aria-hidden="true"></i><h2>Metadata API</h2></div><span class="tiny-badge">OPTIONAL</span></div>
      <div class="api-card"><div class="api-provider"><span class="api-mark">G</span><div><h3>Guison</h3><p>guison-api.onrender.com</p></div><span id="api-status-badge" class="api-status">Not checked</span></div><p id="api-status" role="status" aria-live="polite">No requests made. Status checks are manual.</p><button type="button" id="check-api" class="secondary-button"><i data-lucide="rotate-ccw" aria-hidden="true"></i>Check API status</button><p class="hint">Checks dataset readiness at /readyz, without sending a BIN. Availability is independent of the local generator.</p></div>
    </section>
    <section class="panel about-panel"><div class="panel-heading"><div><i data-lucide="shield-check" aria-hidden="true"></i><h2>Purpose-built for development</h2></div><span class="tiny-badge">ORIGEN</span></div><div class="about-grid"><article><i data-lucide="terminal" aria-hidden="true"></i><h3>Local synthetic fixtures</h3><p>Generation runs in your browser. A Luhn-compatible number only passes a mathematical format check; it does not establish an account’s existence.</p></article><article><i data-lucide="fingerprint" aria-hidden="true"></i><h3>Prefix metadata only</h3><p>Only explicit lookups of 6–8 digits reach Guison. No card numbers, CVVs or expiry dates are sent. Returned links and logos are never loaded automatically.</p></article><article><i data-lucide="lock-keyhole" aria-hidden="true"></i><h3>Firm boundaries</h3><p>No payments, transactions, authorizations, balance checks, active-card checks, merchant testing, scraping or real account data.</p></article></div><div class="about-warning">TEST DATA ONLY — NOT REAL PAYMENT CARDS<p>Synthetic numbers may coincide with real numbers. Never use them in live payment systems. Use your provider’s official fixtures for gateway sandbox flows. Metadata is not verification.</p></div></section>
  </div>
</section>`;

export function mountWorkspace(services: WorkspaceServices): { activeTab: () => Tab; focusSorter: () => void } {
  const { icon, refreshIcons, toast, copy, setTheme } = services;
  const $ = <T extends HTMLElement>(id: string) => document.querySelector<T>(id)!;
  let active: Tab = 'generator';
  const tabs: Tab[] = ['generator', 'lookup', 'sorter', 'settings'];
  function selectTab(tab: Tab, focus = false) {
    active = tab;
    for (const id of tabs) {
      const button = $<HTMLButtonElement>(`#tab-${id}`);
      button.setAttribute('aria-selected', String(id === tab)); button.tabIndex = id === tab ? 0 : -1;
      $(`#panel-${id}`).hidden = id !== tab;
    }
    const genLink = $('#generator-link');
    genLink.classList.toggle('nav-active', tab === 'generator');
    if (tab === 'generator') genLink.setAttribute('aria-current', 'page');
    else genLink.removeAttribute('aria-current');
    if (focus) $(`#tab-${tab}`).focus();
    const headings = { generator: ['Payment card generator', 'Realistic fixtures. Zero real-world stakes. Build better payment experiences.'], lookup: ['A little context for your BIN', 'Understand the prefix. Never verify the card. Metadata for your development workflow.'], sorter: ['Sort your test data', 'Clean, dedupe and order pasted test records locally. Nothing is uploaded, verified or looked up.'], settings: ['Make yourself at home', 'A few preferences. Transparent connections. Clear boundaries.'] };
    $('h1').textContent = headings[tab][0];
    const dot = document.createElement('span'); dot.textContent = '.'; $('h1').append(dot);
    $('.intro p').textContent = headings[tab][1];
  }
  for (const tab of tabs) {
    $(`#tab-${tab}`).addEventListener('click', () => selectTab(tab));
    $(`#tab-${tab}`).addEventListener('keydown', event => {
      let index = tabs.indexOf(tab);
      if (event.key === 'ArrowRight') index = (index + 1) % tabs.length;
      else if (event.key === 'ArrowLeft') index = (index + tabs.length - 1) % tabs.length;
      else if (event.key === 'Home') index = 0;
      else if (event.key === 'End') index = tabs.length - 1;
      else return;
      event.preventDefault(); selectTab(tabs[index], true);
    });
  }
  $('#generator-link').addEventListener('click', event => { event.preventDefault(); selectTab('generator', true); });
  $('#settings-theme').addEventListener('change', () => setTheme($<HTMLSelectElement>('#settings-theme').value as 'light' | 'dark'));
  const history = new LookupHistory();
  let current: BinMetadata | null = null;
  let pending: AbortController | null = null;
  let statusCheck: AbortController | null = null;
  let statusRevision = 0;
  function updateStatus(label: string, detail: string, state = 'neutral') {
    $('#api-status-badge').textContent = label; $('#api-status-badge').dataset.state = state;
    $('#api-status').textContent = detail;
  }
  function copies(enabled: boolean) { $<HTMLButtonElement>('#copy-metadata').disabled = !enabled; $<HTMLButtonElement>('#copy-metadata-json').disabled = !enabled; }
  function renderEmpty() {
    current = null; copies(false);
    $('#metadata-source').textContent = 'GUISON API';
    $('#metadata-content').innerHTML = `<div class="lookup-empty"><div class="lookup-symbol">${icon('fingerprint')}</div><span class="empty-eyebrow">JUST THE FIRST FEW DIGITS</span><h3>Know the range. Not the account.</h3><p>Enter a 6–8 digit prefix to explore available network, issuer and country metadata.</p><div class="empty-code"><span>GET</span> /v1/bin/{prefix}</div><span class="lookup-empty-note">Nothing is sent until you choose Lookup.</span></div>`;
    refreshIcons();
  }
  function renderMetadata(data: BinMetadata, cached = false) {
    current = data; copies(true);
    $('#metadata-source').textContent = cached ? 'SESSION SNAPSHOT' : 'GUISON API';
    $('#metadata-content').innerHTML = '<dl class="metadata-grid"></dl><details class="response-details"><summary>Full metadata response <span>JSON</span></summary><pre tabindex="0" aria-label="BIN metadata JSON"></pre></details>';
    for (const [label, value] of metadataEntries(data)) {
      const item = document.createElement('div'); const dt = document.createElement('dt'); const dd = document.createElement('dd');
      dt.textContent = label; dd.textContent = value; if (value === 'Unknown') dd.className = 'unknown';
      item.append(dt, dd); $('.metadata-grid').append(item);
    }
    $('.response-details pre').textContent = formatMetadata(data, 'json');
    $('#lookup-result-status').textContent = cached ? `Viewing ${data.bin} · saved in this session, not refreshed` : `Metadata returned for ${data.bin} · not card verification`;
  }
  function renderHistory() {
    $('#history-count').textContent = String(history.items.length);
    $('#settings-history-count').textContent = String(history.items.length);
    $<HTMLButtonElement>('#clear-history').disabled = !history.items.length;
    $('#lookup-history').replaceChildren();
    if (!history.items.length) $('#lookup-history').innerHTML = '<p class="history-empty">No lookups yet. A clean slate.</p>';
    for (const entry of history.items) {
      const button = document.createElement('button'); button.className = 'history-item'; button.type = 'button';
      const bin = document.createElement('strong'); bin.textContent = entry.metadata.bin;
      const scheme = document.createElement('span'); scheme.textContent = entry.metadata.scheme ?? 'Unknown network';
      const time = document.createElement('time'); time.dateTime = entry.lookedUpAt; time.textContent = new Date(entry.lookedUpAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      button.setAttribute('aria-label', `View recent lookup ${entry.metadata.bin}`); button.append(bin, scheme, time);
      button.addEventListener('click', () => { cancelLookup(); hideError(); $<HTMLInputElement>('#lookup-bin').value = entry.metadata.bin; renderMetadata(entry.metadata, true); });
      $('#lookup-history').append(button);
    }
  }
  function hideError() { $('#lookup-error').hidden = true; $('#lookup-bin').removeAttribute('aria-invalid'); }
  function setLoading(loading: boolean) {
    $<HTMLButtonElement>('#lookup-submit').disabled = loading;
    $<HTMLInputElement>('#lookup-bin').disabled = loading;
    $('#metadata-content').setAttribute('aria-busy', String(loading));
    $('#lookup-submit').innerHTML = loading ? `${icon('loader-circle', 'spin')} Looking up prefix…` : `${icon('fingerprint')} Lookup metadata ${icon('arrow-right')}`;
    refreshIcons();
  }
  function cancelLookup() { if (pending) { pending.abort(); pending = null; ++statusRevision; updateStatus('Cancelled', 'Lookup cancelled. No current availability check.'); } setLoading(false); }
  $('#lookup-form').addEventListener('submit', async event => {
    event.preventDefault(); if (pending) return; hideError();
    const bin = $<HTMLInputElement>('#lookup-bin').value;
    try { validateBin(bin); } catch (error) { $('#lookup-error').textContent = (error as Error).message; $('#lookup-error').hidden = false; $('#lookup-bin').setAttribute('aria-invalid', 'true'); $('#lookup-bin').focus(); return; }
    const controller = new AbortController(); pending = controller;
    const revision = ++statusRevision;
    renderEmpty(); setLoading(true); updateStatus('Checking', 'Waiting for a metadata response from Guison.');
    $('#lookup-result-status').textContent = 'Requesting prefix metadata… First requests can take a moment.';
    try {
      const data = await lookupBin(bin, controller.signal);
      if (pending !== controller) return;
      history.add(data); renderMetadata(data); renderHistory();
      if (revision === statusRevision) updateStatus('Available', 'Last metadata request succeeded. Status is not continuously monitored.', 'good');
      toast('BIN metadata loaded. No card or account was verified.');
    } catch (error) {
      if (pending !== controller) return;
      if (error instanceof LookupError && error.code === 'cancelled') return;
      $('#lookup-error').textContent = (error as Error).message; $('#lookup-error').hidden = false;
      $('#lookup-result-status').textContent = error instanceof LookupError && error.code === 'not_found' ? `No metadata found for ${bin}` : 'Lookup failed. Local generation is still available.';
      $('#metadata-content').innerHTML = `<div class="lookup-empty lookup-failed">${icon('info')}<h3>No metadata to display.</h3><p>Review the message beside the form. You can retry or keep building with local fixtures.</p></div>`;
      if (revision === statusRevision) updateStatus(error instanceof LookupError && error.code === 'not_found' ? 'Reachable' : 'Unavailable', (error as Error).message, 'warning');
    } finally { if (pending === controller) { pending = null; setLoading(false); } }
  });
  $('#lookup-bin').addEventListener('input', hideError);
  $('#lookup-clear').addEventListener('click', () => { cancelLookup(); hideError(); $<HTMLInputElement>('#lookup-bin').value = ''; renderEmpty(); $('#lookup-result-status').textContent = 'Waiting for a prefix'; $('#lookup-bin').focus(); toast('Lookup cleared. Recent lookups remain in this page session.'); });
  $('#copy-metadata').addEventListener('click', () => { if (current) void copy(formatMetadata(current, 'text'), 'BIN metadata copied'); });
  $('#copy-metadata-json').addEventListener('click', () => { if (current) void copy(formatMetadata(current, 'json'), 'BIN metadata copied as JSON'); });
  $('#clear-history').addEventListener('click', () => { cancelLookup(); history.clear(); renderHistory(); toast('Session lookup history cleared'); });
  $('#check-api').addEventListener('click', async () => {
    if (statusCheck) return;
    const controller = new AbortController(); statusCheck = controller; const revision = ++statusRevision;
    $<HTMLButtonElement>('#check-api').disabled = true;
    updateStatus('Checking', 'Checking Guison dataset readiness. No BIN is sent.');
    try { await checkApiStatus(controller.signal); if (revision === statusRevision) updateStatus('Ready', 'The last manual check returned ready. Local generation works independently.', 'good'); }
    catch (error) { if (revision === statusRevision) updateStatus('Unavailable', (error as Error).message, 'warning'); }
    finally { statusCheck = null; $<HTMLButtonElement>('#check-api').disabled = false; }
  });
  const sorter = mountSorterPanel({ icon, refreshIcons, toast, copy, isActive: () => active === 'sorter' });
  renderEmpty(); renderHistory();
  return { activeTab: () => active, focusSorter: sorter.focusInput };
}
