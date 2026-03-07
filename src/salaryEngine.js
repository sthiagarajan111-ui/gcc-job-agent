// salaryEngine.js — Salary estimation and auto-fill for GCC job applications

const CURRENCY_RATES = {
  GBP: 4.75,
  USD: 3.67,
  EUR: 4.00,
  SAR: 0.98,
  QAR: 1.01,
  KWD: 12.00,
  AED: 1.00,
};

const MARKET_RATES = [
  { role: 'Business Development Manager', level: 'Mid',    location: 'Dubai',        minAED: 18000, maxAED: 28000, typicalAED: 22000 },
  { role: 'Business Development Manager', level: 'Senior', location: 'Dubai',        minAED: 25000, maxAED: 40000, typicalAED: 32000 },
  { role: 'Business Development Executive', level: 'Junior', location: 'Dubai',      minAED: 12000, maxAED: 18000, typicalAED: 15000 },
  { role: 'Sales Manager',                level: 'Mid',    location: 'Dubai',        minAED: 18000, maxAED: 30000, typicalAED: 24000 },
  { role: 'Sales Executive',              level: 'Junior', location: 'Dubai',        minAED: 10000, maxAED: 16000, typicalAED: 13000 },
  { role: 'Sales Executive',              level: 'Mid',    location: 'Dubai',        minAED: 15000, maxAED: 22000, typicalAED: 18000 },
  { role: 'Strategy Consultant',          level: 'Mid',    location: 'Dubai',        minAED: 20000, maxAED: 35000, typicalAED: 27000 },
  { role: 'Strategy Consultant',          level: 'Senior', location: 'Dubai',        minAED: 30000, maxAED: 50000, typicalAED: 40000 },
  { role: 'Investment Analyst',           level: 'Mid',    location: 'Dubai',        minAED: 18000, maxAED: 28000, typicalAED: 23000 },
  { role: 'Finance Analyst',              level: 'Mid',    location: 'Dubai',        minAED: 15000, maxAED: 25000, typicalAED: 20000 },
  { role: 'Business Analyst',             level: 'Mid',    location: 'Dubai',        minAED: 15000, maxAED: 22000, typicalAED: 18000 },
  { role: 'Account Manager',             level: 'Mid',    location: 'Dubai',        minAED: 14000, maxAED: 22000, typicalAED: 17000 },
  { role: 'Relationship Manager',        level: 'Mid',    location: 'Dubai',        minAED: 16000, maxAED: 26000, typicalAED: 20000 },
  { role: 'Commercial Manager',          level: 'Senior', location: 'Dubai',        minAED: 25000, maxAED: 40000, typicalAED: 32000 },
  { role: 'Partnerships Manager',        level: 'Mid',    location: 'Dubai',        minAED: 18000, maxAED: 28000, typicalAED: 22000 },

  { role: 'Business Development Manager', level: 'Mid',   location: 'Abu Dhabi',    minAED: 17000, maxAED: 26000, typicalAED: 21000 },
  { role: 'Sales Manager',               level: 'Mid',    location: 'Abu Dhabi',    minAED: 17000, maxAED: 28000, typicalAED: 22000 },
  { role: 'Strategy Consultant',         level: 'Mid',    location: 'Abu Dhabi',    minAED: 19000, maxAED: 33000, typicalAED: 25000 },
  { role: 'Investment Analyst',          level: 'Mid',    location: 'Abu Dhabi',    minAED: 17000, maxAED: 26000, typicalAED: 21000 },
  { role: 'Finance Analyst',             level: 'Mid',    location: 'Abu Dhabi',    minAED: 14000, maxAED: 23000, typicalAED: 18000 },

  { role: 'Business Development Manager', level: 'Mid',   location: 'Qatar',        minAED: 15000, maxAED: 24000, typicalAED: 19000 },
  { role: 'Sales Manager',               level: 'Mid',    location: 'Qatar',        minAED: 15000, maxAED: 25000, typicalAED: 20000 },
  { role: 'Strategy Consultant',         level: 'Mid',    location: 'Qatar',        minAED: 18000, maxAED: 30000, typicalAED: 24000 },
  { role: 'Finance Analyst',             level: 'Mid',    location: 'Qatar',        minAED: 13000, maxAED: 22000, typicalAED: 17000 },

  { role: 'Business Development Manager', level: 'Mid',   location: 'Saudi Arabia', minAED: 14000, maxAED: 22000, typicalAED: 18000 },
  { role: 'Sales Manager',               level: 'Mid',    location: 'Saudi Arabia', minAED: 14000, maxAED: 24000, typicalAED: 19000 },
  { role: 'Strategy Consultant',         level: 'Mid',    location: 'Saudi Arabia', minAED: 17000, maxAED: 28000, typicalAED: 22000 },
  { role: 'Finance Analyst',             level: 'Mid',    location: 'Saudi Arabia', minAED: 12000, maxAED: 20000, typicalAED: 16000 },

  { role: 'Business Development Manager', level: 'Mid',   location: 'Kuwait',       minAED: 13000, maxAED: 20000, typicalAED: 16000 },
  { role: 'Business Development Manager', level: 'Mid',   location: 'Bahrain',      minAED: 11000, maxAED: 18000, typicalAED: 14000 },
  { role: 'Business Development Manager', level: 'Mid',   location: 'Oman',         minAED: 10000, maxAED: 16000, typicalAED: 13000 },
];

