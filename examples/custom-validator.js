// examples/custom-validator.js — the smallest possible AetherFlow extension.
//
// Drop this into extensions/ and call `registerExampleValidator(AetherFlow)`
// once at bootstrap. No core file is modified. `npm run audit` still passes
// because the extension declares egress: 'none' and uses no network primitive.

import { defineModule, STABILITY } from '../src/sdk/index.js';

export const { manifest, create } = defineModule({
  id: 'example.validator.sku',
  egress: 'none',
  permissions: ['metadata.write'],
  provides: ['validator:sku'],
  subscribe: ['meta:delta'],
}, () => ({ skuRule }));

/** A domain rule: warehouse SKUs look like ABC-12345. */
export function skuRule(value) {
  if (value == null || value === '') return true; // emptiness is 'required' rule's job
  return /^[A-Z]{3}-\d{5}$/.test(String(value)) || 'Use ABC-12345';
}

export function registerExampleValidator(AetherFlow) {
  const unregisterValidator = AetherFlow.validators.register('sku', skuRule, {
    stability: STABILITY.BETA,
    description: 'Warehouse SKU format ABC-12345',
  });
  const unregisterCommand = AetherFlow.commands.register('validate-sku', {
    title: 'Check SKU format in the current view',
    keywords: 'sku warehouse format quality',
    hint: 'example extension',
    run: () => AetherFlow.emit('audit:append', { action: 'validate.sku', from: 'example' }),
  }, { stability: STABILITY.BETA });
  const unsubscribe = AetherFlow.on('meta:delta', (op) => {
    // A real extension would re-validate this cell here.
    if (op.field === 'sku') skuRule(op.value);
  });
  return () => { unregisterValidator(); unregisterCommand(); unsubscribe(); };
}
