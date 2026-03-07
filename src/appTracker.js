require('dotenv').config();
const fs = require('fs-extra');
const path = require('path');
const nodemailer = require('nodemailer');

const DATA_FILE = path.join(__dirname, '../data/applications.json');
const VALID_STATUSES = ['Applied', 'Screening', 'Interview', 'Offer', 'Rejected'];

function loadApplications() {
  if (!fs.existsSync(DATA_FILE)) {
    fs.ensureFileSync(DATA_FILE);
    fs.writeJsonSync(DATA_FILE, [], { spaces: 2 });
    return [];
  }
  return fs.readJsonSync(DATA_FILE);
}

function saveApplications(applications) {
  fs.ensureDirSync(path.dirname(DATA_FILE));
  fs.writeJsonSync(DATA_FILE, applications, { spaces: 2 });
}

function addApplication(job) {
  const today = new Date().toISOString().split('T')[0];
  const id = `${job.company}_${job.title}_${today}`
    .toLowerCase()
    .replace(/\s+/g, '_');

  const applications = loadApplications();
  const duplicate = applications.find(a => a.id === id);
  if (duplicate) {
    console.warn(`[WARN] Duplicate application skipped: ${id}`);
    return duplicate;
  }

  const newApp = {
    id,
    jobTitle: job.title,
    company: job.company,
    location: job.location,
    applyUrl: job.applyUrl,
    tier: job.tier,
    tierLabel: job.tierLabel,
    totalScore: job.totalScore,
    salaryAED: job.salaryAED !== undefined ? job.salaryAED : null,
    appliedDate: today,
    status: 'Applied',
    lastUpdated: today,
    followUpSent: false,
    followUpDate: null,
    notes: '',
    contactEmail: null,
    coverLetterPath: job.coverLetterPath || null,
  };

  applications.push(newApp);
  saveApplications(applications);
  return newApp;
}

function updateStatus(id, newStatus, notes) {
  if (!VALID_STATUSES.includes(newStatus)) {
    console.error(`[ERROR] Invalid status: ${newStatus}`);
    return null;
  }

  const today = new Date().toISOString().split('T')[0];
  const applications = loadApplications();
  const app = applications.find(a => a.id === id);

  if (!app) {
    console.warn(`[WARN] Application not found: ${id}`);
    return null;
  }

  app.status = newStatus;
  app.lastUpdated = today;
  if (notes) {
    app.notes = app.notes ? `${app.notes}\n${notes}` : notes;
  }

  saveApplications(applications);
  return app;
}

function getPipelineSummary() {
  const applications = loadApplications();
  const summary = {
    total: applications.length,
    Applied: 0,
    Screening: 0,
    Interview: 0,
    Offer: 0,
    Rejected: 0,
    tierBreakdown: { tier1: 0, tier2: 0, tier3: 0, tier4: 0 },
  };

  for (const app of applications) {
    if (summary[app.status] !== undefined) summary[app.status]++;
    const key = `tier${app.tier}`;
    if (summary.tierBreakdown[key] !== undefined) summary.tierBreakdown[key]++;
  }

  return summary;
}

async function checkFollowUps() {
  const today = new Date();
  const applications = loadApplications();
  const due = [];

  for (const app of applications) {
    if (app.status !== 'Applied' || app.followUpSent) continue;
    const applied = new Date(app.appliedDate);
    const diffDays = Math.floor((today - applied) / (1000 * 60 * 60 * 24));
    if (diffDays >= 7) due.push(app);
  }

  const todayStr = today.toISOString().split('T')[0];
  for (const app of due) {
    const sent = await sendFollowUpEmail(app);
    if (sent) {
      app.followUpSent = true;
      app.followUpDate = todayStr;
    }
  }

  if (due.length > 0) saveApplications(applications);
  return due;
}

