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

async function scrapeGulfTalent(role, location) {
  await delay(3000);
  try {
    const url = `https://www.gulftalent.com/jobs?search=${encodeURIComponent(role)}&country=${encodeURIComponent(location)}`;
    const { data } = await axios.get(url, { headers: { 'User-Agent': USER_AGENT } });
    const $ = cheerio.load(data);
    const jobs = [];

    $('[class*="job"]').each((_, card) => {
      if (jobs.length >= 10) return false;

      const titleEl =
        $(card).find('.job-title a').first() ||
        $(card).find('.position-title').first() ||
        $(card).find('h3 a').first();

      const title = $(card).find('.job-title a, .position-title, h3 a').first().text().trim();
      if (!title) return;

      const company = $(card).find('.company-name, .employer-name').first().text().trim();
      const loc = $(card).find('.job-location, .location').first().text().trim();

      let href = $(card).find('.job-title a, .position-title, h3 a').first().attr('href') || '';
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
  await delay(3000);
  try {
    const rolePath = role.toLowerCase().replace(/\s+/g, '-');
    const locPath = location.toLowerCase().replace(/\s+/g, '-');
    const url = `https://www.naukrigulf.com/${rolePath}-jobs-in-${locPath}`;
    const { data } = await axios.get(url, { headers: { 'User-Agent': USER_AGENT } });
    const $ = cheerio.load(data);
    const jobs = [];

    $('[class*="job"], [class*="listing"], article').each((_, card) => {
      if (jobs.length >= 10) return false;

      const title = $(card).find('.designation-title, .job-title, h3 a').first().text().trim();
      if (!title) return;

      const company = $(card).find('.comp-name, .company-name').first().text().trim();
      const loc = $(card).find('.loc, .job-location').first().text().trim();

      let href = $(card).find('a').first().attr('href') || '';
      if (href && !href.startsWith('http')) href = 'https://www.naukrigulf.com' + href;

      jobs.push(buildJob(title, company, loc, href, 'NaukriGulf'));
    });

    return jobs;
  } catch (err) {
    console.error('NaukriGulf scraper error:', err.message);
    return [];
  }
}

async function scrapeBayt(role, location) {
  await delay(3000);
  try {
    const rolePath = role.toLowerCase().replace(/\s+/g, '-');
    const locPath = location.toLowerCase().replace(/\s+/g, '-');
    const url = `https://www.bayt.com/en/international/jobs/${rolePath}-jobs-in-${locPath}/`;
    const { data } = await axios.get(url, { headers: { 'User-Agent': USER_AGENT } });
    const $ = cheerio.load(data);
    const jobs = [];

    $('[class*="job"], li[id*="job"]').each((_, card) => {
      if (jobs.length >= 10) return false;

      const title = $(card)
        .find('[data-js-aid="jobTitleLink"], .jb-title, h2 a')
        .first()
        .text()
        .trim();
      if (!title) return;

      const company = $(card).find('.jb-company, .company-name').first().text().trim();
      const loc = $(card)
        .find('[data-js-aid="jobLocation"], .jb-loc')
        .first()
        .text()
        .trim();

      let href =
        $(card).find('[data-js-aid="jobTitleLink"], .jb-title, h2 a').first().attr('href') || '';
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
