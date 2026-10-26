import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { autoRegisterSchedule } from '../src/utils/autoRegisterSchedule.js';

test('the next twenty-minute execution estimate matches the off-hour trigger at minute 7', () => {
  assert.equal(autoRegisterSchedule(Date.parse('2026-10-26T02:06:00+08:00')).nextSlot.toISOString(),
    '2026-10-25T18:07:00.000Z');
  assert.equal(autoRegisterSchedule(Date.parse('2026-10-26T02:09:00+08:00')).nextSlot.toISOString(),
    '2026-10-25T18:27:00.000Z');
  assert.equal(autoRegisterSchedule(Date.parse('2026-10-25T23:59:00+08:00')).nextSlot.toISOString(),
    '2026-10-25T16:07:00.000Z');
});

test('workflow supplies later delivery opportunities throughout each two-hour window', () => {
  const workflow = readFileSync(new URL('../.github/workflows/auto-register-cm.yml', import.meta.url), 'utf8');
  const cron = workflow.match(/cron: '([^']+)'/)?.[1];
  assert.equal(cron, '7,27,47 * * * *');
  const minutes = cron!.split(' ')[0].split(',').map(Number);
  const opportunities = [0, 1].flatMap(hour => minutes.map(minute => hour * 60 + minute));
  assert.deepEqual(opportunities, [7, 27, 47, 67, 87, 107]);
  assert.equal(opportunities[0], autoRegisterSchedule(Date.parse('2026-10-26T00:00:00Z')).nextSlot.getUTCMinutes());
});
