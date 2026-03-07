'use strict';

require('dotenv').config();
const axios = require('axios');
const fs = require('fs-extra');
const path = require('path');

const HUNTER_BASE = 'https://api.hunter.io/v2';
const APOLLO_BASE = 'https://api.apollo.io/v1';
const CONTACTS_FILE = path.join(__dirname, '..', 'data', 'contacts.json');

const HR_KEYWORDS = [
  'hr', 'human resources', 'talent', 'recruitment', 'recruiter',
  'talent acquisition', 'people', 'hiring', 'hr manager',
  'hr director', 'head of hr', 'hr business partner',
  'resourcing', 'staffing'
];

function isHrTitle(title) {
  if (!title) return false;
  const lower = title.toLowerCase();
  return HR_KEYWORDS.some(kw => lower.includes(kw));
}

// ─── 1. Hunter.io ─────────────────────────────────────────────────────────────

async function findContactsHunter(company, location) {
  console.log(`Hunter.io search for ${company}...`);
  const apiKey = process.env.HUNTER_API_KEY;
  const contacts = [];

  try {
    // Step 1: Domain search
    const domainRes = await axios.get(`${HUNTER_BASE}/domain-search`, {
      params: { company, api_key: apiKey, limit: 10 }
    });

    const data = domainRes.data.data;
    const domain = data && data.domain;
    const emails = (data && data.emails) || [];

    let hrContacts = emails.filter(e => isHrTitle(e.position));
    if (hrContacts.length === 0) hrContacts = emails; // fallback: all

    for (const e of hrContacts) {
      // Step 3: Verify email if present
      let confidence = e.confidence || 0;
      if (e.value) {
        try {
          const verRes = await axios.get(`${HUNTER_BASE}/email-verifier`, {
            params: { email: e.value, api_key: apiKey }
          });
          const score = verRes.data.data && verRes.data.data.score;
          if (score != null) confidence = score;
        } catch (_) { /* ignore verification errors */ }
      }

      contacts.push({
        name: [e.first_name, e.last_name].filter(Boolean).join(' ') || null,
        title: e.position || null,
        email: e.value || null,
        linkedin: e.linkedin || null,
        confidence,
        source: 'hunter'
      });
    }

    return contacts;
  } catch (err) {
    if (err.response) {
      if (err.response.status === 401) {
        console.error('Hunter.io API key invalid — check .env file');
      } else if (err.response.status === 429) {
        console.error('Hunter.io rate limit reached — try again later');
      } else {
        console.error('Hunter.io error:', err.response.status, err.response.data);
      }
    } else {
      console.error('Hunter.io request failed:', err.message);
    }
    return [];
  }
}

// ─── 2. Apollo.io ─────────────────────────────────────────────────────────────

async function findContactsApollo(company, location) {
  console.log(`Apollo.io search for ${company}...`);
  const apiKey = process.env.APOLLO_API_KEY;
  const contacts = [];

  try {
    const res = await axios.post(
      `${APOLLO_BASE}/people/search`,
      {
        q_organization_name: company,
        person_titles: [
          'HR Manager', 'HR Director', 'Talent Acquisition',
          'Recruiter', 'Head of HR', 'People Manager',
          'HR Business Partner', 'Talent Manager'
        ],
        per_page: 5
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache',
          'X-Api-Key': apiKey
        }
      }
    );

    const people = (res.data && res.data.people) || [];
    for (const p of people) {
      contacts.push({
        name: [p.first_name, p.last_name].filter(Boolean).join(' ') || null,
        title: p.title || null,
        email: p.email || null,
        linkedin: p.linkedin_url || null,
        confidence: 80, // Apollo does not provide a confidence score
        source: 'apollo'
      });
    }

    return contacts;
  } catch (err) {
    if (err.response) {
      if (err.response.status === 401) {
        console.error('Apollo.io API key invalid — check .env file');
      } else {
        console.error('Apollo.io error:', err.response.status, err.response.data);
      }
    } else {
      console.error('Apollo.io request failed:', err.message);
    }
    return [];
  }
}

// ─── 3. LinkedIn Search Terms ──────────────────────────────────────────────────

function generateLinkedInSearchTerms(company, location, jobTitle) {
  const searches = [
    `"HR Manager" "${company}" "${location}"`,
    `"Talent Acquisition" "${company}"`,
    `"Recruiter" OR "HR" "${company}" "${location}"`
  ];

  const companySlug = company.replace(/\s+/g, '+');
  const linkedInUrl =
    `https://www.linkedin.com/search/results/people/?` +
    `keywords=HR+Manager+${companySlug}&origin=GLOBAL_SEARCH_HEADER`;

  const directMessage =
    `Hi [Name], I recently applied for the ${jobTitle} role at ${company} ` +
    `and wanted to connect. I have a background in business development and ` +
    `finance from LSE and would love to discuss the opportunity.`;

  return { searches, linkedInUrl, directMessage };
}

// ─── 4. findAllContacts ────────────────────────────────────────────────────────

