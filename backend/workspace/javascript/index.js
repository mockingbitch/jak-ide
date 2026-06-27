// A tiny Node script. Try: `node javascript/index.js` in the terminal panel.
function fib(n) {
  let a = 0;
  let b = 1;
  for (let i = 0; i < n; i++) {
    [a, b] = [b, a + b];
  }
  return a;
}

const n = 10;
console.log(`fib(${n}) = ${fib(n)}`);