const LOCATION_DEFAULTS = {
  'dubai':        { minAED: 15000, maxAED: 25000, typicalAED: 20000 },
  'abu dhabi':    { minAED: 14000, maxAED: 23000, typicalAED: 18000 },
  'qatar':        { minAED: 13000, maxAED: 22000, typicalAED: 17000 },
  'saudi arabia': { minAED: 12000, maxAED: 20000, typicalAED: 16000 },
  'kuwait':       { minAED: 11000, maxAED: 18000, typicalAED: 14000 },
  'bahrain':      { minAED: 10000, maxAED: 16000, typicalAED: 13000 },
  'oman':         { minAED: 9000,  maxAED: 14000, typicalAED: 11000 },
};

const ALLOWANCES = {
  housing: { min: 3000, max: 8000, typical: 5000, unit: 'AED/month' },
  car:     { min: 1500, max: 3000, typical: 2000, unit: 'AED/month' },
  flights: { min: 3000, max: 5000, typical: 4000, unit: 'AED/year' },
  medical: { description: 'Self and family coverage' },
  phone:   { min: 300,  max: 500,  typical: 400,  unit: 'AED/month' },
};

function estimateSalary(title, location) {
  const titleLower = (title || '').toLowerCase();
  const locationLower = (location || '').toLowerCase();

  // Find best matching entry
  let bestMatch = null;
  let bestScore = 0;

  for (const entry of MARKET_RATES) {
    const roleLower = entry.role.toLowerCase();
    const entryLocationLower = entry.location.toLowerCase();

    // Score role match: check if all words in role appear in title
    const roleWords = roleLower.split(' ');
    const roleMatchCount = roleWords.filter(w => titleLower.includes(w)).length;
    const roleScore = roleMatchCount / roleWords.length;

    // Score location match
    const locationMatch = locationLower.includes(entryLocationLower) || entryLocationLower.includes(locationLower);

    if (roleScore > 0 && locationMatch) {
      const score = roleScore + 1; // bonus for location match
      if (score > bestScore || (score === bestScore && entry.typicalAED > (bestMatch ? bestMatch.typicalAED : 0))) {
        bestScore = score;
        bestMatch = entry;
      }
    } else if (roleScore > bestScore && !bestMatch) {
      bestScore = roleScore;
      bestMatch = entry;
    }
  }

  // Re-evaluate: prefer both role and location match
  let exactMatch = null;
  let roleOnlyMatch = null;

  for (const entry of MARKET_RATES) {
    const roleLower = entry.role.toLowerCase();
    const entryLocationLower = entry.location.toLowerCase();
    const roleWords = roleLower.split(' ');
    const roleMatchCount = roleWords.filter(w => titleLower.includes(w)).length;
    const roleScore = roleMatchCount / roleWords.length;
    const locationMatch = locationLower.includes(entryLocationLower) || entryLocationLower.includes(locationLower);

    if (roleScore >= 0.6 && locationMatch) {
      if (!exactMatch || roleScore > (exactMatch._score || 0)) {
        exactMatch = { ...entry, _score: roleScore };
      }
    } else if (roleScore >= 0.6 && !locationMatch) {
      if (!roleOnlyMatch || roleScore > (roleOnlyMatch._score || 0)) {
        roleOnlyMatch = { ...entry, _score: roleScore };
      }
    }
  }

  const matched = exactMatch || roleOnlyMatch;

  if (matched) {
    return {
      minAED: matched.minAED,
      maxAED: matched.maxAED,
      typicalAED: matched.typicalAED,
      matchedRole: matched.role,
      confidence: 'high',
    };
  }

  // Fall back to location default
  let defaultEstimate = { minAED: 12000, maxAED: 20000, typicalAED: 16000 };
  for (const [key, val] of Object.entries(LOCATION_DEFAULTS)) {
    if (locationLower.includes(key)) {
      defaultEstimate = val;
      break;
    }
  }

  return {
    ...defaultEstimate,
    matchedRole: 'default estimate',
    confidence: 'estimated',
  };
}

