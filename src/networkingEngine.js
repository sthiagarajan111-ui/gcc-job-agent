require('dotenv').config();
const fs = require('fs-extra');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');

// ─── Candidate Context ────────────────────────────────────────────────────────
const CANDIDATE = {
  name: 'Dheeraj Thiagarajan',
  lseDegree: 'MSc Management Finance (Merit) 2023-2025',
  newcastleDegree: 'BSc Business Management Marketing (2:1) 2018-2021',
  chicagoDegree: 'MBA Exchange (Merit) Aug-Dec 2024',
  currentRole: 'Investment & Partnerships Analyst, Lovemore Sports',
  linkedIn: 'https://www.linkedin.com/in/dheeraj-t1/',
};

const DATA_FILE = path.join(__dirname, '../data/networking.json');

// ─── 1. generateAlumniSearchUrls ─────────────────────────────────────────────
function generateAlumniSearchUrls(company) {
  const encoded = encodeURIComponent(company).replace(/%20/g, '+');
  return {
    lse: `https://www.linkedin.com/search/results/people/?keywords=${encoded}+LSE+%22London+School+of+Economics%22&origin=GLOBAL_SEARCH_HEADER`,
    newcastle: `https://www.linkedin.com/search/results/people/?keywords=${encoded}+%22Newcastle+University%22&origin=GLOBAL_SEARCH_HEADER`,
    chicagoBooth: `https://www.linkedin.com/search/results/people/?keywords=${encoded}+%22Chicago+Booth%22+OR+%22University+of+Chicago%22&origin=GLOBAL_SEARCH_HEADER`,
    lsePage: 'https://www.linkedin.com/school/london-school-of-economics/people/',
    newcastlePage: 'https://www.linkedin.com/school/newcastle-university/people/',
  };
}

// ─── 2. generateLinkedInSearchStrings ────────────────────────────────────────
function generateLinkedInSearchStrings(company) {
  return [
    `"${company}" "London School of Economics"`,
    `"${company}" "Newcastle University"`,
    `"${company}" "LSE" OR "Newcastle"`,
  ];
}

// ─── 3. generateLinkedInMessages ─────────────────────────────────────────────
async function generateLinkedInMessages(job) {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const { title, company, location } = job;

  const placeholders = {
    lseAlumni: `Hi [NAME], fellow LSE alum here. I'm applying for the ${title} role at ${company} and would love to connect. Would appreciate any insights you might have. Best, Dheeraj`,
    newcastleAlumni: `Hi [NAME], Newcastle University alum here. I'm applying for the ${title} role at ${company} and would love to connect. Would appreciate any insights. Best, Dheeraj`,
    coldOutreach: `Hi [NAME], I'm Dheeraj, LSE MSc Finance graduate applying for the ${title} role at ${company}. Would love to connect and learn more about [COMPANY]. Best regards.`,
  };

  const prompts = [
    {
      key: 'lseAlumni',
      text: `Write a LinkedIn connection message from Dheeraj Thiagarajan, LSE MSc Management Finance 2025 graduate, to an LSE alumnus working at ${company} in ${location}. Dheeraj is applying for ${title} role there. Keep under 300 characters. Mention LSE connection. Professional but warm tone. No emojis.`,
    },
    {
      key: 'newcastleAlumni',
      text: `Write a LinkedIn connection message from Dheeraj Thiagarajan, Newcastle University BSc 2021 graduate, to a Newcastle alumnus working at ${company} in ${location}. Dheeraj is applying for ${title} role there. Keep under 300 characters. Mention Newcastle connection. Professional but warm tone. No emojis.`,
    },
    {
      key: 'coldOutreach',
      text: `Write a LinkedIn connection message from Dheeraj Thiagarajan to an HR Manager at ${company} in ${location}. He is applying for ${title}. He has LSE MSc Finance and 65% B2B sales conversion rate at G.Network. Keep under 300 characters. Professional tone. No emojis.`,
    },
  ];

  const messages = { ...placeholders };

  for (const prompt of prompts) {
    try {
      const response = await client.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 200,
        messages: [{ role: 'user', content: prompt.text }],
      });
      messages[prompt.key] = response.content[0].text.trim();
    } catch (err) {
      if (err.status === 429 || err.status === 402 || (err.message && err.message.includes('credit'))) {
        console.warn(`[networkingEngine] API credits issue for ${prompt.key}. Using placeholder template.`);
      } else {
        console.error(`[networkingEngine] Error generating ${prompt.key} message:`, err.message);
      }
      // keep placeholder
    }
  }

  return messages;
}

