import { describe, test, expect } from 'vitest';
import { parseUsdc, parseToken, formatUsdc, formatToken } from './format';

describe('parse', () => {
  test('parseUsdc 6dec', () => {
    expect(parseUsdc('0.01')).toBe(10000n);
    expect(parseUsdc('1')).toBe(1_000_000n);
  });
  test('parseToken 18dec', () => {
    expect(parseToken('1')).toBe(10n ** 18n);
  });
  test('invalid input -> null', () => {
    expect(parseUsdc('abc')).toBeNull();
    expect(parseUsdc('')).toBeNull();
  });
});

describe('format', () => {
  test('formatUsdc trims + groups', () => {
    expect(formatUsdc(12_340_000n)).toBe('12.34');
    expect(formatUsdc(1_000_000n)).toBe('1');
    expect(formatUsdc(1_234_567_000n)).toBe('1,234.567');
  });
  test('formatToken groups thousands, 2 frac max', () => {
    expect(formatToken(1250n * 10n ** 18n)).toBe('1,250');
    expect(formatToken(10n ** 18n + 5n * 10n ** 17n)).toBe('1.5');
  });
});
