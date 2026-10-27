import { describe, expect, it } from 'vitest';
import { CSV_EOL, csvRow, UTF8_BOM } from './csv';

describe('csvRow', () => {
  it('joins plain cells with commas and ends the line with CRLF', () => {
    expect(csvRow(['P-000001', 'Rana Haddad', '34'])).toBe('P-000001,Rana Haddad,34\r\n');
    expect(CSV_EOL).toBe('\r\n');
    expect(csvRow([])).toBe('\r\n');
  });

  it('keeps empty cells', () => {
    expect(csvRow(['a', '', 'c', ''])).toBe('a,,c,\r\n');
  });

  it('quotes cells with commas, quotes or line breaks (RFC 4180), doubling quotes', () => {
    expect(csvRow(['Haddad, Rana'])).toBe('"Haddad, Rana"\r\n');
    expect(csvRow(['Rana "Rou" Haddad'])).toBe('"Rana ""Rou"" Haddad"\r\n');
    expect(csvRow(['line one\nline two'])).toBe('"line one\nline two"\r\n');
    expect(csvRow(['line one\r\nline two'])).toBe('"line one\r\nline two"\r\n');
    expect(csvRow(['"'])).toBe('""""\r\n');
  });

  it('leaves Arabic and accented text as is', () => {
    expect(csvRow(['رنا حداد', 'José Álvarez'])).toBe('رنا حداد,José Álvarez\r\n');
  });

  it("prefixes cells that a spreadsheet would run as a formula with '", () => {
    expect(csvRow(['=SUM(1)'])).toBe("'=SUM(1)\r\n");
    expect(csvRow(['+1'])).toBe("'+1\r\n");
    expect(csvRow(['@x'])).toBe("'@x\r\n");
    expect(csvRow(['-cmd'])).toBe("'-cmd\r\n");
    expect(csvRow(['\tcmd'])).toBe("'\tcmd\r\n");
    // Quoted too: it contains a CR.
    expect(csvRow(['\rcmd'])).toBe(`"'\rcmd"\r\n`);
    // Guarded, then quoted and doubled like any other cell.
    expect(csvRow(['=HYPERLINK("http://x","y")'])).toBe(`"'=HYPERLINK(""http://x"",""y"")"\r\n`);
  });

  it('guards a leading line feed', () => {
    expect(csvRow(['\n=1'])).toBe(`"'\n=1"\r\n`);
  });

  it('guards the full-width trigger characters', () => {
    // U+FF1D, U+FF0B, U+FF0D, U+FF20: some spreadsheets normalise them to = + - @.
    for (const code of [0xff1d, 0xff0b, 0xff0d, 0xff20]) {
      const cell = `${String.fromCharCode(code)}SUM(1)`;
      expect(csvRow([cell])).toBe(`'${cell}\r\n`);
    }
  });

  it('guards a trigger behind leading whitespace', () => {
    expect(csvRow([' =SUM(1)'])).toBe("' =SUM(1)\r\n");
    expect(csvRow(['   +1'])).toBe("'   +1\r\n");
    expect(csvRow([`${String.fromCharCode(0x3000)}@x`])).toBe(
      `'${String.fromCharCode(0x3000)}@x\r\n`,
    );
    expect(csvRow([' -5.00'], { numericColumns: [0] })).toBe("' -5.00\r\n");
    // Whitespace alone, or before ordinary text, is left alone.
    expect(csvRow(['  Rana', ' '])).toBe('  Rana, \r\n');
  });

  it('only guards the first character', () => {
    expect(csvRow(['Rana=Haddad', 'a-b', 'x@y.com'])).toBe('Rana=Haddad,a-b,x@y.com\r\n');
  });

  it('exempts decimal strings in numeric columns, and only those', () => {
    const numericColumns = [1];
    expect(csvRow(['-50.00', '-50.00'], { numericColumns })).toBe("'-50.00,-50.00\r\n");
    expect(csvRow(['x', '-5'], { numericColumns })).toBe('x,-5\r\n');
    expect(csvRow(['x', '250.00'], { numericColumns })).toBe('x,250.00\r\n');
    // Not a decimal: guarded even in a numeric column.
    expect(csvRow(['x', '-1+2'], { numericColumns })).toBe("x,'-1+2\r\n");
    expect(csvRow(['x', '=1'], { numericColumns })).toBe("x,'=1\r\n");
    expect(csvRow(['x', '+50.00'], { numericColumns })).toBe("x,'+50.00\r\n");
    expect(csvRow(['x', '-'], { numericColumns })).toBe("x,'-\r\n");
  });

  it('exposes the UTF-8 byte order mark Excel needs for non-Latin text', () => {
    expect(UTF8_BOM).toBe('\uFEFF');
  });
});
