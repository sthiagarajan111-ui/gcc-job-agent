const puppeteer = require('puppeteer');

async function scrapeLinkedIn(role, location) {
  let browser;
  try {
    await new Promise(r => setTimeout(r, 2000));

    const url = `https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(role)}&location=${encodeURIComponent(location)}`;

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
