'use strict';

require('dotenv').config();

const Anthropic = require('@anthropic-ai/sdk');
const { Document, Packer, Paragraph, TextRun, BorderStyle, AlignmentType } = require('docx');
const fs = require('fs');
const path = require('path');

// ═══════════════════════════════════════════════════════
// SYSTEM PROMPTS (one per candidate)
// ═══════════════════════════════════════════════════════
const SYSTEM_PROMPT = `You are writing a cover letter for Dheeraj Thiagarajan. Write it like a real human wrote it — direct, confident, and specific. No AI-sounding language.

CANDIDATE PROFILE:
Name: Dheeraj Thiagarajan
Email: dheerajt1899@gmail.com
Phone: +44 7501069543
LinkedIn: https://www.linkedin.com/in/dheeraj-t1/
Location: London, UK
Notice Period: 1 Month

Education:
- LSE MSc in Management specialising in Finance (Merit), 2023-2025
- University of Chicago Booth MBA Exchange (Merit), Aug-Dec 2024
- Newcastle University BSc Business Management and Marketing (2:1), 2018-2021

Experience:
- Investment & Partnerships Analyst, Lovemore Sports, London (Aug 2025-Present)
  Valuation models, sell-side advisory for Championship club,
  £1m+ commercial partnerships for Premier League clubs,
  six-figure brand deals for elite footballers
- Business Development Associate, G.Network, London (Jan 2022-Mar 2023)
  65%+ conversion rate, 50+ C-suite stakeholders, top 3 by revenue,
  100% KPIs, increased leads by 12%
- B2B Sales Associate, Durhamlane, Newcastle (Sep-Dec 2021)
  20% increase in new client acquisition, investment bank stakeholders

Extracurricular:
- Strategy Consultant, Castore Consulting (2023-2024): 20%+ revenue upside
- JPMorgan Chase Finance Virtual Experience (2022)
- Common Purpose Leadership Award (2020)

WRITING RULES:
1. Sound like a real human wrote this — conversational, confident, genuine
2. BANNED phrases — never use: "I am excited to", "I am passionate about", "leverage", "utilize", "synergy", "dynamic", "innovative", "thrilled", "delighted", "I would be remiss", "I am writing to express", "I am writing to apply", "Please find attached"
3. Use natural contractions: I've, I'm, I'd, it's, that's
4. Show personality — be direct and confident
5. Maximum 3 paragraphs. Each paragraph max 4 sentences.
6. Total length: 250-320 words
7. First paragraph: specific hook about the company or role — no generic openers
8. Second paragraph: 2-3 specific achievements with numbers that match the job
9. Third paragraph: brief closing, mention GCC market, availability to relocate immediately, 1 month notice, clear CTA
10. Never mention visa status or nationality
11. Do not include any sign-off, name, or closing signature — the document template handles that

Write ONLY the letter body — no subject line, no date, no address blocks. 3 paragraphs separated by blank lines.`;

const THIAGARAJAN_SYSTEM_PROMPT = `You are an expert executive career consultant writing senior-level cover letters for C-suite and Director-level positions in the automotive industry.`;

// ═══════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════

function sanitizeFileName(str) {
  return str.replace(/[^a-zA-Z0-9]/g, '');
}

function getOutputFolder() {
  const folder = path.join('data', 'cover-letters');
  if (!fs.existsSync(folder)) {
    fs.mkdirSync(folder, { recursive: true });
  }
  return folder;
}

function getTodayFormatted() {
  const d = new Date();
  const months = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
}

