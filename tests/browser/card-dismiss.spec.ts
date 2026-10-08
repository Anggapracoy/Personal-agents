import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { buildSync } = createRequire(require.resolve('tsx'))('esbuild');
const bundle = buildSync({stdin:{contents:`import React from 'react';import{createRoot}from'react-dom/client';import{TaskRoute}from'./app/task-route';const task={id:'probe',runId:'probe',title:'Checkout',category:'shopping',status:'needs_approval',actionId:'pending',approvalKind:window.confirmationKind || 'vault_payment',questionRequest:window.questionDismiss?{questions:[{id:'q',question:'Which time?',answerType:'single_choice',options:[{id:'a',label:'6 PM'},{id:'b',label:'7 PM'}]}]}:undefined,approvalRequest:{kind:'payment_card',siteHost:'example.com'},updatedAt:new Date().toISOString()};createRoot(document.getElementById('root')).render(<TaskRoute id="probe" decisions={[]} tasks={[task]} history={[]} snapshots={new Map()} messageCache={new Map()} actions={{onBack(){},onSnapshot(){},onSkip:async()=>{document.body.dataset.skipped='true';},onReplaceTask(){}}}/>);`,loader:'tsx',resolveDir:process.cwd()},bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',define:{'process.env.NODE_ENV':'"development"'}}).outputFiles[0].text;
for (const approvalKind of ['vault_payment','questions','signin','connector','reconnect','purchase','vault_login']) test(`${approvalKind} dismissal requires confirmation and cancellation keeps it pending`, async ({ page }) => {
  const questions=approvalKind==='questions';
  await page.route('**/card-dismiss-fixture', route => route.fulfill({contentType:'text/html',body:'<div id="root"></div>'}));
  await page.route('**/api/**', route => route.fulfill({json:route.request().url().includes('/vault') ? {items:[{id:'card',kind:'payment_card',label:'Saved card',cardBrand:'Mastercard',cardLast4:'5908'}]} : {items:[]}}));
  await page.goto('/card-dismiss-fixture');
  await page.evaluate(approvalKind => {(window as any).questionDismiss=approvalKind==='questions';(window as any).confirmationKind=approvalKind},approvalKind);
  await page.addScriptTag({content:bundle});
  page.once('dialog', async dialog => { expect(dialog.message()).toMatch(/^(Dismiss these questions|Stop choosing a card|Decline this purchase|Skip signing in|Skip connecting|Skip this login)\?/); await dialog.dismiss(); });
  await page.getByRole('button',{name:questions?'Dismiss questions':approvalKind==='purchase'?'Deny':'Not now',exact:true}).click();
  await expect(page.locator('body')).not.toHaveAttribute('data-skipped','true');
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button',{name:questions?'Dismiss questions':approvalKind==='purchase'?'Deny':'Not now',exact:true}).click();
  await expect(page.locator('body')).toHaveAttribute('data-skipped','true');
});
