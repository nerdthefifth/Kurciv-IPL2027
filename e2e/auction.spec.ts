import { expect, test } from '@playwright/test';
import { createCareer, finishAuctionWithAssistant, quietPrefs } from './helpers';

test.beforeEach(async ({ page }) => quietPrefs(page, { auctionSpeed: 1 }));

test('live auction: paced AI bidding, user bids, pause and recovery after reload', async ({ page }) => {
  const cid = await createCareer(page, { club: 'Kolkata Knight Riders', manager: 'Paddle' });
  await page.goto(`/c/${cid}/auction`);
  await expect(page.getByRole('heading', { name: 'The room is set.' })).toBeVisible();
  await page.getByRole('button', { name: 'Begin the auction' }).click();

  // The first lot is introduced before bidding opens: AI clubs do not bid instantly.
  await expect(page.getByText('Introducing')).toBeVisible();
  await expect(page.getByText(/Open for bids|Final call/)).toBeVisible({ timeout: 15_000 });

  // Bid as soon as we may; we either lead or get outbid by a real rival bid.
  const bid = page.getByRole('button', { name: /^Bid ₹/ });
  await expect(bid).toBeEnabled({ timeout: 15_000 });
  await bid.click();
  await page.getByRole('button', { name: /Pause/ }).click();
  await page.getByRole('tab', { name: /Bid history/ }).click();
  // Our bid is on record (we may since have been outbid by a real rival bid).
  await expect(page.locator('ol li').filter({ hasText: /^KKR/ }).first()).toBeVisible();

  // Note the lot and reload: the room comes back on the same lot, still paused.
  await expect(page.getByText('Paused')).toBeVisible();
  const lot = await lotNumber(page);
  await page.reload();
  await expect(page.getByText('Paused')).toBeVisible();
  expect(await lotNumber(page)).toBe(lot);

  // Leaving the room does not advance the clock, even when unpaused.
  await page.getByRole('button', { name: /Resume/ }).click();
  await page.goto(`/c/${cid}/squad`);
  const atLeave = lot;
  await page.waitForTimeout(4000);
  await page.goto(`/c/${cid}/auction`);
  expect(await lotNumber(page)).toBeLessThanOrEqual(atLeave + 2);
});

async function lotNumber(page: import('@playwright/test').Page): Promise<number> {
  await expect(page.getByText(/Lot\s*\d+\s*of/).first()).toBeVisible();
  const text = await page.locator('main').innerText();
  return Number(text.match(/Lot\s*(\d+)\s*of/)![1]);
}

test('assistant-completed auction respects roster rules and opens pre-season', async ({ page }) => {
  const cid = await createCareer(page, { club: 'Delhi Capitals', manager: 'Rules' });
  await finishAuctionWithAssistant(page, cid);
  await page.getByRole('tab', { name: 'Every franchise' }).click();
  await expect(page.getByText('Spent').first()).toBeVisible();
  await page.goto(`/c/${cid}/squad`);
  const header = await page.getByText(/\d+\/25 registered/).textContent();
  const [, n] = header!.match(/(\d+)\/25 registered/)!;
  const [, os] = header!.match(/(\d+)\/5 overseas/)!;
  expect(Number(n)).toBeLessThanOrEqual(25);
  expect(Number(n)).toBeGreaterThanOrEqual(18);
  expect(Number(os)).toBeLessThanOrEqual(5);
  await page.goto(`/c/${cid}`);
  await expect(page.getByRole('button', { name: /Start season/ }).first()).toBeVisible();
});

test('match integration: start the season and play a match to a recorded result', async ({ page }) => {
  const cid = await createCareer(page, { club: 'Punjab Kings', manager: 'Matchday' });
  await finishAuctionWithAssistant(page, cid);
  await page.goto(`/c/${cid}`);
  await page.getByRole('banner').getByRole('button', { name: /Start season/ }).click();
  await expect(page.getByText('Next chapter').or(page.getByText('Match day'))).toBeVisible({ timeout: 60_000 });
  // Continue until match day, then quick-simulate it.
  for (let i = 0; i < 3 && !page.url().endsWith('/match'); i++) {
    await page.getByRole('banner').getByRole('button', { name: /^(Continue|Play match)/ }).first().click();
    await page.waitForTimeout(2500);
  }
  await expect(page).toHaveURL(/\/match$/, { timeout: 60_000 });
  await page.getByRole('button', { name: 'Quick simulate' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Simulate' }).click();
  await expect(page.getByText(/won by|tied/i).first()).toBeVisible({ timeout: 60_000 });
  await page.goto(`/c/${cid}/fixtures`);
  await expect(page.getByText(/won by|tied/i).first()).toBeVisible({ timeout: 60_000 });
});
