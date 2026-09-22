import test from 'node:test';
import assert from 'node:assert/strict';
import {
  activeAuditMode,
  confirmAuditMode,
  supportsAuditModes,
} from '../src/pages/contentAuditMode.ts';
import type { ContentAuditStatus } from '../src/services/api/contentAudit.ts';

const status = (overrides: Partial<ContentAuditStatus> = {}): ContentAuditStatus =>
  ({
    enabled: true,
    mode: 'strict',
    audit_only: false,
    ready: true,
    ...overrides,
  }) as ContentAuditStatus;

test('unknown and legacy observation are not labeled as disabled or simple', () => {
  assert.equal(activeAuditMode(null), null);
  assert.equal(supportsAuditModes(null), false);
  assert.equal(supportsAuditModes(status({ mode: undefined })), false);
  assert.equal(activeAuditMode(status({ audit_only: true })), null);
  assert.equal(activeAuditMode(status({ mode: 'simple', audit_only: true })), null);
  assert.equal(activeAuditMode(status({ mode: 'simple' })), 'simple');
  assert.equal(activeAuditMode(status({ enabled: false })), 'off');
  assert.equal(activeAuditMode(status({ mode: 'off' })), 'off');
});

test('successful save is not treated as active until runtime readback matches', async () => {
  const replies = [status(), status({ mode: 'simple' })];
  const seen: string[] = [];
  const applied = await confirmAuditMode(
    'simple',
    async () => replies.shift()!,
    (s) => seen.push(s.mode!),
    async () => {}
  );
  assert.equal(applied, true);
  assert.deepEqual(seen, ['strict', 'simple']);
});

test('unready runtime, legacy observation and reload failure stay pending', async () => {
  for (const reply of [
    status({ mode: 'simple', ready: false }),
    status({ mode: 'simple', audit_only: true }),
    status(),
  ]) {
    let reads = 0;
    assert.equal(
      await confirmAuditMode(
        'simple',
        async () => {
          reads++;
          return reply;
        },
        () => {},
        async () => {}
      ),
      false
    );
    assert.equal(reads, 8);
  }
  assert.equal(
    await confirmAuditMode(
      'simple',
      async () => {
        throw new Error('offline');
      },
      () => {}
    ),
    false
  );
});

test('off is confirmed without requiring the disabled matcher to be ready', async () => {
  assert.equal(
    await confirmAuditMode(
      'off',
      async () => status({ mode: 'off', enabled: false, ready: false }),
      () => {}
    ),
    true
  );
});
