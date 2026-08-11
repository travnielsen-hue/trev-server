const express = require('express');
const { chromium } = require('playwright');

const app = express();
const PORT = 3000;

app.use(express.json());

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

function retailerNameFromDomain(domain) {
  const cleaned = domain.replace(/^www\./, '');
  const base = cleaned.split('.')[0];
  const overrides = {
    theiconic: 'The Iconic',
    generalpants: 'General Pants',
    countryroad: 'Country Road',
    princesspolly: 'Princess Polly',
    hellomolly: 'Hello Molly',
    seedheritage: 'Seed Heritage',
    rmwilliams: 'R.M. Williams',
    assemblylabel: 'Assembly Label',
    roddandgunn: 'Rodd & Gunn',
    mjbale: 'MJ Bale',
    sportsgirl: 'Sportsgirl',
    sassandbide: 'Sass & Bide',
    becandbridge: 'Bec & Bridge',
    footlocker: 'Foot Locker',
    hypedc: 'HypeDC',
    nudiejeans: 'Nudie Jeans',
    sportscraft: 'Sportscraft',
  };
  if (overrides[base]) return overrides[base];
  return base
    .replace(/[-_]/g, ' ')
    .split(' ')
    .map((w) => (w.length ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ');
}

function parsePriceValue(text) {
  if (!text) return null;
  const match = text.replace(/,/g, '').match(/(\d+(\.\d{1,2})?)/);
  return match ? parseFloat(match[1]) : null;
}

async function extractProduct(page, url) {
  const name = await page.evaluate(() => {
    const og = document.querySelector('meta[property="og:title"]');
    if (og && og.content) return og.content.trim();
    const h1 = document.querySelector('h1');
    if (h1 && h1.textContent.trim()) return h1.textContent.trim();
    return document.title ? document.title.trim() : null;
  });

  const priceText = await page.evaluate(() => {
    const isVisible = (el) => {
      const style = window.getComputedStyle(el);
      return style.display !== 'none' && style.visibility !== 'hidden' && style.textDecoration.indexOf('line-through') === -1;
    };

    const candidates = Array.from(
      document.querySelectorAll('[class*="price" i], [class*="Price" i], [id*="price" i], [data-price], [itemprop="price"]')
    ).filter((el) => isVisible(el) && el.textContent && el.textContent.trim().length > 0 && el.textContent.trim().length < 40);

    if (candidates.length === 0) return null;

    const saleKeywords = ['sale', 'special', 'discount', 'now', 'current'];
    const original = ['was', 'original', 'rrp', 'compare'];

    const scored = candidates.map((el) => {
      const cls = (el.className || '').toString().toLowerCase();
      let score = 0;
      if (saleKeywords.some((k) => cls.includes(k))) score += 2;
      if (original.some((k) => cls.includes(k))) score -= 2;
      if (el.tagName === 'DEL' || el.tagName === 'S' || el.tagName === 'STRIKE') score -= 3;
      return { el, score, text: el.textContent.trim() };
    });

    scored.sort((a, b) => b.score - a.score);
    return scored[0] ? scored[0].text : null;
  });

  const image = await page.evaluate(() => {
    const og = document.querySelector('meta[property="og:image"]');
    if (og && og.content) return og.content;

    const imgs = Array.from(document.querySelectorAll('img'));
    let best = null;
    let bestArea = 0;
    for (const img of imgs) {
      const area = (img.naturalWidth || img.width || 0) * (img.naturalHeight || img.height || 0);
      if (area > bestArea && img.src) {
        bestArea = area;
        best = img.src;
      }
    }
    return best;
  });

  const domain = new URL(url).hostname;
  const retailer = retailerNameFromDomain(domain);
  const priceValue = parsePriceValue(priceText);

  return {
    name: name || null,
    price: priceText || null,
    priceValue,
    image: image || null,
    retailer,
    url,
  };
}

app.post('/scrape', async (req, res) => {
  const { url } = req.body || {};

  if (!url) {
    console.log(`[scrape] no url provided -> failure`);
    return res.status(400).json({ success: false, error: 'Missing "url" in request body' });
  }

  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000);

    const product = await extractProduct(page, url);

    console.log(`[scrape] ${url} -> success: ${JSON.stringify(product)}`);
    res.json({ success: true, product });
  } catch (err) {
    console.log(`[scrape] ${url} -> error: ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
  } finally {
    if (browser) {
      await browser.close();
    }
  }
});

app.listen(PORT, () => {
  console.log(`trev. scrape server listening on port ${PORT}`);
});
