import { expect, test } from '@playwright/test';
import { captureDownload, createCareer, quietPrefs } from './helpers';

test.beforeEach(async ({ page }) => quietPrefs(page));

test('first launch: no sign-in, local-data notice, straight into the game', async ({ page, context }) => {
  await context.clearCookies();
  await page.addInitScript(() => localStorage.removeItem('kurciv.prefs.v1'));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Every season writes a legacy.' })).toBeVisible();
  await expect(page.getByText(/No account needed/)).toBeVisible();
  await expect(page.getByText(/sign in|password|log in/i)).toHaveCount(0);
  await page.getByRole('link', { name: /Enter your cricket world/ }).click();
  await expect(page).toHaveURL(/\/new$/);
});

test('a career survives a full reload and appears in the save slots', async ({ page }) => {
  const cid = await createCareer(page, { manager: 'Reload Test' });
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Next decisions' })).toBeVisible();
  await expect(page.getByText('Saved locally')).toBeVisible();
  await page.goto('/saves');
  await expect(page.getByRole('heading', { name: /Reload Test/ })).toBeVisible();
  await page.goto('/');
  await expect(page.getByRole('button', { name: /Continue RR/ })).toBeVisible();
  await page.getByRole('button', { name: /Continue RR/ }).click();
  await expect(page).toHaveURL(new RegExp(`/c/${cid}`));
});

test('multiple saves: rename, duplicate, export, import, delete', async ({ page }) => {
  await createCareer(page, { manager: 'Slot One', club: 'Chennai Super Kings' });
  await page.goto('/saves');
  const row = page.locator('li', { has: page.getByRole('heading', { name: /Slot One/ }) });

  // rename
  await row.getByRole('button', { name: 'Rename' }).click();
  await page.getByLabel('Name', { exact: true }).fill('My CSK dynasty');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('heading', { name: 'My CSK dynasty' })).toBeVisible();

  // duplicate
  await page.locator('li', { has: page.getByRole('heading', { name: 'My CSK dynasty' }) }).getByRole('button', { name: 'Duplicate' }).click();
  await expect(page.getByRole('heading', { name: 'My CSK dynasty (copy)' })).toBeVisible();

  // export (a gzip-compressed .kurciv file, or plain JSON where CompressionStream is unavailable)
  const file = await captureDownload(page, () =>
    page.locator('li', { has: page.getByRole('heading', { name: 'My CSK dynasty', exact: true }) }).getByRole('button', { name: 'Export backup' }).click());
  expect(file.name).toMatch(/\.(kurciv|json)$/);
  expect(file.bytes.length).toBeGreaterThan(1000);

  // import (staged: summary first, nothing written until confirmed)
  await page.locator('input[type=file]').setInputFiles({ name: file.name, mimeType: 'application/octet-stream', buffer: file.bytes });
  const dialog = page.getByRole('dialog', { name: 'Import a career' });
  await expect(dialog.getByText('Chennai Super Kings')).toBeVisible();
  await dialog.getByRole('button', { name: 'Import as new save' }).click();
  await expect(page.getByRole('heading', { name: 'My CSK dynasty (imported)' })).toBeVisible();

  // delete (with confirmation)
  await page.locator('li', { has: page.getByRole('heading', { name: 'My CSK dynasty (copy)' }) }).getByRole('button', { name: 'Delete' }).click();
  await page.getByRole('button', { name: 'Delete permanently' }).click();
  await expect(page.getByRole('heading', { name: 'My CSK dynasty (copy)' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'My CSK dynasty', exact: true })).toBeVisible();
});

test('invalid and damaged imports are rejected without touching existing saves', async ({ page }) => {
  await page.goto('/saves');
  const before = await page.locator('main li, ul.grid > li').count();
  await page.locator('input[type=file]').setInputFiles({ name: 'evil.json', mimeType: 'application/json', buffer: Buffer.from('{"hello": "<script>alert(1)</script>"}') });
  const dialog = page.getByRole('dialog', { name: 'Import a career' });
  await expect(dialog.getByText(/can.t be imported/)).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Import as new save' })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Cancel' }).click();

  await page.locator('input[type=file]').setInputFiles({ name: 'broken.kurciv', mimeType: 'application/octet-stream', buffer: Buffer.from([0x1f, 0x8b, 0x00, 0x01, 0x02]) });
  await expect(page.getByRole('dialog', { name: 'Import a career' }).getByText(/could not be read/)).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
  expect(await page.locator('main li, ul.grid > li').count()).toBe(before);
});
