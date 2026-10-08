import assert from 'node:assert/strict';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { CLOUD_BROWSER_CONTROLLER } from '../lib/harness/browser/cloud-controller';
const helpers=CLOUD_BROWSER_CONTROLLER.match(/SHADOW_HELPERS = r"""([\s\S]*?)"""/)![1];

test('ordinary target lookup avoids enumerating the whole DOM',()=>{
  const wanted={name:'main control'};
  const document={querySelector:()=>wanted,querySelectorAll:()=>{throw new Error('Unexpected full DOM traversal');}};
  assert.equal(runInNewContext(helpers+"\ndeepQuery('[data-decision-feed-ref=e1]')",{document}),wanted);
});

test('target lookup still finds nested shadow controls and preserves document-first order',()=>{
  const wanted={name:'nested control'};
  const nested={querySelector:()=>wanted,querySelectorAll:()=>[]};
  const shadow={querySelector:()=>null,querySelectorAll:()=>[{shadowRoot:nested}]};
  const document={querySelector:()=>null,querySelectorAll:()=>[{shadowRoot:shadow}]};
  assert.equal(runInNewContext(helpers+"\ndeepQuery('[data-decision-feed-ref=e1]')",{document}),wanted);
  nested.querySelector=()=>null as never;
  assert.equal(runInNewContext(helpers+"\ndeepQuery('[data-decision-feed-ref=e1]')",{document}),null);
});
