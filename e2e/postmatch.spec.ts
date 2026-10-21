import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { captureDownload, createCareer, finishAuctionWithAssistant, quietPrefs } from './helpers';

const SHOTS = process.env.SHOTS_DIR;
const shot = async (page: Page, name: string) => SHOTS && page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: false });

/** PNG width and height from the IHDR chunk. */
function pngSize(buf: Buffer) {
  expect(buf.subarray(1, 4).toString('ascii')).toBe('PNG');
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

test.beforeEach(async ({ page }) => quietPrefs(page));

test('post-match centre: report, refresh consistency and PNG posters in every format', async ({ page }) => {
  test.setTimeout(400_000);
  const cid = await createCareer(page, { club: 'Sunrisers Hyderabad', manager: 'Poster Test' });
  await finishAuctionWithAssistant(page, cid);
  await page.goto(`/c/${cid}`);
  await page.getByRole('banner').getByRole('button', { name: /Start season/ }).click();
  await expect(page.getByText('Next chapter').or(page.getByText('Match day')).first()).toBeVisible({ timeout: 60_000 });
  for (let i = 0; i < 3 && !page.url().endsWith('/match'); i++) {
    await page.getByRole('banner').getByRole('button', { name: /^(Continue|Play match)/ }).first().click();
    await page.waitForTimeout(2500);
  }
  await expect(page).toHaveURL(/\/match$/, { timeout: 60_000 });
  await page.getByRole('button', { name: 'Quick simulate' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Simulate' }).click();

  // The match lands in the Post-Match Centre.
  await expect(page.getByRole('button', { name: /Export match PNG/ })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(/won by|tied|super over/i).first()).toBeVisible();
  await expect(page.getByText('Player of the match').first()).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Scorecards' })).toBeVisible();
  await expect(page.getByRole('alert').filter({ hasText: 'did not pass validation' })).toHaveCount(0);
  await shot(page, 'pm-hero');
  const before = await page.locator('main').innerText();

  // Reopening after a refresh reproduces the same report.
  await page.reload();
  await expect(page.getByRole('button', { name: /Export match PNG/ })).toBeVisible();
  expect(await page.locator('main').innerText()).toBe(before);
  for (const id of ['scorecards', 'moments', 'analytics', 'impact']) {
    await page.locator(`#${id}`).scrollIntoViewIfNeeded();
    await shot(page, `pm-${id}`);
  }

  // Poster studio: every format exports a real PNG at the exact size.
  await page.getByRole('button', { name: /Export match PNG/ }).click();
  const studio = page.getByRole('dialog', { name: 'Match Poster Studio' });
  await expect(studio.getByRole('img', { name: /Poster preview/ })).toBeVisible({ timeout: 30_000 });
  const formats: [string, number, number][] = [['portrait', 1080, 1350], ['story', 1080, 1920], ['square', 1080, 1080], ['landscape', 1920, 1080]];
  const templates = ['Broadcast', 'Editorial', 'Minimal'];
  for (const [i, [fmt, w, h]] of formats.entries()) {
    await studio.getByRole('combobox').selectOption(fmt);
    await studio.getByRole('radio', { name: templates[i % 3] }).click();
    if (i === 1) await studio.getByRole('radio', { name: 'Extended' }).click();
    if (i === 2) await studio.getByRole('radio', { name: 'Winning team' }).click();
    await page.waitForTimeout(500);
    const file = await captureDownload(page, () => studio.getByRole('button', { name: /Export PNG/ }).click());
    expect(file.name).toMatch(/^kurciv-ipl-2027-\d{4}-[a-z0-9-]+-vs-[a-z0-9-]+(-story|-square|-landscape)?\.png$/);
    expect(pngSize(file.bytes)).toEqual({ w, h });
    expect(file.bytes.length).toBeGreaterThan(30_000);
    if (SHOTS) fs.writeFileSync(path.join(SHOTS, `poster-${fmt}-${templates[i % 3].toLowerCase()}.png`), file.bytes);
  }
  await shot(page, 'pm-studio');
  await studio.getByRole('button', { name: 'Close dialog' }).click();

  // Exporting never changes the canonical match.
  await page.reload();
  await expect(page.getByRole('button', { name: /Export match PNG/ })).toBeVisible();
  expect(await page.locator('main').innerText()).toBe(before);

  // Reachable from the fixture list and the match archive.
  await page.goto(`/c/${cid}/fixtures`);
  await page.getByRole('link', { name: 'Match report' }).first().click();
  await expect(page.getByRole('button', { name: /Export match PNG/ })).toBeVisible();
  await page.goto(`/c/${cid}/history`);
  await page.getByRole('tab', { name: 'Match archive' }).click();
  await expect(page.locator('a[href*="/fixtures/"]').first()).toBeVisible();
});