async function findAllContacts(job) {
  const { title, company, location, tier } = job;

  const hunterContacts = await findContactsHunter(company, location);
  const apolloContacts = await findContactsApollo(company, location);

  // Deduplicate by email
  const seen = new Set();
  const merged = [];
  for (const c of [...hunterContacts, ...apolloContacts]) {
    const key = c.email ? c.email.toLowerCase() : `${c.name}|${c.source}`;
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(c);
    }
  }

  const linkedIn = generateLinkedInSearchTerms(company, location, title);
  const jobId = `${company}_${title}_${new Date().toISOString().slice(0, 10)}`;

  // Determine domain from Hunter if available (first email's domain)
  const domainContact = hunterContacts.find(c => c.email && c.email.includes('@'));
  const domainFound = domainContact
    ? domainContact.email.split('@')[1]
    : null;

  const record = {
    jobId,
    jobTitle: title,
    company,
    location,
    tier,
    source: merged.length > 0
      ? (hunterContacts.length > 0 && apolloContacts.length > 0 ? 'hunter+apollo'
        : hunterContacts.length > 0 ? 'hunter' : 'apollo')
      : 'manual',
    contacts: merged,
    linkedInSearchTerms: linkedIn.searches,
    linkedInUrl: linkedIn.linkedInUrl,
    directMessage: linkedIn.directMessage,
    domainFound,
    searchDate: new Date().toISOString()
  };

  // Save to contacts.json
  let all = await loadContacts();
  // Replace existing record for same jobId or append
  const idx = all.findIndex(r => r.jobId === jobId);
  if (idx >= 0) {
    all[idx] = record;
  } else {
    all.push(record);
  }
  await fs.outputJson(CONTACTS_FILE, all, { spaces: 2 });
  console.log(`Saved contacts for ${company} to data/contacts.json`);

  return record;
}

// ─── 5. findContactsForTier1And2 ──────────────────────────────────────────────

async function findContactsForTier1And2(jobs) {
  const qualifying = jobs.filter(j => j.tier === 1 || j.tier === 2);
  const results = [];

  for (const job of qualifying) {
    const record = await findAllContacts(job);
    results.push(record);
    if (qualifying.indexOf(job) < qualifying.length - 1) {
      await new Promise(r => setTimeout(r, 1000));
    }
  }

  console.log(`Found contacts for ${results.length} of ${qualifying.length} jobs`);
  return results;
}

// ─── 6. loadContacts ──────────────────────────────────────────────────────────

async function loadContacts() {
  try {
    const exists = await fs.pathExists(CONTACTS_FILE);
    if (!exists) return [];
    return await fs.readJson(CONTACTS_FILE);
  } catch (_) {
    return [];
  }
}

// ─── 7. getContactsForJob ─────────────────────────────────────────────────────

async function getContactsForJob(company, jobTitle) {
  const all = await loadContacts();
  return all.find(
    r =>
      r.company.toLowerCase() === company.toLowerCase() &&
      r.jobTitle.toLowerCase() === jobTitle.toLowerCase()
  ) || null;
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  findContactsHunter,
  findContactsApollo,
  generateLinkedInSearchTerms,
  findAllContacts,
  findContactsForTier1And2,
  loadContacts,
  getContactsForJob
};

// ─── Test Block ───────────────────────────────────────────────────────────────

if (require.main === module) {
  (async () => {
    // Test 1: LinkedIn search terms (offline)
    console.log('\n══════════════════════════════════');
    console.log('Test 1: generateLinkedInSearchTerms');
    console.log('══════════════════════════════════');
    const li = generateLinkedInSearchTerms(
      'Goldman Sachs', 'Dubai', 'Business Development Manager'
    );
    li.searches.forEach((s, i) => console.log(`Search ${i + 1}: ${s}`));
    console.log('LinkedIn URL:', li.linkedInUrl);
    console.log('Direct Message:', li.directMessage);

    // Test 2: Hunter.io live
    console.log('\n══════════════════════════════════');
    console.log('Test 2: findContactsHunter (live)');
    console.log('══════════════════════════════════');
    const hunterResults = await findContactsHunter('Emaar Properties', 'Dubai');
    console.log(`Contacts found: ${hunterResults.length}`);
    if (hunterResults.length > 0) {
      const first = hunterResults[0];
      console.log(`First contact — Name: ${first.name}, Title: ${first.title}, Email: ${first.email}`);
    }

    // Test 3: Apollo.io live
    console.log('\n══════════════════════════════════');
    console.log('Test 3: findContactsApollo (live)');
    console.log('══════════════════════════════════');
    const apolloResults = await findContactsApollo('Majid Al Futtaim', 'Dubai');
    console.log(`Contacts found: ${apolloResults.length}`);
    if (apolloResults.length > 0) {
      const first = apolloResults[0];
      console.log(`First contact — Name: ${first.name}, Title: ${first.title}`);
    }

    // Test 4: findAllContacts combined
    console.log('\n══════════════════════════════════');
    console.log('Test 4: findAllContacts (combined)');
    console.log('══════════════════════════════════');
    const testJob = {
      title: 'Business Development Manager',
      company: 'ADNOC',
      location: 'Abu Dhabi',
      tier: 1,
      tierLabel: 'APPLY TODAY'
    };
    const record = await findAllContacts(testJob);
    console.log(`Total unique contacts found: ${record.contacts.length}`);
    console.log('Data saved to contacts.json: confirmed');
  })();
}
