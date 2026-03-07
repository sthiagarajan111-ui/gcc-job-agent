'use strict';

require('dotenv').config();

const Anthropic = require('@anthropic-ai/sdk');
const { Document, Packer, Paragraph, TextRun, BorderStyle } = require('docx');
const fs = require('fs');
const path = require('path');

// ═══════════════════════════════════════════════════════
// SYSTEM PROMPTS (one per candidate)
// ═══════════════════════════════════════════════════════
const SYSTEM_PROMPT = `You are writing a professional cover letter for Dheeraj Thiagarajan. Follow these rules exactly:

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

Key Strengths:
- LSE and Chicago Booth dual postgraduate credentials
- Proven B2B sales with 65%+ conversion rate
- Financial modelling and valuation experience
- C-suite stakeholder engagement
- Sports finance and commercial partnerships
- Strategy consulting experience

COVER LETTER WRITING RULES:
1. Length: 3 paragraphs, maximum 350 words total
2. Tone: Confident, commercial, results-focused — not generic
3. Opening paragraph: Show genuine knowledge of the company and role, reference specific things about the company if known
4. Middle paragraph: Pick the 2-3 most relevant experiences from Dheeraj's background that match this specific job. Always include specific numbers and achievements.
5. Closing paragraph: Express enthusiasm for the GCC market, mention availability to relocate immediately, notice period of 1 month, and a clear call to action.
6. Never mention visa status or nationality.
7. Never use clichés like "I am writing to apply" or "Please find attached my CV"
8. Sign off as: Dheeraj Thiagarajan

Write ONLY the body of the cover letter (3 paragraphs), starting directly with the first paragraph. Do not include headers, date, recipient address, subject line, or signature — just the 3 paragraphs of body text separated by blank lines.`;

const THIAGARAJAN_SYSTEM_PROMPT = `You are writing a professional cover letter for Thiagarajan Shanthakumar. Follow these rules exactly:

CANDIDATE PROFILE:
Name: Thiagarajan Shanthakumar
Email: sthiagarajan111@gmail.com
LinkedIn: https://www.linkedin.com/in/thiagarajan-s-66113012/
Location: Muscat, Oman
Notice Period: 1 Month
Target Salary: AED 47,000/month

Experience:
- 35 years of experience in After Sales management across the GCC region
- Current/Most Recent Title: Head of After Sales
- Senior leadership expertise in service operations, warranty management, P&L responsibility
- GCC market expertise with deep knowledge of automotive and service industries
- Team leadership, customer satisfaction, and operational excellence focus

Key Strengths:
- 35 years of After Sales management experience — one of the most experienced in the GCC
- Proven track record in senior leadership roles
- Deep GCC market knowledge and relationships
- P&L management and profitability focus
- Service operations transformation and process improvement

COVER LETTER WRITING RULES:
1. Length: 3 paragraphs, maximum 350 words total
2. Tone: Professional, senior executive — authoritative and results-focused
3. Opening paragraph: Show genuine knowledge of the company and role, reference specific things about the company if known
4. Middle paragraph: Pick the 2-3 most relevant experiences from Thiagarajan's background. Emphasise the 35 years of After Sales expertise, GCC market knowledge, and leadership track record.
5. Closing paragraph: Express enthusiasm for the role, mention availability with 1 month notice, Dubai/GCC location preference, and a clear call to action.
6. Never mention visa status or nationality.
7. Never use clichés like "I am writing to apply" or "Please find attached my CV"
8. Sign off as: Thiagarajan Shanthakumar

Write ONLY the body of the cover letter (3 paragraphs), starting directly with the first paragraph. Do not include headers, date, recipient address, subject line, or signature — just the 3 paragraphs of body text separated by blank lines.`;

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
      contactLine: 'sthiagarajan111@gmail.com | Muscat, Oman',
      linkedin: 'https://www.linkedin.com/in/thiagarajan-s-66113012/',
      titleLine: 'Head of After Sales',
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

  const paragraphs = coverLetterText.split(/\n\n+/).filter(p => p.trim().length > 0);
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
  children.push(new Paragraph({
    children: [new TextRun({ text: candInfo.titleLine, size: 22, font: 'Calibri' })],
  }));
  children.push(new Paragraph({
    children: [new TextRun({ text: candInfo.contactLine, size: 22, font: 'Calibri' })],
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

  const systemPrompt = candidateId === 'thiagarajan' ? THIAGARAJAN_SYSTEM_PROMPT : SYSTEM_PROMPT;

  const userMessage = `Write a cover letter for this job:
Title: ${job.title}
Company: ${job.company}
Location: ${job.location}
Job Description: ${job.description}`;

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
