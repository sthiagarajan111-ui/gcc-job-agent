const axios = require('axios');
const cheerio = require('cheerio');

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

async function scrapeMichaelPage(role, location) {
  await delay(3000);
  try {
    const rolePath = role.toLowerCase().replace(/\s+/g, '-');
    const locPath = (location || 'uae').toLowerCase().replace(/\s+/g, '-');
    const url = `https://www.michaelpage.ae/jobs/${rolePath}/in/${locPath}`;
    const data = await fetchWithRetry(url);
    const $ = cheerio.load(data);
    const jobs = [];

    $('[class*="job"], article, li[class*="job"]').each((_, card) => {
      if (jobs.length >= 10) return false;
      const title = $(card)
        .find('.job-title, h2 a, .title a')
        .first()
        .text()
        .trim();
      if (!title) return;
      const company = $(card)
        .find('.job-company, .company, span.employer')
        .first()
        .text()
        .trim();
      const loc = $(card)
        .find('.job-location, .location, span.location')
        .first()
        .text()
        .trim();
      let href =
        $(card).find('.job-title, h2 a, .title a').first().attr('href') ||
        $(card).find('a').first().attr('href') ||
        '';
      if (href && !href.startsWith('http')) href = 'https://www.michaelpage.ae' + href;
      jobs.push(buildJob(title, company, loc, href, 'Michael Page'));
    });

    console.log(`[MichaelPage] scraper: ${jobs.length} jobs found`);
    return jobs;
  } catch (err) {
    console.log(`[MichaelPage] scraper error: ${err.message}`);
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

async function scrapeJobsAe() {
  await delay(1000);
  try {
    const url = 'https://www.jobs.ae/jobs/in-uae';
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
      if (href && !href.startsWith('http')) href = 'https://www.jobs.ae' + href;
      jobs.push(buildJob(title, company, loc, href, 'Jobs.ae'));
    });

    console.log(`[Jobs.ae] scraper: ${jobs.length} jobs found`);
    return jobs;
  } catch (err) {
    console.log(`[Jobs.ae] scraper error: ${err.message}`);
    return [];
  }
}

async function scrapeGulfRecruiter() {
  await delay(1000);
  try {
    const url = 'https://www.gulfrecruiter.com/jobs';
    const data = await fetchWithRetry(url);
    const $ = cheerio.load(data);
    const jobs = [];

    $('[class*="job"], article, li[class*="job"]').each((_, card) => {
      if (jobs.length >= 10) return false;
      const title = $(card).find('h2, h3, [class*="title"], a').first().text().trim();
      if (!title) return;
      const company = $(card).find('[class*="company"], [class*="employer"]').first().text().trim();
      const loc = $(card).find('[class*="location"]').first().text().trim();
      let href = $(card).find('a').first().attr('href') || '';
      if (href && !href.startsWith('http')) href = 'https://www.gulfrecruiter.com' + href;
      jobs.push(buildJob(title, company, loc, href, 'GulfRecruiter'));
    });

    console.log(`[GulfRecruiter] scraper: ${jobs.length} jobs found`);
    return jobs;
  } catch (err) {
    console.log(`[GulfRecruiter] scraper error: ${err.message}`);
    return [];
  }
}

async function scrapeKhaleejTimes() {
  await delay(1000);
  try {
    const url = 'https://jobs.khaleejtimes.com/jobs';
    const data = await fetchWithRetry(url);
    const $ = cheerio.load(data);
    const jobs = [];

    $('[class*="job"], article, li[class*="job"]').each((_, card) => {
      if (jobs.length >= 10) return false;
      const title = $(card).find('h2, h3, [class*="title"], a').first().text().trim();
      if (!title) return;
      const company = $(card).find('[class*="company"], [class*="employer"]').first().text().trim();
      const loc = $(card).find('[class*="location"]').first().text().trim();
      let href = $(card).find('a').first().attr('href') || '';
      if (href && !href.startsWith('http')) href = 'https://jobs.khaleejtimes.com' + href;
      jobs.push(buildJob(title, company, loc, href, 'Khaleej Times'));
    });

    console.log(`[KhaleejTimes] scraper: ${jobs.length} jobs found`);
    return jobs;
  } catch (err) {
    console.log(`[KhaleejTimes] scraper error: ${err.message}`);
    return [];
  }
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
