require('dotenv').config()

const STRONG_TITLES = ['sales', 'business development',
  'strategy', 'finance', 'investment', 'analyst',
  'consultant', 'commercial', 'bd', 'bdm',
  'manager', 'executive', 'advisor', 'planning',
  'marketing', 'account', 'development', 'growth']

const WEAK_TITLES = ['admin', 'assistant', 'secretary',
  'driver', 'cleaner', 'nurse', 'doctor', 'engineer',
  'pharmacy', 'warehouse', 'logistics', 'cook',
  'chef', 'retail', 'cashier', 'receptionist',
  'security', 'technician', 'mechanic', 'tailor']

const GOOD_LOCATIONS = ['dubai', 'abu dhabi', 'uae',
  'united arab emirates']

const OK_LOCATIONS = ['qatar', 'doha', 'saudi',
  'riyadh', 'jeddah', 'kuwait', 'bahrain',
  'oman', 'muscat']

const FORTUNE_COMPANIES = ['mckinsey', 'bcg', 'bain',
  'deloitte', 'pwc', 'ey', 'kpmg', 'accenture',
  'hsbc', 'citibank', 'jpmorgan', 'goldman',
  'microsoft', 'google', 'amazon', 'oracle',
  'unilever', 'nestle', 'pepsi', 'coca-cola',
  'emirates', 'etihad', 'dp world', 'emaar',
  'damac', 'al futtaim', 'majid', 'alshaya',
  'shell', 'bp', 'exxon', 'total', 'aramco',
  'adnoc', 'chalhoub', 'landmark', 'jumeirah',
  'standard chartered', 'barclays', 'deutsche',
  'siemens', 'ge', 'honeywell', 'johnson',
  'procter', 'henkel', 'loreal', 'lvmh']

function analyzeJobMatch(job) {
  let score = 7
  let reasons = []
  let priority = 'LOW'
  let tip = 'Highlight your LSE qualification prominently.'

  const titleLower = (job.title || '').toLowerCase()
  const locationLower = (job.location || '').toLowerCase()
  const companyLower = (job.company || '').toLowerCase()

  const isStrong = STRONG_TITLES.some(k =>
    titleLower.includes(k))
  const isWeak = WEAK_TITLES.some(k =>
    titleLower.includes(k))

  if (isStrong) {
    score += 2
    reasons.push('Role matches your target positions')
  }
  if (isWeak) {
    score -= 4
    reasons.push('Role outside your target area')
  }

  if (GOOD_LOCATIONS.some(l =>
    locationLower.includes(l))) {
    score += 1
    reasons.push('Dubai/UAE - your top target location')
  } else if (OK_LOCATIONS.some(l =>
    locationLower.includes(l))) {
    reasons.push('Good GCC location opportunity')
  }

  if (FORTUNE_COMPANIES.some(c =>
    companyLower.includes(c))) {
    score += 1
    reasons.push('Top-tier company - excellent for profile')
  }

  if (titleLower.includes('finance') ||
      titleLower.includes('investment')) {
    tip = 'Lead with your LSE Finance specialization'
  } else if (titleLower.includes('sales') ||
      titleLower.includes('business development') ||
      titleLower.includes('bd')) {
    tip = 'Highlight your G-Network BD experience'
  } else if (titleLower.includes('strategy') ||
      titleLower.includes('consultant')) {
    tip = 'Emphasise LSE Masters and analytical skills'
  } else if (titleLower.includes('analyst')) {
    tip = 'Reference your investment analyst role at Love More Sports'
  }

  if (reasons.length === 0) {
    reasons.push('GCC market opportunity')
    reasons.push('LSE profile is competitive here')
  }
  if (reasons.length === 1) {
    reasons.push('Strong academic background relevant')
  }

  score = Math.min(10, Math.max(1, score))

  if (score >= 8) priority = 'HIGH'
  else if (score >= 6) priority = 'MEDIUM'
  else priority = 'LOW'

  return {
    ...job,
    match_score: score,
    apply_priority: priority,
    match_reasons: reasons,
    tailoring_tip: tip
  }
}

async function analyzeAllJobs(jobsArray) {
  console.log('Scoring', jobsArray.length,
    'jobs locally (FREE - no API cost)...')

  const scored = jobsArray.map(job =>
    analyzeJobMatch(job))

  const filtered = scored.filter(j =>
    j.match_score > 3)

  filtered.sort((a, b) =>
    b.match_score - a.match_score)

  const high = filtered.filter(j =>
    j.apply_priority === 'HIGH').length
  const medium = filtered.filter(j =>
    j.apply_priority === 'MEDIUM').length
  const low = filtered.filter(j =>
    j.apply_priority === 'LOW').length

  console.log('Scoring complete!')
  console.log('HIGH:', high,
    '| MEDIUM:', medium, '| LOW:', low)
  console.log('Total jobs for report:', filtered.length)

  return filtered
}

module.exports = { analyzeJobMatch, analyzeAllJobs }
