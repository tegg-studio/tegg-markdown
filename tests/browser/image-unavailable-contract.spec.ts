import {test,expect} from '@playwright/test';

for(const mode of ['reader','live'] as const)for(const locale of ['en-US','zh-CN'] as const){
 test(`${mode} ${locale} uses truthful image failure copy and never exposes an empty-alt resource URL`,async({page})=>{
  await page.route('**/own-missing-contract.png?token=fixture-only-secret',route=>route.fulfill({status:404,contentType:'text/plain',body:'Fixture missing image'}));
  await page.goto('http://127.0.0.1:18930/reliable.html');
  const source='![Author image description](own-missing-contract.png?token=fixture-only-secret)\n\n![](own-missing-contract.png?token=fixture-only-secret)\n\nAfter\n';
  await page.evaluate(({source,mode,locale})=>{const host=(window as any).host;host.load(source);host.editor.setUI({locale});if(!host.editor.setMode(mode))throw Error('Mode rejected');},{source,mode,locale});
  const failures=page.locator(mode==='reader'?'.tegg-reader .md-image-unavailable':'.cm-live-image-fallback');
  await expect(failures).toHaveCount(2);
  for(let i=0;i<2;i++){
   await expect(failures.nth(i)).toBeVisible();
   await expect(failures.nth(i).locator('strong')).toHaveText(locale==='zh-CN'?'\u56fe\u7247\u52a0\u8f7d\u5931\u8d25':'Image loading failed');
   await expect(failures.nth(i)).toHaveAttribute('role','status');
   await expect(failures.nth(i)).not.toContainText('fixture-only-secret');
   await expect(failures.nth(i)).not.toContainText('own-missing-contract.png');
  }
  await expect(failures.nth(0).locator('span')).toHaveText('Author image description');
  await expect(failures.nth(1).locator('span')).toHaveText('');
  expect(await page.evaluate(()=>(window as any).host.editor.source)).toBe(source);
 });
}
