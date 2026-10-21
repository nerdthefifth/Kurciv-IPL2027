import { expect, type Page } from '@playwright/test';

/** Per-device preferences used in tests: no image fetching, no large-bid prompt, notice seen. */
export async function quietPrefs(page: Page, extra: Record<string, unknown> = {}) {
  await page.addInitScript((extra) => {
    if (!localStorage.getItem('kurciv.prefs.v1')) {
      localStorage.setItem('kurciv.prefs.v1', JSON.stringify({ images: false, largeBidConfirm: null, seenLocalDataNotice: true, sound: false, ...extra }));
    }
  }, extra);
}

/** Walks the career creation stepper and waits for the clubhouse. Returns the career id. */
export async function createCareer(page: Page, opts: { club?: string; manager?: string; league?: string } = {}): Promise<string> {
  await page.goto('/new');
  await expect(page.getByRole('heading', { name: 'Choose your competition' })).toBeVisible();
  if (opts.league) await page.getByRole('button', { name: new RegExp(opts.league) }).first().click();
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: new RegExp(opts.club ?? 'Rajasthan Royals') }).first().click();
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByPlaceholder('How the press will know you').fill(opts.manager ?? 'E2E Manager');
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByRole('heading', { name: 'Ready to begin' })).toBeVisible();
  await page.getByRole('button', { name: 'Begin career' }).click();
  await page.waitForURL(/\/c\/[0-9a-f-]+$/, { timeout: 180_000 });
  await expect(page.getByRole('heading', { name: 'Next decisions' })).toBeVisible({ timeout: 60_000 });
  return page.url().split('/c/')[1];
}

/** Lets the assistant finish the user's auction and lands on the summary. */
export async function finishAuctionWithAssistant(page: Page, cid: string) {
  await page.goto(`/c/${cid}/auction`);
  await expect(page.getByRole('heading', { name: 'The room is set.' })).toBeVisible();
  await page.getByRole('button', { name: 'Let my assistant run it' }).click();
  await expect(page.getByRole('heading', { name: 'The hammer falls for the last time.' })).toBeVisible({ timeout: 180_000 });
}

export async function noHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, 'page should not scroll horizontally').toBeLessThanOrEqual(1);
}

/**
 * Captures a file the app hands to the browser's download mechanism (an <a download> pointing
 * at a Blob URL) without going through the browser download manager, which is unreliable under
 * automation in Edge. Returns the exact filename and bytes the user would have received.
 */
export async function captureDownload(page: Page, trigger: () => Promise<unknown>): Promise<{ name: string; bytes: Buffer }> {
  await page.evaluate(() => {
    const w = window as any;
    w.__kurcivDownload = null;
    if (w.__kurcivHooked) return;
    w.__kurcivHooked = true;
    const orig = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
      if (this.download && this.href.startsWith('blob:')) {
        fetch(this.href).then((r) => r.arrayBuffer()).then((buf) => {
          let s = '';
          const b = new Uint8Array(buf);
          for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
          w.__kurcivDownload = { name: this.download, data: btoa(s) };
        });
        return;
      }
      return orig.call(this);
    };
  });
  await trigger();
  const handle = await page.waitForFunction(() => (window as any).__kurcivDownload, undefined, { timeout: 120_000 });
  const { name, data } = (await handle.jsonValue()) as { name: string; data: string };
  return { name, bytes: Buffer.from(data, 'base64') };
}
