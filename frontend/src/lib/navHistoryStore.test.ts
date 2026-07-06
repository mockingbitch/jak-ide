import { describe, it, expect, beforeEach } from 'vitest';
import { useNavHistoryStore, type NavEntry } from './navHistoryStore';

const entry = (path: string, line = 1): NavEntry => ({ path, external: false, line, column: 1 });
const st = () => useNavHistoryStore.getState();

beforeEach(() => {
  useNavHistoryStore.setState({ back: [], forward: [] });
});

describe('push', () => {
  it('appends to the back stack and clears the forward stack', () => {
    st().push(entry('a.php'));
    st().push(entry('b.php'));
    st().goBack(entry('c.php')); // seed the forward stack
    expect(st().forward).toHaveLength(1);

    st().push(entry('d.php'));
    expect(st().back.map((e) => e.path)).toEqual(['a.php', 'd.php']);
    expect(st().forward).toEqual([]);
  });

  it('caps the back stack at 50, dropping the oldest entries', () => {
    for (let i = 1; i <= 55; i++) st().push(entry(`f${i}.php`));
    const back = st().back;
    expect(back).toHaveLength(50);
    expect(back[0].path).toBe('f6.php');
    expect(back[49].path).toBe('f55.php');
  });
});

describe('goBack', () => {
  it('pops the most recent origin and pushes the current location onto forward', () => {
    st().push(entry('a.php', 10));
    st().push(entry('b.php', 20));

    const target = st().goBack(entry('c.php', 30));
    expect(target).toEqual(entry('b.php', 20));
    expect(st().back.map((e) => e.path)).toEqual(['a.php']);
    expect(st().forward).toEqual([entry('c.php', 30)]);
  });

  it('returns null and leaves state untouched when the back stack is empty', () => {
    expect(st().goBack(entry('x.php'))).toBeNull();
    expect(st().back).toEqual([]);
    expect(st().forward).toEqual([]);
  });

  it('does not record a forward entry when current is null', () => {
    st().push(entry('a.php'));
    expect(st().goBack(null)).toEqual(entry('a.php'));
    expect(st().forward).toEqual([]);
  });
});

describe('goForward', () => {
  it('pops the forward stack and pushes the current location back', () => {
    st().push(entry('a.php', 1));
    st().goBack(entry('b.php', 2)); // now back=[], forward=[b]

    const target = st().goForward(entry('a.php', 1));
    expect(target).toEqual(entry('b.php', 2));
    expect(st().forward).toEqual([]);
    expect(st().back).toEqual([entry('a.php', 1)]);
  });

  it('returns null when the forward stack is empty', () => {
    st().push(entry('a.php'));
    expect(st().goForward(entry('x.php'))).toBeNull();
    expect(st().back).toEqual([entry('a.php')]);
  });

  it('round-trips: back then forward restores the original stacks', () => {
    st().push(entry('a.php'));
    st().push(entry('b.php'));
    const back1 = st().goBack(entry('c.php'));
    expect(back1).toEqual(entry('b.php'));
    const fwd = st().goForward(back1);
    expect(fwd).toEqual(entry('c.php'));
    expect(st().back.map((e) => e.path)).toEqual(['a.php', 'b.php']);
    expect(st().forward).toEqual([]);
  });
});
