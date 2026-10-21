import { expect, test } from '@playwright/test';
import { createCareer, noHorizontalOverflow, quietPrefs } from './helpers';

test.beforeEach(async ({ page }) => quietPrefs(page));

test('phone layout: no horizontal scrolling and bottom navigation works', async ({ page }) => {
  await page.goto('/');
  await noHorizontalOverflow(page);
  const cid = await createCareer(page, { manager: 'Pocket' });
  await noHorizontalOverflow(page);
  const quick = page.getByRole('navigation', { name: 'Quick navigation' });
  await expect(quick).toBeVisible();
  await quick.getByRole('link', { name: 'Auction' }).click();
  await expect(page.getByRole('heading', { name: 'The room is set.' })).toBeVisible();
  await noHorizontalOverflow(page);
  await page.getByRole('button', { name: 'Begin the auction' }).click();
  await expect(page.getByRole('button', { name: /^Bid ₹/ })).toBeVisible();
  await noHorizontalOverflow(page);
  await quick.getByRole('button', { name: 'More' }).click();
  await page.getByRole('link', { name: 'Save & Settings' }).click();
  await expect(page).toHaveURL(new RegExp(`/c/${cid}/settings`));
  await noHorizontalOverflow(page);
  await page.goto('/saves');
  await noHorizontalOverflow(page);
});