function getAutoFillSalary(title, location) {
  const estimate = estimateSalary(title, location);
  const { typicalAED } = estimate;

  let autoFillAED;
  let recommendation;

  if (typicalAED >= 18000) {
    autoFillAED = 18000;
    recommendation = `Market typical is AED ${typicalAED.toLocaleString()}. Using Dheeraj's target of AED 18,000 as the auto-fill value.`;
  } else if (typicalAED >= 14000) {
    autoFillAED = typicalAED;
    recommendation = `Market typical is AED ${typicalAED.toLocaleString()}. Using market typical as it is at or above minimum floor of AED 14,000.`;
  } else {
    autoFillAED = 14000;
    recommendation = `Market typical is AED ${typicalAED.toLocaleString()}, which is below the minimum floor. Using floor value of AED 14,000.`;
  }

  return {
    autoFillAED,
    minimumAED: 14000,
    targetAED: 18000,
    stretchAED: 25000,
    recommendation,
  };
}

function convertToAED(amount, currency) {
  const rate = CURRENCY_RATES[(currency || '').toUpperCase()];
  if (!rate) throw new Error(`Unsupported currency: ${currency}`);
  return Math.round(amount * rate);
}

function parseSalaryFromText(text) {
  if (!text) return { found: false, currency: 'unknown', minAED: null, maxAED: null, rawText: '' };

  const patterns = [
    // Range: "15,000 - 20,000 AED" or "AED 15,000 - 20,000"
    { regex: /AED\s*([\d,]+)\s*[-–to]+\s*([\d,]+)/i,           currency: 'AED', type: 'range' },
    { regex: /([\d,]+)\s*[-–to]+\s*([\d,]+)\s*AED/i,            currency: 'AED', type: 'range' },
    { regex: /USD\s*([\d,]+)\s*[-–to]+\s*([\d,]+)/i,            currency: 'USD', type: 'range' },
    { regex: /\$\s*([\d,]+)\s*[-–to]+\s*([\d,]+)/i,             currency: 'USD', type: 'range' },
    { regex: /GBP\s*([\d,]+)\s*[-–to]+\s*([\d,]+)/i,            currency: 'GBP', type: 'range' },
    { regex: /£\s*([\d,]+)\s*[-–to]+\s*([\d,]+)/i,              currency: 'GBP', type: 'range' },
    // Single: "AED 18,000" / "18000 AED" / "AED18000" / "up to AED 25000"
    { regex: /up\s+to\s+AED\s*([\d,]+)/i,                       currency: 'AED', type: 'single' },
    { regex: /AED\s*([\d,]+)/i,                                  currency: 'AED', type: 'single' },
    { regex: /([\d,]+)\s*AED/i,                                  currency: 'AED', type: 'single' },
    { regex: /USD\s*([\d,]+)/i,                                  currency: 'USD', type: 'single' },
    { regex: /\$([\d,]+)/,                                       currency: 'USD', type: 'single' },
    { regex: /GBP\s*([\d,]+)/i,                                  currency: 'GBP', type: 'single' },
    { regex: /£([\d,]+)/,                                        currency: 'GBP', type: 'single' },
  ];

  for (const p of patterns) {
    const match = text.match(p.regex);
    if (match) {
      const parse = s => parseInt(s.replace(/,/g, ''), 10);
      if (p.type === 'range') {
        const min = parse(match[1]);
        const max = parse(match[2]);
        return {
          found: true,
          currency: p.currency,
          minAED: convertToAED(min, p.currency),
          maxAED: convertToAED(max, p.currency),
          rawText: match[0],
        };
      } else {
        const val = parse(match[1]);
        const aed = convertToAED(val, p.currency);
        return {
          found: true,
          currency: p.currency,
          minAED: aed,
          maxAED: aed,
          rawText: match[0],
        };
      }
    }
  }

  return { found: false, currency: 'unknown', minAED: null, maxAED: null, rawText: '' };
}

