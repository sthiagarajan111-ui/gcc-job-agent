require('dotenv').config();
const fs = require('fs-extra');
const path = require('path');
const { google } = require('googleapis');
const readline = require('readline');
const { updateStatus } = require('./appTracker');

const CREDENTIALS_PATH = path.join(__dirname, '../data/gmail-credentials.json');
const TOKEN_PATH = path.join(__dirname, '../data/gmail-token.json');
const APPLICATIONS_PATH = path.join(__dirname, '../data/applications.json');
const SCAN_LOG_PATH = path.join(__dirname, '../data/gmail-scan-log.json');

const SCOPES = ['https://www.googleapis.com/auth/gmail.readonly'];

const SETUP_INSTRUCTIONS = `GMAIL SCANNER SETUP REQUIRED:
1. Go to https://console.cloud.google.com
2. Create a new project called 'GCC Job Agent'
3. Enable the Gmail API
4. Go to Credentials → Create OAuth 2.0 Client ID
5. Application type: Desktop App
6. Download the JSON file
7. Save it as: data/gmail-credentials.json
8. Run node src/gmailScanner.js again to authorize`;

const INTERVIEW_KEYWORDS = [
  'interview', 'schedule a call', 'schedule a meeting',
  'would like to meet', 'invite you to interview',
  'next steps', 'move forward', 'shortlisted',
  'pleased to invite', 'assessment', 'video call',
  'zoom call', 'teams call', 'phone screen',
  'we would like to speak', 'proceed with your application',
];

const OFFER_KEYWORDS = [
  'offer', 'pleased to offer', 'job offer', 'offer letter',
  'congratulations', 'welcome to the team', 'onboarding',
  'start date', 'salary package', 'employment contract',
  'we are delighted', 'formal offer',
];

const REJECTION_KEYWORDS = [
  'unfortunately', 'regret to inform', 'not successful',
  'not moving forward', 'other candidates', 'not shortlisted',
  'decided not to proceed', 'position has been filled',
  'not selected', 'we will not', 'thank you for applying but',
  'keep your cv on file', 'future opportunities',
];

const SCREENING_KEYWORDS = [
  'screening', 'initial call', 'quick call', 'introductory call',
  'hr call', 'recruiter call', 'pre-screen', 'first round',
  'preliminary', 'want to learn more about you',
];

async function getGmailClient() {
  if (!fs.existsSync(CREDENTIALS_PATH)) {
    console.log(SETUP_INSTRUCTIONS);
    return null;
  }

  const credentials = fs.readJsonSync(CREDENTIALS_PATH);
  const { client_secret, client_id, redirect_uris } = credentials.installed || credentials.web;
  const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);

  if (fs.existsSync(TOKEN_PATH)) {
    const token = fs.readJsonSync(TOKEN_PATH);
    oAuth2Client.setCredentials(token);
    return google.gmail({ version: 'v1', auth: oAuth2Client });
  }

  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
  });

  console.log('Authorize this app by visiting this URL:\n', authUrl);

  const code = await new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question('\nEnter the authorization code from the page: ', (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });

  const { tokens } = await oAuth2Client.getToken(code);
  oAuth2Client.setCredentials(tokens);
  fs.ensureDirSync(path.dirname(TOKEN_PATH));
  fs.writeJsonSync(TOKEN_PATH, tokens, { spaces: 2 });
  console.log('Token saved to', TOKEN_PATH);

  return google.gmail({ version: 'v1', auth: oAuth2Client });
}

async function scanInbox(daysBack = 7) {
  const gmail = await getGmailClient();
  if (!gmail) return [];

  const query = `in:inbox newer_than:${daysBack}d`;
  const listRes = await gmail.users.messages.list({ userId: 'me', q: query, maxResults: 100 });
  const messages = (listRes.data.messages || []);

  const results = [];

  for (const msg of messages) {
    try {
      const msgRes = await gmail.users.messages.get({ userId: 'me', id: msg.id, format: 'full' });
      const payload = msgRes.data.payload;
      const headers = payload.headers || [];

      const getHeader = (name) => {
        const h = headers.find(h => h.name.toLowerCase() === name.toLowerCase());
        return h ? h.value : '';
      };

      const subject = getHeader('Subject');
      const sender = getHeader('From');
      const date = getHeader('Date');
      const bodySnippet = msgRes.data.snippet || '';

      let bodyText = bodySnippet;
      if (payload.parts) {
        for (const part of payload.parts) {
          if (part.mimeType === 'text/plain' && part.body && part.body.data) {
            bodyText = Buffer.from(part.body.data, 'base64').toString('utf8');
            break;
          }
        }
      } else if (payload.body && payload.body.data) {
        bodyText = Buffer.from(payload.body.data, 'base64').toString('utf8');
      }

      const detectedType = detectEmailType(subject, bodyText);
      const matchedApplication = matchToApplication(sender, subject, bodyText);

      results.push({
        messageId: msg.id,
        sender,
        subject,
        date,
        detectedType,
        matchedApplication,
        bodySnippet: bodySnippet.slice(0, 300),
      });
    } catch (err) {
      console.error(`[ERROR] Could not fetch message ${msg.id}:`, err.message);
    }
  }

  return results;
}

