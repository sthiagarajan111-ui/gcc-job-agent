require('dotenv').config()

if (process.env.NODE_ENV === 'production') {
  console.log('[index.js] Production mode - starting dashboard')
  require('./src/dashboard.js')
} else {

const cron = require('node-cron')
const config = require('./src/config')
const { scrapeAllSites } = require('./src/scrapeAll')
const { getNewJobsOnly, saveRawJobs,
  loadRawJobs, saveDailyReport } = require('./src/storage')
const { analyzeAllJobs } = require('./src/analyzer')
const { sendJobReport } = require('./src/reporter')
const { prioritizeAllJobs } = require('./src/jobPrioritizer')
const { getSalaryReport } = require('./src/salaryEngine')
const { runDailyReport } = require('./src/reporterV2')
const { generateForTierOneAndTwo } = require('./src/coverLetter')
const { checkFollowUps } = require('./src/appTracker')
const { findContactsForTier1And2 } = require('./src/contactFinder')
const { buildNetworkingPlansForTier1And2 } = require('./src/networkingEngine')

async function runJobAgent() {
  const startTime = Date.now()
  const today = new Date().toISOString().split('T')[0]
  console.log('=== GCC Job Agent Starting:', today, '===')

  let totalScraped = 0
  let newJobs = 0
  let tier1Count = 0
  let tier2Count = 0
  let tier3Count = 0
  let fortuneCount = 0
  let coverLetterCount = 0
  let contactCount = 0
  let followUpCount = 0

  try {

    // STEP 1 - CHECK CACHE FIRST
    let allScrapedJobs = await loadRawJobs(today)

    if (allScrapedJobs && allScrapedJobs.length > 0) {
      console.log('Cache found!',
        allScrapedJobs.length, 'jobs from earlier today')
      console.log('Skipping scraping - using saved jobs')
    } else {
      // STEP 2 - SCRAPE ALL SITES
      console.log('No cache - starting fresh scrape...')
      allScrapedJobs = []

      const fse0 = require('fs-extra')
      const path0 = require('path')

      // Load all active search profiles (GCC + UK + Ireland + Europe)
      const profilesData = fse0.readJsonSync(
        path0.join(__dirname, 'data', 'search-profiles.json'))
      const activeProfiles = profilesData.profiles.filter(p => p.active !== false)

      // Count profiles by region
      let ukProfiles = 0, irelandProfiles = 0, europeProfiles = 0
      for (const p of activeProfiles) {
        if (p.region === 'uk') ukProfiles++
        else if (p.region === 'ireland') irelandProfiles++
        else if (p.region === 'europe') europeProfiles++
      }
      console.log('UK/Ireland/Europe scraping fix applied')
      console.log(`Total profiles being scraped: ${activeProfiles.length}`)
      console.log(`UK profiles: ${ukProfiles} | Ireland: ${irelandProfiles} | Europe: ${europeProfiles}`)

      // Detect which regions have been seen before (to set daysBack)
      const seenJobsPath = path0.join(__dirname, 'data', 'seen_jobs.json')
      const seenIds = fse0.existsSync(seenJobsPath) ? fse0.readJsonSync(seenJobsPath) : []
      const seenIdStr = seenIds.join(' ')
      const seenRegions = new Set()
      if (/london|manchester|edinburgh|birmingham/.test(seenIdStr)) seenRegions.add('uk')
      if (/dublin|cork|galway/.test(seenIdStr)) seenRegions.add('ireland')
      if (/amsterdam|frankfurt|paris|zurich|berlin/.test(seenIdStr)) seenRegions.add('europe')
      if (/dubai|abu-dhabi|riyadh|doha|kuwait|muscat|bahrain|jeddah/.test(seenIdStr)) seenRegions.add('gcc')

      // Inline region detector (avoids re-require of config)
      function getLocRegion(location) {
        const loc = location.toLowerCase()
        if (['london','manchester','edinburgh','birmingham','leeds'].some(c => loc.includes(c))) return 'uk'
        if (['dublin','cork','galway'].some(c => loc.includes(c))) return 'ireland'
        if (['amsterdam','frankfurt','paris','zurich','barcelona','madrid','berlin'].some(c => loc.includes(c))) return 'europe'
        return 'gcc'
      }

      // Build deduplicated role+location pairs from ALL active profiles
      const pairsSeen = new Set()
      const scrapePairs = []
      for (const p of activeProfiles) {
        for (const loc of p.locations) {
          const key = `${p.role}|${loc}`
          if (!pairsSeen.has(key)) {
            pairsSeen.add(key)
            scrapePairs.push({ role: p.role, location: loc })
          }
        }
      }

      for (const { role, location } of scrapePairs) {
        const region = getLocRegion(location)
        const daysBack = seenRegions.has(region) ? 1 : 30
        if (daysBack === 30) {
          console.log(`[First run] ${role} in ${location} — scraping last 30 days`)
        }
        const jobs = await scrapeAllSites(role, location, daysBack)
        allScrapedJobs.push(...jobs)
        console.log('Scraped', role, 'in', location, '-', jobs.length, 'jobs')
        await new Promise(r => setTimeout(r, 2000))
      }

      await saveRawJobs(allScrapedJobs, today)
      console.log('Scraping done -',
        allScrapedJobs.length, 'total jobs cached')
    }

    totalScraped = allScrapedJobs.length

    // STEP 3 - FILTER ALREADY SEEN JOBS
    console.log('Checking for new jobs...')
    const newJobsOnly = await getNewJobsOnly(
      allScrapedJobs)

    if (newJobsOnly.length === 0) {
      console.log('No new jobs today')
      console.log('All jobs seen in previous days')

      const fse = require('fs-extra')
      const path = require('path')
      const dashPath = path.join(__dirname, 'data', `report-${today}.json`)

      // Save prioritized report if not already done
      let allPrioritized = prioritizeAllJobs(allScrapedJobs)
      await fse.outputJson(dashPath, allPrioritized, { spaces: 2 })

      // Load full report and send with all jobs
      const allReportJobs = await fse.readJson(dashPath)
      console.log(`Sending full report with ${allReportJobs.length} jobs`)
      await runDailyReport(allReportJobs)
      console.log('=== GCC Job Agent Finished:',
        today, '===')
      return
    }

    newJobs = newJobsOnly.length
    console.log(newJobsOnly.length,
      'brand new jobs never seen before!')

    // STEP 4 - SCORE LOCALLY (FREE)
    console.log('Scoring new jobs locally...')
    const scoredJobs = await analyzeAllJobs(newJobsOnly)

    // STEP A — Re-prioritize with new scoring engine
    const prioritizedJobs = prioritizeAllJobs(scoredJobs)
    tier1Count = prioritizedJobs.filter(j => j.tier === 1).length
    tier2Count = prioritizedJobs.filter(j => j.tier === 2).length
    tier3Count = prioritizedJobs.filter(j => j.tier === 3).length
    const tier4Count = prioritizedJobs.filter(j => j.tier === 4).length
    fortuneCount = prioritizedJobs.filter(j => j.isFortune500).length
    console.log(`Jobs re-prioritized: Tier 1: ${tier1Count}, Tier 2: ${tier2Count}, Tier 3: ${tier3Count}, Tier 4: ${tier4Count}`)

    // STEP B — Enrich jobs with salary intelligence
    let salaryEnrichedCount = 0
    for (const job of prioritizedJobs) {
      if (!job.salary || job.salary === '') {
        const result = getSalaryReport(job.title, job.location, '')
        job.salaryEstimate = result.estimatedSalary
        job.salaryVerdict = result.verdict
        job.autoFillSalary = result.autoFillRecommendation.autoFillAED
        salaryEnrichedCount++
      }
    }
    console.log(`Salary intelligence added to ${salaryEnrichedCount} jobs`)

    // STEP 5 - SAVE DAILY REPORT
    await saveDailyReport(today, prioritizedJobs)

    // Also save in dash format for dashboard compatibility
    const fse = require('fs-extra')
    const path = require('path')
    const dashPath = path.join(__dirname, 'data', `report-${today}.json`)
    await fse.outputJson(dashPath, prioritizedJobs, { spaces: 2 })

    // STEP C — Send upgraded email report
    // await sendJobReport(scoredJobs, today)  // old reporter — kept as fallback
    await runDailyReport(prioritizedJobs)
    console.log('Upgraded email report sent via reporterV2')

    // STEP D — Generate cover letters (Tier 1 and 2 only)
    try {
      await generateForTierOneAndTwo(prioritizedJobs)
      coverLetterCount = prioritizedJobs.filter(
        j => j.tier === 1 || j.tier === 2).length
      console.log('Cover letters generated for Tier 1 and 2 jobs')
    } catch (err) {
      console.log('Cover letter generation skipped:', err.message)
    }

    // STEP E — Find HR contacts (Tier 1 and 2 only)
    try {
      await findContactsForTier1And2(prioritizedJobs)
      contactCount = prioritizedJobs.filter(
        j => j.tier === 1 || j.tier === 2).length
      console.log('HR contacts search complete')
    } catch (err) {
      console.log('Contact finder skipped:', err.message)
    }

    // STEP F — Build networking plans (Tier 1 and 2 only)
    try {
      await buildNetworkingPlansForTier1And2(prioritizedJobs)
      console.log('Networking plans built for Tier 1 and 2 jobs')
    } catch (err) {
      console.log('Networking engine skipped:', err.message)
    }

    // STEP G — Check follow-up reminders
    try {
      const followUps = await checkFollowUps()
      followUpCount = followUps.length
      if (followUps.length > 0) {
        console.log(`Follow-up reminders sent for ${followUps.length} applications`)
      } else {
        console.log('No follow-up reminders due today')
      }
    } catch (err) {
      console.log('Follow-up check skipped:', err.message)
    }

  } catch (err) {
    console.error('Agent failed:', err.message)
  }

  const endTime = Date.now()
  const elapsedSeconds = Math.round((endTime - startTime) / 1000)
  console.log(`GCC Job Agent complete in ${elapsedSeconds} seconds`)
  console.log(`Tier 1: ${tier1Count} | Tier 2: ${tier2Count} | Cover letters: ${coverLetterCount} | Contacts: ${contactCount}`)

  console.log('═══════════════════════════════════════')
  console.log('GCC JOB AGENT — DAILY RUN COMPLETE')
  console.log('═══════════════════════════════════════')
  console.log('Date:          ' + today)
  console.log('Jobs scraped:  ' + totalScraped)
  console.log('New jobs:      ' + newJobs)
  console.log('Tier 1:        ' + tier1Count)
  console.log('Tier 2:        ' + tier2Count)
  console.log('Tier 3:        ' + tier3Count)
  console.log('Fortune 500:   ' + fortuneCount)
  console.log('Cover letters: ' + coverLetterCount)
  console.log('HR contacts:   ' + contactCount)
  console.log('Follow-ups:    ' + followUpCount)
  console.log('Report sent:   all 4 inboxes')
  console.log('Dashboard:     http://localhost:3000')
  console.log('═══════════════════════════════════════')

  // DASHBOARD AUTO-START (OPTIONAL)
  const args = process.argv.slice(2)
  if (args.includes('--dashboard')) {
    const { startDashboard } = require('./src/dashboard')
    startDashboard()
    console.log('Dashboard started at http://localhost:3000')
    console.log('Press Ctrl+C to stop')
  }
}

cron.schedule('0 4 * * *', () => {
  console.log('Scheduled run triggered')
  runJobAgent()
})

runJobAgent().then(() => process.exit(0))

console.log('=== Scheduler active. 8AM Gulf Time daily ===')
console.log('=== Running now... ===')
}
