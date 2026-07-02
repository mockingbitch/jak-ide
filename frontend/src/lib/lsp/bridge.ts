import type { editor } from 'monaco-editor';

/** A tiny indirection so features outside useLsp (e.g. the implementation gutter) can
 *  issue LSP requests for a model without owning the client registry. useLsp installs
 *  the bridge on mount (routing to the right per-language client) and clears it on
 *  unmount. The bridge injects `textDocument: { uri }`; callers pass only extra params. */
export type LspBridge = (model: editor.ITextModel, method: string, params: object) => Promise<unknown>;

let bridge: LspBridge | null = null;

export const setLspBridge = (b: LspBridge | null): void => {
  bridge = b;
};

export function lspRequest<T>(model: editor.ITextModel, method: string, params: object = {}): Promise<T> {
  if (!bridge) return Promise.reject(new Error('LSP bridge not ready'));
  return bridge(model, method, params) as Promise<T>;
}
