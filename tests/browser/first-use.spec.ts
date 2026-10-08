import { test, expect } from '@playwright/test';
const question='What’s one thing you need to get done this week?';
test('an empty finished scan asks directly on Home, and answering preserves the question in a saved chat',async({page})=>{
 const runs:string[]=[]; page.on('request',r=>{if(r.method()==='POST' && r.url().endsWith('/api/runs'))runs.push(r.url());});
 await page.goto('/?uiPreview=1&scanPreview=empty');
 await expect(page.getByText(question,{exact:true})).toBeVisible();
 await expect(page.getByText('What’s on your plate?',{exact:true})).toHaveCount(0);
 await expect(page.getByRole('button',{name:'Make a plan',exact:true})).toHaveCount(0);
 await page.locator('.wd-home-layer textarea').fill('Find a dinner spot for Friday');
 await page.locator('.wd-home-layer').getByRole('button',{name:'Send',exact:true}).click();
 await expect(page.locator('.wd-front-layer .wd-agent').first()).toHaveText(question);
 await expect(page.locator('.wd-front-layer .wd-agent').last()).toHaveText('What would a good result look like?');
 await page.locator('.wd-front-layer').getByRole('button',{name:'Back',exact:true}).click();
 await expect(page.getByText(question,{exact:true})).toHaveCount(0);
 await expect(page.locator('.wd-row').filter({hasText:'One less thing'})).toBeVisible();
 expect(runs).toEqual([]);
});
test('running discovery shows its activity, never the fallback or generic starters',async({page})=>{
 await page.goto('/?uiPreview=1&scanPreview=first');
 await expect(page.getByText('I’m checking what needs attention.',{exact:true})).toBeVisible();
 await expect(page.getByText(question,{exact:true})).toHaveCount(0);
 await expect(page.locator('.wd-first-use-choices')).toHaveCount(0);
});
test('real findings replace discovery activity and retain normal actionable Home',async({page})=>{
 await page.goto('/?uiPreview=1&scanPreview=arriving');
 await expect(page.locator('.wd-proactive-swipe')).toHaveCount(1,{timeout:6000});
 await expect(page.getByText(question,{exact:true})).toHaveCount(0);
 await expect(page.getByRole('button',{name:'Find a spot',exact:true})).toBeVisible();
});
