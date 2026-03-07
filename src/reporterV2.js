'use strict';

require('dotenv').config();
const fs = require('fs-extra');
const path = require('path');
const nodemailer = require('nodemailer');
const { getPipelineSummary } = require('./appTracker');
const { estimateSalary } = require('./salaryEngine');

// ─── Helpers ────────────────────────────────────────────────────────────────

function fmtDate(d) {
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function fmtTime(d) {
  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

function scoreCircleColor(score) {
  if (score >= 90) return '#27AE60';
  if (score >= 70) return '#4A90D9';
  if (score >= 50) return '#E67E22';
  return '#95A5A6';
}

function tierBorderColor(tier) {
  if (tier === 1) return '#27AE60';
  if (tier === 2) return '#4A90D9';
  if (tier === 3) return '#E67E22';
  return '#95A5A6';
}

function salaryVerdict(aed) {
  if (aed >= 18000) return { label: 'ABOVE TARGET', color: '#27AE60' };
  if (aed >= 14000) return { label: 'AT MINIMUM',   color: '#E67E22' };
  return                    { label: 'BELOW FLOOR',  color: '#E74C3C' };
}

function fmtAED(n) {
  return 'AED ' + Number(n).toLocaleString() + '/month';
}

// ─── Job Card ────────────────────────────────────────────────────────────────

function renderJobCard(job) {
  const border = tierBorderColor(job.tier);
  const circleColor = scoreCircleColor(job.totalScore || 0);

  // Fortune 500 badge
  const f500 = job.isFortuneCompany
    ? `<span style="display:inline-block;background:#F5A623;color:#1B2A4A;padding:2px 8px;border-radius:3px;font-size:11px;font-weight:bold;margin-left:6px">🏆 FORTUNE 500</span>`
    : '';

  // GCC badge
  const gccBadge = (!job.isFortuneCompany && job.isGCCConglomerate)
    ? `<span style="display:inline-block;background:#2E4A7A;color:#fff;padding:2px 8px;border-radius:3px;font-size:11px;font-weight:bold;margin-left:6px">GCC GROUP</span>`
    : '';

  // Tier badge
  const tierBadge = `<span style="display:inline-block;background:${border};color:#fff;padding:2px 8px;border-radius:3px;font-size:11px;font-weight:bold">${job.tierLabel || ''}</span>`;

  // Score breakdown
  const scoreBadge = (icon, label, score, max) => `
    <span style="display:inline-block;background:#F8F9FA;border:1px solid #ddd;border-radius:4px;padding:3px 8px;font-size:12px;margin-right:6px;color:#333">
      ${icon} ${label}: <strong>${score}/${max}</strong>
    </span>`;

  const breakdown = [
    scoreBadge('📍', 'Location', job.locationScore || 0, 25),
    scoreBadge('🏢', 'Company',  job.companyScore  || 0, 25),
    scoreBadge('💰', 'Salary',   job.salaryScore   || 0, 25),
    scoreBadge('🎯', 'Match',    job.matchScore    || 0, 25),
  ].join('');

  // Salary row
  let salaryHtml;
  if (job.salaryAED) {
    const v = salaryVerdict(job.salaryAED);
    salaryHtml = `
      <span style="color:#27AE60;font-weight:bold">${fmtAED(job.salaryAED)}</span>
      <span style="display:inline-block;background:${v.color};color:#fff;padding:2px 8px;border-radius:3px;font-size:11px;font-weight:bold;margin-left:8px">${v.label}</span>`;
  } else {
    const est = estimateSalary(job.title, job.location);
    const v = salaryVerdict(est.typicalAED);
    salaryHtml = `
      <span style="color:#888;font-style:italic">Est. AED ${Number(est.minAED).toLocaleString()} – ${Number(est.maxAED).toLocaleString()}/month</span>
      <span style="display:inline-block;background:${v.color};color:#fff;padding:2px 8px;border-radius:3px;font-size:11px;font-weight:bold;margin-left:8px">${v.label}</span>`;
  }

  // Buttons
  const viewBtn = `<a href="${job.applyUrl || '#'}" style="display:inline-block;background:#1B2A4A;color:#fff;padding:7px 14px;border-radius:4px;text-decoration:none;font-size:13px;font-weight:bold;margin-right:8px">VIEW JOB</a>`;
  const clBtn = job.coverLetterPath
    ? `<a href="${job.coverLetterPath}" style="display:inline-block;background:#4A90D9;color:#fff;padding:7px 14px;border-radius:4px;text-decoration:none;font-size:13px;font-weight:bold">COVER LETTER</a>`
    : `<span style="display:inline-block;background:#95A5A6;color:#fff;padding:7px 14px;border-radius:4px;font-size:13px;font-weight:bold">COVER LETTER</span>`;

  return `
  <div style="background:#fff;border-left:4px solid ${border};box-shadow:0 2px 4px rgba(0,0,0,0.1);padding:16px;margin-bottom:12px;border-radius:2px">
    <table width="100%" cellpadding="0" cellspacing="0"><tr>
      <td style="vertical-align:top">
        <p style="margin:0 0 2px;font-size:16px;font-weight:bold;color:#1B2A4A">${job.title || ''}</p>
        <p style="margin:0 0 4px;font-size:14px;color:#2E4A7A">${job.company || ''}</p>
        <p style="margin:0 0 6px;font-size:12px;color:#888">${job.location || ''} &nbsp;|&nbsp; ${tierBadge}${f500}${gccBadge}</p>
      </td>
      <td style="vertical-align:top;text-align:right;width:80px">
        <div style="width:56px;height:56px;border-radius:50%;background:${circleColor};display:inline-flex;align-items:center;justify-content:center;color:#fff;font-size:18px;font-weight:bold;line-height:56px;text-align:center">
          ${job.totalScore || 0}
        </div>
      </td>
    </tr></table>
    <div style="margin:10px 0 10px">${breakdown}</div>
    <table width="100%" cellpadding="0" cellspacing="0"><tr>
      <td style="vertical-align:middle;font-size:13px">${salaryHtml}</td>
      <td style="text-align:right;vertical-align:middle">${viewBtn}${clBtn}</td>
    </tr></table>
  </div>`;
}

// ─── Section Header ──────────────────────────────────────────────────────────

function sectionHeader(title) {
  return `<div style="background:#1B2A4A;padding:12px 20px;margin:24px 0 12px;border-radius:4px"><h2 style="margin:0;font-size:16px;font-weight:bold;color:#fff">${title}</h2></div>`;
}

// ─── Tier 3 Table ────────────────────────────────────────────────────────────

function renderTier3Table(jobs) {
  if (!jobs.length) return '';
  const rows = jobs.map(j => `
    <tr style="border-bottom:1px solid #eee">
      <td style="padding:8px;font-size:13px;color:#333">${j.title || ''}</td>
      <td style="padding:8px;font-size:13px;color:#555">${j.company || ''}</td>
      <td style="padding:8px;font-size:13px;color:#555">${j.location || ''}</td>
      <td style="padding:8px;font-size:13px;text-align:center;font-weight:bold;color:#E67E22">${j.totalScore || 0}</td>
    </tr>`).join('');
  return `
  <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;background:#fff;border:1px solid #ddd;border-radius:4px">
    <thead>
      <tr style="background:#F8F9FA">
        <th style="padding:10px 8px;text-align:left;font-size:12px;color:#666;font-weight:bold">TITLE</th>
        <th style="padding:10px 8px;text-align:left;font-size:12px;color:#666;font-weight:bold">COMPANY</th>
        <th style="padding:10px 8px;text-align:left;font-size:12px;color:#666;font-weight:bold">LOCATION</th>
        <th style="padding:10px 8px;text-align:center;font-size:12px;color:#666;font-weight:bold">SCORE</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>`;
}

// ─── generateEmailHTML ───────────────────────────────────────────────────────

function generateEmailHTML(jobs, pipelineSummary) {
  const now = new Date();
  const dateStr = fmtDate(now);
  const timeStr = fmtTime(now);

  const tier1Jobs = jobs.filter(j => j.tier === 1);
  const tier2Jobs = jobs.filter(j => j.tier === 2).slice(0, 30);
  const tier3Jobs = jobs.filter(j => j.tier === 3);
  const f500Count = jobs.filter(j => j.isFortuneCompany).length;

  const pipeline = pipelineSummary || { total: 0, Applied: 0, Screening: 0, Interview: 0, Offer: 0, Rejected: 0 };

  // Salary intelligence
  const jobsWithSalary = jobs.filter(j => j.salaryAED);
  const topSalary = jobsWithSalary.length ? Math.max(...jobsWithSalary.map(j => j.salaryAED)) : null;
  const t1Salaries = tier1Jobs.filter(j => j.salaryAED).map(j => j.salaryAED);
  const avgT1Salary = t1Salaries.length ? Math.round(t1Salaries.reduce((a, b) => a + b, 0) / t1Salaries.length) : null;

  // For jobs without salary, use estimateSalary
  const allEffectiveSalaries = jobs.map(j => {
    if (j.salaryAED) return j.salaryAED;
    const est = estimateSalary(j.title, j.location);
    return est.typicalAED;
  });
  const aboveTarget = allEffectiveSalaries.filter(s => s >= 18000).length;
  const aboveStretch = allEffectiveSalaries.filter(s => s >= 25000).length;

  // Pipeline status boxes
  const pipelineStatuses = [
    { label: 'Applied',   count: pipeline.Applied   || 0, color: '#4A90D9' },
    { label: 'Screening', count: pipeline.Screening || 0, color: '#E67E22' },
    { label: 'Interview', count: pipeline.Interview || 0, color: '#27AE60' },
    { label: 'Offer',     count: pipeline.Offer     || 0, color: '#F5A623' },
    { label: 'Rejected',  count: pipeline.Rejected  || 0, color: '#E74C3C' },
  ];

  const pipelineBoxes = pipelineStatuses.map(s => `
    <td style="text-align:center;padding:0 8px">
      <div style="background:rgba(255,255,255,0.15);border-radius:6px;padding:12px 16px">
        <div style="font-size:28px;font-weight:bold;color:#fff">${s.count}</div>
        <div style="font-size:11px;color:rgba(255,255,255,0.8);margin-top:4px;text-transform:uppercase">${s.label}</div>
        <div style="height:3px;background:${s.color};border-radius:2px;margin-top:6px"></div>
      </div>
    </td>`).join('');

  // Stat boxes in header
  const statBoxes = [
    { label: 'Total Jobs Today', value: jobs.length,                  color: '#F5A623' },
    { label: 'Tier 1 + Tier 2',  value: tier1Jobs.length + tier2Jobs.length, color: '#27AE60' },
    { label: 'Fortune 500',       value: f500Count,                   color: '#4A90D9' },
  ].map(b => `
    <td style="text-align:center;padding:0 10px">
      <div style="background:rgba(255,255,255,0.1);border-radius:6px;padding:14px 18px">
        <div style="font-size:32px;font-weight:bold;color:${b.color}">${b.value}</div>
        <div style="font-size:12px;color:rgba(255,255,255,0.8);margin-top:4px">${b.label}</div>
      </div>
    </td>`).join('');

  // Detect candidateId if not set
  function detectCandidateId(job) {
    if (job.candidateId) return job.candidateId;
    const title = (job.title || '').toLowerCase();
    const afterSalesKeywords = ['after sales', 'aftersales', 'service director', 'service manager', 'warranty', 'general manager', 'head of service', 'director service'];
    return afterSalesKeywords.some(k => title.includes(k)) ? 'thiagarajan' : 'dheeraj';
  }

  // Split jobs by candidate
  const dheerajJobs = jobs.filter(j => detectCandidateId(j) === 'dheeraj');
  const thiagarajanJobs = jobs.filter(j => detectCandidateId(j) === 'thiagarajan');

  // Dheeraj tier sections
  const dt1 = dheerajJobs.filter(j => j.tier === 1);
  const dt2 = dheerajJobs.filter(j => j.tier === 2).slice(0, 30);
  const dt3 = dheerajJobs.filter(j => j.tier === 3);

  const dheerajSection = `
    <div style="background:#1B2A4A;border-left:4px solid #58A6FF;padding:12px 20px;margin:24px 0 12px;border-radius:4px">
      <h2 style="margin:0;font-size:16px;font-weight:bold;color:#fff">🔵 Dheeraj Thiagarajan — Jobs</h2>
    </div>
    ${dt1.length ? sectionHeader(`🔥 TIER 1 — APPLY TODAY (${dt1.length} jobs)`) + dt1.map(renderJobCard).join('') : ''}
    ${dt2.length ? sectionHeader(`📋 TIER 2 — APPLY THIS WEEK (${dt2.length} jobs)`) + dt2.map(renderJobCard).join('') : ''}
    ${dt3.length ? sectionHeader(`📌 TIER 3 — APPLY IF TIME (${dt3.length} jobs)`) + renderTier3Table(dt3) : ''}
    ${!dt1.length && !dt2.length && !dt3.length ? '<p style="color:#888;padding:12px">No jobs found for Dheeraj today.</p>' : ''}
  `;

  // Thiagarajan tier sections
  const ts1 = thiagarajanJobs.filter(j => j.tier === 1);
  const ts2 = thiagarajanJobs.filter(j => j.tier === 2).slice(0, 30);
  const ts3 = thiagarajanJobs.filter(j => j.tier === 3);

  const thiagarajanSection = `
    <div style="background:#1A2E1A;border-left:4px solid #3FB950;padding:12px 20px;margin:24px 0 12px;border-radius:4px">
      <h2 style="margin:0;font-size:16px;font-weight:bold;color:#fff">🟢 Thiagarajan Shanthakumar — Jobs</h2>
    </div>
    ${ts1.length ? sectionHeader(`🔥 TIER 1 — APPLY TODAY (${ts1.length} jobs)`) + ts1.map(renderJobCard).join('') : ''}
    ${ts2.length ? sectionHeader(`📋 TIER 2 — APPLY THIS WEEK (${ts2.length} jobs)`) + ts2.map(renderJobCard).join('') : ''}
    ${ts3.length ? sectionHeader(`📌 TIER 3 — APPLY IF TIME (${ts3.length} jobs)`) + renderTier3Table(ts3) : ''}
    ${!ts1.length && !ts2.length && !ts3.length ? '<p style="color:#888;padding:12px">No jobs found for Thiagarajan today.</p>' : ''}
  `;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>GCC Job Agent — Daily Report</title>
<style>
  body { margin:0;padding:0;background:#EBEBEB;font-family:Arial,Helvetica,sans-serif }
  a { color:inherit }
</style>
</head>
<body>
<div style="max-width:720px;margin:0 auto;background:#ffffff">

  <!-- SECTION 1: HEADER -->
  <div style="background:#1B2A4A;padding:32px 28px">
    <h1 style="margin:0 0 4px;font-size:24px;font-weight:bold;color:#fff;letter-spacing:1px">GCC JOB AGENT — DAILY REPORT</h1>
    <p style="margin:0 0 20px;font-size:14px;color:rgba(255,255,255,0.7)">${dateStr} &nbsp;|&nbsp; London → Dubai target</p>
    <table cellpadding="0" cellspacing="0"><tr>${statBoxes}</tr></table>
  </div>

  <!-- SECTION 2: PIPELINE BANNER -->
  <div style="background:#2E4A7A;padding:20px 28px">
    <p style="margin:0 0 14px;font-size:14px;font-weight:bold;color:rgba(255,255,255,0.9);text-transform:uppercase;letter-spacing:1px">YOUR APPLICATION PIPELINE</p>
    <table width="100%" cellpadding="0" cellspacing="0"><tr>${pipelineBoxes}</tr></table>
  </div>

  <!-- SECTIONS 3 / 4 / 5 -->
  <div style="padding:16px 28px 24px">
    ${dheerajSection}
    ${thiagarajanSection}

    <!-- SECTION 6: SALARY INTELLIGENCE -->
    <div style="background:#F8F9FA;border:1px solid #ddd;border-radius:6px;padding:20px;margin-top:28px">
      <h2 style="margin:0 0 16px;font-size:16px;font-weight:bold;color:#1B2A4A">💰 SALARY INTELLIGENCE</h2>
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td style="vertical-align:top;width:50%;padding-right:16px">
            <p style="margin:0 0 8px;font-size:13px;color:#333"><strong>Your UK take-home:</strong> GBP 2,380/month</p>
            <p style="margin:0 0 8px;font-size:13px;color:#333"><strong>AED equivalent:</strong> AED 14,000/month</p>
            <p style="margin:0 0 8px;font-size:13px;color:#27AE60"><strong>Your target:</strong> AED 18,000/month</p>
            <p style="margin:0;font-size:13px;color:#4A90D9"><strong>Your stretch:</strong> AED 25,000/month</p>
          </td>
          <td style="vertical-align:top;width:50%;padding-left:16px;border-left:2px solid #ddd">
            <p style="margin:0 0 8px;font-size:13px;color:#333"><strong>Top salary found today:</strong> ${topSalary ? fmtAED(topSalary) : 'N/A'}</p>
            <p style="margin:0 0 8px;font-size:13px;color:#333"><strong>Average Tier 1 salary:</strong> ${avgT1Salary ? fmtAED(avgT1Salary) : 'N/A'}</p>
            <p style="margin:0 0 8px;font-size:13px;color:#27AE60"><strong>Jobs above your target:</strong> ${aboveTarget} jobs</p>
            <p style="margin:0;font-size:13px;color:#4A90D9"><strong>Jobs above your stretch:</strong> ${aboveStretch} jobs</p>
          </td>
        </tr>
      </table>
    </div>
  </div>

  <!-- SECTION 7: FOOTER -->
  <div style="background:#1B2A4A;padding:20px 28px;text-align:center">
    <p style="margin:0 0 4px;font-size:13px;color:rgba(255,255,255,0.9);font-weight:bold">GCC Job Agent | Built for Dheeraj Thiagarajan</p>
    <p style="margin:0 0 4px;font-size:12px;color:rgba(255,255,255,0.7)">LSE GMIM Finance 2025 | Chicago Booth MBA Exchange</p>
    <p style="margin:0 0 4px;font-size:12px;color:rgba(255,255,255,0.7)">Target: Dubai | AED 18,000/month minimum</p>
    <p style="margin:0;font-size:11px;color:rgba(255,255,255,0.5)">This report was auto-generated at ${timeStr}</p>
  </div>

</div>
</body>
</html>`;
}

// ─── sendReportEmail ─────────────────────────────────────────────────────────

async function sendReportEmail(jobs, pipelineSummary) {
  const html = generateEmailHTML(jobs, pipelineSummary);

  const now = new Date();
  const dateKey = now.toISOString().split('T')[0];
  const filePath = path.join(__dirname, '../data', `reportV2-${dateKey}.html`);
  await fs.ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, html, 'utf8');

  const tier1Count = jobs.filter(j => j.tier === 1).length;
  const tier2Count = jobs.filter(j => j.tier === 2).length;
  const dateLabel = now.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  const subject = `GCC Job Agent — ${dateLabel} — ${tier1Count} Tier 1 + ${tier2Count} Tier 2 Jobs Found`;

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: false,
    auth: {
      user: process.env.EMAIL_FROM,
      pass: process.env.EMAIL_PASSWORD,
    },
  });

  const recipients = [
    'dheerajt1899@gmail.com',
    'jothidevchin@gmail.com',
    'sthiagarajan111@gmail.com',
    'sthiagarajan111@yahoo.com',
  ];

  await transporter.sendMail({
    from: process.env.EMAIL_FROM,
    to: recipients.join(', '),
    subject,
    html,
  });

  console.log('ReporterV2 email sent to 4 recipients');
  return { success: true, filePath, tier1Count, tier2Count };
}

// ─── runDailyReport ──────────────────────────────────────────────────────────

async function runDailyReport(jobs) {
  const pipelineSummary = getPipelineSummary();
  return sendReportEmail(jobs, pipelineSummary);
}

module.exports = { generateEmailHTML, sendReportEmail, runDailyReport };

// ─── TEST BLOCK ──────────────────────────────────────────────────────────────

if (require.main === module) {
  const sampleJobs = [
    {
      title: 'Business Development Manager', company: 'Goldman Sachs',
      location: 'Dubai', tier: 1, tierLabel: 'APPLY TODAY', totalScore: 93,
      locationScore: 25, companyScore: 25, salaryScore: 18, matchScore: 25,
      isFortuneCompany: true, salaryAED: 22000,
      applyUrl: 'https://linkedin.com/jobs/1',
    },
    {
      title: 'Strategy Consultant', company: 'Emaar Properties',
      location: 'Dubai', tier: 1, tierLabel: 'APPLY TODAY', totalScore: 90,
      locationScore: 25, companyScore: 20, salaryScore: 25, matchScore: 20,
      isFortuneCompany: false, isGCCConglomerate: true, salaryAED: 27000,
      applyUrl: 'https://linkedin.com/jobs/2',
    },
    {
      title: 'Investment Analyst', company: 'ADNOC',
      location: 'Abu Dhabi', tier: 2, tierLabel: 'APPLY THIS WEEK', totalScore: 82,
      locationScore: 20, companyScore: 25, salaryScore: 18, matchScore: 19,
      isFortuneCompany: true, salaryAED: null,
      applyUrl: 'https://linkedin.com/jobs/3',
    },
    {
      title: 'Sales Manager', company: 'Majid Al Futtaim',
      location: 'Dubai', tier: 2, tierLabel: 'APPLY THIS WEEK', totalScore: 78,
      locationScore: 25, companyScore: 20, salaryScore: 10, matchScore: 23,
      isFortuneCompany: false, isGCCConglomerate: true, salaryAED: null,
      applyUrl: 'https://linkedin.com/jobs/4',
    },
    {
      title: 'Commercial Manager', company: 'Al Habtoor Group',
      location: 'Dubai', tier: 2, tierLabel: 'APPLY THIS WEEK', totalScore: 75,
      locationScore: 25, companyScore: 20, salaryScore: 12, matchScore: 18,
      isFortuneCompany: false, isGCCConglomerate: true, salaryAED: 16000,
      applyUrl: 'https://linkedin.com/jobs/5',
    },
    {
      title: 'Business Analyst', company: 'Etisalat',
      location: 'Abu Dhabi', tier: 3, tierLabel: 'APPLY IF TIME', totalScore: 65,
      locationScore: 20, companyScore: 20, salaryScore: 10, matchScore: 15,
      isFortuneCompany: false, salaryAED: null,
      applyUrl: 'https://linkedin.com/jobs/6',
    },
    {
      title: 'Finance Analyst', company: 'Regional Bank',
      location: 'Qatar', tier: 3, tierLabel: 'APPLY IF TIME', totalScore: 55,
      locationScore: 15, companyScore: 15, salaryScore: 10, matchScore: 15,
      isFortuneCompany: false, salaryAED: 14000,
      applyUrl: 'https://linkedin.com/jobs/7',
    },
    {
      title: 'Marketing Manager', company: 'Unknown LLC',
      location: 'Oman', tier: 4, tierLabel: 'OPTIONAL', totalScore: 30,
      locationScore: 8, companyScore: 5, salaryScore: 10, matchScore: 7,
      isFortuneCompany: false, salaryAED: null,
      applyUrl: 'https://linkedin.com/jobs/8',
    },
  ];

  const mockPipeline = {
    total: 3,
    Applied: 2, Screening: 1, Interview: 0, Offer: 0, Rejected: 0,
    tierBreakdown: { tier1: 1, tier2: 2, tier3: 0, tier4: 0 },
  };

  (async () => {
    try {
      const result = await sendReportEmail(sampleJobs, mockPipeline);
      console.log(`HTML saved: ${result.filePath}`);
      console.log(`Tier 1: ${result.tier1Count}, Tier 2: ${result.tier2Count}, Tier 3: ${sampleJobs.filter(j => j.tier === 3).length}`);
    } catch (err) {
      console.error('[ERROR] sendReportEmail failed:', err.message);
    }
  })();
}
