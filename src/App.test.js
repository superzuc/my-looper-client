import { formatLength } from './lib/format';

test('formats loop length in bars or beats', () => {
  expect(formatLength(4, 4)).toEqual({ value: 1, unit: 'bar' });
  expect(formatLength(8, 4)).toEqual({ value: 2, unit: 'bar' });
  expect(formatLength(2, 4)).toEqual({ value: 2, unit: 'beat' });
  expect(formatLength(0.5, 4)).toEqual({ value: '0.5', unit: 'beat' });
});
