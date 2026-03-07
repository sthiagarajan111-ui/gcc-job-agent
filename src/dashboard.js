'use strict';

const express = require('express');
const path = require('path');
const fs = require('fs-extra');
const axios = require('axios');
const cheerio = require('cheerio');
const puppeteer = require('puppeteer');

const { addApplication, updateStatus, getPipelineSummary, loadApplications } = require('./appTracker');
const { generateSingleCoverLetter } = require('./coverLetter');
const { autoFillJobApplication } = require('./formFiller');
const { prioritizeAllJobs, prioritizeJob } = require('./jobPrioritizer');
const { loadContacts } = require('./contactFinder');
const { loadNetworkingPlans } = require('./networkingEngine');
const Anthropic = require('@anthropic-ai/sdk');

const prepCache = {};

let server = null;
let app = null;
let browserExtractionResult = null;
let allJobs = null;

// ═══════════════════════════════════════════════════════
// LOAD TODAY'S JOBS
// ═══════════════════════════════════════════════════════

function loadTodaysJobs() {
  const today = new Date().toISOString().split('T')[0];
  const filePath = path.join(__dirname, `../data/report-${today}.json`);
  if (!fs.existsSync(filePath)) return [];
  try {
    const raw = fs.readJsonSync(filePath);
    const jobs = Array.isArray(raw) ? raw : (raw.jobs || []);
    return prioritizeAllJobs(jobs);
  } catch (err) {
    console.error('[dashboard] Error loading jobs:', err.message);
    return [];
  }
}

// ═══════════════════════════════════════════════════════
// LOAD ALL JOBS (all historic reports)
// ═══════════════════════════════════════════════════════

function loadAllJobs() {
  if (allJobs !== null) return allJobs;

  const dataDir = path.join(__dirname, '../data');
  if (!fs.existsSync(dataDir)) { allJobs = []; return allJobs; }

  const files = fs.readdirSync(dataDir).filter(f => /^report-\d{4}-\d{2}-\d{2}\.json$/.test(f));
  if (files.length === 0) { allJobs = []; return allJobs; }

  const seen = new Set();
  let combined = [];

  for (const file of files) {
    try {
      const raw = fs.readJsonSync(path.join(dataDir, file));
      const jobs = Array.isArray(raw) ? raw : (raw.jobs || []);
      combined = combined.concat(jobs);
    } catch (err) {
      console.error(`[dashboard] Error loading ${file}:`, err.message);
    }
  }

  // Deduplicate: prefer explicit id, fall back to title+company+location key
  const deduped = [];
  for (const job of combined) {
    const key = job.id
      ? String(job.id)
      : `${(job.title || '').toLowerCase()}|${(job.company || '').toLowerCase()}|${(job.location || '').toLowerCase()}`;
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(job);
    }
  }

  // Assign id if missing, so routes can look up by stable id
  for (const job of deduped) {
    if (!job.id) {
      job.id = (job.title + '_' + job.company + '_' +
        (job.datePosted || '')).replace(/[^a-zA-Z0-9]/g, '_');
    }
  }

  // Prioritize then sort by totalScore descending
  const prioritized = prioritizeAllJobs(deduped);
  prioritized.sort((a, b) => (b.totalScore || 0) - (a.totalScore || 0));
  allJobs = prioritized;
  return allJobs;
}

function saveJobToTodaysReport(job) {
  const today = new Date().toISOString().split('T')[0];
  const filePath = path.join(__dirname, `../data/report-${today}.json`);
  fs.ensureDirSync(path.dirname(filePath));
  let existing = [];
  if (fs.existsSync(filePath)) {
    try {
      const raw = fs.readJsonSync(filePath);
      existing = Array.isArray(raw) ? raw : (raw.jobs || []);
    } catch (e) {}
  }
  existing.unshift(job);
  fs.writeJsonSync(filePath, existing, { spaces: 2 });
}

// ═══════════════════════════════════════════════════════
// HTML HELPERS
// ═══════════════════════════════════════════════════════

function getTierColor(tier) {
  if (tier === 1) return '#3FB950';
  if (tier === 2) return '#58A6FF';
  if (tier === 3) return '#D29922';
  return '#6E7681';
}

function getScoreColor(score) {
  if (score >= 90) return '#3FB950';
  if (score >= 70) return '#58A6FF';
  if (score >= 50) return '#D29922';
  return '#6E7681';
}

function getSalaryVerdict(job) {
  const score = job.salaryScore || 0;
  if (score >= 25) return { label: 'ABOVE TARGET', color: '#3FB950' };
  if (score >= 18) return { label: 'AT MINIMUM', color: '#D29922' };
  return { label: 'BELOW FLOOR', color: '#DA3633' };
}

// ═══════════════════════════════════════════════════════
// MAIN DASHBOARD HTML
// ═══════════════════════════════════════════════════════

