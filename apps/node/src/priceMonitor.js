import * as cheerio from 'cheerio';

function textOf($, sel) {
  if (!sel) return '';
  const t = $(sel).first().text();
  return (t || '').trim();
}

export async function scrapePriceTarget(target) {
  const url = target.url;
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`fetch failed ${res.status} for ${url}`);
  const html = await res.text();
  const $ = cheerio.load(html);

  const name = textOf($, target.nameSelector);
  const priceText = textOf($, target.priceSelector);
  const currency = target.currency || '';

  return [{
    url,
    name,
    priceText,
    currency,
    ts: Date.now()
  }];
}
