import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';

// Each project gets its own empty hub, and these run in order: empty states first.
test.describe.configure({ mode: 'serial' });

const fixture = (name: string) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
const shot = (page: Page, name: string) =>
  page.screenshot({ path: `test-results/screens/${test.info().project.name}-${name}.png`, fullPage: true });

/**
 * Console errors and failed requests while a test runs. Calendar answers 503 by design when the
 * hub runs without Mac integrations (HUB_NO_MAC), so that one is expected, not a failure.
 */
function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('response', (r) => {
    if (r.status() >= 400 && !(r.status() === 503 && r.url().includes('/api/calendar'))) errors.push(`${r.status()} ${r.url()}`);
  });
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    if (m.text().startsWith('Failed to load resource')) return; // reported by the response listener
    errors.push(`console: ${m.text()}`);
  });
  return errors;
}

test('empty states are honest', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Connect your iPhone')).toBeVisible();
  const activeDays = page.locator('#heatmap dt', { hasText: 'Active days' }).locator('xpath=following-sibling::dd[1]');
  await expect(activeDays).toHaveText('0');
  await expect(page.getByText('No goals yet')).toBeVisible();
});

test('dashboard renders every panel', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/');
  for (const name of ['Goals', 'Focus', 'Year of focus', 'Sleep', 'Push-ups and squats', 'Calendar', 'Resources']) {
    await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
  }
  await expect(page.getByRole('button', { name: 'Chat' })).toBeVisible();
  await page.waitForLoadState('networkidle');
  await shot(page, 'dashboard');
  expect(errors).toEqual([]);
});

test('goal flow', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Add a goal' }).click();
  const title = page.getByPlaceholder('Type a goal, press Enter');
  await title.fill('Finish chapter 4 (e2e)');
  await title.press('Enter');
  const hours = page.getByRole('form', { name: 'Plan this goal' }).getByLabel('How long, in hours');
  await hours.fill('10');
  await hours.press('Enter');
  await expect(page.getByText('0 h / 10 h')).toBeVisible();
  expect(errors).toEqual([]);
});

test('focus session flow', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/');
  // The start form waits behind Focus's + until it's asked for.
  await page.getByRole('button', { name: 'New focus session' }).click();
  await page.getByPlaceholder('What are you working on?').fill('e2e algebra');
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await page.getByRole('button', { name: 'Pause' }).first().click();
  await page.getByRole('button', { name: 'Resume' }).first().click();
  await page.getByRole('button', { name: 'Stop' }).first().click();

  const sheet = page.getByRole('dialog', { name: 'Wrap up' });
  await expect(sheet).toBeVisible();
  // Upload files' own input; the camera has one too.
  await sheet.locator('input[type="file"][multiple]').setInputFiles(fixture('hw.py'));
  await expect(sheet.getByRole('list', { name: 'Attached files' })).toContainText('hw.py');
  await shot(page, 'wrap-up');
  await sheet.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(sheet).toBeHidden();

  await page.goto('/database');
  await expect(page.getByText('e2e algebra').first()).toBeVisible();
  await expect(page.getByText('1 file').first()).toBeVisible();
  await shot(page, 'database');
  expect(errors).toEqual([]);
});

test('essay autosaves', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/essays');
  // On a phone the columns are tabs; Insights has to be the open one.
  const tab = page.getByRole('tab', { name: /Insights/ });
  if (await tab.isVisible()) await tab.click();
  await page.getByRole('button', { name: 'New essay in Insights' }).click();
  await page.waitForURL(/\/essays\/\d+$/);

  const doc = page.locator('.ProseMirror');
  await doc.click();
  await page.keyboard.type('hello dusk');
  await expect(page.getByText(/^Saved \d{2}:\d{2}$/)).toBeVisible({ timeout: 10_000 });
  await shot(page, 'editor');
  await page.reload();
  await expect(page.locator('.ProseMirror')).toContainText('hello dusk');
  expect(errors).toEqual([]);
});

test('every page renders without errors', async ({ page }) => {
  const errors = watchErrors(page);
  for (const [name, path] of [['essays', '/essays'], ['settings', '/settings']] as const) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    await shot(page, name);
  }
  expect(errors).toEqual([]);
});
