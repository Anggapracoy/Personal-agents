import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { HOSTED_FIELD_RECOVERY_EXPRESSION } from '../lib/harness/browser/hosted-field-recovery';

function fixture() {
  let now = 0, calls = 0;
  const holders = Array.from({length: 3}, () => ({
    getBoundingClientRect: () => ({width: 200, height: 48}),
    querySelector: (_: string): object | null => null,
  }));
  const adapter = {clientInstance: {}, hostedFieldsInstance: null as object | null, config: {paypal: {}, hostedFields: undefined as object | undefined}};
  const component = {getCode: () => 'braintree', isProcessing: false, paymentMethodNonce: null as string | null,
    clientConfig: {hostedFields: {number: {}, expirationDate: {}, cvv: {}}},
    initBraintree: () => {calls++; adapter.config.hostedFields = component.clientConfig.hostedFields;},
  };
  const quote = {paymentMethod: () => ({method: 'braintree'})};
  const context = vm.createContext({
    location: {hostname: 'naturamarket.ca', pathname: '/checkout', hash: '#payment'},
    Date: {now: () => now},
    document: {getElementById: (id: string) => holders[['braintree_cc_number','braintree_expirationDate','braintree_cc_cid'].indexOf(id)], querySelector: () => null},
    getComputedStyle: () => ({visibility: 'visible'}),
    requirejs: {s: {contexts: {_: {defined: {
      'PayPal_Braintree/js/view/payment/adapter': adapter,
      'Magento_Checkout/js/model/nm-braintree-express-state': {getCreditCardComponent: () => component},
      'Magento_Checkout/js/model/quote': quote,
    }}}}},
  });
  return {context, adapter, component, quote, holders, calls: () => calls,
    run: () => vm.runInContext(HOSTED_FIELD_RECOVERY_EXPRESSION, context),
    advance: () => {now += 3000;}};
}

test('stalled PayPal configuration recovers selected card fields once after a grace period', () => {
  const f = fixture();
  assert.equal(f.run(), null); assert.equal(f.calls(), 0);
  f.advance(); assert.equal(f.run().attempted, true); assert.equal(f.calls(), 1);
  // Even if another site callback overwrites the adapter again, do not loop.
  f.adapter.config.hostedFields = undefined;
  f.advance(); assert.equal(f.run(), null); assert.equal(f.calls(), 1);
});

test('recovery never resets existing, partially mounted, hidden, submitted, or unselected fields', () => {
  const cases: ((f: ReturnType<typeof fixture>) => void)[] = [
    f => {f.adapter.hostedFieldsInstance = {};},
    f => {f.holders[0].querySelector = () => ({});},
    f => {f.holders[1].getBoundingClientRect = () => ({width: 0, height: 0});},
    f => {f.component.isProcessing = true;},
    f => {f.component.paymentMethodNonce = 'already-tokenized';},
    f => {f.quote.paymentMethod = () => ({method: 'braintree_paypal'});},
    f => {f.adapter.config.hostedFields = {};},
    f => {f.context.location.hostname = 'another-store.test';},
    f => {f.context.location.hash = '#shipping';},
    f => {f.context.requirejs = undefined;},
  ];
  for (const change of cases) {
    const f = fixture(); change(f); f.run(); f.advance(); f.run();
    assert.equal(f.calls(), 0);
  }
});

test('throwing initialization is contained and never retried', () => {
  const f = fixture(); let calls = 0;
  f.component.initBraintree = () => {calls++; throw new Error('private site error');};
  f.run(); f.advance(); const result = f.run();
  assert.equal(result.failed, true); assert.equal(JSON.stringify(result).includes('private'), false);
  f.advance(); assert.equal(f.run(), null); assert.equal(calls, 1);
});
