// scripts/browser-smoke.mjs — minimal Playwright check for CI.
//
// Playwright is imported dynamically so this file has no hard dependency and
// package.json stays devDependency-free. Set PLAYWRIGHT_MODULE to override the
// module specifier when Playwright lives out of tree. A missing install gives
// a clear error instead of an unhandled crash.

const TARGET_URL = process.env.SMOKE_URL || 'http://127.0.0.1:5199';
const MODULE = process.env.PLAYWRIGHT_MODULE || 'playwright';

async function main() {
  let chromium;
  try {
    ({ chromium } = await import(MODULE));
  } catch (err) {
    console.error(
      'browser-smoke: Playwright is not available.\n' +
      '  CI installs it with `npx --yes playwright install chromium` plus a local module.\n' +
      '  Set PLAYWRIGHT_MODULE to a resolvable specifier if it lives elsewhere.\n' +
      `  Import error: ${err.message}`
    );
    process.exitCode = 1;
    return;
  }

  const failures = [];
  const check = (ok, label) => {
    if (ok) console.log(`  ✓ ${label}`);
    else { failures.push(label); console.error(`  ✗ ${label}`); }
  };

  let browser;
  try {
    browser = await chromium.launch();
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));

    await page.goto(TARGET_URL, { waitUntil: 'load' });
    await page.waitForFunction(() => !!window.AetherFlow, undefined, { timeout: 15000 });
    check(true, 'window.AetherFlow is exposed');

    const ledgerLen = await page.evaluate(() => window.AetherFlow.getLedger().length);
    check(ledgerLen === 0, 'Egress Ledger is empty (0 outbound attempts)');

    // Drop a minimal CSV through the window drop handler (DataTransfer + File).
    const CSV = 'name,amount\nSMOKE_UNIQUE_VALUE_42,7\nBob,17\n';
    await page.evaluate((text) => {
      const file = new File([text], 'smoke.csv', { type: 'text/csv' });
      const dt = new DataTransfer();
      dt.items.add(file);
      window.dispatchEvent(new DragEvent('drop', {
        dataTransfer: dt, bubbles: true, cancelable: true,
      }));
    }, CSV);

    await page.waitForFunction(
      () => document.body.innerText.includes('SMOKE_UNIQUE_VALUE_42'),
      undefined,
      { timeout: 15000 }
    );
    check(true, 'dropped CSV renders its rows');

    check(errors.length === 0,
      `no uncaught page errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
  } catch (err) {
    check(false, `browser smoke threw: ${err.message}`);
  } finally {
    if (browser) await browser.close();
  }

  if (failures.length) {
    console.error(`\nBROWSER SMOKE FAILED — ${failures.length} check(s) failed.`);
    process.exitCode = 1;
  } else {
    console.log('\nbrowser-smoke: all checks passed.');
  }
}

main().catch((err) => {
  console.error(`browser-smoke: unexpected failure: ${err.message}`);
  process.exitCode = 1;
});
