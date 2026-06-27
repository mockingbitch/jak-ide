# Project

AI First IDE

Stack

- Electron
- React
- TypeScript
- Rust
- Monaco
- SQLite

Rules

Always

- Keep modules decoupled.
- Use dependency injection.
- Never create circular dependencies.
- Follow feature-based architecture.
- Write strongly typed code.
- Avoid any.
- Prefer composition over inheritance.

Performance

- Never block UI thread.
- Heavy tasks must run in Rust.
- IPC must be async.

Coding

- Functional programming preferred.
- Small components.
- Pure functions.
- Maximum file size 500 LOC.

Testing

Every feature must include tests.