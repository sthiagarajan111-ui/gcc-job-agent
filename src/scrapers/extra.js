const axios = require('axios');
const cheerio = require('cheerio');

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

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

async function scrapeIndeedGulf(role, location) {
  await delay(3000);
  try {
    const url = `https://gulf.indeed.com/jobs?q=${encodeURIComponent(role)}&l=${encodeURIComponent(location)}`;
    const { data } = await axios.get(url, { headers: { 'User-Agent': USER_AGENT } });
    const $ = cheerio.load(data);
    const jobs = [];

    $('[class*="job"], [class*="result"], [class*="card"]').each((_, card) => {
      if (jobs.length >= 10) return false;

      const title = $(card)
        .find('.jobTitle span, .jobTitle a, h2.jobTitle')
        .first()
        .text()
        .trim();
      if (!title) return;

      const company = $(card)
        .find('.companyName, [data-testid="company-name"]')
        .first()
        .text()
        .trim();
      const loc = $(card)
        .find('.companyLocation, [data-testid="text-location"]')
        .first()
        .text()
        .trim();

      let href = $(card).find('a').first().attr('href') || '';
      if (href && !href.startsWith('http')) href = 'https://gulf.indeed.com' + href;

      jobs.push(buildJob(title, company, loc, href, 'Indeed'));
    });

    return jobs;
  } catch (err) {
    console.error('IndeedGulf scraper error:', err.message);
    return [];
  }
}

async function scrapeMichaelPage(role, location) {
  await delay(3000);
  try {
    const rolePath = role.toLowerCase().replace(/\s+/g, '-');
    const locPath = location.toLowerCase().replace(/\s+/g, '-');
    const url = `https://www.michaelpage.ae/jobs/${rolePath}/in/${locPath}`;
    const { data } = await axios.get(url, { headers: { 'User-Agent': USER_AGENT } });
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

    return jobs;
  } catch (err) {
    console.error('MichaelPage scraper error:', err.message);
    return [];
  }
}

async function scrapeMonsterGulf(role, location) {
  await delay(3000);
  try {
    const rolePath = role.toLowerCase().replace(/\s+/g, '-');
    const locPath = location.toLowerCase().replace(/\s+/g, '-');
    const url = `https://www.monstergulf.com/jobs-in-${locPath}/${rolePath}/`;
    const { data } = await axios.get(url, { headers: { 'User-Agent': USER_AGENT } });
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

    return jobs;
  } catch (err) {
    console.error('MonsterGulf scraper error:', err.message);
    return [];
  }
}

module.exports = { scrapeIndeedGulf, scrapeMichaelPage, scrapeMonsterGulf };