function buildDashboardHtml(jobs, contactsData = [], networkingData = []) {
  const todayIso = new Date().toISOString().split('T')[0];
  const today = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  const tier1 = jobs.filter(j => j.tier === 1).length;
  const tier2 = jobs.filter(j => j.tier === 2).length;
  const fortune500 = jobs.filter(j => j.isFortuneCompany).length;
  const applications = loadApplications();
  const applied = applications.length;
  const todaysNew = jobs.filter(j => {
    const d = (j.postedDate || j.addedDate || '');
    return d.startsWith(todayIso);
  }).length;

  // Pre-compute contact/networking fields per job
  const HR_TITLE_KW = ['hiring manager', 'talent acquisition', 'recruiter', 'hr manager', 'hr director'];
  const FUNC_TITLE_KW = ['director', 'head of', 'vp', 'manager', 'lead', 'chief'];
  const HR_EXCLUDE_KW = ['hr', 'human resources', 'talent', 'recruitment', 'recruiter', 'hiring', 'people'];

  const enrichedJobs = jobs.map(job => {
    const companyLower = (job.company || '').toLowerCase();

    const contactRecord = contactsData.find(c => (c.company || '').toLowerCase() === companyLower);
    let hiringMgr = null;
    let funcMgr = null;
    if (contactRecord && Array.isArray(contactRecord.contacts)) {
      const hrContact = contactRecord.contacts.find(c => {
        const t = (c.title || '').toLowerCase();
        return c.name && HR_TITLE_KW.some(kw => t.includes(kw));
      });
      if (hrContact) hiringMgr = hrContact.name;

      const fmContact = contactRecord.contacts.find(c => {
        const t = (c.title || '').toLowerCase();
        const isHr = HR_EXCLUDE_KW.some(kw => t.includes(kw));
        return c.name && !isHr && FUNC_TITLE_KW.some(kw => t.includes(kw));
      });
      if (fmContact) funcMgr = fmContact.name;
    }

    const networkRecord = networkingData.find(n => (n.company || '').toLowerCase() === companyLower);
    const alumniCount = (networkRecord && networkRecord.alumniFound) ? networkRecord.alumniFound : 0;

    return { ...job, _hiringMgr: hiringMgr, _funcMgr: funcMgr, _alumniCount: alumniCount };
  });

  const jobsJson = JSON.stringify(enrichedJobs).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>GCC Job Agent Dashboard</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, sans-serif; background: #0D1117; color: #E6EDF3; color-scheme: dark; }

  /* NAVBAR */
  .navbar {
    background: #161B22;
    padding: 0 24px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: 56px;
    position: sticky;
    top: 0;
    z-index: 100;
    border-bottom: 1px solid #58A6FF;
  }
  .navbar-logo { color: white; font-weight: bold; font-size: 18px; letter-spacing: 1px; }
  .navbar-links { display: flex; gap: 8px; }
  .navbar-links a {
    color: white; text-decoration: none; padding: 6px 16px;
    border-radius: 4px; font-size: 14px;
    border: 1px solid transparent;
  }
  .navbar-links a:hover, .navbar-links a.active { background: #30363D; border: 1px solid #58A6FF; }
  .navbar-right { color: #8B949E; font-size: 13px; text-align: right; }
  .navbar-right strong { color: white; display: block; font-size: 14px; }

  /* STATS BAR */
  .stats-bar {
    background: #161B22;
    border-bottom: 1px solid #30363D;
    padding: 16px 24px;
    display: flex;
    gap: 16px;
    flex-wrap: wrap;
  }
  .stat-box {
    flex: 1;
    min-width: 100px;
    text-align: center;
    background: #1F2937;
    border-radius: 8px;
    padding: 12px 16px;
    border: 1px solid #30363D;
    transition: border-color 0.15s;
  }
  .stat-box:hover { border-color: #58A6FF; }
  .stat-number { font-size: 28px; font-weight: bold; color: #58A6FF; }
  .stat-label { font-size: 12px; color: #8B949E; margin-top: 4px; }

  /* FILTER BAR */
  .filter-bar {
    background: #161B22;
    border-top: 1px solid #30363D;
    border-bottom: 2px solid #30363D;
    padding: 12px 24px;
    display: flex;
    gap: 10px;
    flex-wrap: wrap;
    align-items: center;
  }
  .filter-bar select, .filter-bar input {
    border: 1px solid #484F58;
    border-radius: 4px;
    padding: 7px 10px;
    font-size: 13px;
    color: #E6EDF3;
    background: #1F2937;
  }
  .filter-bar select:focus, .filter-bar input:focus {
    outline: none;
    border: 2px solid #58A6FF;
  }
  .btn-fortune {
    background: #30363D; color: white; border: 1px solid #F5A623;
    border-radius: 4px; padding: 7px 14px; cursor: pointer; font-size: 13px;
  }
  .btn-fortune.active { background: #F5A623; }
  .btn-reset {
    background: #30363D; color: white; border: 1px solid #484F58;
    border-radius: 4px; padding: 7px 14px; cursor: pointer; font-size: 13px;
  }

  /* JOB GRID */
  .jobs-container { padding: 20px 24px; }
  .jobs-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 16px;
  }
  @media (max-width: 900px) {
    .jobs-grid { grid-template-columns: 1fr; }
  }

  /* JOB CARD */
  .job-card {
    background: #1F2937;
    border-radius: 8px;
    border: 1px solid #484F58;
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    position: relative;
    box-shadow: 0 2px 8px rgba(0,0,0,0.4);
    transition: border-color 0.15s;
  }
  .job-card:hover { border-color: #58A6FF; }
  .card-top { display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; }
  .card-title-section { flex: 1; }
  .card-title { font-weight: bold; color: #E6EDF3; font-size: 15px; margin-bottom: 3px; }
  .card-company { color: #58A6FF; font-size: 13px; margin-bottom: 4px; }
  .card-meta { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  .card-location { font-size: 12px; color: #8B949E; }
  .tier-badge {
    font-size: 11px; font-weight: bold; color: white;
    padding: 2px 8px; border-radius: 12px;
  }
  .fortune-badge {
    font-size: 11px; font-weight: bold; color: #1B2A4A;
    background: #F5A623; padding: 2px 8px; border-radius: 12px;
  }
  .score-circle {
    width: 48px; height: 48px; border-radius: 50%;
    display: flex; align-items: center; justify-content: center;
    font-weight: bold; font-size: 14px; color: white;
    flex-shrink: 0;
  }

  /* SCORE BARS */
  .score-breakdown { display: flex; gap: 8px; flex-wrap: wrap; border-top: 1px solid #30363D; border-bottom: 1px solid #30363D; padding-top: 8px; padding-bottom: 8px; }
  .score-item { flex: 1; min-width: 70px; }
  .score-item-label { font-size: 11px; color: #8B949E; margin-bottom: 3px; }
  .score-item-value { font-size: 12px; font-weight: bold; color: #E6EDF3; margin-bottom: 3px; }
  .score-bar-bg { background: #30363D; border-radius: 3px; height: 5px; }
  .score-bar-fill { height: 5px; border-radius: 3px; background: #58A6FF; }

  /* SALARY ROW */
  .salary-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .salary-text { font-size: 13px; }
  .salary-amount { color: #3FB950; font-weight: bold; }
  .salary-estimate { color: #8B949E; }
  .verdict-badge {
    font-size: 11px; font-weight: bold; color: white;
    padding: 2px 8px; border-radius: 4px;
  }

  /* BUTTON ROW */
  .btn-row { display: flex; gap: 8px; flex-wrap: wrap; border-top: 1px solid #30363D; padding-top: 10px; }
  .btn {
    font-size: 12px; font-weight: bold; padding: 6px 12px;
    border: none; border-radius: 4px; cursor: pointer;
    text-decoration: none; display: inline-block;
  }
  .btn-view { background: #238636; color: white; }
  .btn-apply { background: #1F6FEB; color: white; }
  .btn-apply.applied { background: #30363D; cursor: default; }
  .btn-cover { background: #8957E5; color: white; }
  .btn-autofill { background: #D29922; color: #0D1117; }

  /* PAGINATION */
  .pagination {
    padding: 20px 24px;
    display: flex;
    gap: 12px;
    align-items: center;
    border-top: 2px solid #30363D;
    padding-top: 16px;
  }
  .pagination button {
    background: #30363D; color: white; border: none;
    border-radius: 4px; padding: 8px 18px; cursor: pointer; font-size: 13px;
  }
  .pagination button:disabled { background: #1F2937; color: #6E7681; cursor: default; }
  .pagination span { font-size: 13px; color: #8B949E; }

  /* NO JOBS */
  .no-jobs {
    text-align: center; padding: 60px 24px; color: #8B949E;
  }
  .no-jobs h2 { font-size: 24px; margin-bottom: 8px; }

  /* SPINNER */
  .spinner {
    display: inline-block; width: 12px; height: 12px;
    border: 2px solid #fff; border-top-color: transparent;
    border-radius: 50%; animation: spin 0.6s linear infinite;
    margin-right: 4px; vertical-align: middle;
  }
  @keyframes spin { to { transform: rotate(360deg); } }

  /* SECTION HEADERS */
  .section-header { border-left: 4px solid #58A6FF; border-bottom: 1px solid #30363D; padding-left: 12px; }

  /* SCROLLBAR */
  ::-webkit-scrollbar { width: 8px; height: 8px; }
  ::-webkit-scrollbar-track { background: #0D1117; }
  ::-webkit-scrollbar-thumb { background: #30363D; border-radius: 4px; }
  ::-webkit-scrollbar-thumb:hover { background: #58A6FF; }

  /* ADD JOB MODAL */
  .modal-overlay { display:none;position:fixed;inset:0;background:rgba(0,0,0,0.75);z-index:2000;align-items:center;justify-content:center; }
  .modal-overlay.open { display:flex; }
  .modal-box { background:#161B22;border:1px solid #30363D;border-radius:10px;padding:28px;width:520px;max-width:95vw;max-height:90vh;overflow-y:auto; }
  .modal-title { font-size:16px;font-weight:bold;color:#E6EDF3;margin-bottom:16px;display:flex;justify-content:space-between;align-items:center; }
  .modal-close { background:none;border:none;color:#8B949E;font-size:20px;cursor:pointer;line-height:1; }
  .modal-close:hover { color:#E6EDF3; }
  .modal-input { width:100%;background:#0D1117;border:1px solid #30363D;border-radius:6px;color:#E6EDF3;padding:9px 12px;font-size:13px;box-sizing:border-box;margin-bottom:10px; }
  .modal-input:focus { outline:none;border-color:#58A6FF; }
  .modal-btn { background:#238636;border:none;color:white;padding:9px 18px;border-radius:6px;font-size:13px;cursor:pointer;font-weight:bold; }
  .modal-btn:hover { background:#2ea043; }
  .modal-btn-sec { background:#21262D;border:1px solid #30363D;color:#E6EDF3;padding:8px 16px;border-radius:6px;font-size:13px;cursor:pointer; }
  .modal-btn-sec:hover { background:#30363D; }
  .modal-progress { font-size:12px;color:#8B949E;margin:10px 0;padding:10px;background:#0D1117;border-radius:6px;border:1px solid #21262D; }
  .modal-browser-msg { background:#1B2A4A;border:1px solid #284776;border-radius:6px;padding:14px;margin:12px 0;font-size:13px;color:#E6EDF3; }
  .modal-field-row { display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px; }
  .modal-field-label { font-size:11px;color:#8B949E;margin-bottom:4px; }
  .modal-success-card { background:#0D1117;border:1px solid #3FB950;border-radius:8px;padding:14px;margin-top:12px; }
  .modal-success-card .sc-title { font-weight:bold;color:#E6EDF3;font-size:14px; }
  .modal-success-card .sc-company { color:#58A6FF;font-size:12px; }
  .modal-success-card .sc-meta { display:flex;gap:10px;font-size:11px;color:#8B949E;margin-top:6px;flex-wrap:wrap; }
  .modal-success-card .sc-score { font-size:22px;font-weight:bold;color:#3FB950; }
  .btn-add-job { background:#238636;border:none;color:white;padding:6px 14px;border-radius:6px;font-size:12px;font-weight:bold;cursor:pointer;white-space:nowrap; }
  .btn-add-job:hover { background:#2ea043; }

  /* INTERVIEW PREP PANEL */
  .prep-panel {
    background: #0D1117; border: 1px solid #8957E5; border-top: none;
    border-radius: 0 0 8px 8px; margin-top: -4px; overflow: hidden;
    max-height: 0; padding: 0 20px;
    transition: max-height 0.4s ease, padding 0.3s ease;
  }
  .prep-panel.open { max-height: 2400px; padding: 20px; }
  .prep-tabs { display: flex; gap: 4px; flex-wrap: wrap; margin-bottom: 16px; border-bottom: 1px solid #30363D; padding-bottom: 8px; }
  .prep-tab {
    background: #1F2937; color: #8B949E; border: none;
    border-radius: 6px 6px 0 0; padding: 8px 14px;
    font-size: 12px; cursor: pointer; font-weight: bold;
  }
  .prep-tab.active { background: #8957E5; color: white; }
  .prep-tab-pane { display: none; }
  .prep-tab-pane.active { display: block; }
  .prep-loading-dots span { animation: blink 1.4s infinite both; font-size: 18px; }
  .prep-loading-dots span:nth-child(2) { animation-delay: 0.2s; }
  .prep-loading-dots span:nth-child(3) { animation-delay: 0.4s; }
  @keyframes blink { 0%,80%,100%{ opacity:0; } 40%{ opacity:1; } }
  .prep-section { margin-bottom: 16px; }
  .prep-section-title { font-size: 11px; font-weight: bold; color: #8B949E; letter-spacing: 1px; text-transform: uppercase; margin-bottom: 8px; }
  .prep-pill { display: inline-block; background: #1F2937; border: 1px solid #30363D; border-radius: 12px; padding: 3px 10px; font-size: 12px; margin: 2px; color: #E6EDF3; }
  .prep-pill-green { background: rgba(63,185,80,0.15); border-color: #3FB950; color: #3FB950; }
  .prep-pill-blue { background: rgba(88,166,255,0.15); border-color: #58A6FF; color: #58A6FF; }
  .prep-pill-purple { background: rgba(137,87,229,0.15); border-color: #8957E5; color: #8957E5; }
  .prep-question-card {
    background: #1F2937; border-radius: 6px; padding: 10px 12px;
    margin-bottom: 6px; font-size: 13px; color: #E6EDF3;
    display: flex; justify-content: space-between; align-items: flex-start; gap: 8px;
  }
  .prep-q-behavioural { border-left: 3px solid #D29922; }
  .prep-q-technical { border-left: 3px solid #58A6FF; }
  .prep-q-situational { border-left: 3px solid #3FB950; }
  .prep-q-company { border-left: 3px solid #8957E5; }
  .prep-copy-btn { background: #30363D; border: none; color: #8B949E; border-radius: 4px; padding: 3px 8px; font-size: 11px; cursor: pointer; white-space: nowrap; flex-shrink: 0; }
  .prep-copy-btn:hover { color: white; }
  .star-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .star-cell { background: #161B22; border-radius: 6px; padding: 8px 10px; }
  .star-cell-label { font-size: 10px; font-weight: bold; color: #8957E5; text-transform: uppercase; margin-bottom: 4px; }
  .star-cell-text { font-size: 12px; color: #E6EDF3; }
  .prep-checklist-item { display: flex; align-items: flex-start; gap: 10px; padding: 8px 0; border-bottom: 1px solid #1F2937; font-size: 13px; }
  .prep-checklist-item input[type=checkbox] { margin-top: 2px; cursor: pointer; accent-color: #8957E5; width: 16px; height: 16px; flex-shrink: 0; }
  .prep-checklist-item.checked label { text-decoration: line-through; color: #6E7681; }
</style>
</head>
<body>

<nav class="navbar">
  <div class="navbar-logo">GCC JOB AGENT</div>
  <div class="navbar-links">
    <a href="/" class="active">Jobs</a>
    <a href="/tracker">Tracker</a>
  </div>
  <div class="navbar-right">
    <strong>Dheeraj Thiagarajan</strong>
    ${today}
  </div>
</nav>

<div class="stats-bar">
  <div class="stat-box">
    <div class="stat-number" id="stat-total">${jobs.length}</div>
    <div class="stat-label">Total Jobs (All Time)</div>
  </div>
  <div class="stat-box">
    <div class="stat-number" id="stat-today" style="color:#00D4FF">${todaysNew}</div>
    <div class="stat-label">Today's New Jobs</div>
  </div>
  <div class="stat-box">
    <div class="stat-number" style="color:#3FB950">${tier1}</div>
    <div class="stat-label">Tier 1</div>
  </div>
  <div class="stat-box">
    <div class="stat-number" style="color:#58A6FF">${tier2}</div>
    <div class="stat-label">Tier 2</div>
  </div>
  <div class="stat-box">
    <div class="stat-number" style="color:#F5A623">${fortune500}</div>
    <div class="stat-label">Fortune 500</div>
  </div>
  <div class="stat-box">
    <div class="stat-number" style="color:#D29922">${applied}</div>
    <div class="stat-label">Applied</div>
  </div>
</div>

<div class="filter-bar">
  <select id="filter-tier" onchange="onTierChange()">
    <option value="">All Tiers</option>
    <option value="1">Tier 1 Only</option>
    <option value="2">Tier 2 Only</option>
    <option value="3">Tier 3 Only</option>
    <option value="4">Tier 4 Only</option>
  </select>
  <div style="display:inline-block;vertical-align:top">
    <select id="filter-company" onchange="applyFilters()">
      <option value="All Companies">All Companies</option>
    </select>
    <div style="font-size:10px;color:#6E7681;font-style:italic;margin-top:2px">Updates with Tier filter</div>
  </div>
  <select id="filter-source" onchange="applyFilters()">
    <option value="All Sources">All Sources</option>
  </select>
  <select id="filter-location" onchange="applyFilters()">
    <option value="">All Locations</option>
    <option value="Dubai">Dubai</option>
    <option value="Abu Dhabi">Abu Dhabi</option>
    <option value="Qatar">Qatar</option>
    <option value="Saudi Arabia">Saudi Arabia</option>
    <option value="Kuwait">Kuwait</option>
    <option value="Bahrain">Bahrain</option>
    <option value="Oman">Oman</option>
  </select>
  <select id="filter-role" onchange="applyFilters()">
    <option value="">All Roles</option>
    <option value="Business Development">Business Development</option>
    <option value="Sales">Sales</option>
    <option value="Strategy">Strategy</option>
    <option value="Finance">Finance</option>
    <option value="Business Analyst">Business Analyst</option>
  </select>
  <button class="btn-fortune" id="btn-fortune" onclick="toggleFortune()">Show Fortune 500 Only</button>
  <select id="filter-sort" onchange="applyFilters()">
    <option value="high">Highest Score</option>
    <option value="low">Lowest Score</option>
    <option value="newest">Newest First</option>
  </select>
  <input type="text" id="filter-search" placeholder="Search company or title..." oninput="applyFilters()" style="min-width:180px">
  <button class="btn-reset" onclick="resetFilters()">Reset Filters</button>
  <button class="btn-add-job" onclick="openAddJobModal()">➕ Add Job from URL</button>
</div>

<div class="jobs-container" id="jobs-container">
  ${jobs.length === 0 ? `
    <div class="no-jobs" id="no-jobs-msg">
      <h2>No jobs found</h2>
      <p>Run the agent first to generate today's job report.</p>
    </div>
  ` : ''}
  <div class="jobs-grid" id="jobs-grid"></div>
</div>

<div class="pagination" id="pagination" style="display:none">
  <button id="btn-prev" onclick="prevPage()" disabled>&#8592; Previous</button>
  <span id="pagination-info"></span>
  <button id="btn-next" onclick="nextPage()">Next &#8594;</button>
</div>

<script>
const ALL_JOBS = ${jobsJson};
const PAGE_SIZE = 20;
let currentPage = 1;
let filteredJobs = [...ALL_JOBS];
let fortuneActive = false;
const appliedSet = new Set();

function getTierColor(tier) {
  if (tier === 1) return '#3FB950';
  if (tier === 2) return '#58A6FF';
  if (tier === 3) return '#D29922';
  return '#6E7681';
}
function getScoreColor(score) {
  if (score >= 90) return '#3FB950';
  if (score >= 70) return '#58A6FF';
  if (score >= 50) return '#D29922';
  return '#6E7681';
}
function getSalaryVerdict(job) {
  const score = job.salaryScore || 0;
  if (score >= 25) return { label: 'ABOVE TARGET', color: '#3FB950' };
  if (score >= 18) return { label: 'AT MINIMUM', color: '#D29922' };
  return { label: 'BELOW FLOOR', color: '#DA3633' };
}
function formatDate(dateStr) {
  if (!dateStr) return 'Unknown';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return String(dateStr);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dd = new Date(d);
  dd.setHours(0, 0, 0, 0);
  const diff = Math.round((today - dd) / (1000 * 60 * 60 * 24));
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  if (diff > 1) return diff + ' days ago';
  return String(dateStr);
}
function getJobId(job) {
  if (job.id) return job.id;
  if (job._id) return String(job._id);
  return ((job.title || '') + '_' + (job.company || '') + '_' +
    (job.datePosted || '')).replace(/[^a-zA-Z0-9]/g, '_');
}

function updateCompanyDropdown(jobs, selectedTier) {
  let tierJobs = jobs
  if (selectedTier === '1') tierJobs = jobs.filter(j => j.tier === 1)
  else if (selectedTier === '2') tierJobs = jobs.filter(j => j.tier === 2)
  else if (selectedTier === '3') tierJobs = jobs.filter(j => j.tier === 3)
  else if (selectedTier === '4') tierJobs = jobs.filter(j => j.tier === 4)

  const companies = ['All Companies',
    ...new Set(tierJobs.map(j => j.company)
    .filter(Boolean).sort())]

  const companySelect = document.getElementById('filter-company')
  companySelect.innerHTML = companies.map(c =>
    \`<option value="\${c}">\${c}</option>\`).join('')

  companySelect.value = 'All Companies'
}

function updateSourceDropdown(jobs, selectedTier) {
  let tierJobs = jobs
  if (selectedTier === '1') tierJobs = jobs.filter(j => j.tier === 1)
  else if (selectedTier === '2') tierJobs = jobs.filter(j => j.tier === 2)
  else if (selectedTier === '3') tierJobs = jobs.filter(j => j.tier === 3)
  else if (selectedTier === '4') tierJobs = jobs.filter(j => j.tier === 4)

  const sources = ['All Sources',
    ...new Set(tierJobs.map(j =>
      j.source || j.platform || j.board || j.origin || j.website || 'Unknown')
    .filter(Boolean).sort())]

  const sourceSelect = document.getElementById('filter-source')
  sourceSelect.innerHTML = sources.map(s =>
    \`<option value="\${s}">\${s}</option>\`).join('')

  sourceSelect.value = 'All Sources'
}

function onTierChange() {
  const tier = document.getElementById('filter-tier').value
  updateCompanyDropdown(ALL_JOBS, tier)
  updateSourceDropdown(ALL_JOBS, tier)
  applyFilters()
}

function applyFilters() {
  const tier = document.getElementById('filter-tier').value;
  const company = document.getElementById('filter-company').value;
  const source = document.getElementById('filter-source').value;
  const location = document.getElementById('filter-location').value;
  const role = document.getElementById('filter-role').value;
  const sort = document.getElementById('filter-sort').value;
  const search = document.getElementById('filter-search').value.toLowerCase();

  filteredJobs = ALL_JOBS.filter(job => {
    if (tier && String(job.tier) !== tier) return false;
    if (company && company !== 'All Companies' && (job.company || '') !== company) return false;
    if (source && source !== 'All Sources' && (job.source || job.platform || job.board || job.origin || job.website || 'Unknown') !== source) return false;
    if (location && !(job.location || '').includes(location)) return false;
    if (role && !(job.title || '').toLowerCase().includes(role.toLowerCase())) return false;
    if (fortuneActive && !job.isFortuneCompany) return false;
    if (search && !(job.company || '').toLowerCase().includes(search) && !(job.title || '').toLowerCase().includes(search)) return false;
    return true;
  });

  if (sort === 'high') filteredJobs.sort((a, b) => (b.totalScore || 0) - (a.totalScore || 0));
  else if (sort === 'low') filteredJobs.sort((a, b) => (a.totalScore || 0) - (b.totalScore || 0));
  else if (sort === 'newest') filteredJobs.sort((a, b) => (b.postedDate || '').localeCompare(a.postedDate || ''));

  document.getElementById('stat-total').textContent = filteredJobs.length;
  currentPage = 1;
  renderPage();
}

function toggleFortune() {
  fortuneActive = !fortuneActive;
  const btn = document.getElementById('btn-fortune');
  btn.classList.toggle('active', fortuneActive);
  applyFilters();
}

function resetFilters() {
  document.getElementById('filter-tier').value = '';
  updateCompanyDropdown(ALL_JOBS, '');
  updateSourceDropdown(ALL_JOBS, '');
  document.getElementById('filter-location').value = '';
  document.getElementById('filter-role').value = '';
  document.getElementById('filter-sort').value = 'high';
  document.getElementById('filter-search').value = '';
  fortuneActive = false;
  document.getElementById('btn-fortune').classList.remove('active');
  applyFilters();
}

function renderPage() {
  const grid = document.getElementById('jobs-grid');
  if (!grid) return;
  const start = (currentPage - 1) * PAGE_SIZE;
  const end = start + PAGE_SIZE;
  const pageJobs = filteredJobs.slice(start, end);

  grid.innerHTML = pageJobs.map((job, idx) => buildCard(job, start + idx)).join('');

  const pagination = document.getElementById('pagination');
  if (filteredJobs.length > PAGE_SIZE) {
    pagination.style.display = 'flex';
    document.getElementById('btn-prev').disabled = currentPage === 1;
    document.getElementById('btn-next').disabled = end >= filteredJobs.length;
    document.getElementById('pagination-info').textContent =
      'Showing ' + (start + 1) + '-' + Math.min(end, filteredJobs.length) + ' of ' + filteredJobs.length + ' jobs';
  } else {
    pagination.style.display = 'none';
  }
}

function buildCard(job, idx) {
  const jobId = getJobId(job);
  const tierColor = getTierColor(job.tier);
  const scoreColor = getScoreColor(job.totalScore || 0);
  const verdict = getSalaryVerdict(job);
  const isApplied = appliedSet.has(jobId);

  const scoreBreakdown = [
    { label: 'Location', score: job.locationScore || 0 },
    { label: 'Company', score: job.companyScore || 0 },
    { label: 'Salary', score: job.salaryScore || 0 },
    { label: 'Match', score: job.matchScore || 0 },
  ];

  const salary = job.salary
    ? '<span class="salary-amount">' + escapeHtml(job.salary) + '</span>'
    : '<span class="salary-estimate">Estimated range not listed</span>';

  // Info row fields
  const _source = escapeHtml(job.source || job.platform || job.board || job.origin || job.website || 'Unknown');
  const _datePosted = escapeHtml(formatDate(job.datePosted || job.date || job.postedAt || job.postedDate || ''));
  const _salaryHtml = (() => {
    if (job.salary || job.salaryText) return '<span style="color:#3FB950">' + escapeHtml(job.salary || job.salaryText) + '</span>';
    if (job.salaryEstimate) return '<span style="color:#8B949E;font-style:italic">Est. ' + escapeHtml(job.salaryEstimate) + '</span>';
    return '<span style="color:#6E7681">Not disclosed</span>';
  })();
  const _hiringMgrHtml = job._hiringMgr
    ? '<span style="color:#58A6FF">' + escapeHtml(job._hiringMgr) + '</span>'
    : '<span style="color:#6E7681">Not found</span>';
  const _funcMgrHtml = job._funcMgr
    ? '<span style="color:#58A6FF">' + escapeHtml(job._funcMgr) + '</span>'
    : '<span style="color:#6E7681">Not found</span>';
  const _alumniCount = job._alumniCount || 0;
  const _alumniBadgeColor = _alumniCount >= 3 ? '#3FB950' : _alumniCount >= 1 ? '#D29922' : '#6E7681';
  const _alumniText = _alumniCount > 0 ? _alumniCount + ' found' : 'Not available';
  const _alumniBadge = '<span style="display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;border-radius:50%;background:' + _alumniBadgeColor + ';font-size:10px;font-weight:bold;color:white;margin-right:2px">' + _alumniCount + '</span>';

  return \`
    <div style="display:flex;flex-direction:column">
    <div class="job-card" id="card-\${escapeHtml(jobId)}" style="border-left: 4px solid \${tierColor}">
      <div class="card-top">
        <div class="card-title-section">
          <div class="card-title">\${escapeHtml(job.title || '')}</div>
          <div class="card-company">\${escapeHtml(job.company || '')}</div>
          <div class="card-meta">
            <span class="card-location">\${escapeHtml(job.location || '')}</span>
            <span class="tier-badge" style="background:\${tierColor}">TIER \${job.tier}</span>
            \${job.isFortuneCompany ? '<span class="fortune-badge">Fortune 500</span>' : ''}
          </div>
        </div>
        <div class="score-circle" style="background:\${scoreColor}">\${job.totalScore || 0}</div>
      </div>

      <div style="background:#161B22;border-radius:6px;padding:8px 12px;border:1px solid #30363D;font-size:11px">
        <div style="display:flex;gap:16px;flex-wrap:wrap;align-items:center;margin-bottom:4px">
          <span><span style="color:#8B949E">🌐 Source: </span><span style="color:#E6EDF3">\${_source}</span></span>
          <span><span style="color:#8B949E">📅 Posted: </span><span style="color:#E6EDF3">\${_datePosted}</span></span>
          <span><span style="color:#8B949E">💰 Salary: </span>\${_salaryHtml}</span>
        </div>
        <div style="display:flex;gap:16px;flex-wrap:wrap;align-items:center">
          <span><span style="color:#8B949E">👤 Hiring Mgr: </span>\${_hiringMgrHtml}</span>
          <span><span style="color:#8B949E">👔 Func. Mgr: </span>\${_funcMgrHtml}</span>
          <span><span style="color:#8B949E">🎓 Alumni: </span>\${_alumniBadge}<span style="color:\${_alumniBadgeColor}">\${_alumniText}</span></span>
        </div>
      </div>

      <div class="score-breakdown">
        \${scoreBreakdown.map(s => \`
          <div class="score-item">
            <div class="score-item-label">\${s.label}</div>
            <div class="score-item-value">\${s.score}/25</div>
            <div class="score-bar-bg">
              <div class="score-bar-fill" style="width:\${(s.score/25*100)}%"></div>
            </div>
          </div>
        \`).join('')}
      </div>

      <div class="salary-row">
        <div class="salary-text">\${salary}</div>
        <span class="verdict-badge" style="background:\${verdict.color}">\${verdict.label}</span>
      </div>

      <div class="btn-row">
        <a href="\${escapeHtml(job.applyUrl || '#')}" target="_blank" class="btn btn-view">VIEW JOB</a>
        <button class="btn btn-apply \${isApplied ? 'applied' : ''}"
          id="btn-apply-\${escapeHtml(jobId)}"
          onclick="handleApply(this, \${JSON.stringify(job).replace(/"/g, '&quot;')})"
          \${isApplied ? 'disabled' : ''}>
          \${isApplied ? '✅ Applied' : 'APPLY & TRACK'}
        </button>
        <button class="btn btn-cover" id="btn-cover-\${escapeHtml(jobId)}"
          onclick="handleCoverLetter(this, '\${escapeHtml(jobId)}', \${JSON.stringify(job).replace(/"/g, '&quot;')})">
          COVER LETTER
        </button>
        <button class="btn btn-autofill"
          onclick="handleAutofill(this, \${JSON.stringify(job).replace(/"/g, '&quot;')})">
          AUTO-FILL
        </button>
        <button class="btn" id="btn-prep-\${escapeHtml(jobId)}"
          style="background:#8957E5;color:white;border-radius:6px;padding:6px 12px;font-size:12px;font-weight:bold;"
          onclick="handleInterviewPrep(this, '\${escapeHtml(jobId)}', \${JSON.stringify(job).replace(/"/g, '&quot;')})">
          INTERVIEW PREP
        </button>
      </div>
    </div>
    <div class="prep-panel" id="prep-panel-\${escapeHtml(jobId)}">
      <div id="prep-loading-\${escapeHtml(jobId)}" style="display:none;text-align:center;padding:20px">
        <div style="font-size:14px;color:#8957E5;font-weight:bold;margin-bottom:8px">🤖 Claude AI is preparing your interview brief...</div>
        <div style="font-size:12px;color:#8B949E;margin-bottom:12px">Analysing <strong style="color:#E6EDF3">\${escapeHtml(job.company || '')}</strong> and the <strong style="color:#E6EDF3">\${escapeHtml(job.title || '')}</strong> role...</div>
        <div class="prep-loading-dots" style="color:#8957E5"><span>●</span><span> ●</span><span> ●</span></div>
      </div>
      <div id="prep-content-\${escapeHtml(jobId)}" style="display:none"></div>
    </div>
    </div>
  \`;
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function prevPage() { if (currentPage > 1) { currentPage--; renderPage(); } }
function nextPage() { if ((currentPage * PAGE_SIZE) < filteredJobs.length) { currentPage++; renderPage(); } }

async function handleApply(btn, job) {
  btn.disabled = true;
  btn.textContent = 'Adding...';
  try {
    const res = await fetch('/api/add-application', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(job),
    });
    const data = await res.json();
    if (data.success) {
      btn.textContent = '✅ Applied';
      btn.classList.add('applied');
      const jobId = getJobId(job);
      appliedSet.add(jobId);
    } else {
      btn.textContent = 'Error';
      btn.disabled = false;
    }
  } catch (e) {
    btn.textContent = 'Error';
    btn.disabled = false;
  }
}

async function handleCoverLetter(btn, jobId, job) {
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>Generating...';
  try {
    const res = await fetch('/api/generate-cover-letter/' + encodeURIComponent(jobId), {
      method: 'GET',
      headers: { 'x-job-data': JSON.stringify(job) },
    });
    const data = await res.json();
    if (data.success && data.filePath) {
      const fileName = data.filePath.split(/[\\\\/]/).pop();
      btn.innerHTML = '<a href="/cover-letter/' + encodeURIComponent(fileName) + '" target="_blank" style="color:white;text-decoration:none">DOWNLOAD</a>';
      btn.disabled = false;
    } else {
      btn.textContent = data.message || 'Error';
      btn.disabled = false;
    }
  } catch (e) {
    btn.textContent = 'Error';
    btn.disabled = false;
  }
}

async function handleAutofill(btn, job) {
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>Opening...';
  try {
    const res = await fetch('/api/autofill/' + encodeURIComponent(getJobId(job)));
    const data = await res.json();
    btn.textContent = data.success ? 'Opened!' : 'Error';
    setTimeout(() => { btn.textContent = 'AUTO-FILL'; btn.disabled = false; }, 3000);
  } catch (e) {
    btn.textContent = 'Error';
    btn.disabled = false;
  }
}

// ── INTERVIEW PREP ─────────────────────────────────────
const _prepState = {};

async function handleInterviewPrep(btn, jobId, job) {
  const panel = document.getElementById('prep-panel-' + jobId);
  if (!panel) return;
  if (_prepState[jobId] === 'loaded') {
    if (panel.classList.contains('open')) {
      panel.classList.remove('open');
      btn.textContent = 'INTERVIEW PREP';
    } else {
      panel.classList.add('open');
      btn.innerHTML = '📚 INTERVIEW PREP ▲';
    }
    return;
  }
  if (_prepState[jobId] === 'loading') return;
  _prepState[jobId] = 'loading';
  btn.innerHTML = '<span class="spinner"></span>Preparing...';
  btn.disabled = true;
  const loading = document.getElementById('prep-loading-' + jobId);
  const content = document.getElementById('prep-content-' + jobId);
  if (loading) loading.style.display = 'block';
  if (content) content.style.display = 'none';
  panel.classList.add('open');
  try {
    const res = await fetch('/api/interview-prep/' + encodeURIComponent(jobId));
    const data = await res.json();
    if (data.success && data.prep) {
      _prepState[jobId] = 'loaded';
      if (loading) loading.style.display = 'none';
      if (content) { content.innerHTML = buildPrepHtml(jobId, data.prep, job); content.style.display = 'block'; }
      btn.innerHTML = '📚 INTERVIEW PREP ▲';
      btn.disabled = false;
      loadChecklistState(jobId, (data.prep.preparationChecklist || []));
    } else if (data.message === 'no_credits') {
      _prepState[jobId] = 'error';
      if (loading) loading.style.display = 'none';
      if (content) { content.innerHTML = buildNoCreditsFallback(job); content.style.display = 'block'; }
      btn.innerHTML = '📚 INTERVIEW PREP ▲';
      btn.disabled = false;
    } else {
      _prepState[jobId] = 'error';
      if (loading) loading.style.display = 'none';
      if (content) { content.innerHTML = '<div style="color:#DA3633;padding:12px">Error: ' + escapeHtml(data.message || 'Failed') + '</div>'; content.style.display = 'block'; }
      btn.textContent = 'INTERVIEW PREP';
      btn.disabled = false;
    }
  } catch (e) {
    _prepState[jobId] = 'error';
    if (loading) loading.style.display = 'none';
    if (content) content.style.display = 'none';
    panel.classList.remove('open');
    btn.textContent = 'INTERVIEW PREP';
    btn.disabled = false;
  }
}

function buildNoCreditsFallback(job) {
  const company = escapeHtml((job && job.company) ? job.company : 'the company');
  return '<div style="padding:12px;background:#1F2937;border-radius:6px;border:1px solid #D29922">' +
    '<div style="color:#D29922;font-weight:bold;margin-bottom:8px">⚠️ Interview prep requires Anthropic API credits.</div>' +
    '<div style="color:#8B949E;font-size:12px;margin-bottom:12px">Add credits at <strong style="color:#E6EDF3">console.anthropic.com</strong> then try again.</div>' +
    '<div style="font-size:12px;font-weight:bold;color:#8B949E;margin-bottom:6px">BASIC PREP CHECKLIST:</div>' +
    '<div style="display:flex;flex-direction:column;gap:6px;font-size:13px;color:#E6EDF3">' +
    '<div>✅ Research ' + company + ' on LinkedIn and website</div>' +
    '<div>✅ Review the job description thoroughly</div>' +
    '<div>✅ Prepare 3 STAR examples from your experience</div>' +
    '<div>✅ Research GCC market for this industry</div>' +
    '<div>✅ Prepare 5 questions to ask the interviewer</div>' +
    '<div>✅ Review your CV and be ready to discuss each role</div>' +
    '</div></div>';
}

function buildPrepHtml(jobId, prep, job) {
  const co = prep.companyOverview || {};
  const ind = prep.industryInsights || {};
  const role = prep.roleInsights || {};
  const qs = prep.likelyInterviewQuestions || {};
  const ans = prep.suggestedAnswerPointers || {};
  const companyName = escapeHtml((job && job.company) ? job.company : 'Company');

  let html = '<div class="prep-tabs">' +
    '<button class="prep-tab active" id="tab-btn-' + jobId + '-company" onclick="switchPrepTab(\\'' + jobId + '\\',\\'company\\')">🏢 Company</button>' +
    '<button class="prep-tab" id="tab-btn-' + jobId + '-industry" onclick="switchPrepTab(\\'' + jobId + '\\',\\'industry\\')">📊 Industry</button>' +
    '<button class="prep-tab" id="tab-btn-' + jobId + '-role" onclick="switchPrepTab(\\'' + jobId + '\\',\\'role\\')">🎯 Role</button>' +
    '<button class="prep-tab" id="tab-btn-' + jobId + '-questions" onclick="switchPrepTab(\\'' + jobId + '\\',\\'questions\\')">❓ Questions</button>' +
    '<button class="prep-tab" id="tab-btn-' + jobId + '-answers" onclick="switchPrepTab(\\'' + jobId + '\\',\\'answers\\')">💡 Your Answers</button>' +
    '<button class="prep-tab" id="tab-btn-' + jobId + '-checklist" onclick="switchPrepTab(\\'' + jobId + '\\',\\'checklist\\')">✅ Checklist</button>' +
    '</div>';

  // Tab 1 — Company
  const culturePills = (co.culture || '').split(/[,;]/).map(function(k){ return k.trim(); }).filter(Boolean)
    .map(function(k){ return '<span class="prep-pill">' + escapeHtml(k) + '</span>'; }).join('');
  html += '<div class="prep-tab-pane active" id="tab-' + jobId + '-company">' +
    '<div class="prep-section">' +
    '<div class="prep-section-title">About ' + companyName + '</div>' +
    '<div style="font-size:14px;color:#E6EDF3;margin-bottom:8px">' + escapeHtml(co.whatTheyDo || '') + '</div>' +
    '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:6px"><span class="prep-pill prep-pill-blue">' + escapeHtml(co.size || '') + '</span>' + culturePills + '</div></div>' +
    '<div class="prep-section"><div class="prep-section-title">Why You Fit</div>' +
    '<div style="color:#3FB950;font-size:13px">' + escapeHtml(co.whyDheerajFits || '') + '</div></div>' +
    '<div class="prep-section"><div class="prep-section-title">Recent News</div>' +
    '<div style="color:#8B949E;font-style:italic;font-size:13px">' + escapeHtml(co.recentNews || '') + '</div></div></div>';

  // Tab 2 — Industry
  const keyTrends = (ind.keyTrends || []).map(function(t){ return '<div style="color:#58A6FF;font-size:13px;padding:4px 0">→ ' + escapeHtml(t) + '</div>'; }).join('');
  const compBadges = (ind.topCompetitors || []).map(function(c){ return '<span class="prep-pill prep-pill-blue">' + escapeHtml(c) + '</span>'; }).join('');
  html += '<div class="prep-tab-pane" id="tab-' + jobId + '-industry">' +
    '<div class="prep-section"><div style="margin-bottom:10px"><span class="prep-pill prep-pill-purple">' + escapeHtml(ind.sector || '') + '</span></div>' +
    '<div style="font-size:12px;color:#8B949E;margin-bottom:4px">GCC Market</div>' +
    '<div style="font-size:13px;color:#E6EDF3;margin-bottom:12px">' + escapeHtml(ind.gccMarketSize || '') + '</div>' +
    '<div class="prep-section-title">Key Trends</div>' + keyTrends + '</div>' +
    '<div class="prep-section"><div class="prep-section-title">Top Competitors</div><div>' + compBadges + '</div></div></div>';

  // Tab 3 — Role
  const resps = (role.typicalResponsibilities || []).map(function(r){ return '<div style="font-size:13px;color:#E6EDF3;padding:4px 0 4px 12px;border-left:2px solid #30363D">• ' + escapeHtml(r) + '</div>'; }).join('');
  const kpis = (role.kpisMeasuredBy || []).map(function(k){ return '<div style="font-size:13px;color:#E6EDF3;padding:4px 0">📏 ' + escapeHtml(k) + '</div>'; }).join('');
  html += '<div class="prep-tab-pane" id="tab-' + jobId + '-role">' +
    '<div class="prep-section"><div class="prep-section-title">Typical Responsibilities</div>' + resps + '</div>' +
    '<div class="prep-section"><div class="prep-section-title">Measured By (KPIs)</div>' + kpis + '</div>' +
    '<div class="prep-section" style="display:flex;gap:24px;flex-wrap:wrap">' +
    '<div><div style="font-size:11px;color:#8B949E">CAREER PATH</div><div style="font-size:13px;color:#E6EDF3">→ ' + escapeHtml(role.careerProgression || '') + '</div></div>' +
    '<div><div style="font-size:11px;color:#8B949E">SALARY RANGE</div><div style="font-size:13px;color:#D29922;font-weight:bold">' + escapeHtml(role.salaryRange || '') + '</div></div></div></div>';

  // Tab 4 — Questions
  function qCards(items, cls) {
    return (items || []).map(function(q) {
      return '<div class="prep-question-card ' + cls + '"><span>' + escapeHtml(q) + '</span>' +
        '<button class="prep-copy-btn" data-text="' + escapeHtml(q) + '" onclick="copyPrepText(this)">Copy</button></div>';
    }).join('');
  }
  html += '<div class="prep-tab-pane" id="tab-' + jobId + '-questions">' +
    '<div class="prep-section"><div class="prep-section-title" style="color:#D29922">Behavioural</div>' + qCards(qs.behavioural, 'prep-q-behavioural') + '</div>' +
    '<div class="prep-section"><div class="prep-section-title" style="color:#58A6FF">Technical</div>' + qCards(qs.technical, 'prep-q-technical') + '</div>' +
    '<div class="prep-section"><div class="prep-section-title" style="color:#3FB950">Situational</div>' + qCards(qs.situational, 'prep-q-situational') + '</div>' +
    '<div class="prep-section"><div class="prep-section-title" style="color:#8957E5">Company Specific</div>' + qCards(qs.companySpecific, 'prep-q-company') + '</div></div>';

  // Tab 5 — Your Answers
  const starCards = (ans.starExamples || []).map(function(s, i) {
    return '<div style="background:#1F2937;border-radius:6px;padding:12px;margin-bottom:10px">' +
      '<div style="font-size:11px;font-weight:bold;color:#8957E5;margin-bottom:8px">STAR EXAMPLE ' + (i + 1) + '</div>' +
      '<div class="star-grid">' +
      '<div class="star-cell"><div class="star-cell-label">Situation</div><div class="star-cell-text">' + escapeHtml(s.situation || '') + '</div></div>' +
      '<div class="star-cell"><div class="star-cell-label">Task</div><div class="star-cell-text">' + escapeHtml(s.task || '') + '</div></div>' +
      '<div class="star-cell"><div class="star-cell-label">Action</div><div class="star-cell-text">' + escapeHtml(s.action || '') + '</div></div>' +
      '<div class="star-cell"><div class="star-cell-label">Result</div><div class="star-cell-text">' + escapeHtml(s.result || '') + '</div></div>' +
      '</div></div>';
  }).join('');
  const askQs = (prep.questionsToAskInterviewer || []).map(function(q){ return '<span class="prep-pill prep-pill-green" style="margin:2px">' + escapeHtml(q) + '</span>'; }).join('');
  html += '<div class="prep-tab-pane" id="tab-' + jobId + '-answers">' +
    '<div class="prep-section"><div class="prep-section-title">Top Strength to Emphasise</div>' +
    '<div style="color:#D29922;font-weight:bold;font-size:13px">' + escapeHtml(ans.topStrengthToEmphasise || '') + '</div></div>' +
    '<div class="prep-section"><div class="prep-section-title">STAR Examples</div>' + starCards + '</div>' +
    '<div class="prep-section"><div class="prep-section-title">Questions to Ask Interviewer</div><div>' + askQs + '</div></div></div>';

  // Tab 6 — Checklist
  const chkItems = (prep.preparationChecklist || []).map(function(item, i) {
    const cid = 'chk-' + jobId + '-' + i;
    return '<div class="prep-checklist-item" id="chk-row-' + cid + '">' +
      '<input type="checkbox" id="' + cid + '" onchange="toggleChecklistItem(\\'' + jobId + '\\',' + i + ',this)">' +
      '<label for="' + cid + '" style="cursor:pointer">' + escapeHtml(item) + '</label></div>';
  }).join('');
  const redFlags = (prep.redFlags || []).map(function(f){ return '<div style="color:#D29922;font-size:13px;padding:4px 0">⚠️ ' + escapeHtml(f) + '</div>'; }).join('');
  html += '<div class="prep-tab-pane" id="tab-' + jobId + '-checklist">' +
    '<div class="prep-section"><div class="prep-section-title">Pre-Interview Checklist</div>' + chkItems + '</div>' +
    '<div class="prep-section"><div class="prep-section-title">Dress Code</div>' +
    '<div style="font-size:13px;color:#E6EDF3">👔 ' + escapeHtml(prep.dresscode || '') + '</div></div>' +
    '<div class="prep-section"><div class="prep-section-title">Red Flags</div>' + redFlags + '</div></div>';

  return html;
}

function switchPrepTab(jobId, tab) {
  ['company','industry','role','questions','answers','checklist'].forEach(function(t) {
    var pane = document.getElementById('tab-' + jobId + '-' + t);
    var btn = document.getElementById('tab-btn-' + jobId + '-' + t);
    if (pane) pane.classList.toggle('active', t === tab);
    if (btn) btn.classList.toggle('active', t === tab);
  });
}

function copyPrepText(btn) {
  var text = btn.getAttribute('data-text');
  if (!text) return;
  navigator.clipboard.writeText(text).then(function() {
    btn.textContent = 'Copied!';
    setTimeout(function() { btn.textContent = 'Copy'; }, 2000);
  }).catch(function() { btn.textContent = 'Copy'; });
}

function toggleChecklistItem(jobId, idx, checkbox) {
  var key = 'prep-checklist-' + jobId;
  var saved = JSON.parse(localStorage.getItem(key) || '{}');
  saved[idx] = checkbox.checked;
  localStorage.setItem(key, JSON.stringify(saved));
  var row = document.getElementById('chk-row-chk-' + jobId + '-' + idx);
  if (row) row.classList.toggle('checked', checkbox.checked);
}

function loadChecklistState(jobId, items) {
  var key = 'prep-checklist-' + jobId;
  var saved = JSON.parse(localStorage.getItem(key) || '{}');
  items.forEach(function(item, i) {
    var cb = document.getElementById('chk-' + jobId + '-' + i);
    if (cb && saved[i]) {
      cb.checked = true;
      var row = document.getElementById('chk-row-chk-' + jobId + '-' + i);
      if (row) row.classList.add('checked');
    }
  });
}

// Store job map for API lookups
window.__jobMap = {};
ALL_JOBS.forEach(j => { window.__jobMap[getJobId(j)] = j; });

// Init
if (ALL_JOBS.length > 0) {
  updateCompanyDropdown(ALL_JOBS, '');
  updateSourceDropdown(ALL_JOBS, '');
  applyFilters();
}

// ─── ADD JOB MODAL ───────────────────────────────────────
let _addJobUrl = '';
let _browserPollInterval = null;
let _manualMode = false;

function detectPortalName(url) {
  const u = (url || '').toLowerCase();
  if (u.includes('linkedin.com')) return 'LinkedIn';
  if (u.includes('michaelpage.com') || u.includes('michaelpage.ae')) return 'Michael Page';
  if (u.includes('bayt.com')) return 'Bayt';
  if (u.includes('gulftalent.com')) return 'GulfTalent';
  if (u.includes('naukrigulf.com')) return 'NaukriGulf';
  if (u.includes('indeed.com')) return 'Indeed';
  if (u.includes('monstergulf.com')) return 'Monster Gulf';
  return 'the recruiter website';
}

function openAddJobModal() {
  _addJobUrl = '';
  _manualMode = false;
  document.getElementById('modal-url-input').value = '';
  setModalSection('url-section');
  document.getElementById('add-job-modal').classList.add('open');
}

function closeAddJobModal() {
  if (_browserPollInterval) { clearInterval(_browserPollInterval); _browserPollInterval = null; }
  document.getElementById('add-job-modal').classList.remove('open');
}

function setModalSection(section) {
  ['url-section','progress-section','browser-section','manual-section','success-section'].forEach(id => {
    document.getElementById('modal-' + id).style.display = 'none';
  });
  document.getElementById('modal-' + section).style.display = 'block';
}

function setProgress(steps) {
  const icons = { done: '✅', loading: '<span class="spinner" style="width:12px;height:12px;border-width:2px"></span>', wait: '⏳', error: '❌' };
  document.getElementById('modal-progress-steps').innerHTML = steps.map(s =>
    \`<div class="step">\${icons[s.state] || '•'} \${s.text}</div>\`
  ).join('');
}

async function startExtraction() {
  _addJobUrl = document.getElementById('modal-url-input').value.trim();
  if (!_addJobUrl) return;
  setModalSection('progress-section');
  setProgress([{ state: 'loading', text: 'Fetching job page...' }]);

  try {
    const r = await fetch('/api/add-job-from-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: _addJobUrl })
    });
    const data = await r.json();

    if (data.success && data.job) {
      closeAddJobModal();
      addJobToGrid(data.job);
    } else if (data.requiresBrowser) {
      const portalName = data.portalName || detectPortalName(_addJobUrl);
      setProgress([
        { state: 'done', text: 'Direct fetch attempted' },
        { state: 'loading', text: 'Login required — opening browser...' }
      ]);
      setModalSection('browser-section');
      document.getElementById('modal-browser-portal').textContent = portalName;
      startBrowserExtraction(_addJobUrl, portalName);
    } else {
      setProgress([{ state: 'error', text: data.message || 'Extraction failed' }]);
      setTimeout(() => showManualForm(), 2000);
    }
  } catch (err) {
    setProgress([{ state: 'error', text: 'Network error — try manual entry' }]);
    setTimeout(() => showManualForm(), 1500);
  }
}

async function startBrowserExtraction(url, portalName) {
  await fetch('/api/add-job-browser', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url })
  });

  _browserPollInterval = setInterval(async () => {
    try {
      const r = await fetch('/api/browser-status');
      const data = await r.json();
      if (data.status === 'complete' && data.job) {
        clearInterval(_browserPollInterval); _browserPollInterval = null;
        closeAddJobModal();
        addJobToGrid(data.job);
      } else if (data.status === 'failed') {
        clearInterval(_browserPollInterval); _browserPollInterval = null;
        showManualForm();
      }
    } catch (e) { /* keep polling */ }
  }, 3000);
}

function cancelBrowser() {
  if (_browserPollInterval) { clearInterval(_browserPollInterval); _browserPollInterval = null; }
  showManualForm();
}

function showManualForm() {
  _manualMode = true;
  document.getElementById('manual-apply-url').value = _addJobUrl;
  setModalSection('manual-section');
}

async function submitManual() {
  const manualData = {
    title: document.getElementById('manual-title').value.trim(),
    company: document.getElementById('manual-company').value.trim(),
    location: document.getElementById('manual-location').value.trim(),
    salary: document.getElementById('manual-salary').value.trim(),
    description: document.getElementById('manual-description').value.trim(),
    source: document.getElementById('manual-source').value.trim(),
    applyUrl: document.getElementById('manual-apply-url').value.trim(),
  };
  if (!manualData.title) return alert('Job title is required.');
  const url = manualData.applyUrl || _addJobUrl;
  const r = await fetch('/api/add-job-from-url', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, manualData })
  });
  const data = await r.json();
  if (data.success && data.job) { closeAddJobModal(); addJobToGrid(data.job); }
  else alert(data.message || 'Error saving job');
}

function showSuccessCard(job) {
  setModalSection('success-section');
  const tc = job.tier === 1 ? '#3FB950' : job.tier === 2 ? '#58A6FF' : job.tier === 3 ? '#D29922' : '#6E7681';
  document.getElementById('modal-success-content').innerHTML = \`
    <div class="modal-success-card">
      <div style="display:flex;justify-content:space-between;align-items:flex-start">
        <div>
          <div class="sc-title">\${escapeHtml(job.title || '')}</div>
          <div class="sc-company">\${escapeHtml(job.company || '')}</div>
          <div class="sc-meta">
            <span>\${escapeHtml(job.location || '')}</span>
            <span style="color:\${tc};font-weight:bold">TIER \${job.tier}</span>
            <span>Score: \${job.totalScore || 0}/100</span>
          </div>
        </div>
        <div class="sc-score" style="color:\${tc}">\${job.totalScore || 0}</div>
      </div>
      <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap">
        <button class="modal-btn" onclick="saveJobToDashboard(window._lastExtractedJob)">Save to Dashboard</button>
        <button class="modal-btn-sec" onclick="closeAddJobModal()">Close</button>
      </div>
    </div>
  \`;
  window._lastExtractedJob = job;
}

function showToast(msg) {
  const t = document.createElement('div');
  t.textContent = msg;
  t.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#238636;color:white;padding:12px 22px;border-radius:8px;font-size:14px;font-weight:500;z-index:99999;box-shadow:0 4px 12px rgba(0,0,0,.4);pointer-events:none';
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 4000);
}

function addJobToGrid(job) {
  console.log('Adding card to grid:', job.title);
  const noJobsMsg = document.getElementById('no-jobs-msg');
  if (noJobsMsg) noJobsMsg.remove();
  const grid = document.getElementById('jobs-grid');
  if (grid) {
    grid.insertAdjacentHTML('afterbegin', buildCard(job, 0));
  }
  const statTotal = document.getElementById('stat-total');
  if (statTotal) statTotal.textContent = parseInt(statTotal.textContent || '0') + 1;
  const statToday = document.getElementById('stat-today');
  if (statToday) statToday.textContent = parseInt(statToday.textContent || '0') + 1;
  showToast(\`✅ \${job.title} at \${job.company} added!\`);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function saveJobToDashboard(job) {
  try {
    const r = await fetch('/api/add-application', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(job)
    });
    const data = await r.json();
    if (data.success) {
      closeAddJobModal();
      alert('Job saved to tracker!');
    } else {
      alert(data.message || 'Error saving job');
    }
  } catch (e) {
    alert('Error saving job');
  }
}
</script>

<!-- ADD JOB MODAL -->
<div class="modal-overlay" id="add-job-modal" onclick="if(event.target===this)closeAddJobModal()">
  <div class="modal-box">
    <div class="modal-title">
      <span>➕ Add Job from URL</span>
      <button class="modal-close" onclick="closeAddJobModal()">×</button>
    </div>

    <!-- URL INPUT -->
    <div id="modal-url-section">
      <div class="modal-field-label">Paste the job listing URL</div>
      <input class="modal-input" id="modal-url-input" type="url" placeholder="https://linkedin.com/jobs/view/...">
      <div style="display:flex;gap:8px;margin-top:4px">
        <button class="modal-btn" onclick="startExtraction()">🔍 Extract &amp; Add Job</button>
        <button class="modal-btn-sec" onclick="showManualForm()">Enter Manually</button>
      </div>
    </div>

    <!-- PROGRESS -->
    <div id="modal-progress-section" style="display:none">
      <div class="modal-progress">
        <div id="modal-progress-steps"></div>
      </div>
    </div>

    <!-- BROWSER WAITING -->
    <div id="modal-browser-section" style="display:none">
      <div class="modal-browser-msg">
        <div style="font-weight:bold;margin-bottom:6px">🖥️ Browser window opened</div>
        <div>Please log in to <strong id="modal-browser-portal"></strong> and navigate to the job page.</div>
        <div style="color:#3FB950;margin-top:6px">✅ Job details will be extracted automatically.</div>
        <div style="color:#8B949E;font-size:11px;margin-top:4px">Do not close the browser window.</div>
      </div>
      <div style="display:flex;gap:8px;align-items:center;margin-top:8px">
        <span class="spinner" style="width:14px;height:14px;border-width:2px"></span>
        <span style="font-size:12px;color:#8B949E">Waiting for browser...</span>
        <button class="modal-btn-sec" onclick="cancelBrowser()" style="margin-left:auto">Cancel — Enter Manually</button>
      </div>
    </div>

    <!-- MANUAL ENTRY -->
    <div id="modal-manual-section" style="display:none">
      <div style="font-size:12px;color:#8B949E;margin-bottom:10px">Fill in what you know — all fields optional except Title.</div>
      <div class="modal-field-row">
        <div><div class="modal-field-label">Job Title *</div><input class="modal-input" id="manual-title" placeholder="e.g. Sales Manager"></div>
        <div><div class="modal-field-label">Company</div><input class="modal-input" id="manual-company" placeholder="e.g. Emaar Properties"></div>
      </div>
      <div class="modal-field-row">
        <div><div class="modal-field-label">Location</div><input class="modal-input" id="manual-location" placeholder="e.g. Dubai"></div>
        <div><div class="modal-field-label">Salary</div><input class="modal-input" id="manual-salary" placeholder="e.g. AED 20000"></div>
      </div>
      <div class="modal-field-row">
        <div><div class="modal-field-label">Source</div><input class="modal-input" id="manual-source" placeholder="e.g. LinkedIn"></div>
        <div><div class="modal-field-label">Apply URL</div><input class="modal-input" id="manual-apply-url" placeholder="https://..."></div>
      </div>
      <div><div class="modal-field-label">Description</div><textarea class="modal-input" id="manual-description" rows="3" placeholder="Paste job description..."></textarea></div>
      <div style="display:flex;gap:8px;margin-top:4px">
        <button class="modal-btn" onclick="submitManual()">Add Job Manually</button>
        <button class="modal-btn-sec" onclick="setModalSection('url-section')">← Back</button>
      </div>
    </div>

    <!-- SUCCESS -->
    <div id="modal-success-section" style="display:none">
      <div id="modal-success-content"></div>
    </div>
  </div>
</div>
</body>
</html>`;
}

// ═══════════════════════════════════════════════════════
// TRACKER PAGE HTML
// ═══════════════════════════════════════════════════════

function buildTrackerHtml() {
  const today = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  const applications = loadApplications();
  const pipeline = getPipelineSummary();

  const responseRate = pipeline.total > 0
    ? Math.round(((pipeline.Screening + pipeline.Interview + pipeline.Offer) / pipeline.total) * 100)
    : 0;
  const interviewRate = pipeline.total > 0
    ? Math.round(((pipeline.Interview + pipeline.Offer) / pipeline.total) * 100)
    : 0;
  const offerRate = pipeline.total > 0
    ? Math.round((pipeline.Offer / pipeline.total) * 100)
    : 0;

  const columns = [
    { status: 'Applied', color: '#1F6FEB' },
    { status: 'Screening', color: '#D29922' },
    { status: 'Interview', color: '#3FB950' },
    { status: 'Offer', color: '#F5A623' },
    { status: 'Rejected', color: '#DA3633' },
  ];

  const appsJson = JSON.stringify(applications).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');

  const columnsHtml = columns.map(col => {
    const colApps = applications.filter(a => a.status === col.status);
    const cards = colApps.map(app => `
      <div class="kanban-card" id="kcard-${app.id}">
        <div class="kcard-title">${escHtml(app.jobTitle || '')}</div>
        <div class="kcard-company">${escHtml(app.company || '')}</div>
        <div class="kcard-meta">
          <span class="kcard-location">${escHtml(app.location || '')}</span>
          ${app.tier ? `<span class="tier-badge" style="background:${getTierColor(app.tier)}">T${app.tier}</span>` : ''}
        </div>
        <div class="kcard-date">Applied: ${app.appliedDate || ''}</div>
        <select class="status-select" onchange="changeStatus('${app.id}', this.value)" data-id="${app.id}">
          <option value="Applied" ${app.status === 'Applied' ? 'selected' : ''}>Applied</option>
          <option value="Screening" ${app.status === 'Screening' ? 'selected' : ''}>Screening</option>
          <option value="Interview" ${app.status === 'Interview' ? 'selected' : ''}>Interview</option>
          <option value="Offer" ${app.status === 'Offer' ? 'selected' : ''}>Offer</option>
          <option value="Rejected" ${app.status === 'Rejected' ? 'selected' : ''}>Rejected</option>
        </select>
      </div>
    `).join('');

    return `
      <div class="kanban-col">
        <div class="kanban-col-header" style="background:${col.color}">
          ${col.status}
          <span class="col-count">${colApps.length}</span>
        </div>
        <div class="kanban-col-body" id="col-${col.status}">
          ${cards || '<div class="empty-col">No applications here yet</div>'}
        </div>
      </div>
    `;
  }).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>GCC Job Agent — Tracker</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, sans-serif; background: #0D1117; color: #E6EDF3; color-scheme: dark; }
  .navbar {
    background: #161B22; padding: 0 24px; display: flex;
    align-items: center; justify-content: space-between; height: 56px;
    position: sticky; top: 0; z-index: 100;
    border-bottom: 1px solid #58A6FF;
  }
  .navbar-logo { color: white; font-weight: bold; font-size: 18px; letter-spacing: 1px; }
  .navbar-links { display: flex; gap: 8px; }
  .navbar-links a {
    color: white; text-decoration: none; padding: 6px 16px;
    border-radius: 4px; font-size: 14px;
    border: 1px solid transparent;
  }
  .navbar-links a:hover, .navbar-links a.active { background: #30363D; border: 1px solid #58A6FF; }
  .navbar-right { color: #8B949E; font-size: 13px; text-align: right; }
  .navbar-right strong { color: white; display: block; font-size: 14px; }

  .pipeline-bar {
    background: #1F2937; border: 1px solid #30363D; border-radius: 8px;
    padding: 14px 24px; display: flex; gap: 16px; flex-wrap: wrap; align-items: center;
  }
  .pipeline-stat { text-align: center; border-right: 1px solid #30363D; padding-right: 16px; }
  .pipeline-stat:last-child { border-right: none; padding-right: 0; }
  .pipeline-num { font-size: 22px; font-weight: bold; color: white; }
  .pipeline-label { font-size: 12px; color: #8B949E; }
  .pipeline-div { width: 1px; background: #30363D; height: 36px; }

  .kanban-wrapper { padding: 20px 24px; overflow-x: auto; }
  .kanban-board { display: flex; gap: 14px; min-width: 900px; }
  .kanban-col { flex: 1; min-width: 180px; border: 1px solid #30363D; border-radius: 8px; }
  .kanban-col-header {
    color: white; font-weight: bold; font-size: 14px;
    padding: 10px 14px; border-radius: 6px 6px 0 0;
    display: flex; justify-content: space-between; align-items: center;
    border-bottom: 2px solid rgba(255,255,255,0.2);
  }
  .col-count {
    background: rgba(255,255,255,0.3); border-radius: 12px;
    padding: 1px 8px; font-size: 12px;
  }
  .kanban-col-body {
    background: #161B22; border-radius: 0 0 6px 6px;
    padding: 10px; min-height: 200px; display: flex; flex-direction: column; gap: 8px;
  }
  .empty-col { text-align: center; color: #6E7681; font-size: 13px; padding: 20px 0; }

  .kanban-card {
    background: #1F2937; border: 1px solid #484F58; border-radius: 6px; padding: 12px;
    box-shadow: 0 2px 8px rgba(0,0,0,0.4); display: flex; flex-direction: column; gap: 6px;
    transition: border-color 0.15s;
  }
  .kanban-card:hover { border-color: #58A6FF; }
  .kcard-title { font-weight: bold; font-size: 13px; color: #E6EDF3; }
  .kcard-company { font-size: 12px; color: #58A6FF; }
  .kcard-meta { display: flex; gap: 6px; align-items: center; }
  .kcard-location { font-size: 11px; color: #8B949E; }
  .tier-badge {
    font-size: 10px; font-weight: bold; color: white;
    padding: 1px 6px; border-radius: 10px;
  }
  .kcard-date { font-size: 11px; color: #6E7681; }
  .status-select {
    width: 100%; border: 1px solid #30363D; border-radius: 4px;
    padding: 4px 6px; font-size: 12px; color: #E6EDF3; background: #1F2937; cursor: pointer;
  }

  /* SCROLLBAR */
  ::-webkit-scrollbar { width: 8px; height: 8px; }
  ::-webkit-scrollbar-track { background: #0D1117; }
  ::-webkit-scrollbar-thumb { background: #30363D; border-radius: 4px; }
  ::-webkit-scrollbar-thumb:hover { background: #58A6FF; }
</style>
</head>
<body>
<nav class="navbar">
  <div class="navbar-logo">GCC JOB AGENT</div>
  <div class="navbar-links">
    <a href="/">Jobs</a>
    <a href="/tracker" class="active">Tracker</a>
  </div>
  <div class="navbar-right">
    <strong>Dheeraj Thiagarajan</strong>
    ${today}
  </div>
</nav>

<div class="pipeline-bar">
  <div class="pipeline-stat">
    <div class="pipeline-num">${pipeline.total}</div>
    <div class="pipeline-label">Total Applied</div>
  </div>
  <div class="pipeline-div"></div>
  <div class="pipeline-stat">
    <div class="pipeline-num" style="color:#58A6FF">${responseRate}%</div>
    <div class="pipeline-label">Response Rate</div>
  </div>
  <div class="pipeline-div"></div>
  <div class="pipeline-stat">
    <div class="pipeline-num" style="color:#3FB950">${interviewRate}%</div>
    <div class="pipeline-label">Interview Rate</div>
  </div>
  <div class="pipeline-div"></div>
  <div class="pipeline-stat">
    <div class="pipeline-num" style="color:#F5A623">${offerRate}%</div>
    <div class="pipeline-label">Offer Rate</div>
  </div>
</div>

<div class="kanban-wrapper">
  <div class="kanban-board">
    ${columnsHtml}
  </div>
</div>

<script>
let allApps = ${appsJson};

function getTierColor(tier) {
  if (tier === 1) return '#3FB950';
  if (tier === 2) return '#58A6FF';
  if (tier === 3) return '#D29922';
  return '#6E7681';
}

async function changeStatus(id, newStatus) {
  try {
    const res = await fetch('/api/update-status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, status: newStatus }),
    });
    const data = await res.json();
    if (data.success) {
      moveCard(id, newStatus);
    }
  } catch (e) {
    console.error('Failed to update status:', e);
  }
}

function moveCard(id, newStatus) {
  const card = document.getElementById('kcard-' + id);
  if (!card) return;
  card.remove();

  const app = allApps.find(a => a.id === id);
  if (app) app.status = newStatus;

  const targetCol = document.getElementById('col-' + newStatus);
  if (!targetCol) return;

  const empty = targetCol.querySelector('.empty-col');
  if (empty) empty.remove();

  const newCard = buildCard(app);
  targetCol.insertAdjacentHTML('beforeend', newCard);

  // Update counts
  const columns = ['Applied', 'Screening', 'Interview', 'Offer', 'Rejected'];
  columns.forEach(status => {
    const colBody = document.getElementById('col-' + status);
    const header = colBody.closest('.kanban-col').querySelector('.col-count');
    const count = colBody.querySelectorAll('.kanban-card').length;
    header.textContent = count;
    if (count === 0) colBody.innerHTML = '<div class="empty-col">No applications here yet</div>';
  });
}

function buildCard(app) {
  if (!app) return '';
  return \`
    <div class="kanban-card" id="kcard-\${app.id}">
      <div class="kcard-title">\${escHtml(app.jobTitle || '')}</div>
      <div class="kcard-company">\${escHtml(app.company || '')}</div>
      <div class="kcard-meta">
        <span class="kcard-location">\${escHtml(app.location || '')}</span>
        \${app.tier ? \`<span class="tier-badge" style="background:\${getTierColor(app.tier)}">T\${app.tier}</span>\` : ''}
      </div>
      <div class="kcard-date">Applied: \${app.appliedDate || ''}</div>
      <select class="status-select" onchange="changeStatus('\${app.id}', this.value)" data-id="\${app.id}">
        <option value="Applied" \${app.status === 'Applied' ? 'selected' : ''}>Applied</option>
        <option value="Screening" \${app.status === 'Screening' ? 'selected' : ''}>Screening</option>
        <option value="Interview" \${app.status === 'Interview' ? 'selected' : ''}>Interview</option>
        <option value="Offer" \${app.status === 'Offer' ? 'selected' : ''}>Offer</option>
        <option value="Rejected" \${app.status === 'Rejected' ? 'selected' : ''}>Rejected</option>
      </select>
    </div>
  \`;
}

function escHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
</script>
</body>
</html>`;
}

// Helper for server-side HTML escaping
function escHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ─── INTERVIEW PREP CACHE ────────────────────────────
function getPrepCacheFilePath() {
  const today = new Date().toISOString().split('T')[0];
  return path.join(__dirname, '../data/interview-prep-' + today + '.json');
}

function loadPrepCache() {
  const filePath = getPrepCacheFilePath();
  if (fs.existsSync(filePath)) {
    try {
      const data = fs.readJsonSync(filePath);
      Object.assign(prepCache, data);
    } catch (e) { /* ignore */ }
  }
}

function savePrepCache() {
  const filePath = getPrepCacheFilePath();
  try {
    fs.ensureDirSync(path.dirname(filePath));
    fs.writeJsonSync(filePath, prepCache, { spaces: 2 });
  } catch (e) { /* ignore */ }
}

function getTierColor(tier) {
  if (tier === 1) return '#3FB950';
  if (tier === 2) return '#58A6FF';
  if (tier === 3) return '#D29922';
  return '#6E7681';
}

// ═══════════════════════════════════════════════════════
// JOB URL EXTRACTION — HELPERS
// ═══════════════════════════════════════════════════════

function isLoginPage(html, url) {
  const u = (url || '').toLowerCase();
  const h = (html || '').toLowerCase();
  if (/\/(login|signin|sign-in|auth|authenticate)/.test(u)) return true;
  if (u.includes('linkedin.com/login') || u.includes('linkedin.com/authwall')) return true;
  if (h.includes('authwall') || h.includes('login-required') || h.includes('sign-in-required') || h.includes('members-only')) return true;
  const hasPassword = h.includes('password');
  const hasEmail = h.includes('email');
  const hasSignIn = h.includes('sign in') || h.includes('signin');
  const hasUsername = h.includes('username');
  const hasLogin = h.includes('login');
  if (hasPassword && hasEmail && hasSignIn) return true;
  if (hasPassword && hasUsername && hasLogin) return true;
  return false;
}

function detectPortalName(url) {
  const u = (url || '').toLowerCase();
  if (u.includes('linkedin.com')) return 'LinkedIn';
  if (u.includes('michaelpage.com') || u.includes('michaelpage.ae')) return 'Michael Page';
  if (u.includes('bayt.com')) return 'Bayt';
  if (u.includes('gulftalent.com')) return 'GulfTalent';
  if (u.includes('naukrigulf.com')) return 'NaukriGulf';
  if (u.includes('indeed.com')) return 'Indeed';
  if (u.includes('monstergulf.com')) return 'Monster Gulf';
  return 'the recruiter website';
}

function extractJobDetails(html, url) {
  const $ = cheerio.load(html);
  $('script, style, nav, footer, header').remove();
  const title =
    $('h1').first().text().trim() ||
    $('[class*="job-title"]').first().text().trim() ||
    $('[class*="position-title"]').first().text().trim() ||
    $('title').text().trim().split('|')[0].trim() || '';
  const company =
    $('[class*="company-name"]').first().text().trim() ||
    $('[class*="employer"]').first().text().trim() ||
    $('[class*="org-name"]').first().text().trim() || '';
  const location =
    $('[class*="location"]').first().text().trim() ||
    $('[class*="job-location"]').first().text().trim() || '';
  const salary =
    $('[class*="salary"]').first().text().trim() ||
    $('[class*="compensation"]').first().text().trim() || '';
  let description = '';
  $('[class*="description"], [class*="job-desc"], [class*="details"], main, article').each((_, el) => {
    const text = $(el).text().trim();
    if (text.length > description.length) description = text;
  });
  if (description.length > 2000) description = description.substring(0, 2000);
  return { title, company, location, salary, description, source: detectPortalName(url), applyUrl: url };
}

function handleExtractedJob(extracted, url, res) {
  const job = prioritizeJob({
    title: extracted.title || '',
    company: extracted.company || '',
    location: extracted.location || '',
    salary: extracted.salary || '',
    description: extracted.description || '',
    source: extracted.source || detectPortalName(url),
    applyUrl: url,
    postedDate: new Date().toISOString().split('T')[0],
  });
  console.log(`[add-job] allJobs array length before add: ${allJobs !== null ? allJobs.length : 'null (not loaded)'}`);
  saveJobToTodaysReport(job);
  console.log(`[add-job] Job saved to file: ${job.title} at ${job.company}`);
  if (allJobs !== null) allJobs.unshift(job);
  console.log(`[add-job] allJobs array length after add: ${allJobs !== null ? allJobs.length : 'null'}`);
  return res.json({ success: true, job, extractedBy: 'fetch' });
}

function handleManualData(manualData, url, res) {
  const job = prioritizeJob({
    title: manualData.title || '',
    company: manualData.company || '',
    location: manualData.location || '',
    salary: manualData.salary || '',
    description: manualData.description || '',
    source: manualData.source || detectPortalName(url),
    applyUrl: url || manualData.applyUrl || '',
    postedDate: new Date().toISOString().split('T')[0],
  });
  console.log(`[add-job] allJobs array length before add: ${allJobs !== null ? allJobs.length : 'null (not loaded)'}`);
  saveJobToTodaysReport(job);
  console.log(`[add-job] Job saved to file: ${job.title} at ${job.company}`);
  if (allJobs !== null) allJobs.unshift(job);
  console.log(`[add-job] allJobs array length after add: ${allJobs !== null ? allJobs.length : 'null'}`);
  return res.json({ success: true, job, extractedBy: 'manual' });
}

// ═══════════════════════════════════════════════════════
// START DASHBOARD
// ═══════════════════════════════════════════════════════

function findJobById(jobId) {
  const allJobs = loadAllJobs();

  // 1. Exact id match
  let job = allJobs.find(j => j.id === jobId);
  if (job) return job;

  // 2. _id match
  job = allJobs.find(j => String(j._id) === jobId);
  if (job) return job;

  // 3. Index match
  const idx = parseInt(jobId);
  if (!isNaN(idx) && allJobs[idx]) return allJobs[idx];

  // 4. title+company from jobId string
  const parts = jobId.split('_');
  if (parts.length >= 2) {
    job = allJobs.find(j =>
      j.company && j.title &&
      jobId.toLowerCase().includes(
        j.company.toLowerCase().replace(/\s+/g, ''))
    );
    if (job) return job;
  }

  return null;
}

function startDashboard() {
  app = express();
  app.use(express.json());

  // Serve cover letter files
  const coverLetterDir = path.join(__dirname, '../data/cover-letters');
  app.use('/cover-letter', express.static(coverLetterDir));

  // ── GET / ──────────────────────────────────────────
  app.get('/', async (req, res) => {
    const jobs = loadAllJobs();
    const contactsData = await loadContacts();
    const networkingData = loadNetworkingPlans();
    res.send(buildDashboardHtml(jobs, contactsData, networkingData));
  });

  // ── GET /tracker ───────────────────────────────────
  app.get('/tracker', (req, res) => {
    res.send(buildTrackerHtml());
  });

  // ── GET /api/jobs ──────────────────────────────────
  app.get('/api/jobs', (req, res) => {
    let jobs = loadAllJobs();
    const { tier, location, role, fortune500 } = req.query;
    if (tier) jobs = jobs.filter(j => String(j.tier) === tier);
    if (location) jobs = jobs.filter(j => (j.location || '').includes(location));
    if (role) jobs = jobs.filter(j => (j.title || '').toLowerCase().includes(role.toLowerCase()));
    if (fortune500 === 'true') jobs = jobs.filter(j => j.isFortuneCompany);
    res.json(jobs);
  });

  // ── GET /api/pipeline ─────────────────────────────
  app.get('/api/pipeline', (req, res) => {
    res.json(getPipelineSummary());
  });

  // ── GET /api/generate-cover-letter/:jobId ─────────
  app.get('/api/generate-cover-letter/:jobId', async (req, res) => {
    try {
      const jobData = req.headers['x-job-data'];
      let job;
      if (jobData) {
        job = JSON.parse(jobData);
      } else {
        // Fall back to finding job in today's list
        const jobs = loadTodaysJobs();
        const jobId = decodeURIComponent(req.params.jobId);
        const today = new Date().toISOString().split('T')[0];
        job = jobs.find(j => {
          const id = ((j.company || '') + '_' + (j.title || '') + '_' + today)
            .toLowerCase().replace(/\s+/g, '_');
          return id === jobId;
        });
      }
      if (!job) {
        return res.json({ success: false, message: 'Job not found' });
      }
      const result = await generateSingleCoverLetter(job);
      res.json({ success: true, filePath: result.filePath, message: 'Cover letter generated' });
    } catch (err) {
      console.error('[dashboard] Cover letter error:', err.message);
      res.json({ success: false, message: err.message });
    }
  });

  // ── GET /api/autofill/:jobId ───────────────────────
  app.get('/api/autofill/:jobId', async (req, res) => {
    try {
      const jobId = decodeURIComponent(req.params.jobId);
      const job = findJobById(jobId);
      if (!job) {
        return res.json({ success: false, message: 'Job not found' });
      }
      autoFillJobApplication(job).catch(err => console.error('[dashboard] AutoFill error:', err.message));
      res.json({ success: true, message: 'Browser opened for auto-fill' });
    } catch (err) {
      console.error('[dashboard] AutoFill error:', err.message);
      res.json({ success: false, message: err.message });
    }
  });

  // ── POST /api/update-status ────────────────────────
  app.post('/api/update-status', (req, res) => {
    const { id, status, notes } = req.body;
    if (!id || !status) {
      return res.json({ success: false, message: 'id and status required' });
    }
    const application = updateStatus(id, status, notes);
    if (!application) {
      return res.json({ success: false, message: 'Application not found or invalid status' });
    }
    res.json({ success: true, application });
  });

  // ── POST /api/add-application ──────────────────────
  app.post('/api/add-application', (req, res) => {
    const job = req.body;
    if (!job || !job.title || !job.company) {
      return res.json({ success: false, message: 'Job title and company required' });
    }
    const application = addApplication(job);
    res.json({ success: true, application });
  });

  // ── POST /api/add-job-from-url ─────────────────────────
  app.post('/api/add-job-from-url', async (req, res) => {
    const { url, manualData } = req.body;
    if (!url) return res.json({ success: false, message: 'URL required' });

    if (manualData && manualData.title) {
      return handleManualData(manualData, url, res);
    }

    // TIER 1: Direct fetch
    try {
      const response = await axios.get(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
        timeout: 15000,
        validateStatus: status => status < 500,
      });
      if (response.status !== 401 && response.status !== 403 && !isLoginPage(response.data, url)) {
        const extracted = extractJobDetails(response.data, url);
        if (extracted.title && extracted.title.length > 3) {
          return handleExtractedJob(extracted, url, res);
        }
      }
    } catch (fetchError) {
      // Fall through to browser
    }

    // TIER 2: Signal client to open browser
    return res.json({
      success: false,
      requiresBrowser: true,
      message: 'This page requires login. Opening browser...',
      url,
      portalName: detectPortalName(url),
    });
  });

  // ── POST /api/add-job-browser ──────────────────────────
  app.post('/api/add-job-browser', async (req, res) => {
    const { url } = req.body;
    if (!url) return res.json({ success: false, message: 'URL required' });

    browserExtractionResult = { status: 'waiting' };
    res.json({ success: true, message: 'Browser opening...' });

    (async () => {
      let browser;
      try {
        browser = await puppeteer.launch({ headless: false, defaultViewport: null, args: ['--start-maximized'] });
        const page = await browser.newPage();
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});

        await page.evaluate(() => {
          const overlay = document.createElement('div');
          overlay.id = 'gcc-overlay';
          overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;background:#1B2A4A;color:white;padding:14px 20px;z-index:999999;font-family:Arial,sans-serif;font-size:14px;';
          overlay.innerHTML =
            '<div style="font-weight:bold;color:#F5A623">🤖 GCC Job Agent — Job Extractor</div>' +
            '<div style="color:white">If this page requires login, please sign in now.</div>' +
            '<div style="color:#3FB950">✅ Job details will be extracted automatically once you reach the job page.</div>' +
            '<div style="color:#8B949E;font-size:12px">Do not close this browser. Return to dashboard after you see the job details.</div>';
          document.body.insertBefore(overlay, document.body.firstChild);
        }).catch(() => {});

        let extracted = null;
        for (let i = 0; i < 60; i++) {
          await new Promise(r => setTimeout(r, 2000));
          try {
            const currentUrl = page.url();
            const hasJob = await page.evaluate(() => {
              const h1 = document.querySelector('h1');
              const jobTitle = document.querySelector('.job-title, [class*="position"]');
              const bodyText = document.body ? document.body.innerText : '';
              const keywords = ['apply', 'job description', 'responsibilities', 'requirements', 'salary', 'experience'];
              return !!(h1 || jobTitle) && keywords.some(k => bodyText.toLowerCase().includes(k));
            }).catch(() => false);

            if (hasJob && !isLoginPage('', currentUrl)) {
              await new Promise(r => setTimeout(r, 2000));
              const html = await page.content().catch(() => '');
              const domData = await page.evaluate(() => {
                const getText = (...selectors) => {
                  for (const s of selectors) {
                    const el = document.querySelector(s);
                    if (el && el.innerText && el.innerText.trim()) return el.innerText.trim();
                  }
                  return '';
                };
                const title = getText('h1', '.job-title', '[class*="position-title"]', '[class*="jobTitle"]');
                const company = getText('.company-name', '[class*="employer"]', '[class*="companyName"]', '[class*="org-name"]');
                const location = getText('.job-location', '[class*="location"]', '[class*="companyLocation"]');
                const salary = getText('[class*="salary"]', '[class*="compensation"]');
                let desc = '';
                document.querySelectorAll('[class*="description"], [class*="job-desc"], main, article').forEach(el => {
                  if (el.innerText && el.innerText.length > desc.length) desc = el.innerText;
                });
                return { title, company, location, salary, description: desc.substring(0, 2000) };
              }).catch(() => ({}));

              extracted = (domData.title && domData.title.length > 3) ? domData : extractJobDetails(html, currentUrl);
              extracted.applyUrl = currentUrl;
              break;
            }
          } catch (pollErr) { /* continue */ }
        }

        await browser.close().catch(() => {});

        if (extracted && extracted.title) {
          const job = prioritizeJob({
            title: extracted.title || '',
            company: extracted.company || '',
            location: extracted.location || '',
            salary: extracted.salary || '',
            description: extracted.description || '',
            source: detectPortalName(extracted.applyUrl || url),
            applyUrl: extracted.applyUrl || url,
            postedDate: new Date().toISOString().split('T')[0],
          });
          saveJobToTodaysReport(job);
          if (allJobs !== null) allJobs.unshift(job);
          browserExtractionResult = { status: 'complete', job };
        } else {
          browserExtractionResult = { status: 'failed', message: 'Browser timed out. Please try manual entry.' };
        }
      } catch (err) {
        if (browser) await browser.close().catch(() => {});
        browserExtractionResult = { status: 'failed', message: err.message || 'Browser error. Please try manual entry.' };
      }
    })();
  });

  // ── GET /api/browser-status ────────────────────────────
  app.get('/api/browser-status', (req, res) => {
    if (!browserExtractionResult) return res.json({ status: 'idle' });
    const result = { ...browserExtractionResult };
    if (result.status === 'complete' || result.status === 'failed') browserExtractionResult = null;
    res.json(result);
  });

  // ── GET /api/interview-prep/:jobId ──────────────────────
  app.get('/api/interview-prep/:jobId', async (req, res) => {
    const jobId = decodeURIComponent(req.params.jobId);

    // Cache hit
    if (prepCache[jobId]) {
      console.log('Cache hit for jobId:', jobId);
      return res.json({ success: true, prep: prepCache[jobId], cached: true });
    }

    // Find job across all historical jobs
    const job = findJobById(jobId);

    if (!job) {
      return res.json({ success: false, message: 'Job not found' });
    }

    // Check networking.json for insights
    const networkingData = loadNetworkingPlans();
    const networkRecord = networkingData.find(n =>
      (n.company || '').toLowerCase() === (job.company || '').toLowerCase()
    );
    const networkingInsights = networkRecord ? JSON.stringify(networkRecord) : null;

    try {
      const client = new Anthropic();
      const userMessage =
        'Generate interview preparation for this job:\n' +
        'Candidate: Dheeraj Thiagarajan\n' +
        'Education: LSE MSc Management Finance (Merit) 2025, University of Chicago Booth MBA Exchange 2024, Newcastle University BSc Business Management 2021\n' +
        'Experience: Investment & Partnerships Analyst at Lovemore Sports (current), Business Development at G.Network (65% conversion rate, top 3 by revenue), B2B Sales at Durhamlane\n' +
        'Skills: Financial modelling, B2B sales, C-suite stakeholder management, strategy consulting\n\n' +
        'Job Title: ' + (job.title || 'Not specified') + '\n' +
        'Company: ' + (job.company || 'Not specified') + '\n' +
        'Location: ' + (job.location || 'Not specified') + '\n' +
        'Industry: [detect from company and title]\n' +
        'Job Description: ' + (job.description || 'Not provided') + '\n' +
        (networkingInsights ? '\nNetworking Insights: ' + networkingInsights + '\n' : '') +
        '\nReturn ONLY this JSON structure:\n' +
        '{\n' +
        '  "companyOverview": {\n' +
        '    "whatTheyDo": "string (2 sentences)",\n' +
        '    "size": "string (e.g. Large multinational / Mid-size regional)",\n' +
        '    "culture": "string (3-5 culture keywords)",\n' +
        '    "recentNews": "string (1-2 likely recent developments)",\n' +
        '    "whyDheerajFits": "string (2 sentences connecting his background)"\n' +
        '  },\n' +
        '  "industryInsights": {\n' +
        '    "sector": "string (industry sector name)",\n' +
        '    "gccMarketSize": "string (market context)",\n' +
        '    "keyTrends": ["trend1", "trend2", "trend3"],\n' +
        '    "topCompetitors": ["comp1", "comp2", "comp3"]\n' +
        '  },\n' +
        '  "roleInsights": {\n' +
        '    "typicalResponsibilities": ["resp1", "resp2", "resp3", "resp4"],\n' +
        '    "kpisMeasuredBy": ["kpi1", "kpi2", "kpi3"],\n' +
        '    "careerProgression": "string (likely next role)",\n' +
        '    "salaryRange": "string (AED range for this role)"\n' +
        '  },\n' +
        '  "likelyInterviewQuestions": {\n' +
        '    "behavioural": ["q1", "q2", "q3", "q4"],\n' +
        '    "technical": ["q1", "q2", "q3"],\n' +
        '    "situational": ["q1", "q2", "q3"],\n' +
        '    "companySpecific": ["q1", "q2"]\n' +
        '  },\n' +
        '  "suggestedAnswerPointers": {\n' +
        '    "topStrengthToEmphasise": "string",\n' +
        '    "starExamples": [\n' +
        '      { "situation": "string", "task": "string", "action": "string", "result": "string" },\n' +
        '      { "situation": "string", "task": "string", "action": "string", "result": "string" },\n' +
        '      { "situation": "string", "task": "string", "action": "string", "result": "string" }\n' +
        '    ]\n' +
        '  },\n' +
        '  "questionsToAskInterviewer": ["q1", "q2", "q3", "q4"],\n' +
        '  "redFlags": ["flag1", "flag2"],\n' +
        '  "dresscode": "string",\n' +
        '  "preparationChecklist": ["item1", "item2", "item3", "item4", "item5", "item6"]\n' +
        '}';

      const message = await client.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1500,
        system: 'You are an expert career coach helping a candidate prepare for a job interview. Provide concise, actionable interview preparation content. Always respond in valid JSON format only. No markdown, no code blocks, just raw JSON.',
        messages: [{ role: 'user', content: userMessage }],
      });

      function safeParseJSON(text) {
        // Strip markdown code fences
        let clean = text
          .replace(/^```json\s*/i, '')
          .replace(/^```\s*/i, '')
          .replace(/```\s*$/i, '')
          .trim()
        return JSON.parse(clean)
      }

      const rawText = message.content[0].text.trim();
      const prep = safeParseJSON(rawText);
      prepCache[jobId] = prep;
      savePrepCache();
      return res.json({ success: true, prep });
    } catch (err) {
      console.error('[dashboard] Interview prep error:', err.message);
      if (err.status === 402 || (err.message && (err.message.includes('credit') || err.message.includes('billing') || err.message.includes('quota')))) {
        return res.json({ success: false, message: 'no_credits', error: err.message });
      }
      return res.json({ success: false, message: err.message || 'Failed to generate prep' });
    }
  });

  const PORT = process.env.PORT || 3000;
  server = app.listen(PORT, () => {
    console.log(`GCC Job Agent Dashboard running at port ${PORT}`);
  });

  return app;
}

// ═══════════════════════════════════════════════════════
// STOP DASHBOARD
// ═══════════════════════════════════════════════════════

function stopDashboard() {
  if (server) {
    server.close(() => {
      console.log('[dashboard] Server stopped');
    });
    server = null;
  }
}

// ═══════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════

module.exports = { startDashboard, stopDashboard, loadTodaysJobs, loadAllJobs };

// ═══════════════════════════════════════════════════════
// TEST BLOCK
// ═══════════════════════════════════════════════════════

if (require.main === module) {
  loadPrepCache();
  startDashboard();
  console.log('Dashboard started — open http://localhost:3000');
  console.log('Press Ctrl+C to stop');
  console.log('loadAllJobs() built — shows all historic jobs combined & deduplicated');
}
