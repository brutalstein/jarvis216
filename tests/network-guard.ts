const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname))
    throw new Error("EXTERNAL_NETWORK_DISABLED_IN_TESTS");
  return originalFetch(input, init);
};
