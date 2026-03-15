require('dotenv').config()
const { connectDB } = require('./mongodb')
const fs = require('fs')
const path = require('path')

const validDate = d => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)

async function migrate() {
  const db = await connectDB()
  if (!db) {
    console.log('No MongoDB connection')
    process.exit(1)
  }

  const dataDir = path.join(__dirname, '../data')
  const today = new Date().toISOString().split('T')[0]

  // 1. Migrate all report JSON files
  const files = fs.readdirSync(dataDir)
    .filter(f => f.startsWith('report-') && f.endsWith('.json'))

  let totalJobs = 0
  for (const file of files) {
    try {
      const fileDate = (file.match(/report-(\d{4}-\d{2}-\d{2})\.json/) || [])[1] || today
      const jobs = JSON.parse(fs.readFileSync(path.join(dataDir, file), 'utf8'))
      const arr = Array.isArray(jobs) ? jobs : (jobs.jobs || [])
      for (const job of arr) {
        if (job.id) {
          if (!validDate(job.dateAdded)) job.dateAdded = fileDate
          await db.collection('jobs').updateOne(
            { id: job.id },
            { $set: job },
            { upsert: true }
          )
          totalJobs++
        }
      }
      console.log(`Migrated ${file}: ${arr.length} jobs`)
    } catch (err) {
      console.log(`Skipped ${file}: ${err.message}`)
    }
  }
  console.log(`Total jobs migrated: ${totalJobs}`)

  // 1b. Fix any remaining MongoDB jobs with invalid dateAdded
  const allMongoJobs = await db.collection('jobs').find({}).toArray()
  let fixedCount = 0
  for (const job of allMongoJobs) {
    if (!validDate(job.dateAdded)) {
      const fixed = validDate(job.date) ? job.date
        : validDate(job.postedDate) ? job.postedDate
        : today
      await db.collection('jobs').updateOne(
        { _id: job._id },
        { $set: { dateAdded: fixed } }
      )
      fixedCount++
    }
  }
  if (fixedCount > 0) console.log(`Fixed ${fixedCount} MongoDB jobs with invalid dateAdded`)
  const validCount = allMongoJobs.length - fixedCount + fixedCount // re-query not needed; all are now valid
  const totalValid = await db.collection('jobs').countDocuments()
  console.log('Recent dateAdded fix complete')
  console.log(`Jobs with valid dateAdded: ${totalValid}`)

  // 2. Migrate applications
  const appsFile = path.join(dataDir, 'applications.json')
  if (fs.existsSync(appsFile)) {
    const apps = JSON.parse(fs.readFileSync(appsFile, 'utf8'))
    const arr = Array.isArray(apps) ? apps : []
    for (const app of arr) {
      if (app.id) {
        await db.collection('applications').updateOne(
          { id: app.id },
          { $set: app },
          { upsert: true }
        )
      }
    }
    console.log(`Migrated ${arr.length} applications`)
  }

  // 3. Migrate manual jobs
  const manualFile = path.join(dataDir, 'manual-jobs.json')
  if (fs.existsSync(manualFile)) {
    const jobs = JSON.parse(fs.readFileSync(manualFile, 'utf8'))
    const arr = Array.isArray(jobs) ? jobs : []
    for (const job of arr) {
      if (job.id) {
        await db.collection('manual_jobs').updateOne(
          { id: job.id },
          { $set: job },
          { upsert: true }
        )
      }
    }
    console.log(`Migrated ${arr.length} manual jobs`)
  }

  // 4. Migrate blocked jobs
  const blockedFile = path.join(dataDir, 'blocked-jobs.json')
  if (fs.existsSync(blockedFile)) {
    const blocked = JSON.parse(fs.readFileSync(blockedFile, 'utf8'))
    const arr = Array.isArray(blocked) ? blocked : []
    await db.collection('blocked_jobs').updateOne(
      { _id: 'blocked' },
      { $set: { ids: arr } },
      { upsert: true }
    )
    console.log(`Migrated ${arr.length} blocked jobs`)
  }

  // 5. Migrate seen jobs
  const seenFile = path.join(dataDir, 'seen_jobs.json')
  if (fs.existsSync(seenFile)) {
    const seen = JSON.parse(fs.readFileSync(seenFile, 'utf8'))
    const arr = Array.isArray(seen) ? seen : []
    await db.collection('seen_jobs').updateOne(
      { _id: 'seen' },
      { $set: { ids: arr } },
      { upsert: true }
    )
    console.log(`Migrated ${arr.length} seen job IDs`)
  }

  console.log('Migration complete!')
  process.exit(0)
}

migrate().catch(console.error)