// ─── 4. generate7DayActionPlan ────────────────────────────────────────────────
function generate7DayActionPlan(job, alumniUrls) {
  const { title, company } = job;

  return [
    {
      day: 1,
      title: 'Research',
      tasks: [
        `Research ${company} on LinkedIn and company website`,
        'Find 3-5 LSE/Newcastle alumni at the company',
        'Identify the hiring manager if possible',
      ],
      urls: [alumniUrls.lse, alumniUrls.newcastle],
    },
    {
      day: 2,
      title: 'Connect with Alumni',
      tasks: [
        'Send connection requests to 2-3 LSE alumni found',
        'Use Message Type 1 (LSE alumni message)',
        'Send connection requests to 2-3 Newcastle alumni',
        'Use Message Type 2 (Newcastle alumni message)',
        'Do NOT mention the job application yet',
      ],
      urls: [alumniUrls.lsePage, alumniUrls.newcastlePage],
    },
    {
      day: 3,
      title: 'Apply',
      tasks: [
        `Submit the job application for ${title} via the apply URL`,
        'Use Auto-Fill feature from the dashboard',
        'Attach CV and cover letter',
        'Note the application in the tracker',
      ],
      urls: [],
    },
    {
      day: 4,
      title: 'Follow up on connections',
      tasks: [
        'Check if alumni accepted connection requests',
        'If accepted: send a follow-up message mentioning the application naturally',
        'Connect with HR Manager if found via contactFinder',
      ],
      urls: [],
    },
    {
      day: 5,
      title: 'Engage with company content',
      tasks: [
        `Like and comment on ${company} recent LinkedIn posts`,
        `Follow ${company} official LinkedIn page`,
        'This increases profile visibility to recruiters',
      ],
      urls: [],
    },
    {
      day: 6,
      title: 'Second wave outreach',
      tasks: [
        'If no response from alumni: try 1-2 more connections',
        'Send cold outreach to HR Manager using Message Type 3',
        'Check application status in tracker',
      ],
      urls: [],
    },
    {
      day: 7,
      title: 'Review and escalate',
      tasks: [
        'If no response to application: send follow-up email',
        'Use the follow-up template from appTracker.js',
        `Connect with senior leaders at ${company} on LinkedIn`,
        'Move to next priority job if no response',
      ],
      urls: [],
    },
  ];
}

// ─── 5. generateCompanyInsights ───────────────────────────────────────────────
async function generateCompanyInsights(job) {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const { title, company } = job;

  const prompt = `Provide brief insights about ${company} for a job interview preparation. Include:
1. What the company does (2 sentences max)
2. Recent news or achievements (1-2 points)
3. Company culture keywords (3-5 words)
4. Likely interview questions for ${title} role (3 questions)
5. How Dheeraj's LSE Finance background and B2B sales experience are relevant (2 sentences)
Keep total response under 400 words.`;

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 600,
      messages: [{ role: 'user', content: prompt }],
    });
    return response.content[0].text.trim();
  } catch (err) {
    if (err.status === 429 || err.status === 402 || (err.message && err.message.includes('credit'))) {
      console.warn(`[networkingEngine] API credits issue for company insights. Returning null.`);
    } else {
      console.error(`[networkingEngine] Error generating company insights:`, err.message);
    }
    return null;
  }
}

// ─── 6. buildNetworkingPlan ───────────────────────────────────────────────────
async function buildNetworkingPlan(job) {
  try {
    const { title, company, location, tier, tierLabel } = job;
    const jobId = `${company.toLowerCase().replace(/\s+/g, '-')}-${title.toLowerCase().replace(/\s+/g, '-')}-${Date.now()}`;

    const alumniSearchUrls = generateAlumniSearchUrls(company);
    const linkedInSearchStrings = generateLinkedInSearchStrings(company);
    const linkedInMessages = await generateLinkedInMessages(job);
    const actionPlan = generate7DayActionPlan(job, alumniSearchUrls);
    const companyInsights = tier === 1 ? await generateCompanyInsights(job) : null;

    const plan = {
      jobId,
      jobTitle: title,
      company,
      location,
      tier: tier || null,
      tierLabel: tierLabel || null,
      alumniSearchUrls,
      linkedInSearchStrings,
      linkedInMessages,
      actionPlan,
      companyInsights,
      generatedDate: new Date().toISOString(),
    };

    // Save to data/networking.json
    await fs.ensureFile(DATA_FILE);
    let existing = [];
    try {
      existing = await fs.readJson(DATA_FILE);
      if (!Array.isArray(existing)) existing = [];
    } catch (_) {
      existing = [];
    }
    existing.push(plan);
    await fs.writeJson(DATA_FILE, existing, { spaces: 2 });

    return plan;
  } catch (err) {
    console.error(`[networkingEngine] buildNetworkingPlan error for ${job.company}:`, err.message);
    return null;
  }
}

