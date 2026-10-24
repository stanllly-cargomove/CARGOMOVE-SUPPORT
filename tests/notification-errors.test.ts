import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeError } from '../src/components/common/notifications';

test('summarizes missing company external IDs by record count', () => {
  assert.equal(summarizeError([
    'CMREG400001: Company "Haulier One" (REG-1) is missing required HAULIERID.',
    'CMREG400002: Company "Forwarder One" (REG-2) is missing required FORWARDING_AGENT_ID.',
    'CMREG400003: Company "Forwarder Two" (REG-3) is missing required FORWARDING_AGENT_ID.',
  ].join(' | ')), '1 record missing HAULIER_ID.\n2 records missing FORWARDING_ID.');
});

test('keeps unrelated errors alongside summarized missing IDs', () => {
  assert.equal(summarizeError([
    'CMREG400001: Company "Haulier One" (REG-1) is missing required HAULIERID.',
    'CMREG400002: The parent company is not registered.',
  ].join('\n')), '1 record missing HAULIER_ID.\nCMREG400002: The parent company is not registered.');
});
