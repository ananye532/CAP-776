import { expect, test } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const samples = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../samples');

test('import → review → resolve duplicate → update status → follow-up → analytics', async ({ page }) => {
  // First run: create the single account.
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Create your account' })).toBeVisible();
  await page.getByLabel('Name').fill('E2E User');
  await page.getByLabel('Email').fill('e2e@example.com');
  await page.getByLabel('Password').fill('e2e-password-123');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByText('No applications yet')).toBeVisible();

  // Create an application manually (as if applied via LinkedIn).
  await page.getByRole('button', { name: 'Add your first application' }).click();
  const dialog = page.getByRole('dialog', { name: 'New application' });
  await dialog.getByLabel('Company').fill('Bluepeak Payments');
  await dialog.getByLabel('Job title').fill('Data Analyst');
  await dialog.getByLabel('Source').selectOption('linkedin');
  await dialog.getByLabel('Location').fill('Bengaluru');
  await dialog.getByRole('button', { name: 'Add application' }).click();
  await expect(page.getByRole('heading', { name: 'Data Analyst' })).toBeVisible();

  // Import a Naukri JSON export.
  await page.getByRole('link', { name: 'Import & Sync' }).click();
  await page.getByRole('button', { name: /Import from Naukri/ }).click();
  await page.getByTestId('import-file').setInputFiles(path.join(samples, 'naukri_applications_sample.json'));
  await expect(page.getByText('File detected:')).toBeVisible();
  await expect(page.locator('.summary-tile', { hasText: 'Records found' })).toContainText('3');
  await expect(page.locator('.summary-tile', { hasText: 'Potential duplicates' })).toContainText('1');
  await expect(page.getByRole('cell', { name: 'designation' })).toBeVisible();

  // Review: the duplicate is shown with its match; keep the default (import separately, queue review).
  await page.getByRole('button', { name: 'Review records' }).click();
  await expect(page.getByText(/Possible duplicate \(\d+%\)/)).toBeVisible();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Import now' }).click();
  await expect(page.getByText('Import complete')).toBeVisible();
  await expect(page.getByText(/3 created/)).toBeVisible();

  // Resolve the duplicate by merging into the LinkedIn record.
  await page.getByRole('tab', { name: /Duplicates/ }).click();
  const card = page.locator('.card', { hasText: 'Possible duplicate' });
  await expect(card).toBeVisible();
  await card.locator('label.side', { hasText: 'LinkedIn' }).locator('input[type=radio]').check();
  await card.getByRole('button', { name: 'Merge into selected' }).click();
  await expect(page.getByText('No duplicates to review')).toBeVisible();

  // The merged application keeps both sources.
  await page.getByRole('link', { name: 'Applications', exact: true }).click();
  await expect(page.getByText('3 applications')).toBeVisible();
  await page.getByRole('link', { name: /^Data Analyst/ }).first().click();
  const sources = page.locator('.card', { hasText: 'Sources' });
  await expect(sources).toContainText('2 records');
  await expect(sources).toContainText('Naukri');
  await expect(sources).toContainText('LinkedIn');

  // Update status with history.
  await page.getByRole('button', { name: 'Change status' }).click();
  const sdlg = page.getByRole('dialog', { name: 'Change status' });
  await sdlg.getByLabel('New status').selectOption('screening');
  await sdlg.getByRole('button', { name: 'Update status' }).click();
  await expect(page.locator('.page-head .badge', { hasText: 'Screening' })).toBeVisible();
  await expect(page.locator('.timeline')).toContainText('Screening');

  // Schedule a follow-up and see it on the Follow-ups page.
  await page.getByRole('button', { name: 'Follow-up', exact: true }).click();
  const fdlg = page.getByRole('dialog', { name: 'Schedule follow-up' });
  await fdlg.getByLabel('Type').selectOption('recruiter');
  await fdlg.getByRole('button', { name: 'Save' }).click();
  await page.getByRole('link', { name: 'Follow-ups' }).first().click();
  await expect(page.getByText('Data Analyst — Bluepeak Payments')).toBeVisible();

  // Analytics use real records.
  await page.getByRole('link', { name: 'Analytics' }).click();
  await expect(page.getByText('Based on 3 submitted applications')).toBeVisible();
  await expect(page.locator('.funnel')).toContainText('Responses');
  const platformRow = page.locator('tr', { hasText: 'Naukri' }).first();
  await expect(platformRow).toBeVisible();

  // Global search.
  await page.keyboard.press('/');
  await page.getByPlaceholder(/Search everything/).fill('bluep');
  await expect(page.locator('.palette-hit').first()).toContainText('Bluepeak');
});

test('mobile layout turns tables into cards', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByLabel('Email').fill('e2e@example.com');
  await page.getByLabel('Password').fill('e2e-password-123');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByRole('navigation', { name: 'Mobile navigation' }).getByRole('link', { name: 'Apps' }).click();
  await expect(page.locator('.cards-list .m-card').first()).toBeVisible();
  await expect(page.locator('.table-wrap.responsive')).toBeHidden();
});
