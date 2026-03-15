const { MongoClient } = require('mongodb')

const MONGODB_URI = process.env.MONGODB_URI
const DB_NAME = 'gcc-job-agent'

let client = null
let db = null

async function connectDB() {
  if (db) return db
  if (!MONGODB_URI) {
    console.log('[MongoDB] No URI found, using local files')
    return null
  }
  try {
    client = new MongoClient(MONGODB_URI, {
      tls: true,
      tlsAllowInvalidCertificates: false,
      serverSelectionTimeoutMS: 10000,
    })
    await client.connect()
    db = client.db(DB_NAME)
    console.log('[MongoDB] Connected to Atlas')
    return db
  } catch (err) {
    console.log('[MongoDB] Connection failed:', err.message)
    return null
  }
}

async function getDB() {
  if (db) return db
  return await connectDB()
}

module.exports = { connectDB, getDB }
