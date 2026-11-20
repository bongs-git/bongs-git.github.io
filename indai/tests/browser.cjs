// Each test gets a disconnected backend by default. Page-specific fixtures take precedence.
const { chromium: engine, devices } = require('playwright');
const chromium = {
  async launch(options = {}) {
    const browser = await engine.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, ...options });
    const newContext = browser.newContext.bind(browser);
    browser.newContext = async (options = {}) => {
      const context = await newContext(options);
      await context.route('**://zptjziewsfuvfcogrikz.supabase.co/**', route => {
        const url = new URL(route.request().url());
        if (url.pathname.endsWith('/indai_gex_levels')) return route.fulfill({contentType:'application/json',body:'[]'});
        if (url.pathname.endsWith('/indai-tv')) return route.fulfill({contentType:'application/json',body:JSON.stringify({bars:[],alerts:[]})});
        const status = url.pathname.endsWith('/indai-brain') && route.request().method() === 'GET';
        return route.fulfill({ status: status ? 200 : 503, contentType: 'application/json', body: JSON.stringify(status ? { configured: false, passcode: false } : { error: 'test_offline', message: 'Offline test fixture' }) });
      });
      await context.route('https://www.tradingview-widget.com/embed-widget/**', route => route.fulfill({contentType:'text/html',body:'<!doctype html><html><body>TradingView fixture</body></html>'}));
      return context;
    };
    return browser;
  },
};
// UI and backend tests do not download neural voice models. Sound tests exercise audio separately.
async function quietFixture(page) {
  await page.addInitScript(() => {
    if (window !== window.top) return;
    const settings = JSON.parse(localStorage.getItem('jarvis.settings.v1') || '{}');
    settings.voice = false;
    localStorage.setItem('jarvis.settings.v1', JSON.stringify(settings));
  });
}
module.exports = { chromium, devices, quietFixture };
