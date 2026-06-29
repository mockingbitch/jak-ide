// Typed view of the Electron preload bridge (desktop/preload.js → window.jakide).
// Absent in the browser/web build, hence every member — and `jakide` itself — is optional.
interface JakideBridge {
  readonly platform?: string;
  readonly isDesktop?: boolean;
  readonly pickFolder?: () => Promise<string | null>;
  readonly setApiKey?: () => Promise<void>;
  readonly toggleDevTools?: () => void;
  readonly promptSubmit?: (value: string) => void;
  readonly promptCancel?: () => void;
}

interface Window {
  readonly jakide?: JakideBridge;
}
