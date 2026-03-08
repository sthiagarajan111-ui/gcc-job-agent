const axios = require('axios');
const cheerio = require('cheerio');
const puppeteer = require('puppeteer');

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  'Connection': 'keep-alive',
  'Upgrade-Insecure-Requests': '1',
};

const delay = ms => new Promise(r => setTimeout(r, ms));

function buildJob(title, company, location, applyUrl, source) {
  return {
    title: title ? title.trim() : '',
    company: company ? company.trim() : '',
    location: location ? location.trim() : '',
    salary: 'Not listed',
    postedDate: 'Recent',
    applyUrl,
    source,
    description: '',
  };
}

async function scrapeGulfTalent(role, location) {
  if (process.env.NODE_ENV === 'production') return [];
  await delay(3000);
  try {
    const url = `https://www.gulftalent.com/jobs?search=${encodeURIComponent(role)}&country=${encodeURIComponent(location)}`;
    const { data } = await axios.get(url, { headers: HEADERS, timeout: 15000 });
    const $ = cheerio.load(data);
    const jobs = [];

    $('a[class*="ga-job-impression"]').each((_, el) => {
      if (jobs.length >= 10) return false;
      const title = $(el).text().trim();
      if (!title) return;
      const card = $(el).closest('li, article, div[class*="job"]');
      const company = card.find('[class*="company"], [class*="employer"]').first().text().trim();
      const loc = card.find('[class*="location"]').first().text().trim();
      let href = $(el).attr('href') || '';
      if (href && !href.startsWith('http')) href = 'https://www.gulftalent.com' + href;
      jobs.push(buildJob(title, company, loc, href, 'GulfTalent'));
    });

    return jobs;
  } catch (err) {
    console.error('GulfTalent scraper error:', err.message);
    return [];
  }
}

async function scrapeNaukriGulf(role, location) {
  if (process.env.NODE_ENV === 'production') return [];
  await delay(3000);
  let browser;
  try {
    const rolePath = role.toLowerCase().replace(/\s+/g, '-');
    const locPath = location.toLowerCase().replace(/\s+/g, '-');
    const url = `https://www.naukrigulf.com/${rolePath}-jobs-in-${locPath}?lang=en`;

    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    const page = await browser.newPage();
    await page.setUserAgent(HEADERS['User-Agent']);
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' });
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
    await new Promise(r => setTimeout(r, 4000));

    const jobs = await page.evaluate(() => {
      const tuples = document.querySelectorAll('div.ng-box.srp-tuple');
      return Array.from(tuples).slice(0, 10).map(el => {
        const titleEl = el.querySelector('p.designation-title');
        const orgEl = el.querySelector('a.info-org');
        const locEl = el.querySelector('li.info-loc span:not(.ico)');
        const anchor = el.querySelector('a.info-position');
        const title = titleEl ? titleEl.innerText.trim() : '';
        if (!title) return null;
        const company = orgEl
          ? (orgEl.getAttribute('title') || orgEl.innerText).replace(/\s+/g, ' ').trim()
          : '';
        const location = locEl ? locEl.innerText.trim() : '';
        let href = anchor ? anchor.href : '';
        href = href.replace('arabic.naukrigulf.com', 'www.naukrigulf.com');
        return { title, company, location, applyUrl: href };
      }).filter(Boolean);
    });

    await browser.close();
    return jobs.map(j => buildJob(j.title, j.company, j.location, j.applyUrl, 'NaukriGulf'));
  } catch (err) {
    console.error('NaukriGulf scraper error:', err.message);
    if (browser) await browser.close();
    return [];
  }
}

async function scrapeBayt(role, location) {
  if (process.env.NODE_ENV === 'production') return [];
  await delay(3000);
  try {
    const rolePath = role.toLowerCase().replace(/\s+/g, '-');
    const locPath = location.toLowerCase().replace(/\s+/g, '-');
    const url = `https://www.bayt.com/en/international/jobs/${rolePath}-jobs-in-${locPath}/`;
    const { data } = await axios.get(url, { headers: HEADERS, timeout: 15000 });
    const $ = cheerio.load(data);
    const jobs = [];

    $('li[data-js-job]').each((_, card) => {
      if (jobs.length >= 10) return false;
      const title = $(card)
        .find('.t-bold a, [data-js-aid="jobTitleLink"], h2 a')
        .first()
        .text()
        .trim();
      if (!title) return;
      const company = $(card).find('.jb-company, .t-nowrap').first().text().trim();
      const loc = $(card)
        .find('[data-js-aid="jobLocation"], .jb-loc, .t-mute')
        .first()
        .text()
        .trim();
      let href = $(card).find('a').first().attr('href') || '';
      if (href && !href.startsWith('http')) href = 'https://www.bayt.com' + href;
      jobs.push(buildJob(title, company, loc, href, 'Bayt'));
    });

    return jobs;
  } catch (err) {
    console.error('Bayt scraper error:', err.message);
    return [];
  }
}

module.exports = { scrapeGulfTalent, scrapeNaukriGulf, scrapeBayt };
