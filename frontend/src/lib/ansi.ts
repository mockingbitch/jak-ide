// The Run panel shows a plain text log (the interactive terminal handles colours),
// so we strip ANSI escape sequences and normalise carriage returns from captured
// command output. Pure + testable.

// CSI / OSC / single-char escape sequences.
// eslint-disable-next-line no-control-regex
const ANSI = /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1B\\))/g;

export function cleanOutput(s: string): string {
  return (
    s
      .replace(ANSI, '')
      // CRLF → LF; a lone CR (progress redraws) collapses to LF so lines don't overwrite.
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
  );
}
