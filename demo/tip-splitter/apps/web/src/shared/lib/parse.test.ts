import { describe, expect, it } from 'vitest';
import { parseAmount, parsePercent, parsePeople } from '@/shared/lib';

describe('parseAmount', () => {
  it.each([
    ['42,50', 4250],
    ['$1,234.50', 123450],
    ['1,234', 123400],
    [' 42.5 ', 4250],
    ['1.234,50', 123450],
    ['1,234,567', 123456700],
    ['1.234.567', 123456700],
    ['12,345.6', 1234560],
  ])('parses %j to %i cents @AC-calc-9', (input, cents) => {
    expect(parseAmount(input)).toBe(cents);
  });

  it.each(['1,2345', '1.234', '1,23,456', '1,234.567', '$', '', '   '])(
    'rejects %j @AC-calc-9',
    (input) => {
      expect(parseAmount(input)).toBeNull();
    },
  );

  it.each(['12..5', 'abc', '-5', '4.505', '10000000'])('rejects %j @AC-calc-10', (input) => {
    expect(parseAmount(input)).toBeNull();
  });

  it.each([
    ['0', 0],
    ['9999999.99', 999999999],
  ])('accepts %j as %i cents @AC-calc-10', (input, cents) => {
    expect(parseAmount(input)).toBe(cents);
  });
});

describe('parsePercent', () => {
  it.each([
    ['0', 0],
    ['100', 10000],
    ['12.5', 1250],
    ['12.55', 1255],
  ])('parses %j to %i basis points @AC-calc-13', (input, bp) => {
    expect(parsePercent(input)).toBe(bp);
  });

  it.each(['150', '-1', 'abc', '12.345', ''])('rejects %j @AC-calc-13', (input) => {
    expect(parsePercent(input)).toBeNull();
  });
});

describe('parsePeople', () => {
  it.each([
    ['1', 1],
    ['3', 3],
    ['50', 50],
  ])('parses %j to %i @AC-calc-16', (input, n) => {
    expect(parsePeople(input)).toBe(n);
  });

  it.each(['0', '51', '2.5', 'abc', ''])('rejects %j @AC-calc-16', (input) => {
    expect(parsePeople(input)).toBeNull();
  });
});
