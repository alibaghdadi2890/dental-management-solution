import { configure } from '@testing-library/react';

/**
 * Test-only setup for every spec. jsdom has no layout or scrolling: the router's scroll
 * restoration calls `window.scrollTo` on each navigation, which jsdom answers with a "Not
 * implemented" error per call, and it has no `Element.scrollIntoView` at all (the workspace chart
 * scrolls the selected tooth into view). No-ops keep the output to real problems; a spec that
 * cares spies on them.
 */
window.scrollTo = () => undefined;
Element.prototype.scrollIntoView = () => undefined;

/**
 * `findBy…` and `waitFor` wait up to 5 s, not 1 s: CI runs the API and web suites side by side on
 * one runner, and the visit workspace's first render can take longer than a second there.
 */
configure({ asyncUtilTimeout: 5000 });
