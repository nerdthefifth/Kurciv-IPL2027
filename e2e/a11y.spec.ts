import { expect, test } from '@playwright/test';
import { createCareer, quietPrefs } from './helpers';

test.beforeEach(async ({ page }) => quietPrefs(page));

test('keyboard: skip link, focusable controls with accessible names, Escape closes dialogs', async ({ page }) => {
  const cid = await createCareer(page, { manager: 'Keys' });
  await page.goto(`/c/${cid}`);
  await expect(page.getByRole('heading', { name: 'Next decisions' })).toBeVisible();
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
  await page.keyboard.press('Enter');

  // Every button on the clubhouse has an accessible name.
  const unnamed = await page.locator('button').evaluateAll((els) => els.filter((b) => !(b.getAttribute('aria-label') || b.textContent?.trim() || b.getAttribute('title'))).length);
  expect(unnamed).toBe(0);

  // The notification centre opens and closes with the keyboard.
  await page.getByRole('button', { name: /Notifications/ }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: 'Notifications' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Notifications' })).toHaveCount(0);
});

test('turning animations off applies reduced motion everywhere', async ({ page }) => {
  const cid = await createCareer(page, { manager: 'Calm' });
  await page.goto(`/c/${cid}/settings`);
  await page.getByRole('switch', { name: 'Animations' }).click();
  await expect(page.locator('html')).toHaveClass(/reduced-motion/);
  await page.reload();
  await expect(page.locator('html')).toHaveClass(/reduced-motion/);
});

test('light theme can be selected and persists', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('radio', { name: 'Light' }).or(page.getByRole('button', { name: 'Light' })).first().click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});
