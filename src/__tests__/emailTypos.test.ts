import { suggestEmail } from '../lib/emailTypos';

describe('suggestEmail', () => {
  test('corrects a transposed gmail domain', () => {
    expect(suggestEmail('jean@gmial.com')).toBe('jean@gmail.com');
  });

  test('corrects a hotmail domain with a wrong top-level domain', () => {
    expect(suggestEmail('jean@hotmail.con')).toBe('jean@hotmail.com');
  });

  test('keeps the local part verbatim and normalises the domain case', () => {
    expect(suggestEmail('Jean.D@GMIAL.COM')).toBe('Jean.D@gmail.com');
  });

  test('keeps a +tag in the local part', () => {
    expect(suggestEmail('jean+billets@gmial.com')).toBe('jean+billets@gmail.com');
  });

  test('uses the last @ when the local part contains one', () => {
    expect(suggestEmail('"a@b"@gmial.com')).toBe('"a@b"@gmail.com');
  });

  test('returns null for an exact common domain', () => {
    expect(suggestEmail('jean@gmail.com')).toBeNull();
  });

  test('returns null for an exact common domain in upper case', () => {
    expect(suggestEmail('jean@GMAIL.COM')).toBeNull();
  });

  test('returns null when the domain is shorter than 4 characters', () => {
    expect(suggestEmail('jean@a.c')).toBeNull();
    expect(suggestEmail('jean@gm')).toBeNull();
  });

  test('returns null without an @', () => {
    expect(suggestEmail('jean.gmial.com')).toBeNull();
  });

  test('returns null when the @ is the first character', () => {
    expect(suggestEmail('@gmial.com')).toBeNull();
  });

  test('returns null for an empty input', () => {
    expect(suggestEmail('')).toBeNull();
  });

  test('returns null for an empty domain', () => {
    expect(suggestEmail('jean@')).toBeNull();
  });

  test('returns null when the closest common domain is 3 or more edits away', () => {
    expect(suggestEmail('jean@hotmail.xxx')).toBeNull();
    expect(suggestEmail('jean@gmxxxxl.com')).toBeNull();
  });

  test('returns null for an unrelated domain', () => {
    expect(suggestEmail('jean@example.org')).toBeNull();
  });

  test('resolves a tie to the first candidate of the list', () => {
    expect(suggestEmail('jean@hotmail.xx')).toBe('jean@hotmail.fr');
  });

  test('trims whitespace around the domain', () => {
    expect(suggestEmail('jean@gmial.com ')).toBe('jean@gmail.com');
    expect(suggestEmail('jean@ gmial.com')).toBe('jean@gmail.com');
  });
});
