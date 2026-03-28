declare module 'screenshot-desktop' {
  function screenshot(options?: { format?: 'png' | 'jpg'; screen?: number }): Promise<Buffer>;
  export default screenshot;
}
