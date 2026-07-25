import { describe, expect, it } from 'vitest';
import { parsePorcelainV1Z } from './git-status';

describe('Git porcelain v1 -z parser', () => {
  it('keeps Windows paths, spaces, quotes and Unicode literal', () => {
    expect(
      parsePorcelainV1Z(
        ' M src\\中文 目录\\app.tsx\0?? docs\\a "quoted" file.md\0A  C:\\absolute-looking.txt\0',
      ),
    ).toEqual([
      ' M src\\中文 目录\\app.tsx',
      '?? docs\\a "quoted" file.md',
      'A  C:\\absolute-looking.txt',
    ]);
  });

  it('restores source to target order for renamed and copied files', () => {
    expect(
      parsePorcelainV1Z('R  src\\new name.ts\0src\\old name.ts\0 C copied.txt\0source.txt\0'),
    ).toEqual(['R  src\\old name.ts → src\\new name.ts', ' C source.txt → copied.txt']);
  });

  it('renders control characters without breaking rows', () => {
    expect(parsePorcelainV1Z(' M line\nbreak\tname\u0085\u202Etxt.ts\0')).toEqual([
      ' M line\\nbreak\\tname\\u0085\\u202etxt.ts',
    ]);
  });

  it('rejects truncated or malformed records', () => {
    expect(() => parsePorcelainV1Z(' M missing-terminator')).toThrow('无法识别');
    expect(() => parsePorcelainV1Z('invalid\0')).toThrow('无法识别');
    expect(() => parsePorcelainV1Z('R  target.ts\0')).toThrow('无法识别');
  });
});
