const config = {
  CANDIDATE: {
    name: 'Candidate',
    education: [
      'MSc Global Masters in Management Finance - LSE 2025',
      'BSc Marketing and Management - Newcastle University 2021',
    ],
    experience: [
      'Sales - Durham Lane UK - 3 months',
      'Sales and Business Development - G-Network UK - 1 year',
      'Investment Analyst - Love More Sports UK - 6 months',
    ],
    totalYears: 2,
  },

  TARGET_ROLES: [
    {
      title: 'Sales Executive',
      keywords: ['sales executive', 'sales manager', 'account executive'],
    },
    {
      title: 'Business Development',
      keywords: ['business development', 'BDM', 'BD executive'],
    },
    {
      title: 'Strategy Consultant',
      keywords: ['strategy consultant', 'management consultant'],
    },
    {
      title: 'Business Analyst',
      keywords: ['business analyst', 'commercial analyst', 'BA'],
    },
    {
      title: 'Finance Analyst',
      keywords: ['finance analyst', 'financial analyst', 'FP&A', 'investment analyst'],
    },
  ],

  TARGET_LOCATIONS: [
    'Dubai',
    'Abu Dhabi',
    'UAE',
    'Riyadh',
    'Jeddah',
    'Saudi Arabia',
    'Doha',
    'Qatar',
    'Kuwait',
    'Bahrain',
    'Muscat',
    'Oman',
  ],

  JOB_SITES: [
    {
      name: 'linkedin',
      searchUrl: 'https://www.linkedin.com/jobs/search/?keywords={keywords}&location={location}',
    },
    {
      name: 'indeed_gulf',
      searchUrl: 'https://www.indeed.com/jobs?q={keywords}&l={location}',
    },
    {
      name: 'naukri_gulf',
      searchUrl: 'https://www.naukrigulf.com/{keywords}-jobs-in-{location}',
    },
    {
      name: 'gulftalent',
      searchUrl: 'https://www.gulftalent.com/jobs?search={keywords}&location={location}',
    },
    {
      name: 'michaelpage',
      searchUrl: 'https://www.michaelpage.ae/jobs/{keywords}/{location}',
    },
    {
      name: 'bayt',
      searchUrl: 'https://www.bayt.com/en/international/jobs/{keywords}-jobs-in-{location}/',
    },
    {
      name: 'monstergulf',
      searchUrl: 'https://www.monstergulf.com/jobs-in-{location}/{keywords}/',
    },
  ],

  SETTINGS: {
    minMatchScore: 6,
    maxJobsPerReport: 40,
    delayBetweenRequests: 3000,
    reportHour: 8,
    timezone: 'Asia/Dubai',
  },
};

module.exports = config;
