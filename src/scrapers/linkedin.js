const puppeteer = require('puppeteer');

const LOCATION_GEOIDS = {
  // GCC (existing)
  'Dubai': '106204383',
  'Abu Dhabi': '102611383',
  'Riyadh': '105149290',
  'Doha': '106048158',
  'Kuwait': '101355337',
  'Muscat': '106048158',
  'Bahrain': '96570',
  'Jeddah': '105043218',
  // UK
  'London': '90009496',
  'Manchester': '103502874',
  'Edinburgh': '104063',
  'Birmingham': '107505',
  'Leeds': '108057',
  // Ireland
  'Dublin': '106278171',
  'Cork': '104738515',
  'Galway': '106680244',
  // Europe
  'Amsterdam': '102011674',
  'Frankfurt': '100476452',
  'Paris': '105015875',
  'Zurich': '106693272',
  'Barcelona': '103035651',
  'Madrid': '100994331',
  'Berlin': '106967730',
};

async function scrapeLinkedIn(role, location, daysBack = 1) {
  if (process.env.NODE_ENV === 'production') { console.log('[LinkedIn] Skipped - production mode'); return []; }
  let browser;
  try {
    await new Promise(r => setTimeout(r, 2000));

    let url = `https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(role)}&location=${encodeURIComponent(location)}`;
    if (daysBack && daysBack > 1) {
      url += `&f_TPR=r${Math.round(daysBack * 24 * 3600)}`;
    }

    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    const page = await browser.newPage();

    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
    );

    await page.goto(url);
    await new Promise(r => setTimeout(r, 3000));

    const jobs = await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll('.base-card'));
      return cards.slice(0, 10).map(card => {
        const titleEl = card.querySelector('.base-search-card__title');
        const companyEl = card.querySelector('.base-search-card__subtitle');
        const locationEl = card.querySelector('.job-search-card__location');
        const anchorEl = card.closest('a') || card.querySelector('a');
        const dateEl = card.querySelector('.job-search-card__listdate');

        return {
          title: titleEl ? titleEl.textContent.trim() : '',
          company: companyEl ? companyEl.textContent.trim() : '',
          location: locationEl ? locationEl.textContent.trim() : '',
          applyUrl: anchorEl ? anchorEl.href : '',
          postedDate: dateEl ? (dateEl.getAttribute('datetime') || dateEl.textContent.trim()) : '',
        };
      });
    });

    await browser.close();

    return jobs.map(job => ({
      title: job.title,
      company: job.company,
      location: job.location,
      salary: 'Not listed',
      postedDate: job.postedDate,
      applyUrl: job.applyUrl,
      source: 'LinkedIn',
      description: '',
    }));
  } catch (err) {
    console.error('LinkedIn scraper error:', err);
    if (browser) await browser.close();
    return [];
  }
}

module.exports = { scrapeLinkedIn };
