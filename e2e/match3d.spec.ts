import { expect, test, type Page } from '@playwright/test';
import { quietPrefs, toMatchDay } from './helpers';

const SHOTS = process.env.SHOTS_DIR;

/** Answers whatever decision sheet is open (openers, bowler, batter, review) with the preselected choice. */
async function answerSheet(page: Page): Promise<boolean> {
  const dialog = page.getByRole('dialog').first();
  if (!(await dialog.isVisible().catch(() => false))) return false;
  const label = (await dialog.getAttribute('aria-label')) ?? '';
  if (/review/i.test(label)) {
    // Ask for the review, so the ball-tracking presentation runs.
    await dialog.getByRole('button', { name: /^review$/i }).click();
    return true;
  }
  if (/review result/i.test(label)) {
    await dialog.getByRole('button', { name: /continue/i }).click();
    return true;
  }
  const next = dialog.getByRole('button', { name: /^(next|start innings)$/i });
  if (await next.isEnabled()) await next.click();
  else {
    await dialog.locator('li button:not([disabled])').first().click();
    await next.click();
  }
  return true;
}

test('a full over plays in 3D, in step with the engine, without page scrolling', async ({ page }) => {
  test.setTimeout(480_000);
  await quietPrefs(page);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await toMatchDay(page);
  await page.getByRole('button', { name: /Play live/ }).click();

  // Toss
  await page.getByRole('button', { name: 'heads' }).click({ timeout: 30_000 });
  const start = page.getByRole('button', { name: /^start$/i });
  await start.click({ timeout: 30_000 });
  // Once seen intermittently: the toss screen stayed after START. Press again if so.
  await page.waitForTimeout(5000);
  if (await start.isVisible().catch(() => false)) await start.click();

  // The 3D view mounts (lazy chunk) with a WebGL canvas.
  const canvas = page.locator('[aria-label="3D match view"] canvas');
  await expect(canvas).toBeVisible({ timeout: 30_000 });
  const scrolls = await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
  expect(scrolls, 'match screen should not scroll vertically').toBeLessThanOrEqual(1);

  const hit = page.getByRole('button', { name: 'HIT' });
  let balls = 0;
  let checkedMidBall = false;
  const overDone = async () => /\((1\.0|1\.\d|[2-9]\.\d)\)/.test(await page.locator('header[aria-label="Scoreboard"]').innerText());
  for (let guard = 0; guard < 60 && !(await overDone()); guard++) {
    if (await answerSheet(page)) continue;
    await expect(hit).toBeEnabled({ timeout: 60_000 }).catch(() => undefined);
    if (await answerSheet(page)) continue;
    if (!(await hit.isEnabled())) continue;
    const before = await page.locator('header[aria-label="Scoreboard"]').innerText();
    await hit.click();
    if (!checkedMidBall) {
      // Mid-delivery: the picture is running and the score has not jumped ahead of it.
      const fps = await page.evaluate(() => new Promise<number>((res) => {
        let n = 0;
        const t0 = performance.now();
        const f = () => (performance.now() - t0 < 1500 ? (n++, requestAnimationFrame(f)) : res(n / 1.5));
        requestAnimationFrame(f);
      }));
      console.log(`frames per second during a delivery (Medium): ${fps.toFixed(1)}`);
      expect(await page.locator('header[aria-label="Scoreboard"]').innerText()).toBe(before);
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/3d-mid-delivery.png` });
      checkedMidBall = true;
    }
    await expect(hit).toBeEnabled({ timeout: 60_000 }).catch(() => undefined);
    balls++;
  }
  expect(await overDone(), 'a complete over (six legal balls) was played').toBe(true);
  expect(balls).toBeGreaterThanOrEqual(6);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/3d-after-over.png` });

  // The over strip and commentary agree with what was played. (Answer the next over's decision first.)
  while (await answerSheet(page)) await page.waitForTimeout(500);
  await page.getByRole('tab', { name: 'commentary' }).click();
  await expect(page.locator('section[aria-label="Commentary"] li').first()).toBeVisible();
  await page.getByRole('tab', { name: 'live' }).click();

  // Replay never changes the score.
  const score = await page.locator('header[aria-label="Scoreboard"]').innerText();
  await page.getByRole('button', { name: 'Replay last ball' }).click();
  await page.waitForTimeout(1500);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/3d-replay.png` });
  await page.waitForTimeout(6000);
  expect(await page.locator('header[aria-label="Scoreboard"]').innerText()).toBe(score);

  // Camera modes and the Low setting work; the 2D fallback keeps every control.
  await page.getByRole('combobox', { name: 'Camera' }).selectOption('wide');
  await page.getByRole('combobox', { name: 'Graphics quality' }).selectOption('low');
  await expect(canvas).toBeVisible({ timeout: 30_000 });
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/3d-wide-low.png` });
  await page.getByRole('button', { name: 'Switch to 2D' }).click();
  await expect(canvas).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'HIT' })).toBeVisible();
  await page.getByRole('button', { name: '3D view' }).click();
  await expect(canvas).toBeVisible({ timeout: 30_000 });

  // Instant simulation skips the picture and finishes the match.
  await answerSheet(page);
  await page.getByRole('button', { name: 'Sim match' }).click();
  await expect(page.getByRole('button', { name: /Confirm result/ })).toBeVisible({ timeout: 120_000 });
  expect(errors).toEqual([]);
});