function getTodayISO() {
  return new Date().toISOString().split('T')[0];
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function blankLine() {
  return new Paragraph({ children: [new TextRun({ text: '', font: 'Calibri', size: 22 })] });
}

// ═══════════════════════════════════════════════════════
// CANDIDATE HEADER INFO
// ═══════════════════════════════════════════════════════

function getCandidateHeaderInfo(candidateId) {
  if (candidateId === 'thiagarajan') {
    return {
      nameDisplay: 'THIAGARAJAN SHANTHAKUMAR',
      contactLine: 'sthiagarajan111@yahoo.com | +968 95212246 | Muscat, Oman',
      linkedin: 'https://www.linkedin.com/in/thiagarajan-s-66113012/',
      titleLine: 'Head of After Sales | 38 Years Automotive Experience',
      signoffName: 'THIAGARAJAN SHANTHAKUMAR',
    };
  }
  return {
    nameDisplay: 'DHEERAJ THIAGARAJAN',
    contactLine: 'dheerajt1899@gmail.com | +44 7501069543 | London, UK',
    linkedin: 'https://www.linkedin.com/in/dheeraj-t1/',
    titleLine: 'Investment & Partnerships Analyst',
    signoffName: 'DHEERAJ THIAGARAJAN',
  };
}

// ═══════════════════════════════════════════════════════
// FUNCTION 2: saveCoverLetterDocx
// ═══════════════════════════════════════════════════════

async function saveCoverLetterDocx(job, coverLetterText, candidateId) {
  const folder = getOutputFolder();
  const companyClean = sanitizeFileName(job.company);
  const titleClean = sanitizeFileName(job.title);
  const fileName = `CoverLetter_${companyClean}_${titleClean}_${getTodayISO()}.docx`;
  const filePath = path.join(folder, fileName);

  // Strip any trailing sign-off name the AI may include despite instructions
  const signoffNames = ['Dheeraj Thiagarajan', 'DHEERAJ THIAGARAJAN', 'Thiagarajan Shanthakumar', 'THIAGARAJAN SHANTHAKUMAR'];
  const paragraphs = coverLetterText
    .split(/\n\n+/)
    .filter(p => p.trim().length > 0)
    .filter(p => !signoffNames.includes(p.trim()));
  const candInfo = getCandidateHeaderInfo(candidateId);

  const children = [];

  // Header: Name
  children.push(new Paragraph({
    children: [new TextRun({
      text: candInfo.nameDisplay,
      bold: true,
      size: 32,       // 16pt
      color: '1B2A4A',
      font: 'Calibri',
    })],
  }));

  // Header: Contact info
  children.push(new Paragraph({
    children: [new TextRun({
      text: candInfo.contactLine,
      size: 24,       // 12pt
      font: 'Calibri',
    })],
  }));

  // Header: LinkedIn
  children.push(new Paragraph({
    children: [new TextRun({
      text: candInfo.linkedin,
      size: 24,       // 12pt
      font: 'Calibri',
    })],
  }));

  // Horizontal rule (bottom border on empty paragraph)
  children.push(new Paragraph({
    border: {
      bottom: {
        color: '1B2A4A',
        space: 1,
        style: BorderStyle.SINGLE,
        size: 6,
      },
    },
    children: [new TextRun({ text: '', font: 'Calibri', size: 22 })],
  }));

  children.push(blankLine());

  // Date
  children.push(new Paragraph({
    children: [new TextRun({ text: getTodayFormatted(), size: 22, font: 'Calibri' })],
  }));

  children.push(blankLine());

  // Recipient
  children.push(new Paragraph({
    children: [new TextRun({ text: 'Hiring Manager', bold: true, size: 22, font: 'Calibri' })],
  }));
  children.push(new Paragraph({
    children: [new TextRun({ text: job.company, size: 22, font: 'Calibri' })],
  }));
  children.push(new Paragraph({
    children: [new TextRun({ text: job.location, size: 22, font: 'Calibri' })],
  }));

  children.push(blankLine());

  // Subject line
  children.push(new Paragraph({
    children: [new TextRun({ text: `Re: ${job.title}`, bold: true, size: 22, font: 'Calibri' })],
  }));

  children.push(blankLine());

  // Body paragraphs
  for (const para of paragraphs) {
    children.push(new Paragraph({
      alignment: AlignmentType.JUSTIFIED,
      children: [new TextRun({ text: para.trim(), size: 22, font: 'Calibri' })],
    }));
    children.push(blankLine());
  }

  // Closing
  children.push(new Paragraph({
    children: [new TextRun({ text: 'Yours sincerely,', size: 22, font: 'Calibri' })],
  }));

  children.push(blankLine());

  children.push(new Paragraph({
    children: [new TextRun({ text: candInfo.signoffName, bold: true, size: 22, font: 'Calibri' })],
  }));

  const doc = new Document({
    sections: [{
      properties: {
        page: {
          size: {
            width: 11906,   // A4 width in twips
            height: 16838,  // A4 height in twips
          },
          margin: {
            top: 1417,      // 2.5cm in twips
            right: 1417,
            bottom: 1417,
            left: 1417,
          },
        },
      },
      children,
    }],
  });

  const buffer = await Packer.toBuffer(doc);
  fs.writeFileSync(filePath, buffer);

  return filePath;
}

// ═══════════════════════════════════════════════════════
// FUNCTION 1: generateCoverLetter
// ═══════════════════════════════════════════════════════

async function generateCoverLetter(job, candidateId) {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY is not set in environment variables. Please add it to your .env file.');
  }

  const client = new Anthropic();

  let systemPrompt, userMessage;

  if (candidateId === 'thiagarajan') {
    systemPrompt = THIAGARAJAN_SYSTEM_PROMPT;
    userMessage = `Write a professional executive cover letter for Thiagarajan Shanthakumar applying for the role of ${job.title} at ${job.company} in ${job.location}.

CANDIDATE PROFILE:
Name: Thiagarajan Shanthakumar
Current Role: Head of After Sales, Mohsin Haider Darwish, Muscat
Total Experience: 38 years in Automotive After Sales
OEM Experience: 14 years (Eicher Motors, Ashok Leyland)
GCC Experience: 24 years (Oman Trading Establishment, Lootah Group, MHD)
Education: MBA + Mechanical Engineering Diploma
LinkedIn: https://www.linkedin.com/in/thiagarajan-s-66113012/
Target Salary: AED 47,000/month
Location: Available to relocate anywhere in GCC, preference Dubai

KEY ACHIEVEMENTS TO HIGHLIGHT:
- General Motors Grandmaster Award (multiple years)
- Best Global After Sales Dealer Award 2021 from Isuzu Motors
- Best of the Best Service Manager Award from General Motors
- Managed 700+ multinational workforce
- 24 years GCC experience across multiple OEM brands
- Successfully established new dealership in UAE (Lootah Group)
- Record-high customer satisfaction and retention achievements
- Proven P&L management and profit centre leadership
- Multi-brand expertise: GM, Isuzu, Hyundai, Cadillac, McLaren, JLR, MG, Changan, Jetour, Hongqi, Alfa Romeo

CURRENT COMPANY BRANDS:
Jeep, Dodge, Ram, Alfa Romeo, McLaren, MG, JLR, Jetour, Hongqi

JOB DESCRIPTION:
${job.description || 'Not provided'}

WRITING GUIDELINES:
- Senior executive tone — confident, authoritative
- Highlight 38 years of progressive leadership
- Emphasise GCC market knowledge (24 years)
- Mention relevant OEM awards and recognition
- Show P&L and profit centre experience
- Reference team management at scale (700+ staff)
- Keep to 3-4 paragraphs, professional format
- Do NOT mention visa or work permit status
- End with strong call to action for interview`;
  } else {
    systemPrompt = SYSTEM_PROMPT;
    userMessage = `Write a cover letter for Dheeraj Thiagarajan applying for ${job.title} at ${job.company}.

Candidate profile: Dheeraj Thiagarajan — LSE MSc Finance (Merit), Chicago Booth MBA Exchange (Merit), Investment & Partnerships Analyst at Lovemore Sports (£1m+ Premier League partnerships, six-figure brand deals), former BD Associate at G.Network (65%+ conversion rate, top 3 by revenue), Strategy Consultant at Castore Consulting (20%+ revenue upside). Based in London, 1 month notice, available to relocate immediately.

Job details:
Title: ${job.title}
Company: ${job.company}
Location: ${job.location}
Description: ${job.description}`;
  }

  let coverLetterText;
  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    });
    coverLetterText = response.content[0].text;
  } catch (err) {
    console.error(`Error calling Claude API for ${job.title} at ${job.company}:`, err.message);
    throw err;
  }

  const filePath = await saveCoverLetterDocx(job, coverLetterText, candidateId);
  return { text: coverLetterText, filePath };
}

