// Drives the REAL dashboard (live Strike data, clean state) and saves 2x screenshots of each state for the video.
import puppeteer from "puppeteer-core";
import { mkdirSync } from "node:fs";

const BASE = "http://127.0.0.1:8790";
const OUT = "shots";
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  headless: "new",
  args: ["--hide-scrollbars", "--force-color-profile=srgb"],
  defaultViewport: { width: 1440, height: 900, deviceScaleFactor: 2 },
});
const page = await browser.newPage();
page.setDefaultTimeout(120_000);

const go = async (hash) => {
  await page.goto(`${BASE}/#${hash}`, { waitUntil: "networkidle2" });
  await page.reload({ waitUntil: "networkidle2" });
};
const shot = async (name, full = false) => {
  await sleep(600);
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: full });
  console.log("saved", name, full ? "(full)" : "");
};
const clickText = async (sel, text) => {
  const h = await page.evaluateHandle((s, t) => [...document.querySelectorAll(s)].find((e) => e.textContent.trim().includes(t)), sel, text);
  const el = h.asElement();
  if (!el) throw new Error(`no ${sel} with "${text}"`);
  await el.evaluate((n) => { n.scrollIntoView({ block: "center" }); n.click(); });
};

// 1 Overview (live data: wait for every async panel)
await go("overview");
await page.waitForSelector(".bars .bar-row");
await page.waitForSelector("table.cmp");
await page.waitForFunction(() => document.querySelectorAll(".tablewrap tbody tr").length >= 5);
await page.waitForFunction(() => document.querySelectorAll(".bar-spark svg polyline").length >= 6);
await sleep(2500);
await shot("overview", true);
await shot("overview-top");

// 2 Markets
await go("radar");
await page.waitForSelector("tbody tr");
await shot("markets");
await clickText(".filters button", "Stocks");
await sleep(500);
await shot("markets-stocks");

// 3 Check a trade
await go("circuit");
await page.waitForSelector(".preset");
await shot("circuit-empty");
await clickText(".preset", "The risky one");
await page.waitForSelector(".vhero");
await page.waitForSelector("table.cmp");
await shot("circuit-risky", true);
await shot("circuit-risky-top");
await clickText(".preset", "A safer one");
await page.waitForFunction(() => /Allowed/.test(document.querySelector(".vtitle")?.textContent ?? ""));
await shot("circuit-safe-top");

// 4 Weekend risk + protection
await go("positions");
await page.waitForSelector(".proposal, tbody tr", { timeout: 120_000 });
await page.waitForFunction(() => document.querySelectorAll(".inbar").length >= 10, { timeout: 120_000 });
await sleep(1500);
await shot("positions", true);
await shot("positions-top");
await clickText("button", "Add protection");
await page.waitForSelector(".proposal");
await shot("positions-proposal");
await page.evaluate(() => document.querySelector(".proposal")?.scrollIntoView({ block: "center" }));
await shot("positions-proposal-focus");
await clickText(".proposal button", "Confirm");
await page.waitForSelector(".prop-res");
await shot("positions-confirmed");

// 5 Audit log
await go("log");
await page.waitForSelector("tbody tr");
await clickText("button", "Verify the whole log");
await page.waitForSelector(".verify-ok");
await shot("log");

// 6 Credit
await go("credit");
await clickText("button", "Check health");
await page.waitForSelector(".vhero");
await page.waitForSelector("table.heat");
await sleep(800);
await shot("credit", true);
await shot("credit-top");

// 7 Vault
await go("vault");
await page.waitForSelector(".kpi");
await clickText("button", "Run mandate check now");
await page.waitForFunction(() => document.querySelectorAll("tbody tr").length >= 7, { timeout: 120_000 });
await sleep(800);
await shot("vault", true);

await browser.close();
console.log("done");
