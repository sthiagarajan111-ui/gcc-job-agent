const fs = require('fs');
const path = require('path');
const { getDB } = require('./mongodb');

const DATA_DIR = path.join(__dirname, '..', 'data');
const SEEN_JOBS_FILE = path.join(DATA_DIR, 'seen_jobs.json');

// ── Seen jobs ──────────────────────────────────────────

async function loadSeenJobs() {
  try {
    const db = await getDB();
    if (db) {
      const doc = await db.collection('seen_jobs').findOne({ _id: 'seen' });
      if (doc && doc.ids) return new Set(doc.ids);
    }
  } catch (err) {
    console.log('[storage] MongoDB loadSeenJobs failed, using local file');
  }
  // Fallback
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

async function saveSeenJobs(seenJobsSet) {
  const ids = [...seenJobsSet];
  try {
    const db = await getDB();
    if (db) {
      await db.collection('seen_jobs').updateOne(
        { _id: 'seen' },
        { $set: { ids } },
        { upsert: true }
      );
    }
  } catch (err) {
    console.log('[storage] MongoDB saveSeenJobs failed, using local file');
  }
  // Always write local backup
  try {
    fs.writeFileSync(SEEN_JOBS_FILE, JSON.stringify(ids, null, 2), 'utf8');
  } catch (err) {
    console.error('Error saving seen jobs:', err);
  }
}

// ── Job ID generation ──────────────────────────────────

function generateJobId(job) {
  const raw = `${job.title}${job.company}${job.location}`;
  return raw.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

// ── Filter new jobs ────────────────────────────────────

async function filterNewJobs(jobsArray) {
  const seen = await loadSeenJobs();
  const newJobs = jobsArray.filter(job => {
    const id = generateJobId(job);
    return !seen.has(id);
  });
  for (const job of newJobs) {
    seen.add(generateJobId(job));
  }
  await saveSeenJobs(seen);
  return newJobs;
}

// ── Daily report ───────────────────────────────────────

async function saveDailyReport(dateString, jobsArray) {
  try {
    const db = await getDB();
    if (db) {
      for (const job of jobsArray) {
        if (job.id) {
          await db.collection('jobs').updateOne(
            { id: job.id },
            { $set: { ...job, date: dateString } },
            { upsert: true }
          );
        }
      }
    }
  } catch (err) {
    console.log('[storage] MongoDB saveDailyReport failed, using local file');
  }
  // Always write local backup
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

// ── Raw jobs cache ─────────────────────────────────────

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

// ── Applications ───────────────────────────────────────

async function saveApplications(apps) {
  try {
    const db = await getDB();
    if (db) {
      for (const app of apps) {
        if (app.id) {
          await db.collection('applications').updateOne(
            { id: app.id },
            { $set: app },
            { upsert: true }
          );
        }
      }
      // Remove deleted ones: delete any id not in apps
      const ids = apps.map(a => a.id).filter(Boolean);
      await db.collection('applications').deleteMany({ id: { $nin: ids } });
    }
  } catch (err) {
    console.log('[storage] MongoDB saveApplications failed, using local file');
  }
  // Always write local backup
  try {
    const fse = require('fs-extra');
    const filePath = path.join(DATA_DIR, 'applications.json');
    await fse.outputJson(filePath, apps, { spaces: 2 });
  } catch (err) {
    console.error('Error saving applications:', err);
  }
}

async function loadApplications() {
  try {
    const db = await getDB();
    if (db) {
      const apps = await db.collection('applications').find({}).toArray();
      if (apps.length > 0) return apps;
    }
  } catch (err) {
    console.log('[storage] MongoDB loadApplications failed, using local file');
  }
  // Fallback
  try {
    const fse = require('fs-extra');
    const filePath = path.join(DATA_DIR, 'applications.json');
    if (!await fse.pathExists(filePath)) return [];
    return await fse.readJson(filePath);
  } catch (err) {
    return [];
  }
}

// ── getNewJobsOnly ─────────────────────────────────────

async function getNewJobsOnly(freshJobs) {
  const seen = await loadSeenJobs();
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
  await saveSeenJobs(seen);
  console.log(`Total jobs ever seen: ${seen.size}`);
  console.log(`New jobs today: ${newJobs.length}`);
  console.log(`Already seen before: ${freshJobs.length - newJobs.length}`);
  return newJobs;
}

module.exports = {
  loadSeenJobs, saveSeenJobs, generateJobId, filterNewJobs,
  saveDailyReport, loadReport, saveRawJobs, loadRawJobs,
  getNewJobsOnly, saveApplications, loadApplications
};
