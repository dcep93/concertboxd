import { test, expect } from '@playwright/test';
const url = '/src/app_x/tests/fixtures/notesDraft.html';
const key = (uid = 'owner', concert = 'a') => `concertboxd:public-notes:v1:${JSON.stringify([uid, concert])}`;
const stored = (page, uid, concert) => page.evaluate(key => localStorage.getItem(key), key(uid, concert));
const notes = page => page.getByLabel('Public Notes', { exact: true });

test('debounces the latest text and restores it on reload, including an empty draft', async ({ page }) => {
  await page.clock.install();
  await page.clock.pauseAt(new Date(Date.now() + 1000));
  await page.goto(url);
  await notes(page).fill('First');
  await page.clock.runFor(200);
  expect(await stored(page)).toBeNull();
  await notes(page).fill('Latest');
  await page.clock.runFor(299);
  expect(await stored(page)).toBeNull();
  await page.clock.runFor(1);
  expect(await stored(page)).toBe('Latest');
  await expect(page.getByLabel('Published notes')).toHaveText('owner a published');
  await page.reload();
  await expect(notes(page)).toHaveValue('Latest');
  await notes(page).fill('');
  await page.clock.runFor(300);
  expect(await stored(page)).toBe('');
  await page.reload();
  await expect(notes(page)).toHaveValue('');
});

test('flushes on immediate reload and unmount', async ({ page }) => {
  await page.goto(url);
  await notes(page).fill('Reload immediately');
  await page.reload();
  await expect(notes(page)).toHaveValue('Reload immediately');
  await notes(page).fill('Unmount immediately');
  await page.getByLabel('Show editor').uncheck();
  expect(await stored(page)).toBe('Unmount immediately');
  await page.getByLabel('Show editor').check();
  await expect(notes(page)).toHaveValue('Unmount immediately');
});

test('isolates identities and concerts even when the hook stays mounted', async ({ page }) => {
  await page.goto(url);
  await notes(page).fill('Owner A draft');
  await page.getByLabel('Concert', { exact: true }).selectOption('b');
  await expect(notes(page)).toHaveValue('owner b published');
  await notes(page).fill('Owner B draft');
  await page.getByLabel('Account', { exact: true }).selectOption('other');
  await expect(notes(page)).toHaveValue('other b published');
  await notes(page).fill('Other B draft');
  await page.getByLabel('Account', { exact: true }).selectOption('');
  await expect(notes(page)).toHaveValue('owner b published');
  await expect(notes(page)).toHaveAttribute('readonly', '');
  await page.getByLabel('Account', { exact: true }).selectOption('owner');
  await expect(notes(page)).toHaveValue('Owner B draft');
  await page.getByLabel('Concert', { exact: true }).selectOption('a');
  await expect(notes(page)).toHaveValue('Owner A draft');
  expect(await stored(page, 'other', 'b')).toBe('Other B draft');
});

test('publication clears the draft and cancels pending writes', async ({ page }) => {
  await page.goto(url);
  await notes(page).fill('Publish this');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByLabel('Published notes')).toHaveText('Publish this');
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
  expect(await stored(page)).toBeNull();
  await page.getByLabel('Show editor').uncheck();
  await page.getByLabel('Show editor').check();
  await expect(notes(page)).toHaveValue('Publish this');
  expect(await stored(page)).toBeNull();
});

test('an earlier save acknowledgment preserves newer typing', async ({ page }) => {
  await page.goto(url);
  await page.getByLabel('Save mode').selectOption('delayed');
  await notes(page).fill('Submitted');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await notes(page).fill('Newer draft');
  await page.getByRole('button', { name: 'Complete save' }).click();
  await expect(page.getByLabel('Published notes')).toHaveText('Submitted');
  await expect(notes(page)).toHaveValue('Newer draft');
  await expect.poll(() => stored(page)).toBe('Newer draft');
  await page.reload();
  await expect(notes(page)).toHaveValue('Newer draft');
});

test('failed publication retains the local draft', async ({ page }) => {
  await page.goto(url);
  await page.getByLabel('Save mode').selectOption('failure');
  await notes(page).fill('Keep after failure');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByLabel('Save error')).toHaveText('Fixture save failed');
  await page.reload();
  await expect(notes(page)).toHaveValue('Keep after failure');
});

test('blocked storage does not interrupt typing or publishing', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    for (const method of ['getItem', 'setItem', 'removeItem'])
      Storage.prototype[method] = () => { throw new DOMException('Blocked', 'SecurityError'); };
  });
  await page.goto(url);
  await notes(page).fill('Storage unavailable');
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide')));
  await expect(notes(page)).toHaveValue('Storage unavailable');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByLabel('Published notes')).toHaveText('Storage unavailable');
  expect(errors).toEqual([]);
});


test('hiding the page flushes the draft before its debounce expires', async ({ page }) => {
  await page.clock.install();
  await page.clock.pauseAt(new Date(Date.now() + 1000));
  await page.goto(url);
  await notes(page).fill('Background draft');
  expect(await stored(page)).toBeNull();
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  expect(await stored(page)).toBe('Background draft');
});
