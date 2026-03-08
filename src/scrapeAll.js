const path = require('path')
const fs = require('fs-extra')
const { scrapeLinkedIn } = require('./scrapers/linkedin')
const { scrapeGulfTalent, scrapeNaukriGulf, scrapeBayt } = require('./scrapers/gulf')
const {
  scrapeIndeedGulf, scrapeMichaelPage, scrapeMonsterGulf,
  scrapeDubizzle, scrapeJobsAe, scrapeGulfRecruiter, scrapeKhaleejTimes, scrapeCvLibrary,
} = require('./scrapers/extra')

const IS_PRODUCTION = process.env.NODE_ENV === 'production'

function loadBlockedJobs() {
  const filePath = path.join(__dirname, '../data/blocked-jobs.json')
  if (!fs.existsSync(filePath)) return []
  try {
    const data = fs.readJsonSync(filePath)
    return Array.isArray(data) ? data : []
  } catch (e) {
    return []
  }
}

async function scrapeAllSites(role, location) {
  if (IS_PRODUCTION) {
    console.log('[Scraper] Production mode - scraping disabled')
    return []
  }
  const scraperNames = [
    'LinkedIn', 'GulfTalent', 'NaukriGulf', 'Bayt',
    'IndeedGulf', 'MichaelPage', 'MonsterGulf',
    'Dubizzle', 'Jobs.ae', 'GulfRecruiter', 'Khaleej Times', 'CV Library',
  ]

  const results = await Promise.allSettled([
    scrapeLinkedIn(role, location),
    scrapeGulfTalent(role, location),
    scrapeNaukriGulf(role, location),
    scrapeBayt(role, location),
    scrapeIndeedGulf(role, location),
    scrapeMichaelPage(role, location),
    scrapeMonsterGulf(role, location),
    scrapeDubizzle(),
    scrapeJobsAe(),
    scrapeGulfRecruiter(),
    scrapeKhaleejTimes(),
    scrapeCvLibrary(),
  ])

  results.forEach((r, i) => {
    const count = r.status === 'fulfilled' ? r.value.length : 0;
    console.log(`${scraperNames[i]}: ${count} jobs`);
  });
  const summary = results
    .map((r, i) => `${scraperNames[i]}: ${r.status === 'fulfilled' ? r.value.length : 0}`)
    .join(' | ')
  console.log('Summary: ' + summary);

  const combined = results
    .filter(r => r.status === 'fulfilled')
    .flatMap(r => r.value)

  const seen = new Set()
  const deduplicated = combined.filter(job => {
    const key = `${job.title}|${job.company}`.toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  const withIds = deduplicated.map(job => ({
    ...job,
    id: (job.title + job.company + job.location)
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
  }))

  // Filter out blocked jobs
  const blocked = loadBlockedJobs()
  const notBlocked = withIds.filter(job => {
    if (blocked.find(b => b.id === job.id)) return false
    if (blocked.find(b =>
      b.title && b.company &&
      b.title.toLowerCase() === (job.title || '').toLowerCase() &&
      b.company.toLowerCase() === (job.company || '').toLowerCase()
    )) return false
    return true
  })

  console.log(`Total unique jobs found: ${notBlocked.length} (${withIds.length - notBlocked.length} blocked)`)

  return notBlocked
}

module.exports = { scrapeAllSites }
