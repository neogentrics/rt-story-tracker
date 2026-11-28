'use strict';
// Clicks a toolbar button wherever the window's width has put it: on the bar, or in the More menu.
//
// The bar arranges itself again when its words or the window change, which they can just after a project opens. That can move the button
// into More, or back out, between looking for it and clicking it, and a click on a button in the closed menu waits until it times out. So
// each try is short, and it looks again until a click lands.
const TRY_MS = 2000;
const GIVE_UP_MS = 30000;

module.exports = async function tool(window, selector) {
  const button = window.locator(selector).first();
  await button.waitFor({ state: 'attached' });
  const until = Date.now() + GIVE_UP_MS;
  for (;;) {
    try {
      if (await button.evaluate((node) => Boolean(node.closest('.more-menu[hidden]')))) await window.click('.more-button', { timeout: TRY_MS });
      await button.click({ timeout: TRY_MS });
      return;
    } catch (error) {
      if (error.name !== 'TimeoutError' || Date.now() > until) throw error;
    }
  }
};
