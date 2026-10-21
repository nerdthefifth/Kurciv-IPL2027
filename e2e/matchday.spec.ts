import { expect, test, type Page } from '@playwright/test';
import path from 'node:path';
import { quietPrefs, toMatchDay } from './helpers';

const SHOTS = process.env.SHOTS_DIR;
const shot = async (page: Page, name: string) => SHOTS && page.screenshot({ path: path.join(SHOTS, `${name}.png`) });

test.beforeEach(async ({ page }) => quietPrefs(page, { sidebarCollapsed: false }));

/** Ball count from the top strip ("12.3 / 20 ov"). */
async function legalBalls(page: Page): Promise<number> {
  const t = (await page.getByLabel('Score', { exact: true }).innerText()).match(/(\d+)\.(\d) \/ \d+ ov/);
  return t ? Number(t[1]) * 6 + Number(t[2]) : 0;
}
async function commentaryCount(page: Page) {
  return page.getByLabel(/^Commentary$/).locator('li').count();
}

/** Answer any pending decision with the default choice. */
async function answer(page: Page) {
  const panel = page.getByLabel('Tactical control centre');
  if (await panel.getByText('Decision · over').isVisible().catch(() => false)) {
    await panel.locator('button:not([disabled])', { hasText: /ctl \d+/ }).first().click();
    return true;
  }
  if (await panel.getByText('Decision · wicket').isVisible().catch(() => false)) {
    await panel.locator('button', { hasText: 'Next in order' }).click();
    return true;
  }
  if (await panel.getByText('Decision review system').isVisible().catch(() => false)) {
    await panel.getByRole('button', { name: 'Accept the decision' }).click();
    return true;
  }
  return false;
}

test('one-screen matchday: toss, ball-by-ball, play/pause, live tactics, decisions, viewports', async ({ page }) => {
  test.setTimeout(420_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await toMatchDay(page);
  await page.getByRole('button', { name: /Play live/ }).click();

  // Toss: call, genuine result, decision.
  const toss = page.getByRole('dialog', { name: 'The toss' });
  await expect(toss.getByText('Your call, captain.')).toBeVisible();
  await shot(page, 'md-toss-call');
  await toss.getByRole('button', { name: 'Heads' }).click();
  await expect(toss.getByText(/You called heads\. It’s (heads|tails)\./)).toBeVisible({ timeout: 10_000 });
  await expect(toss.getByRole('button', { name: /Bat first|Hear their decision/ }).first()).toBeVisible();
  const won = await toss.getByRole('button', { name: /Bat first/ }).isVisible();
  if (won) await toss.getByRole('button', { name: /Bowl first/ }).click();
  else await toss.getByRole('button', { name: 'Hear their decision' }).click();
  const outcome = page.getByRole('dialog', { name: 'Toss result' });
  await expect(outcome).toBeVisible();
  await outcome.getByRole('button', { name: 'To the middle' }).click();

  // Turn on manual incoming-batter choice.
  const panel = page.getByLabel('Tactical control centre');
  await panel.getByRole('tab', { name: 'Auto' }).click();
  await panel.getByRole('switch', { name: /Incoming batter/ }).click();
  await expect(panel.getByRole('switch', { name: /Incoming batter: you/ })).toBeVisible();

  // Ball-by-ball: exactly one delivery per press.
  for (let i = 0; i < 3; i++) {
    while (await answer(page)) await page.waitForTimeout(300);
    const before = await commentaryCount(page);
    await page.getByRole('button', { name: /^Next ball/ }).click();
    await expect.poll(() => commentaryCount(page), { timeout: 10_000 }).toBe(before + 1);
    await page.waitForTimeout(800);
    expect(await commentaryCount(page)).toBe(before + 1); // exactly one
    while (await answer(page)) await page.waitForTimeout(300);
  }
  await shot(page, 'md-1440');

  // No document scrolling at desktop sizes.
  for (const [w, h] of [[1366, 768], [1440, 900], [1920, 1080]]) {
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(400);
    const over = await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
    expect(over, `vertical overflow at ${w}x${h}`).toBeLessThanOrEqual(1);
    await expect(page.getByLabel('Match controls').getByRole('button', { name: /^(Play|Pause)/ })).toBeInViewport();
    await shot(page, `md-${w}x${h}`);
  }
  await page.setViewportSize({ width: 1440, height: 900 });

  // Continuous play, then pause: no duplicates, play stops.
  await page.getByRole('radio', { name: 'Fast' }).click();
  let plays = 0;
  let seenWicketChoice = false;
  for (let round = 0; round < 12 && plays < 4; round++) {
    if (await answer(page)) continue;
    const play = page.getByLabel('Match controls').getByRole('button', { name: /^Play/ });
    if (!(await play.isEnabled())) break;
    await play.click();
    plays++;
    await page.waitForTimeout(2500);
    // Change tactics while play runs: they apply between balls.
    const bowling = await panel.getByRole('tab', { name: 'Plan' }).isVisible();
    if (!bowling && (await panel.getByRole('tab', { name: 'Approach' }).isVisible())) {
      await panel.getByRole('tab', { name: 'Approach' }).click();
      await panel.getByRole('radio', { name: 'Aggressive' }).click();
    }
    if (await page.getByRole('button', { name: /^Pause/ }).isVisible()) await page.getByRole('button', { name: /^Pause/ }).click();
    await page.waitForTimeout(1500);
    const a = await legalBalls(page);
    await page.waitForTimeout(1500);
    expect(await legalBalls(page)).toBe(a); // paused means paused
    if (await panel.getByText('Decision · wicket').isVisible()) {
      seenWicketChoice = true;
      await shot(page, 'md-batter-choice');
      const options = panel.locator('li button');
      await options.last().click(); // send someone other than the default
    }
  }
  const seqs = await page.getByLabel(/^Commentary$/).locator('li span.num.w-8').allInnerTexts();
  expect(new Set(seqs.slice(0, 6)).size).toBe(Math.min(6, seqs.length)); // the latest balls are all distinct

  // Finish instantly through the same engine and open the report.
  while (await answer(page)) await page.waitForTimeout(300);
  await page.getByRole('button', { name: 'Sim match' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Simulate' }).click();
  await expect(page.getByRole('button', { name: /Confirm result/ })).toBeVisible({ timeout: 60_000 });
  await shot(page, 'md-complete');
  await page.getByRole('button', { name: /Confirm result/ }).click();
  await expect(page.getByRole('button', { name: /Export match PNG/ })).toBeVisible({ timeout: 60_000 });
  test.info().annotations.push({ type: 'wicket-choice-seen', description: String(seenWicketChoice) });
});
