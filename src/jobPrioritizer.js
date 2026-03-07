'use strict';

// --- Company Lists ---

const FORTUNE_500_KEYWORDS = [
  'amazon', 'apple', 'microsoft', 'google', 'alphabet', 'meta',
  'exxonmobil', 'shell', 'bp', 'totalenergies', 'chevron',
  'jpmorgan', 'goldman sachs', 'morgan stanley', 'hsbc',
  'citigroup', 'barclays', 'deutsche bank', 'ubs', 'blackrock',
  'mckinsey', 'boston consulting', 'bain', 'deloitte', 'pwc',
  'ernst young', 'kpmg', 'accenture', 'ibm', 'oracle', 'sap',
  'salesforce', 'cisco', 'intel', 'samsung', 'sony', 'siemens',
  'unilever', 'nestle', 'procter gamble', 'johnson johnson',
  'pfizer', 'novartis', 'roche', 'astrazeneca', 'lvmh', 'nike',
  'adidas', 'toyota', 'bmw', 'mercedes', 'volkswagen', 'ford',
  'general motors', 'boeing', 'airbus', 'caterpillar',
  'general electric', 'honeywell', '3m', 'abb', 'schlumberger',
  'halliburton', 'baker hughes', 'aramco', 'adnoc', 'emirates',
  'etihad', 'qatar airways', 'dp world', 'emaar', 'aldar',
  'damac', 'majid al futtaim', 'al futtaim', 'chalhoub',
  'landmark group', 'jumeirah', 'marriott', 'hilton',
  'hyatt', 'ihg', 'four seasons', 'mastercard', 'visa',
  'american express', 'paypal', 'stripe', 'bloomberg',
  'reuters', 'mubadala', 'adq', 'pif', 'qia', 'investcorp',
];

const GCC_CONGLOMERATE_KEYWORDS = [
  'al futtaim', 'al habtoor', 'al ghurair', 'al rostamani',
  'majid al futtaim', 'chalhoub', 'landmark', 'jumeirah',
  'emaar', 'aldar', 'damac', 'nakheel', 'meraas', 'dubai holding',
  'icd', 'mubadala', 'adq', 'adnoc', 'etisalat', 'du telecom',
  'stc', 'zain', 'ooredoo', 'agility', 'dallah', 'abdul latif jameel',
  'olayan', 'almana', 'al sayer', 'mbc', 'rotana', 'osn',
];

// --- Helper ---

function normalize(str) {
  return (str || '').toLowerCase();
}

// --- Exported Functions ---

function isFortuneCompany(companyName) {
  const name = normalize(companyName);
  return FORTUNE_500_KEYWORDS.some(k => name.includes(k));
}

function isGCCConglomerate(companyName) {
  const name = normalize(companyName);
  return GCC_CONGLOMERATE_KEYWORDS.some(k => name.includes(k));
}

function scoreLocation(location) {
  const loc = normalize(location);
  if (loc.includes('dubai')) return 25;
  if (loc.includes('abu dhabi') || loc.includes('uae')) return 20;
  if (loc.includes('qatar') || loc.includes('doha')) return 15;
  if (loc.includes('saudi') || loc.includes('riyadh') || loc.includes('jeddah')) return 12;
  if (loc.includes('kuwait') || loc.includes('bahrain')) return 10;
  if (loc.includes('oman') || loc.includes('muscat')) return 8;
  return 5; // Unknown
}

function scoreCompany(companyName) {
  if (isFortuneCompany(companyName)) return 25;
  if (isGCCConglomerate(companyName)) return 20;
  // Well known regional — none explicitly defined beyond the two lists, so falls to SME/Unknown
  return 5;
}

function scoreSalary(salaryText) {
  const text = normalize(salaryText || '');
  if (!text.trim()) return 10; // Not mentioned

  // Extract numeric amount and currency
  const aedMatch = text.match(/aed\s*([\d,]+)/);
  const usdMatch = text.match(/usd\s*([\d,]+)/);
  const gbpMatch = text.match(/gbp\s*([\d,]+)/);
  const genericMatch = text.match(/([\d,]+)/);

  let aed = null;

  if (aedMatch) {
    aed = parseFloat(aedMatch[1].replace(/,/g, ''));
  } else if (usdMatch) {
    aed = parseFloat(usdMatch[1].replace(/,/g, '')) * 3.67;
  } else if (gbpMatch) {
    aed = parseFloat(gbpMatch[1].replace(/,/g, '')) * 4.75;
  } else if (genericMatch) {
    aed = parseFloat(genericMatch[1].replace(/,/g, ''));
  }

  if (aed === null || isNaN(aed)) return 10; // Not parseable — treat as not mentioned

  if (aed > 25000) return 25;
  if (aed >= 15000) return 18;
  if (aed >= 8000) return 12;
  return 5; // Below AED 8000
}