// ─── 7. buildNetworkingPlansForTier1And2 ─────────────────────────────────────
async function buildNetworkingPlansForTier1And2(jobs) {
  const filtered = jobs.filter(j => j.tier === 1 || j.tier === 2);
  const plans = [];

  for (const job of filtered) {
    try {
      const plan = await buildNetworkingPlan(job);
      if (plan) plans.push(plan);
    } catch (err) {
      console.error(`[networkingEngine] Error processing ${job.company}:`, err.message);
    }
    if (filtered.indexOf(job) < filtered.length - 1) {
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  console.log(`[networkingEngine] Built networking plans for ${plans.length} jobs`);
  return plans;
}

// ─── 8. loadNetworkingPlans ───────────────────────────────────────────────────
function loadNetworkingPlans() {
  try {
    if (!fs.existsSync(DATA_FILE)) return [];
    return fs.readJsonSync(DATA_FILE);
  } catch (_) {
    return [];
  }
}

// ─── 9. getNetworkingPlanForJob ───────────────────────────────────────────────
function getNetworkingPlanForJob(company, jobTitle) {
  const plans = loadNetworkingPlans();
  return plans.find(
    p =>
      p.company.toLowerCase() === company.toLowerCase() &&
      p.jobTitle.toLowerCase() === jobTitle.toLowerCase()
  ) || null;
}

// ─── Exports ──────────────────────────────────────────────────────────────────
module.exports = {
  generateAlumniSearchUrls,
  generateLinkedInSearchStrings,
  generateLinkedInMessages,
  generate7DayActionPlan,
  generateCompanyInsights,
  buildNetworkingPlan,
  buildNetworkingPlansForTier1And2,
  loadNetworkingPlans,
  getNetworkingPlanForJob,
};

// ─── Test Block ───────────────────────────────────────────────────────────────
if (require.main === module) {
  const testJob = {
    title: 'Business Development Manager',
    company: 'Emirates Group',
    location: 'Dubai',
    tier: 1,
    tierLabel: 'APPLY TODAY',
  };

  (async () => {
    console.log('\n══════════════════════════════════════════════');
    console.log('  networkingEngine.js — Test Suite');
    console.log('══════════════════════════════════════════════\n');

    // Test 1: generateAlumniSearchUrls
    console.log('── Test 1: generateAlumniSearchUrls ──');
    const urls = generateAlumniSearchUrls(testJob.company);
    console.log('LSE Search URL:         ', urls.lse);
    console.log('Newcastle Search URL:   ', urls.newcastle);
    console.log('Chicago Booth URL:      ', urls.chicagoBooth);
    console.log('LSE Alumni Page:        ', urls.lsePage);
    console.log('Newcastle Alumni Page:  ', urls.newcastlePage);

    // Test 2: generateLinkedInSearchStrings
    console.log('\n── Test 2: generateLinkedInSearchStrings ──');
    const strings = generateLinkedInSearchStrings(testJob.company);
    strings.forEach((s, i) => console.log(`  ${i + 1}. ${s}`));

    // Test 3: generate7DayActionPlan
    console.log('\n── Test 3: generate7DayActionPlan (Day 1 & Day 3) ──');
    const plan = generate7DayActionPlan(testJob, urls);
    const days = [plan[0], plan[2]];
    days.forEach(d => {
      console.log(`\n  Day ${d.day} — ${d.title}`);
      d.tasks.forEach(t => console.log(`    • ${t}`));
      if (d.urls.length) d.urls.forEach(u => console.log(`    URL: ${u}`));
    });

    // Test 4: generateLinkedInMessages
    console.log('\n── Test 4: generateLinkedInMessages (Claude API) ──');
    const messages = await generateLinkedInMessages(testJob);
    console.log('\n  LSE Alumni Message:');
    console.log(' ', messages.lseAlumni);
    console.log('\n  Newcastle Alumni Message:');
    console.log(' ', messages.newcastleAlumni);
    console.log('\n  Cold Outreach Message:');
    console.log(' ', messages.coldOutreach);

    // Test 5: generateCompanyInsights
    console.log('\n── Test 5: generateCompanyInsights (Claude API) ──');
    const insights = await generateCompanyInsights(testJob);
    if (insights) {
      console.log(insights);
    } else {
      console.log('API credits needed');
    }

    // Test 6: buildNetworkingPlan
    console.log('\n── Test 6: buildNetworkingPlan (full combined test) ──');
    const fullPlan = await buildNetworkingPlan(testJob);
    if (fullPlan) {
      console.log('Networking plan saved to data/networking.json');
      const totalTasks = fullPlan.actionPlan.reduce((sum, d) => sum + d.tasks.length, 0);
      console.log(`Total tasks in 7-day plan: ${totalTasks}`);
    }

    console.log('\n══════════════════════════════════════════════\n');
  })();
}
