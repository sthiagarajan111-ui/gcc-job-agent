require('dotenv').config()
const { connectDB } = require('./mongodb')
const fs = require('fs')
const path = require('path')

async function migrate() {
  const db = await connectDB()
  if (!db) {
    console.log('No MongoDB connection')
    process.exit(1)
  }

  const dataDir = path.join(__dirname, '../data')

  // 1. Migrate all report JSON files
  const files = fs.readdirSync(dataDir)
    .filter(f => f.startsWith('report-') && f.endsWith('.json'))

  let totalJobs = 0
  for (const file of files) {
    try {
      const jobs = JSON.parse(fs.readFileSync(path.join(dataDir, file), 'utf8'))
      const arr = Array.isArray(jobs) ? jobs : (jobs.jobs || [])
      for (const job of arr) {
        if (job.id) {
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
