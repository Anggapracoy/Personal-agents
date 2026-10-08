import test from 'node:test';
import assert from 'node:assert/strict';
import { CLOUD_BROWSER_CONTROLLER } from '../lib/harness/browser/cloud-controller';

test('browser locator roles match native numeric inputs and preserve explicit roles', () => {
  const definition = CLOUD_BROWSER_CONTROLLER.match(/const roleFor = element => ([^\n]+);/);
  assert.ok(definition);
  const roleFor = new Function('element', `return (${definition[1]});`);
  const input = (type: string, role: string | null = null) => ({ tagName: 'INPUT', type, getAttribute: (name: string) => name === 'role' ? role : null });
  assert.equal(roleFor(input('number')), 'spinbutton');
  assert.equal(roleFor(input('text')), 'textbox');
  assert.equal(roleFor(input('search')), 'searchbox');
  assert.equal(roleFor(input('checkbox')), 'checkbox');
  assert.equal(roleFor(input('number', 'textbox')), 'textbox');
  assert.equal(roleFor(input('text', 'spinbutton')), 'spinbutton');
});
