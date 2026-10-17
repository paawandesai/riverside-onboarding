// Radix dialogs lock page scrolling by adding a <style> tag. The server's CSP allows style tags only
// with this response's nonce, which it writes into a meta tag; Radix reads it from __webpack_nonce__.
// Imported first in main.tsx so the nonce is in place before any dialog opens.
const nonce = document.querySelector<HTMLMetaElement>('meta[name="csp-nonce"]')?.content;
if (nonce && nonce !== "__CSP_NONCE__") (globalThis as { __webpack_nonce__?: string }).__webpack_nonce__ = nonce;

export {};
