import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCodexAdditionalLimit } from '../src/utils/quota/parsers.ts';

test('normalizes image-generation rate limits to the GPT Image 2 quota group', () => {
  const cases = ['gpt_image_2', 'image_generation', 'image-gen', 'media_generation'];

  for (const identifier of cases) {
    assert.deepEqual(normalizeCodexAdditionalLimit(identifier, [identifier]), {
      name: 'GPT Image 2',
      category: 'image',
    });
  }
});

test('preserves non-image additional rate-limit names', () => {
  assert.deepEqual(normalizeCodexAdditionalLimit('Code review', ['code_review']), {
    name: 'Code review',
    category: 'general',
  });
});

test('does not classify unrelated image metadata as generation quota', () => {
  assert.deepEqual(normalizeCodexAdditionalLimit('Image search', ['image_search']), {
    name: 'Image search',
    category: 'general',
  });
});