// ═══════════════════════════════════════════════════════
// FUNCTION 3: generateForTierOneAndTwo
// ═══════════════════════════════════════════════════════

async function generateForTierOneAndTwo(jobs) {
  const qualifying = jobs.filter(j => j.tier === 1 || j.tier === 2);
  const results = [];

  for (const job of qualifying) {
    console.log(`Generating cover letter for ${job.title} at ${job.company}...`);
    try {
      const { text, filePath } = await generateCoverLetter(job, job.candidateId || 'dheeraj');
      results.push({ job, filePath, text });
    } catch (err) {
      console.error(`Failed for ${job.title} at ${job.company}:`, err.message);
    }
    await delay(2000);
  }

  console.log(`Generated ${results.length} cover letters in data/cover-letters/`);
  return results;
}

// ═══════════════════════════════════════════════════════
// FUNCTION 4: generateSingleCoverLetter
// ═══════════════════════════════════════════════════════

async function generateSingleCoverLetter(job, candidateId) {
  return generateCoverLetter(job, candidateId || job.candidateId || 'dheeraj');
}

// ═══════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════

module.exports = { generateCoverLetter, saveCoverLetterDocx, generateForTierOneAndTwo, generateSingleCoverLetter };

// ═══════════════════════════════════════════════════════
// TEST BLOCK
// ═══════════════════════════════════════════════════════

if (require.main === module) {
  const testJob = {
    title: 'Business Development Manager',
    company: 'Emirates Group',
    location: 'Dubai',
    tier: 1,
    tierLabel: 'APPLY TODAY',
    description: 'We are looking for a results-driven BD Manager to lead enterprise client acquisition and revenue growth across our commercial division in Dubai. The role involves managing C-suite relationships, developing new business pipelines and driving strategic partnerships.',
  };

  (async () => {
    try {
      console.log('Generating cover letter for test job...\n');
      const { text, filePath } = await generateSingleCoverLetter(testJob);

      console.log('═══════════════════════════════════════════════════════');
      console.log('COVER LETTER TEXT:');
      console.log('═══════════════════════════════════════════════════════');
      console.log(text);
      console.log('\n═══════════════════════════════════════════════════════');
      console.log('FILE SAVED TO:', filePath);
      console.log('FILE EXISTS:', fs.existsSync(filePath));
      console.log('═══════════════════════════════════════════════════════');
    } catch (err) {
      console.error('Error:', err.message);
      process.exit(1);
    }
  })();
}
