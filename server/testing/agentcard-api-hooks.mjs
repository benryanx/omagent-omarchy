const target = process.env.OMAGENT_TEST_AGENTCARD_API;
if (process.env.OMAGENT_DATA_DIR !== process.env.HOME || !target || !/^http:\/\/127\.0\.0\.1:[1-9]\d{0,4}$/.test(target)) {
  throw new Error("The Agentcard API stand-in requires an explicitly isolated fixture.");
}
const original = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.origin === "https://api.agentcard.sh" && url.pathname.startsWith("/api/v2/")) {
    return original(`${target}${url.pathname}${url.search}`, init);
  }
  return original(input, init);
};
