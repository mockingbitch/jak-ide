import { describe, it, expect } from 'vitest';
import { candidateSymbols, implTargets, implHover } from './implementations';

describe('candidateSymbols', () => {
  it('picks classes/interfaces from a hierarchical documentSymbol tree, recursing children', () => {
    const symbols = [
      {
        name: 'AuthRepositoryInterface',
        kind: 11, // Interface
        selectionRange: { start: { line: 5, character: 10 }, end: { line: 5, character: 34 } },
        children: [
          { name: 'find', kind: 6, selectionRange: { start: { line: 6, character: 4 }, end: { line: 6, character: 8 } } },
          { name: 'Nested', kind: 5, selectionRange: { start: { line: 9, character: 2 }, end: { line: 9, character: 8 } } },
        ],
      },
      { name: 'someFn', kind: 12, selectionRange: { start: { line: 20, character: 0 }, end: { line: 20, character: 6 } } },
    ];
    const c = candidateSymbols(symbols);
    expect(c.map((x) => x.name)).toEqual(['AuthRepositoryInterface', 'Nested']); // method + function skipped
    expect(c[0]).toMatchObject({ line: 5, character: 10 });
  });

  it('handles flat SymbolInformation (location.range) and non-arrays', () => {
    const flat = [{ name: 'Foo', kind: 5, location: { range: { start: { line: 0, character: 6 }, end: { line: 0, character: 9 } } } }];
    expect(candidateSymbols(flat).map((x) => x.name)).toEqual(['Foo']);
    expect(candidateSymbols(null)).toEqual([]);
  });
});

describe('implTargets', () => {
  const root = 'file:///project';
  it('maps same-project locations to relative 1-based targets', () => {
    const res = [
      { uri: 'file:///project/app/UserRepository.php', range: { start: { line: 9, character: 6 }, end: { line: 9, character: 20 } } },
      { uri: 'file:///project/app/CachedUserRepo.php', range: { start: { line: 3, character: 6 }, end: { line: 3, character: 20 } } },
    ];
    const t = implTargets(res, root, 'app/AuthRepositoryInterface.php', 6);
    expect(t).toEqual([
      { path: 'app/UserRepository.php', line: 10 },
      { path: 'app/CachedUserRepo.php', line: 4 },
    ]);
  });

  it('drops out-of-project targets and the declaration itself', () => {
    const res = [
      { uri: 'file:///elsewhere/Vendor.php', range: { start: { line: 1, character: 0 }, end: { line: 1, character: 1 } } },
      { uri: 'file:///project/app/Iface.php', range: { start: { line: 4, character: 6 }, end: { line: 4, character: 9 } } }, // self
    ];
    expect(implTargets(res, root, 'app/Iface.php', 5)).toEqual([]);
  });

  it('accepts LocationLink shape and null', () => {
    const res = [{ targetUri: 'file:///project/a.php', targetSelectionRange: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } } }];
    expect(implTargets(res, root, 'x.php', 1)).toEqual([{ path: 'a.php', line: 1 }]);
    expect(implTargets(null, root, 'x.php', 1)).toEqual([]);
  });
});

describe('implHover', () => {
  it('summarises implementers by unique file name', () => {
    const md = implHover([
      { path: 'app/UserRepository.php', line: 10 },
      { path: 'app/UserRepository.php', line: 44 }, // same file, another method — dedup by name
      { path: 'app/CachedUserRepo.php', line: 4 },
    ]);
    expect(md).toContain('**Implementations** (3)');
    expect(md).toContain('UserRepository.php');
    expect(md).toContain('CachedUserRepo.php');
  });
});