function detectEmailType(subject, body) {
  const text = (subject + ' ' + body).toLowerCase();

  for (const kw of OFFER_KEYWORDS) {
    if (text.includes(kw.toLowerCase())) return 'Offer';
  }
  for (const kw of INTERVIEW_KEYWORDS) {
    if (text.includes(kw.toLowerCase())) return 'Interview';
  }
  for (const kw of SCREENING_KEYWORDS) {
    if (text.includes(kw.toLowerCase())) return 'Screening';
  }
  for (const kw of REJECTION_KEYWORDS) {
    if (text.includes(kw.toLowerCase())) return 'Rejected';
  }

  return 'Unknown';
}

function matchToApplication(sender, subject, body) {
  if (!fs.existsSync(APPLICATIONS_PATH)) return null;
  const applications = fs.readJsonSync(APPLICATIONS_PATH);

  const senderLower = sender.toLowerCase();
  const subjectLower = subject.toLowerCase();
  const bodyLower = body.toLowerCase();

  const normalizeName = (name) => name.toLowerCase().replace(/[^a-z0-9]/g, '');

  for (const app of applications) {
    const company = app.company || '';
    const jobTitle = app.jobTitle || '';
    const companyNorm = normalizeName(company);
    const companyWords = company.toLowerCase().split(/\s+/).filter(w => w.length > 2);

    // Strategy 1: sender domain matches company name
    const domainMatch = companyWords.some(word => senderLower.includes(word));
    if (domainMatch) return app;

    // Strategy 2: subject contains job title
    if (jobTitle && subjectLower.includes(jobTitle.toLowerCase())) return app;

    // Strategy 3: subject contains company name
    if (company && subjectLower.includes(company.toLowerCase())) return app;

    // Strategy 4: body contains both job title and company name
    if (
      jobTitle && company &&
      bodyLower.includes(jobTitle.toLowerCase()) &&
      bodyLower.includes(company.toLowerCase())
    ) return app;
  }

  return null;
}

async function processNewEmails(daysBack = 7) {
  const emails = await scanInbox(daysBack);

  let updated = 0;
  let unmatched = 0;
  let offers = 0;
  let interviews = 0;
  let rejections = 0;

  for (const email of emails) {
    if (email.detectedType === 'Unknown') continue;

    if (email.detectedType === 'Offer') offers++;
    else if (email.detectedType === 'Interview') interviews++;
    else if (email.detectedType === 'Rejected') rejections++;

    if (email.matchedApplication) {
      const app = email.matchedApplication;
      updateStatus(app.id, email.detectedType, `Auto-detected via Gmail scan: ${email.subject}`);
      console.log(`✅ Updated ${app.company} — ${app.jobTitle} to ${email.detectedType}`);
      updated++;
    } else {
      console.log(`⚠️  Unmatched recruiter email: ${email.subject} from ${email.sender}`);
      unmatched++;
    }
  }

  const scanEntry = {
    scanDate: new Date().toISOString(),
    emailsFound: emails.length,
    updated,
    unmatched,
  };

  let log = [];
  if (fs.existsSync(SCAN_LOG_PATH)) {
    try { log = fs.readJsonSync(SCAN_LOG_PATH); } catch (_) { log = []; }
  }
  log.push(scanEntry);
  fs.ensureDirSync(path.dirname(SCAN_LOG_PATH));
  fs.writeJsonSync(SCAN_LOG_PATH, log, { spaces: 2 });

  const summary = { scanned: emails.length, updated, unmatched, offers, interviews, rejections };
  return summary;
}

async function getLastScanSummary() {
  if (!fs.existsSync(SCAN_LOG_PATH)) return null;
  try {
    const log = fs.readJsonSync(SCAN_LOG_PATH);
    return log.length > 0 ? log[log.length - 1] : null;
  } catch (_) {
    return null;
  }
}

module.exports = {
  getGmailClient,
  scanInbox,
  detectEmailType,
  matchToApplication,
  processNewEmails,
  getLastScanSummary,
};

if (require.main === module) {
  (async () => {
    console.log('\n=== TEST 1: detectEmailType — all 4 types ===\n');

    const resultA = detectEmailType(
      'Interview Invitation — Business Development Role',
      'We would like to invite you for an interview next week'
    );
    console.log(`Test A — Expected: Interview | Got: ${resultA} | ${resultA === 'Interview' ? 'PASS' : 'FAIL'}`);

    const resultB = detectEmailType(
      'Your application to Goldman Sachs',
      'Unfortunately we will not be moving forward with your application'
    );
    console.log(`Test B — Expected: Rejected  | Got: ${resultB} | ${resultB === 'Rejected' ? 'PASS' : 'FAIL'}`);

    const resultC = detectEmailType(
      'Congratulations — Job Offer',
      'We are pleased to offer you the position with a salary package'
    );
    console.log(`Test C — Expected: Offer     | Got: ${resultC} | ${resultC === 'Offer' ? 'PASS' : 'FAIL'}`);

    const resultD = detectEmailType(
      'Quick screening call — Emaar Properties',
      'We would like to schedule a quick HR screening call'
    );
    console.log(`Test D — Expected: Screening | Got: ${resultD} | ${resultD === 'Screening' ? 'PASS' : 'FAIL'}`);

    console.log('\n=== TEST 2: Gmail credentials setup check ===\n');
    if (!fs.existsSync(CREDENTIALS_PATH)) {
      console.log('Credentials file not found. Printing setup instructions:\n');
      const client = await getGmailClient();
      if (!client) console.log('\n(getGmailClient returned null as expected)');
    } else {
      console.log('Gmail credentials found — ready to scan');
    }
  })();
}
