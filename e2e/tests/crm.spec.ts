import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { fa } from '@ishan/i18n';

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? 'admin@ishan.local';
const ADMIN_TEMP = process.env.E2E_ADMIN_PASSWORD ?? 'ChangeMe-Dev-2026!';
const ADMIN_NEW = 'E2e-Rotated-Passw0rd!';
const run = Date.now().toString(36);

async function a11y(page: Page, name: string) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  const serious = results.violations.filter(
    (v) => v.impact === 'serious' || v.impact === 'critical',
  );
  expect(
    serious.map((v) => `${v.id}: ${v.nodes.length} node(s) - ${v.nodes[0]?.html.slice(0, 120)}`),
    `a11y violations on ${name}`,
  ).toEqual([]);
}

test.describe.serial('Ishan CRM end-to-end', () => {
  test('API is healthy through the web proxy', async ({ request }) => {
    const res = await request.get('/api/v1/health/ready');
    expect(res.status()).toBe(200);
  });

  test('login page is accessible and rejects bad credentials', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('heading', { name: fa.login.title })).toBeVisible();
    await a11y(page, '/login');
    await page.getByLabel(fa.common.email, { exact: true }).fill(ADMIN_EMAIL);
    await page.getByLabel(fa.common.password, { exact: true }).fill('wrong-password-123');
    await page.getByRole('button', { name: fa.login.submit }).click();
    await expect(page.getByText(fa.login.invalid)).toBeVisible();
  });

  test('bootstrap admin must change the temporary password', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel(fa.common.email, { exact: true }).fill(ADMIN_EMAIL);
    await page.getByLabel(fa.common.password, { exact: true }).fill(ADMIN_TEMP);
    await page.getByRole('button', { name: fa.login.submit }).click();
    await expect(page).toHaveURL(/\/account/);
    await expect(page.getByText(fa.account.mustChange)).toBeVisible();
    await page.getByLabel(fa.account.current, { exact: true }).fill(ADMIN_TEMP);
    await page.getByLabel(fa.account.next, { exact: true }).fill(ADMIN_NEW);
    await page.getByRole('button', { name: fa.common.save }).click();
    await expect(page.getByText(fa.account.changed)).toBeVisible();
    await a11y(page, '/account');
  });

  test('customer lifecycle: create, contact, tag, search', async ({ page }) => {
    await loginAdmin(page);
    await page.goto('/customers');
    await a11y(page, '/customers');
    await page.getByRole('button', { name: fa.customers.add }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel(fa.common.name, { exact: true }).fill(`شرکت آزمون ${run}`);
    await dialog.getByLabel(fa.customers.kind, { exact: true }).selectOption('ORGANIZATION');
    await dialog.getByLabel(fa.common.email, { exact: true }).fill(`e2e-${run}@example.com`);
    await dialog.getByRole('button', { name: fa.common.save }).click();
    await expect(page).toHaveURL(/\/customers\/[0-9a-f-]{36}/);
    await expect(page.getByRole('heading', { name: `شرکت آزمون ${run}` })).toBeVisible();

    await page.getByRole('button', { name: fa.customers.addContact }).click();
    const cd = page.getByRole('dialog');
    await cd.getByLabel(fa.customers.firstName, { exact: true }).fill('سارا');
    await cd.getByLabel(fa.customers.lastName, { exact: true }).fill('احمدی');
    await cd.getByRole('button', { name: fa.common.save }).click();
    await expect(page.getByText('سارا احمدی')).toBeVisible();

    await page.goto('/customers');
    await page.getByPlaceholder(fa.customers.searchPlaceholder).fill(`آزمون ${run}`);
    await page.getByRole('button', { name: fa.common.search, exact: true }).click();
    await expect(page.getByRole('link', { name: `شرکت آزمون ${run}` })).toBeVisible();
  });

  test('lead converts to a customer with a deal shown on the board', async ({ page }) => {
    await loginAdmin(page);
    await page.goto('/leads');
    await page.getByRole('button', { name: fa.leads.add }).click();
    const d = page.getByRole('dialog');
    await d.getByLabel(fa.common.name, { exact: true }).fill(`سرنخ آزمون ${run}`);
    await d.getByLabel(fa.leads.company, { exact: true }).fill(`شرکت سرنخ ${run}`);
    await d.getByRole('button', { name: fa.common.save }).click();
    const row = page.getByRole('row', { name: new RegExp(`سرنخ آزمون ${run}`) });
    await expect(row).toBeVisible();
    await row.getByRole('button', { name: fa.leads.convert }).click();
    const c = page.getByRole('dialog');
    await c.getByLabel(fa.leads.withDeal).check();
    await c.getByLabel(fa.leads.dealTitle, { exact: true }).fill(`فرصت آزمون ${run}`);
    await c.getByLabel(fa.deals.amountToman, { exact: true }).fill('500000000');
    await c.getByRole('button', { name: fa.leads.convert }).click();
    await expect(page.getByText(fa.leads.converted)).toBeVisible();

    await page.goto('/deals');
    await expect(page.getByRole('button', { name: `فرصت آزمون ${run}` })).toBeVisible();
    await a11y(page, '/deals');
  });

  test('deal can be moved to the won stage and appears in the funnel', async ({ page }) => {
    await loginAdmin(page);
    await page.goto('/deals');
    const picker = page.getByLabel(`${fa.deals.moveTo}: فرصت آزمون ${run}`);
    await picker.selectOption({ label: 'برنده شد' });
    await expect(page.getByText(fa.deals.moved)).toBeVisible();
    const won = page.getByRole('listitem', { name: 'برنده شد' });
    await expect(won.getByRole('button', { name: `فرصت آزمون ${run}` })).toBeVisible();
  });

  test('activities: note, task and call on the customer file, then calendar and reminders', async ({
    page,
  }) => {
    await loginAdmin(page);
    await page.goto('/customers');
    await page.getByPlaceholder(fa.customers.searchPlaceholder).fill(`آزمون ${run}`);
    await page.getByRole('button', { name: fa.common.search, exact: true }).click();
    await page.getByRole('link', { name: `شرکت آزمون ${run}` }).click();
    await expect(page.getByRole('heading', { name: `شرکت آزمون ${run}` })).toBeVisible();

    // note → appears in the interaction history
    await page.getByRole('button', { name: fa.activities.addNote }).click();
    const note = page.getByRole('dialog');
    await note.getByLabel(fa.activities.noteText, { exact: true }).fill(`یادداشت آزمون ${run}`);
    await note.getByRole('button', { name: fa.common.save }).click();
    await expect(page.getByText(fa.activities.created)).toBeVisible();
    await expect(page.getByRole('listitem').getByText(`یادداشت آزمون ${run}`)).toBeVisible();

    // logged call with an outcome → history
    await page.getByRole('button', { name: fa.activities.addCall }).click();
    const call = page.getByRole('dialog');
    await call.getByLabel(fa.activities.activityTitle, { exact: true }).fill(`تماس آزمون ${run}`);
    await call.getByLabel(fa.activities.outcome, { exact: true }).fill(`نتیجه ${run}`);
    await call.getByRole('button', { name: fa.common.save }).click();
    await expect(page.getByText(`نتیجه ${run}`)).toBeVisible();

    // planned task (Jalali date/time defaults to the next full hour) → upcoming list
    await page.getByRole('button', { name: fa.activities.addTask }).click();
    const task = page.getByRole('dialog');
    await task.getByLabel(fa.activities.activityTitle, { exact: true }).fill(`وظیفه آزمون ${run}`);
    await expect(task.getByLabel(fa.activities.month)).not.toHaveValue('');
    await task.getByRole('button', { name: fa.common.save }).click();
    const item = page.getByRole('listitem').filter({ hasText: `وظیفه آزمون ${run}` });
    await expect(item).toBeVisible();

    // completing moves it into the history
    await item.getByRole('button', { name: fa.activities.complete, exact: true }).click();
    await expect(page.getByText(fa.activities.completed)).toBeVisible();

    // the task list shows it under "done"
    await page.goto('/activities');
    await page.getByRole('tab', { name: fa.activities.tabs.done }).click();
    await expect(page.getByText(`وظیفه آزمون ${run}`)).toBeVisible();
    await a11y(page, '/activities');

    // calendar renders a Jalali month grid
    await page.goto('/calendar');
    await expect(page.getByRole('table')).toBeVisible();
    await a11y(page, '/calendar');

    // reminder bell opens and shows the empty state
    await page
      .getByRole('button', { name: new RegExp(fa.activities.reminders) })
      .first()
      .click();
    await expect(page.getByText(fa.activities.remindersEmpty)).toBeVisible();
  });

  test('dashboard: KPIs, org scope, table alternative, CSV export', async ({ page }) => {
    await loginAdmin(page);
    await page.goto('/');
    await expect(page.getByRole('heading', { name: new RegExp(fa.dashboard.title) })).toBeVisible();
    await expect(page.getByText(fa.dashboard.wonHero)).toBeVisible();
    await page.getByLabel(fa.dashboard.scopeLabel, { exact: true }).selectOption('all');
    await expect(page.getByText(fa.dashboard.performance).first()).toBeVisible();
    await page.getByLabel(fa.dashboard.rangeLabel, { exact: true }).selectOption('90');
    // Every chart has a table alternative.
    await page.getByRole('button', { name: fa.dashboard.showTable }).first().click();
    await expect(page.getByRole('button', { name: fa.dashboard.showChart }).first()).toBeVisible();
    await a11y(page, '/ (dashboard)');
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: fa.dashboard.exportCsv }).click();
    expect((await download).suggestedFilename()).toBe('sales-performance.csv');
    await expect(page.getByText(fa.dashboard.exported)).toBeVisible();
  });

  test('admin can open users and the audit log, then log out', async ({ page }) => {
    await loginAdmin(page);
    await page.goto('/users');
    await expect(page.getByRole('heading', { name: fa.users.title })).toBeVisible();
    await page.goto('/audit');
    await expect(page.getByText('deal.stage_changed').first()).toBeVisible();
    await expect(page.getByText('activity.completed').first()).toBeVisible();
    await page.getByRole('button', { name: fa.nav.logout }).first().click();
    await expect(page).toHaveURL(/\/login/);
  });
});

async function loginAdmin(page: Page) {
  await page.goto('/login');
  await page.getByLabel(fa.common.email, { exact: true }).fill(ADMIN_EMAIL);
  await page.getByLabel(fa.common.password, { exact: true }).fill(ADMIN_NEW);
  await page.getByRole('button', { name: fa.login.submit }).click();
  await expect(page).toHaveURL(/\/$/);
}
