/**
 * Test-only setup for every spec. jsdom has no layout or scrolling: the router's scroll
 * restoration calls `window.scrollTo` on each navigation, which jsdom answers with a "Not
 * implemented" error per call. A no-op keeps the output to real problems.
 */
window.scrollTo = () => undefined;