function scoreProfileMatch(title, description) {
  const text = normalize(`${title} ${description}`);

  const strongKeywords = [
    'business development', 'bd manager', 'sales manager',
    'sales executive', 'strategy consultant', 'investment analyst',
    'partnerships', 'commercial', 'revenue',
    'client acquisition', 'enterprise sales', 'b2b',
  ];

  const mediumKeywords = [
    'finance analyst', 'business analyst', 'account manager',
    'relationship manager', 'project manager', 'consultant',
    'analyst', 'management', 'operations',
  ];

  const weakKeywords = [
    'marketing', 'hr', 'it', 'engineering', 'logistics',
    'supply chain', 'legal', 'admin',
  ];

  const hasStrong = strongKeywords.some(k => text.includes(k));
  const hasMedium = mediumKeywords.some(k => text.includes(k));
  const hasWeak = weakKeywords.some(k => text.includes(k));

  // Determine raw profile score (out of 10)
  let rawScore;
  if (hasStrong) {
    rawScore = 9; // Score 9-10
  } else if (hasMedium) {
    rawScore = 7; // Score 7-8
  } else if (hasWeak) {
    rawScore = 5; // Weak match (below 6 range, but still has a keyword)
  } else {
    rawScore = 4; // No match — below 6
  }

  // Map raw score to points
  if (rawScore >= 9) return 25;
  if (rawScore >= 7) return 18;
  if (rawScore === 6) return 12;
  return 5; // Below 6
}

function detectExperienceLevel(job) {
  const text = normalize(`${job.title || ''} ${job.description || ''}`);

  const seniorKeywords = [
    'senior', 'lead', 'head of', 'director', 'vp', 'vice president',
    'principal', '5+ years', '5 years', '6 years', '7+ years', '8+ years',
    '10+ years',
  ];
  const yearsForManager = ['5+ years', '5 years', '6 years', '7+ years', '8+ years', '10+ years'];
  const isSenior = seniorKeywords.some(k => text.includes(k)) ||
    (text.includes('manager') && yearsForManager.some(k => text.includes(k)));
  if (isSenior) return 'senior';

  const entryKeywords = [
    'entry level', 'graduate', 'junior', 'trainee', 'intern',
    'fresh graduate', '0-1 year', 'no experience', 'entry-level',
    'associate', 'analyst',
  ];
  if (entryKeywords.some(k => text.includes(k))) return 'entry';

  const midKeywords = [
    '2 years', '3 years', '2-3 years', '2+ years', '3+ years',
    'mid level', 'mid-level', 'experienced',
  ];
  if (midKeywords.some(k => text.includes(k))) return 'mid';

  return 'unknown';
}

function prioritizeJob(job) {
  const locationScore = scoreLocation(job.location);
  const companyScore = scoreCompany(job.company);
  const salaryScore = scoreSalary(job.salary);
  const matchScore = scoreProfileMatch(job.title, job.description);
  const experienceLevel = detectExperienceLevel(job);
  const experienceAdjustment = experienceLevel === 'senior' ? -20 : 0;

  const totalScore = locationScore + companyScore + salaryScore + matchScore + experienceAdjustment;

  let tier, tierLabel;
  if (totalScore >= 80) {
    tier = 1; tierLabel = 'APPLY TODAY';
  } else if (totalScore >= 60) {
    tier = 2; tierLabel = 'APPLY THIS WEEK';
  } else if (totalScore >= 40) {
    tier = 3; tierLabel = 'APPLY IF TIME';
  } else {
    tier = 4; tierLabel = 'OPTIONAL';
  }

  const fortuneFlag = isFortuneCompany(job.company);
  const gccFlag = isGCCConglomerate(job.company);

  return {
    ...job,
    locationScore,
    companyScore,
    salaryScore,
    matchScore,
    totalScore,
    tier,
    tierLabel,
    isFortuneCompany: fortuneFlag,
    isGCCConglomerate: gccFlag,
    fortuneBadge: fortuneFlag ? 'Fortune 500' : '',
    experienceLevel,
  };
}

function prioritizeAllJobs(jobsArray) {
  return jobsArray.map(prioritizeJob).sort((a, b) => b.totalScore - a.totalScore);
}

module.exports = {
  isFortuneCompany,
  isGCCConglomerate,
  scoreLocation,
  scoreCompany,
  scoreSalary,
  scoreProfileMatch,
  detectExperienceLevel,
  prioritizeJob,
  prioritizeAllJobs,
};

// --- Test Block ---
if (require.main === module) {
  const testJobs = [
    {
      title: 'Business Development Manager',
      company: 'Goldman Sachs',
      location: 'Dubai',
      salary: 'AED 22000',
      description: 'enterprise sales B2B client acquisition revenue',
    },
    {
      title: 'Sales Executive',
      company: 'Local Trading LLC',
      location: 'Abu Dhabi',
      salary: '',
      description: 'sales account management B2B',
    },
    {
      title: 'Marketing Manager',
      company: 'Unknown Startup',
      location: 'Oman',
      salary: 'AED 6000',
      description: 'marketing campaigns social media',
    },
  ];

  const results = prioritizeAllJobs(testJobs);

  console.log('\n=== JOB PRIORITIZER TEST RESULTS ===\n');
  results.forEach((job, i) => {
    console.log(`#${i + 1} — ${job.title} @ ${job.company}`);
    console.log(`  Location   : ${job.location} → ${job.locationScore} pts`);
    console.log(`  Company    : ${job.companyScore} pts${job.fortuneBadge ? ` [${job.fortuneBadge}]` : ''}`);
    console.log(`  Salary     : ${job.salary || '(not mentioned)'} → ${job.salaryScore} pts`);
    console.log(`  Match      : ${job.matchScore} pts`);
    console.log(`  Total Score: ${job.totalScore} / 100`);
    console.log(`  Tier       : TIER ${job.tier} — ${job.tierLabel}`);
    console.log('');
  });
}
