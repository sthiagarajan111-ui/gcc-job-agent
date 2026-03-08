const axios = require('axios');
const cheerio = require('cheerio');
const puppeteer = require('puppeteer');

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.5',
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

async function fetchWithRetry(url, retries = 1) {
  try {
    const { data } = await axios.get(url, { headers: HEADERS, timeout: 15000 });
    return data;
  } catch (err) {
    if (retries > 0) {
      await delay(2000);
      return fetchWithRetry(url, retries - 1);
    }
    throw err;
  }
}

async function scrapeIndeedGulf(role, location) {
  await delay(3000);
  try {
    const url = `https://www.indeed.com/jobs?q=${encodeURIComponent(role)}&l=${encodeURIComponent(location || 'United Arab Emirates')}&fromage=1`;
    let data;
    try {
      data = await fetchWithRetry(url);
    } catch (err) {
      if (err.response && (err.response.status === 403 || err.response.status === 429)) {
        console.log('[Indeed] scraper: blocked (403/429), returning 0 jobs');
        return [];
      }
      throw err;
    }
    const $ = cheerio.load(data);
    const jobs = [];

    $('.job_seen_beacon, .resultContent, [class*="job"], [class*="result"], [class*="card"]').each((_, card) => {
      if (jobs.length >= 10) return false;
      const title = $(card)
        .find('.jobTitle span, .jobTitle a, h2.jobTitle, [class*="jobTitle"]')
        .first()
        .text()
        .trim();
      if (!title) return;
      const company = $(card)
        .find('.companyName, [data-testid="company-name"], [class*="company"]')
        .first()
        .text()
        .trim();
      const loc = $(card)
        .find('.companyLocation, [data-testid="text-location"], [class*="location"]')
        .first()
        .text()
        .trim();
      let href = $(card).find('a').first().attr('href') || '';
      if (href && !href.startsWith('http')) href = 'https://www.indeed.com' + href;
      jobs.push(buildJob(title, company, loc, href, 'Indeed'));
    });

    console.log(`[Indeed] scraper: ${jobs.length} jobs found`);
    return jobs;
  } catch (err) {
    console.log(`[Indeed] scraper error: ${err.message}`);
    return [];
  }
}

function getMichaelPageCategory(role) {
  const r = role.toLowerCase();
  if (r.includes('finance') || r.includes('financial') || r.includes('analyst') || r.includes('investment')) {
    return 'banking-financial-services';
  }
  if (r.includes('strategy') || r.includes('consultant') || r.includes('business analyst')) {
    return 'strategy-management';
  }
  return 'sales';
}

async function scrapeMichaelPage(role, location) {
  await delay(3000);
  let browser;
  try {
    const category = getMichaelPageCategory(role);
    const url = `https://www.michaelpage.ae/jobs/${category}`;

    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    const page = await browser.newPage();
    await page.setUserAgent(HEADERS['User-Agent']);
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
    await new Promise(r => setTimeout(r, 5000));

    const jobs = await page.evaluate(() => {
      const rows = document.querySelectorAll('.views-row');
      return Array.from(rows).slice(0, 10).map(row => {
        const anchor = row.querySelector('h3 a, h2 a');
        const title = anchor ? anchor.innerText.trim() : '';
        if (!title) return null;
        const locEl = row.querySelector('.job-location');
        const salEl = row.querySelector('.salary');
        return {
          title,
          location: locEl ? locEl.innerText.trim() : '',
          salary: salEl ? salEl.innerText.trim() : '',
          applyUrl: anchor ? anchor.href : '',
        };
      }).filter(Boolean);
    });

    await browser.close();
    console.log(`[MichaelPage] scraper: ${jobs.length} jobs found`);
    return jobs.map(j => ({
      ...buildJob(j.title, '', j.location, j.applyUrl, 'Michael Page'),
      salary: j.salary || 'Not listed',
    }));
  } catch (err) {
    console.log(`[MichaelPage] scraper error: ${err.message}`);
    if (browser) await browser.close();
    return [];
  }
}