function getSalaryReport(title, location, salaryText) {
  const parsed = parseSalaryFromText(salaryText);
  const estimated = estimateSalary(title, location);
  const autoFill = getAutoFillSalary(title, location);

  const typicalAED = parsed.found ? parsed.minAED : estimated.typicalAED;

  const ukMonthlyTakehomeGBP = 2380;
  const ukMonthlyTakehomeAED = 14000;
  const realIncreasePercent = Math.round(((typicalAED - ukMonthlyTakehomeAED) / ukMonthlyTakehomeAED) * 100);

  let verdict;
  if (typicalAED >= 18000)      verdict = 'ABOVE TARGET';
  else if (typicalAED >= 14000) verdict = 'AT MINIMUM';
  else                          verdict = 'BELOW FLOOR';

  return {
    postedSalary: parsed.found ? parsed : null,
    estimatedSalary: estimated,
    autoFillRecommendation: autoFill,
    allowances: ALLOWANCES,
    comparisonToUK: {
      ukMonthlyTakehomeGBP,
      ukMonthlyTakehomeAED,
      gccTypicalAED: typicalAED,
      realIncreasePercent,
    },
    verdict,
  };
}

module.exports = { estimateSalary, getAutoFillSalary, convertToAED, parseSalaryFromText, getSalaryReport };

// ─────────────────────────────────────────────────────────────────────────────
if (require.main === module) {
  const fmt = obj => JSON.stringify(obj, null, 2);

  console.log('\n═══════════════════════════════════════════════════════');
  console.log('Test 1: getSalaryReport("Business Development Manager", "Dubai", "")');
  console.log('═══════════════════════════════════════════════════════');
  console.log(fmt(getSalaryReport('Business Development Manager', 'Dubai', '')));

  console.log('\n═══════════════════════════════════════════════════════');
  console.log('Test 2: getSalaryReport("Sales Executive", "Abu Dhabi", "AED 16,000")');
  console.log('═══════════════════════════════════════════════════════');
  console.log(fmt(getSalaryReport('Sales Executive', 'Abu Dhabi', 'AED 16,000')));

  console.log('\n═══════════════════════════════════════════════════════');
  console.log('Test 3: getSalaryReport("Marketing Manager", "Oman", "")');
  console.log('═══════════════════════════════════════════════════════');
  console.log(fmt(getSalaryReport('Marketing Manager', 'Oman', '')));

  console.log('\n═══════════════════════════════════════════════════════');
  console.log('Test 4: getAutoFillSalary("Strategy Consultant", "Dubai")');
  console.log('═══════════════════════════════════════════════════════');
  console.log(fmt(getAutoFillSalary('Strategy Consultant', 'Dubai')));

  console.log('\n═══════════════════════════════════════════════════════');
  console.log('Test 5: convertToAED(35000, "GBP") — expected 166250');
  console.log('═══════════════════════════════════════════════════════');
  const result5 = convertToAED(35000, 'GBP');
  console.log(`Result: ${result5} ${result5 === 166250 ? '✓ CORRECT' : '✗ UNEXPECTED'}`);
}
