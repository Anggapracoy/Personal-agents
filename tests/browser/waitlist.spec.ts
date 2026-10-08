import {test,expect} from '@playwright/test';
test('public landing invites waitlist signup instead of direct access',async({page})=>{await page.goto('/');const links=page.getByRole('link',{name:'Join the waitlist'});await expect(links).toHaveCount(2);for(const link of await links.all())await expect(link).toHaveAttribute('href','/waitlist');await expect(page.locator('a[href*="testflight.apple.com"]')).toHaveCount(0);});
test('waitlist handles failure, retry and confirmation',async({page})=>{
 let calls=0;await page.route('**/api/waitlist',async route=>{calls++;expect(route.request().postDataJSON()).toEqual({email:'alex@example.com'});await route.fulfill({status:calls===1?503:200,json:calls===1?{error:'Please try again.'}:{joined:true}});});await page.goto('/waitlist');await page.getByLabel('Email address').fill('alex@example.com');await page.getByRole('button',{name:'Join the waitlist'}).click();await expect(page.getByRole('alert').filter({hasText:'Please try again.'})).toHaveText('Please try again.');await page.getByRole('button',{name:'Join the waitlist'}).click();await expect(page.getByRole('heading',{name:'You’re on the list.'})).toBeVisible();expect(calls).toBe(2);
});
test('waitlist page is responsive and admin list is protected',async({page})=>{
 await page.setViewportSize({width:1440,height:900});await page.goto('/waitlist');await page.screenshot({path:'/tmp/dash-waitlist-desktop.png'});
 await page.setViewportSize({width:393,height:852});await page.screenshot({path:'/tmp/dash-waitlist-mobile.png'});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.goto('/admin-erjkfh23lrjghrjk959584?tab=waitlist');await expect(page.getByText('alex@example.com',{exact:true})).toHaveCount(0);
 await page.setViewportSize({width:1440,height:900});await page.goto('/admin-erjkfh23lrjghrjk959584?tab=waitlist&uiPreview=1');await expect(page.getByRole('heading',{name:'Waitlist',exact:true})).toBeVisible();await expect(page.getByRole('cell',{name:'alex@example.com',exact:true})).toBeVisible();await page.screenshot({path:'/tmp/dash-waitlist-admin-preview.png'});
});
