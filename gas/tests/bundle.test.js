import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { buildBundle } from '../tools/bundle.mjs';

describe('單檔 Code.gs', () => {
  const text = buildBundle();
  it('與 src 同步（改了 src 請執行 node gas/tools/bundle.mjs）', () => {
    expect(fs.readFileSync(path.resolve(__dirname, '../dist/Code.gs'), 'utf8')).toBe(text);
  });
  it('單一檔案可載入並含主要函式', () => {
    const ctx = {};
    vm.createContext(ctx);
    vm.runInContext(text, ctx);
    for (const f of ['doPost', 'setup', 'generateToken', 'showSetupInfo']) expect(typeof ctx[f]).toBe('function');
  });
});
