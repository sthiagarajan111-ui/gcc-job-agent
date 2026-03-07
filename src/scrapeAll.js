const { scrapeLinkedIn } = require('./scrapers/linkedin')
const { scrapeGulfTalent, scrapeNaukriGulf, scrapeBayt } = require('./scrapers/gulf')
const { scrapeIndeedGulf, scrapeMichaelPage, scrapeMonsterGulf } = require('./scrapers/extra')

async function scrapeAllSites(role, location) {
  const scraperNames = [
    'LinkedIn', 'GulfTalent', 'NaukriGulf', 'Bayt',
    'IndeedGulf', 'MichaelPage', 'MonsterGulf'
  ]

  const results = await Promise.allSettled([
    scrapeLinkedIn(role, location),
    scrapeGulfTalent(role, location),
    scrapeNaukriGulf(role, location),
    scrapeBayt(role, location),
    scrapeIndeedGulf(role, location),
    scrapeMichaelPage(role, location),
    scrapeMonsterGulf(role, location)
  ])

  const summary = results
    .map((r, i) => `${scraperNames[i]}: ${r.status === 'fulfilled' ? r.value.length : 0} jobs`)
    .join(' | ')
  console.log(summary)

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

  console.log(`Total unique jobs found: ${withIds.length}`)

  return withIds
}

module.exports = { scrapeAllSites }