async function sendFollowUpEmail(application) {
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: false,
    auth: {
      user: process.env.EMAIL_FROM,
      pass: process.env.EMAIL_PASSWORD,
    },
  });

  const subject = `Follow-up Reminder: ${application.jobTitle} at ${application.company}`;

  const body = `Hi Dheeraj,

You applied for ${application.jobTitle} at ${application.company} (${application.location})
on ${application.appliedDate} — 7 days ago with no response yet.

Job URL: ${application.applyUrl}
Your Tier: ${application.tierLabel}
Status: ${application.status}

Suggested follow-up action:
1. Find the HR Manager on LinkedIn at ${application.company}
2. Send a polite connection request referencing your application
3. Email subject: "Following up — ${application.jobTitle} Application"

Template message:
"Dear Hiring Manager,
I applied for the ${application.jobTitle} role at ${application.company} on ${application.appliedDate}
and wanted to follow up to express my continued interest.
I am very enthusiastic about this opportunity and would welcome
the chance to discuss how my background in business development
and finance can add value to your team.
Please let me know if you need any additional information.
Kind regards,
Dheeraj Thiagarajan
+44 7501069543"

This is an automated reminder from your GCC Job Agent.`;

  try {
    await transporter.sendMail({
      from: process.env.EMAIL_FROM,
      to: 'dheerajt1899@gmail.com',
      cc: 'sthiagarajan111@gmail.com',
      subject,
      text: body,
    });
    console.log(`Follow-up sent for ${application.jobTitle} at ${application.company}`);
    return true;
  } catch (err) {
    console.error(`[ERROR] Failed to send follow-up for ${application.jobTitle}:`, err.message);
    return false;
  }
}

function getApplicationsByStatus(status) {
  return loadApplications().filter(a => a.status === status);
}

function getTier1And2Applications() {
  return loadApplications()
    .filter(a => a.tier === 1 || a.tier === 2)
    .sort((a, b) => new Date(b.appliedDate) - new Date(a.appliedDate));
}

module.exports = {
  loadApplications,
  saveApplications,
  addApplication,
  updateStatus,
  getPipelineSummary,
  checkFollowUps,
  sendFollowUpEmail,
  getApplicationsByStatus,
  getTier1And2Applications,
};

if (require.main === module) {
  (async () => {
    console.log('\n=== TEST 1: Add 3 sample applications ===');
    const job1 = addApplication({
      title: 'Business Development Manager',
      company: 'Goldman Sachs',
      location: 'Dubai',
      tier: 1,
      tierLabel: 'APPLY TODAY',
      totalScore: 93,
      applyUrl: 'https://linkedin.com/jobs/1',
      salaryAED: 22000,
    });
    console.log('Added:', job1.id);

    const job2 = addApplication({
      title: 'Sales Executive',
      company: 'Emaar Properties',
      location: 'Dubai',
      tier: 2,
      tierLabel: 'APPLY THIS WEEK',
      totalScore: 75,
      applyUrl: 'https://linkedin.com/jobs/2',
      salaryAED: 18000,
    });
    console.log('Added:', job2.id);

    const job3 = addApplication({
      title: 'Finance Analyst',
      company: 'ADNOC',
      location: 'Abu Dhabi',
      tier: 2,
      tierLabel: 'APPLY THIS WEEK',
      totalScore: 72,
      applyUrl: 'https://linkedin.com/jobs/3',
      salaryAED: 20000,
    });
    console.log('Added:', job3.id);

    console.log('\n=== TEST 2: Update Job 2 status to Screening ===');
    const updated = updateStatus(job2.id, 'Screening', 'Recruiter called');
    console.log('Updated:', updated ? `${updated.id} → ${updated.status}` : 'NOT FOUND');

    console.log('\n=== TEST 3: Pipeline Summary ===');
    const summary = getPipelineSummary();
    console.log(JSON.stringify(summary, null, 2));

    console.log('\n=== TEST 4: Tier 1 and 2 Applications ===');
    const topTier = getTier1And2Applications();
    console.log(`Count: ${topTier.length}`);
    topTier.forEach(a => console.log(` - ${a.company} (Tier ${a.tier})`));

    console.log('\n=== TEST 5: Check Follow-ups ===');
    const followUps = await checkFollowUps();
    console.log(`Follow-ups due today: ${followUps.length}`);
  })();
}
