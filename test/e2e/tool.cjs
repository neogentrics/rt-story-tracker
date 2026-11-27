'use strict';
// Clicks a toolbar button wherever the window's width has put it: on the bar, or in the More menu.
module.exports = async function tool(window, selector) {
  const button = window.locator(selector).first();
  await button.waitFor({ state: 'attached' });
  if (await button.evaluate((node) => Boolean(node.closest('.more-menu[hidden]')))) await window.click('.more-button');
  await button.click();
};
