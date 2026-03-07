const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const SEEN_JOBS_FILE = path.join(DATA_DIR, 'seen_jobs.json');

function loadSeenJobs() {
  try {
    if (!fs.existsSync(SEEN_JOBS_FILE)) {
      fs.writeFileSync(SEEN_JOBS_FILE, '[]', 'utf8');
      return new Set();
    }
    const raw = fs.readFileSync(SEEN_JOBS_FILE, 'utf8');
    return new Set(JSON.parse(raw));
  } catch (err) {
    console.error('Error loading seen jobs:', err);
    return new Set();
  }
}

function saveSeenJobs(seenJobsSet) {
  try {
    fs.writeFileSync(SEEN_JOBS_FILE, JSON.stringify([...seenJobsSet], null, 2), 'utf8');
  } catch (err) {
    console.error('Error saving seen jobs:', err);
  }
}

function generateJobId(job) {
  const raw = `${job.title}${job.company}${job.location}`;
  return raw.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function filterNewJobs(jobsArray) {
  const seen = loadSeenJobs();
  const newJobs = jobsArray.filter(job => {
    const id = generateJobId(job);
    return !seen.has(id);
  });
  for (const job of newJobs) {
    seen.add(generateJobId(job));
  }
  saveSeenJobs(seen);
  return newJobs;
}

function saveDailyReport(dateString, jobsArray) {
  try {
    const filePath = path.join(DATA_DIR, `report_${dateString}.json`);
    fs.writeFileSync(filePath, JSON.stringify(jobsArray, null, 2), 'utf8');
  } catch (err) {
    console.error(`Error saving daily report for ${dateString}:`, err);
  }
}

function loadReport(dateString) {
  try {
    const filePath = path.join(DATA_DIR, `report_${dateString}.json`);
    if (!fs.existsSync(filePath)) return [];
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    console.error(`Error loading report for ${dateString}:`, err);
    return [];
  }
}

async function saveRawJobs(jobsArray, dateString) {
  const fse = require('fs-extra');
  const filePath = path.join(DATA_DIR, `rawjobs_${dateString}.json`);
  await fse.outputJson(filePath, jobsArray, { spaces: 2 });
  console.log(`Saved ${jobsArray.length} raw jobs for ${dateString}`);
}

async function loadRawJobs(dateString) {
  const fse = require('fs-extra');
  const filePath = path.join(DATA_DIR, `rawjobs_${dateString}.json`);
  try {
    if (!await fse.pathExists(filePath)) return null;
    const data = await fse.readJson(filePath);
    console.log(`Loaded ${data.length} cached jobs for ${dateString}`);
    return data;
  } catch (err) {
    return null;
  }
}

async function getNewJobsOnly(freshJobs) {
  const seen = loadSeenJobs();
  const totalBefore = seen.size;
  const newJobs = [];
  for (const job of freshJobs) {
    const jobId = `${job.title}${job.company}${job.location}`
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-');
    if (!seen.has(jobId)) {
      newJobs.push(job);
      seen.add(jobId);
    }
  }
  saveSeenJobs(seen);
  console.log(`Total jobs ever seen: ${seen.size}`);
  console.log(`New jobs today: ${newJobs.length}`);
  console.log(`Already seen before: ${freshJobs.length - newJobs.length}`);
  return newJobs;
}

module.exports = { loadSeenJobs, saveSeenJobs, generateJobId, filterNewJobs, saveDailyReport, loadReport, saveRawJobs, loadRawJobs, getNewJobsOnly };