async function scrapeMonsterGulf(role, location) {
  await delay(3000);
  try {
    const rolePath = role.toLowerCase().replace(/\s+/g, '-');
    const locPath = (location || 'uae').toLowerCase().replace(/\s+/g, '-');
    const url = `https://www.monstergulf.com/jobs-in-${locPath}/${rolePath}/`;
    const data = await fetchWithRetry(url);
    const $ = cheerio.load(data);
    const jobs = [];

    $('[class*="job"], article, li[class*="job"]').each((_, card) => {
      if (jobs.length >= 10) return false;
      const title = $(card)
        .find('.job-title a, h3.title a, .position a')
        .first()
        .text()
        .trim();
      if (!title) return;
      const company = $(card)
        .find('.company-name, .employer, span.company')
        .first()
        .text()
        .trim();
      const loc = $(card)
        .find('.job-location, .location, span.loc')
        .first()
        .text()
        .trim();
      let href =
        $(card).find('.job-title a, h3.title a, .position a').first().attr('href') ||
        $(card).find('a').first().attr('href') ||
        '';
      if (href && !href.startsWith('http')) href = 'https://www.monstergulf.com' + href;
      jobs.push(buildJob(title, company, loc, href, 'Monster Gulf'));
    });

    console.log(`[MonsterGulf] scraper: ${jobs.length} jobs found`);
    return jobs;
  } catch (err) {
    console.log(`[MonsterGulf] scraper error: ${err.message}`);
    return [];
  }
}

async function scrapeDubizzle() {
  await delay(1000);
  try {
    const url = 'https://uae.dubizzle.com/jobs/';
    const data = await fetchWithRetry(url);
    const $ = cheerio.load(data);
    const jobs = [];

    $('[class*="job"], article, li[class*="job"], [class*="listing"]').each((_, card) => {
      if (jobs.length >= 10) return false;
      const title = $(card).find('h2, h3, [class*="title"]').first().text().trim();
      if (!title) return;
      const company = $(card).find('[class*="company"], [class*="employer"]').first().text().trim();
      const loc = $(card).find('[class*="location"]').first().text().trim();
      let href = $(card).find('a').first().attr('href') || '';
      if (href && !href.startsWith('http')) href = 'https://uae.dubizzle.com' + href;
      jobs.push(buildJob(title, company, loc, href, 'Dubizzle'));
    });

    console.log(`[Dubizzle] scraper: ${jobs.length} jobs found`);
    return jobs;
  } catch (err) {
    console.log(`[Dubizzle] scraper error: ${err.message}`);
    return [];
  }
}

// Domain has expired / DNS failure — disabled
async function scrapeJobsAe() {
  return [];
}

// Domain is parked — disabled
async function scrapeGulfRecruiter() {
  return [];
}

// jobs.khaleejtimes.com DNS dead; khaleejtimes.com/jobs is news, not a job board — disabled
async function scrapeKhaleejTimes() {
  return [];
}

async function scrapeCvLibrary() {
  await delay(1000);
  try {
    const url = 'https://www.cv-library.co.uk/jobs/in-united-arab-emirates';
    const data = await fetchWithRetry(url);
    const $ = cheerio.load(data);
    const jobs = [];

    $('[class*="job"], article, li[class*="job"]').each((_, card) => {
      if (jobs.length >= 10) return false;
      const title = $(card).find('h2, h3, [class*="title"], a[class*="job"]').first().text().trim();
      if (!title) return;
      const company = $(card).find('[class*="company"], [class*="employer"]').first().text().trim();
      const loc = $(card).find('[class*="location"]').first().text().trim();
      let href = $(card).find('a').first().attr('href') || '';
      if (href && !href.startsWith('http')) href = 'https://www.cv-library.co.uk' + href;
      jobs.push(buildJob(title, company, loc, href, 'CV Library'));
    });

    console.log(`[CVLibrary] scraper: ${jobs.length} jobs found`);
    return jobs;
  } catch (err) {
    console.log(`[CVLibrary] scraper error: ${err.message}`);
    return [];
  }
}

module.exports = {
  scrapeIndeedGulf,
  scrapeMichaelPage,
  scrapeMonsterGulf,
  scrapeDubizzle,
  scrapeJobsAe,
  scrapeGulfRecruiter,
  scrapeKhaleejTimes,
  scrapeCvLibrary,
};
