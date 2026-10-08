// A narrowly scoped workaround for Natura's shared credit-card/PayPal adapter race.
// Never reset a mounted widget: it may already contain privately entered payment data.
export const HOSTED_FIELD_RECOVERY_EXPRESSION = String.raw`(() => {
  if (location.hostname !== 'naturamarket.ca' || location.pathname !== '/checkout' || location.hash !== '#payment') return null;
  const modules = globalThis.requirejs?.s?.contexts?._?.defined;
  if (!modules) return null;
  const adapter = modules['PayPal_Braintree/js/view/payment/adapter'];
  const component = modules['Magento_Checkout/js/model/nm-braintree-express-state']?.getCreditCardComponent?.();
  const selected = modules['Magento_Checkout/js/model/quote']?.paymentMethod?.();
  if (!adapter || !component || selected?.method !== 'braintree' || component.getCode?.() !== 'braintree') return null;
  if (component.isProcessing || component.paymentMethodNonce || typeof component.initBraintree !== 'function') return null;
  const ids = ['braintree_cc_number', 'braintree_expirationDate', 'braintree_cc_cid'];
  const holders = ids.map(id => document.getElementById(id));
  if (holders.some(e => !e || !e.getBoundingClientRect().width || !e.getBoundingClientRect().height || getComputedStyle(e).visibility === 'hidden')) return null;
  // Do not touch working, partially mounted, or currently initializing card widgets.
  if (adapter.hostedFieldsInstance || holders.some(e => e.querySelector('iframe,input')) || document.querySelector('iframe[id^="braintree-hosted-field-"]')) return null;
  if (!adapter.clientInstance || !adapter.config?.paypal || adapter.config.hostedFields || !component.clientConfig?.hostedFields) return null;
  const key = '__dashNaturaHostedFieldRecovery';
  const state = globalThis[key] || (globalThis[key] = {firstSeen: Date.now(), attempted: false});
  if (state.attempted || Date.now() - state.firstSeen < 2500) return null;
  // Set the guard before invoking site code, including when that code throws.
  state.attempted = true;
  try {
    component.initBraintree();
    return {attempted: true};
  } catch {
    return {attempted: true, failed: true};
  }
})()`;
