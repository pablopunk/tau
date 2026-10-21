import { chromium } from "@playwright/test";
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
await page.goto(process.argv[2] ?? "http://127.0.0.1:49279/");
await page.getByRole("button", { name: "Dictate" }).waitFor({ timeout: 15000 });
const info = await page.evaluate(() => {
  const btns = [...document.querySelectorAll("button")].filter(b => /dictate|keyboard/i.test(b.getAttribute("aria-label") || ""));
  return btns.map(b => {
    const r = b.getBoundingClientRect();
    const cs = getComputedStyle(b);
    return { label: b.getAttribute("aria-label"), w: r.width, h: r.height, cls: b.className.slice(-120), width: cs.width, height: cs.height, borderRadius: cs.borderRadius };
  });
});
console.log(JSON.stringify(info, null, 1));
await browser.close();
