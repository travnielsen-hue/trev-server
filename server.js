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
    if (og && og.content) return { value: og.content.trim(), source: 'og:title' };
    const h1 = document.querySelector('h1');
    if (h1 && h1.textContent.trim()) return { value: h1.textContent.trim(), source: 'h1' };
    if (document.title) return { value: document.title.trim(), source: 'document.title' };
    return { value: null, source: 'none' };
  });
  console.log(`[extract] name found via ${name.source}: ${name.value}`);

  const priceText = await page.evaluate(() => {
    const candidates = Array.from(document.querySelectorAll('[class*="price" i]')).filter(
      (el) => el.textContent && el.textContent.includes('$')
    );
    if (candidates.length === 0) return null;
    return candidates[0].textContent.trim();
  });
  console.log(`[extract] price found: ${priceText}`);

  const image = await page.evaluate(() => {
    const og = document.querySelector('meta[property="og:image"]');
    if (og && og.content) return { value: og.content, source: 'og:image' };

    const imgs = Array.from(document.querySelectorAll('img'));

    const productImgs = imgs.filter((img) => img.src && img.src.includes('product'));
    if (productImgs.length > 0) {
      let best = productImgs[0];
      let bestArea = 0;
      for (const img of productImgs) {
        const area = (img.naturalWidth || img.width || 0) * (img.naturalHeight || img.height || 0);
        if (area > bestArea) {
          bestArea = area;
          best = img;
        }
      }
      return { value: best.src, source: 'largest img with "product" in src' };
    }

    const wideImg = imgs.find((img) => (img.naturalWidth || img.width || 0) > 300 && img.src);
    if (wideImg) return { value: wideImg.src, source: 'first img with width > 300' };

    return { value: null, source: 'none' };
  });
  console.log(`[extract] image found via ${image.source}: ${image.value}`);

  const domain = new URL(url).hostname;
  const retailer = retailerNameFromDomain(domain);
  const priceValue = parsePriceValue(priceText);

  return {
    name: name.value || null,
    price: priceText || null,
    priceValue,
    image: image.value || null,
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
    await page.waitForLoadState('networkidle', { timeout: 30000 });
    console.log(`[scrape] ${url} -> page load state: networkidle`);

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
