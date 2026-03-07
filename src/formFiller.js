const puppeteer = require('puppeteer');

// ─── Candidate Profile ───────────────────────────────────────────────────────
const CANDIDATE = {
  firstName:             'Dheeraj',
  lastName:              'Thiagarajan',
  fullName:              'Dheeraj Thiagarajan',
  email:                 'dheerajt1899@gmail.com',
  phone:                 '+44 7501069543',
  linkedin:              'https://www.linkedin.com/in/dheeraj-t1/',
  location:              'London, UK',
  city:                  'London',
  country:               'United Kingdom',
  noticePeriod:          '1 Month',
  currentSalary:         '35000',
  expectedSalary:        '18000',
  currentCompany:        'Lovemore Sports',
  currentTitle:          'Investment and Partnerships Analyst',
  yearsExperience:       '4',
  university:            'London School of Economics',
  degree:                'MSc Management Finance',
  graduationYear:        '2025',
};

// ─── Field Mapping ────────────────────────────────────────────────────────────
// Each entry: { keywords: [...], value, type: 'text'|'select' }
const FIELD_MAP = [
  {
    keywords: ['full name', 'fullname', 'your name'],
    // 'name' alone would be too broad — handled separately below
    value: CANDIDATE.fullName,
  },
  {
    keywords: ['first name', 'firstname', 'first_name', 'fname', 'given name'],
    value: CANDIDATE.firstName,
  },
  {
    keywords: ['last name', 'lastname', 'last_name', 'lname', 'surname', 'family name'],
    value: CANDIDATE.lastName,
  },
  {
    keywords: ['email', 'e-mail', 'email address'],
    typeMatch: 'email',
    value: CANDIDATE.email,
  },
  {
    keywords: ['phone', 'mobile', 'telephone', 'contact number', 'tel'],
    typeMatch: 'tel',
    value: CANDIDATE.phone,
  },
  {
    keywords: ['linkedin', 'linked in', 'linkedin url', 'linkedin profile'],
    value: CANDIDATE.linkedin,
  },
  {
    keywords: ['location', 'city', 'current location', 'where are you based'],
    value: CANDIDATE.location,
  },
  {
    keywords: ['country', 'country of residence'],
    value: CANDIDATE.country,
  },
  {
    keywords: ['notice period', 'notice', 'availability', 'available from'],
    value: CANDIDATE.noticePeriod,
  },
  {
    keywords: ['current salary', 'current ctc', 'present salary'],
    value: CANDIDATE.currentSalary,
  },
  {
    keywords: ['expected salary', 'desired salary', 'salary expectation', 'target salary', 'minimum salary', 'salary requirement'],
    value: CANDIDATE.expectedSalary,
  },
  {
    keywords: ['current company', 'current employer', 'present company', 'current organization'],
    value: CANDIDATE.currentCompany,
  },
  {
    keywords: ['current title', 'current position', 'current role', 'job title', 'position title'],
    value: CANDIDATE.currentTitle,
  },
  {
    keywords: ['years of experience', 'years experience', 'total experience', 'work experience years'],
    value: CANDIDATE.yearsExperience,
  },
  {
    keywords: ['university', 'college', 'institution', 'school', 'education'],
    value: CANDIDATE.university,
  },
  {
    keywords: ['degree', 'qualification', 'highest qualification'],
    value: CANDIDATE.degree,
  },
  {
    keywords: ['graduation year', 'year of graduation', 'passing year'],
    value: CANDIDATE.graduationYear,
  },
];

// Keywords that indicate a visa/work permit field — must be skipped
const VISA_KEYWORDS = [
  'visa', 'work permit', 'right to work', 'work authorization',
  'sponsorship', 'work eligibility',
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function normalize(str) {
  return (str || '').toLowerCase().trim();
}

/**
 * Returns the candidate value to fill, or null if the field should be skipped.
 * fieldAttrs: { name, id, placeholder, ariaLabel, type }
 */
function matchField(fieldAttrs) {
  const haystack = [
    fieldAttrs.name,
    fieldAttrs.id,
    fieldAttrs.placeholder,
    fieldAttrs.ariaLabel,
  ].map(normalize).join(' ');

  const inputType = normalize(fieldAttrs.type);

  // Skip visa/work permit fields
  for (const kw of VISA_KEYWORDS) {
    if (haystack.includes(kw)) return null;
  }

  // Skip cover letter
  const coverLetterKws = ['cover letter', 'covering letter', 'motivation letter'];
  for (const kw of coverLetterKws) {
    if (haystack.includes(kw)) return null;
  }

  // Try each mapping entry
  for (const entry of FIELD_MAP) {
    // keyword match
    for (const kw of entry.keywords) {
      if (haystack.includes(kw)) return entry.value;
    }
    // type attribute match (email / tel)
    if (entry.typeMatch && inputType === entry.typeMatch) return entry.value;
  }

  // Fallback: bare "name" in attributes → full name (only if nothing else matched)
  if (haystack.includes('name') && !haystack.includes('company') && !haystack.includes('username') && !haystack.includes('user')) {
    return CANDIDATE.fullName;
  }

  return null;
}

// ─── Core Functions ───────────────────────────────────────────────────────────

/**
 * Fills all detected form fields on the page.
 * Returns filledCount.
 */
async function fillAllFields(page) {
  const elements = await page.$$('input, textarea, select');
  let filledCount = 0;

  for (const el of elements) {
    const attrs = await page.evaluate(node => ({
      tag:         node.tagName.toLowerCase(),
      type:        node.getAttribute('type') || '',
      name:        node.getAttribute('name') || '',
      id:          node.getAttribute('id') || '',
      placeholder: node.getAttribute('placeholder') || '',
      ariaLabel:   node.getAttribute('aria-label') || '',
    }), el);

    // Skip hidden, submit, button, checkbox, radio, file inputs
    const skipTypes = ['hidden', 'submit', 'button', 'image', 'reset', 'checkbox', 'radio', 'file'];
    if (skipTypes.includes(attrs.type.toLowerCase())) continue;

    const value = matchField(attrs);
    if (value === null) continue;

    if (attrs.tag === 'select') {
      // Try to select the best matching option
      const filled = await page.evaluate((node, val) => {
        const lower = val.toLowerCase();
        for (const opt of node.options) {
          if (opt.text.toLowerCase().includes(lower) || opt.value.toLowerCase().includes(lower)) {
            node.value = opt.value;
            node.dispatchEvent(new Event('change', { bubbles: true }));
            return true;
          }
        }
        return false;
      }, el, value);

      if (filled) {
        // Highlight
        await page.evaluate(node => {
          node.style.backgroundColor = '#FFFF99';
          node.style.border = '2px solid #FFA500';
          node.style.transition = 'background-color 0.3s ease';
        }, el);
        filledCount++;
      }
    } else {
      // input / textarea — set value directly and fire events (works with React/Angular)
      await page.evaluate((node, val) => {
        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
          node.tagName === 'TEXTAREA'
            ? window.HTMLTextAreaElement.prototype
            : window.HTMLInputElement.prototype,
          'value'
        );
        if (nativeInputValueSetter) {
          nativeInputValueSetter.set.call(node, val);
        } else {
          node.value = val;
        }
        node.dispatchEvent(new Event('input',  { bubbles: true }));
        node.dispatchEvent(new Event('change', { bubbles: true }));
      }, el, value);

      // Highlight
      await page.evaluate(node => {
        node.style.backgroundColor = '#FFFF99';
        node.style.border = '2px solid #FFA500';
        node.style.transition = 'background-color 0.3s ease';
      }, el);

      filledCount++;
    }
  }

  return filledCount;
}

/**
 * Injects a fixed review overlay at the top of the page.
 */
async function injectOverlay(page, filledCount) {
  await page.evaluate(count => {
    // Remove any existing overlay
    const existing = document.getElementById('gcc-job-agent-overlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'gcc-job-agent-overlay';
    overlay.style.cssText = [
      'position: fixed',
      'top: 0',
      'left: 0',
      'width: 100%',
      'background: #1B2A4A',
      'color: white',
      'padding: 15px 20px',
      'font: bold 14px Arial, sans-serif',
      'z-index: 999999',
      'box-sizing: border-box',
      'display: flex',
      'justify-content: space-between',
      'align-items: flex-start',
    ].join(';');

    const msg = document.createElement('span');
    msg.innerHTML =
      `\u2705 GCC Job Agent has auto-filled <strong>${count}</strong> field(s).<br>` +
      `Please review all highlighted fields in yellow, attach your CV, ` +
      `and click Submit when ready.<br>` +
      `Visa fields have been left blank intentionally.`;
    overlay.appendChild(msg);

    const closeBtn = document.createElement('button');
    closeBtn.textContent = '\u2715';
    closeBtn.style.cssText = [
      'background: transparent',
      'border: 1px solid white',
      'color: white',
      'font-size: 16px',
      'cursor: pointer',
      'padding: 2px 8px',
      'margin-left: 20px',
      'flex-shrink: 0',
    ].join(';');
    closeBtn.onclick = () => overlay.remove();
    overlay.appendChild(closeBtn);

    document.body.insertBefore(overlay, document.body.firstChild);
  }, filledCount);
}

// ─── Portal Detection ─────────────────────────────────────────────────────────

function detectPortal(url) {
  if (url.includes('linkedin.com')) {
    return {
      portal: 'LinkedIn',
      instruction: "Click the 'Easy Apply' or 'Apply' button to open the application form",
      applyButtonSelectors: [
        '.jobs-apply-button',
        'button[aria-label*="Easy Apply"]',
        'button[aria-label*="Apply"]',
        '.jobs-s-apply button',
      ],
    };
  }
  if (url.includes('michaelpage.com')) {
    return {
      portal: 'Michael Page',
      instruction: "Click the 'Apply Now' button to open the application form",
      applyButtonSelectors: [
        'a[href*="apply"]',
        'button.apply',
        '.apply-button',
        'a.btn-apply',
        '[data-apply]',
      ],
    };
  }
  if (url.includes('bayt.com')) {
    return {
      portal: 'Bayt',
      instruction: "Click the 'Apply for Job' button",
      applyButtonSelectors: [
        '#apply-button',
        '.apply-for-job',
        'a[href*="apply"]',
        'button[id*="apply"]',
      ],
    };
  }
  if (url.includes('gulftalent.com')) {
    return {
      portal: 'GulfTalent',
      instruction: "Click the 'Apply Now' button",
      applyButtonSelectors: [
        '.apply-now',
        'a[href*="apply"]',
        'button.apply-now',
      ],
    };
  }
  if (url.includes('naukrigulf.com')) {
    return {
      portal: 'Naukrigulf',
      instruction: "Click the 'Apply' button",
      applyButtonSelectors: [
        '#apply-button',
        '.apply-btn',
        'button[id*="apply"]',
      ],
    };
  }
  if (url.includes('hays.com')) {
    return {
      portal: 'Hays',
      instruction: "Click the 'Apply Now' button",
      applyButtonSelectors: [
        '.apply-now-btn',
        'a[href*="apply"]',
        'button.apply',
      ],
    };
  }
  if (url.includes('roberthalf.com')) {
    return {
      portal: 'Robert Half',
      instruction: "Click the 'Apply Now' button",
      applyButtonSelectors: [
        '.apply-now',
        'button[class*="apply"]',
        'a[href*="apply"]',
      ],
    };
  }
  if (url.includes('indeed.com')) {
    return {
      portal: 'Indeed',
      instruction: "Click the 'Apply Now' or 'Apply on company site' button",
      applyButtonSelectors: [
        '#indeedApplyButton',
        '.jobsearch-IndeedApplyButton',
        'button[id*="apply"]',
      ],
    };
  }
  return {
    portal: 'Recruiter Website',
    instruction: 'Click the Apply or Apply Now button on this page to open the application form',
    applyButtonSelectors: [
      'a[href*="apply"]',
      'button[class*="apply"]',
      'input[value*="Apply"]',
      'a[class*="apply"]',
      '[id*="apply-btn"]',
      '[class*="apply-now"]',
    ],
  };
}

// ─── Phase 1 Overlay ──────────────────────────────────────────────────────────

async function injectWaitingOverlay(page, portal, job) {
  await page.evaluate((instruction) => {
    const existing = document.getElementById('gcc-waiting-overlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'gcc-waiting-overlay';
    overlay.style.cssText = [
      'position: fixed',
      'top: 0',
      'left: 0',
      'width: 100%',
      'background: #1B2A4A',
      'color: white',
      'padding: 16px 20px',
      'font: 14px Arial, sans-serif',
      'z-index: 999999',
      'box-shadow: 0 4px 12px rgba(0,0,0,0.5)',
      'box-sizing: border-box',
    ].join(';');

    overlay.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:flex-start;">
        <div>
          <div style="font-size:16px;font-weight:bold;color:#F5A623;margin-bottom:6px;">
            🤖 GCC Job Agent — Auto-Fill Ready
          </div>
          <div style="color:white;font-size:14px;margin-bottom:4px;">
            ${instruction}
          </div>
          <div style="color:#cccccc;font-size:12px;margin-bottom:4px;">
            Once the form opens, all fields will be filled automatically within 2 seconds.
          </div>
          <div style="color:#27AE60;font-size:12px;font-weight:bold;margin-bottom:4px;">
            ✅ Ready to fill: Name, Email, Phone, LinkedIn, Location, Salary (AED 18,000), Notice Period, Current Company, Experience
          </div>
          <div style="color:orange;font-size:11px;">
            ⚠️  Visa and work permit fields will be left blank
          </div>
        </div>
        <button id="gcc-waiting-close" style="background:transparent;border:1px solid white;color:white;font-size:16px;cursor:pointer;padding:2px 8px;margin-left:20px;flex-shrink:0;">×</button>
      </div>
    `;

    document.body.insertBefore(overlay, document.body.firstChild);
    document.getElementById('gcc-waiting-close').onclick = () => overlay.remove();
  }, portal.instruction);
}

// ─── Phase 2 — Detect Form and Fill ──────────────────────────────────────────

async function waitForFormAndFill(page, job, portal) {
  const initialUrl = page.url();
  const maxAttempts = 60;

  for (let i = 0; i < maxAttempts; i++) {
    await new Promise(r => setTimeout(r, 1000));

    let formDetected = false;

    try {
      // Check 1: URL changed
      const currentUrl = page.url();
      if (currentUrl !== initialUrl) {
        formDetected = true;
      }

      // Check 2: More than 3 visible input fields
      if (!formDetected) {
        const inputCount = await page.$$eval(
          'input:not([type="hidden"])',
          els => els.filter(el => el.offsetParent !== null).length
        );
        if (inputCount > 3) formDetected = true;
      }

      // Check 3: Any apply button selector has disappeared
      if (!formDetected) {
        for (const sel of portal.applyButtonSelectors) {
          const found = await page.$(sel);
          if (!found) {
            formDetected = true;
            break;
          }
        }
      }
    } catch {
      // Page may be navigating — ignore errors and retry
    }

    if (formDetected) {
      await new Promise(r => setTimeout(r, 1500));
      const filledCount = await fillAllFields(page);
      await injectOverlay(page, filledCount);

      // Update waiting overlay if still present
      await page.evaluate(() => {
        const w = document.getElementById('gcc-waiting-overlay');
        if (w) w.remove();
      });

      console.log(`[formFiller] Form detected and auto-filled: ${filledCount} fields`);
      return;
    }
  }

  // Timeout
  await page.evaluate(() => {
    const w = document.getElementById('gcc-waiting-overlay');
    if (w) {
      const msg = w.querySelector('div > div > div:first-child');
      if (msg) msg.textContent = '⏱️ Form not detected automatically. If you can see a form, the fields may still have been filled. Please check and submit.';
    }
  });
  console.log('[formFiller] Form detection timed out after 60 seconds');
}

// ─── Candidate Data Text Block ────────────────────────────────────────────────

function getCandidateDataAsText() {
  return [
    '=== DHEERAJ THIAGARAJAN — JOB APPLICATION DATA ===',
    `Full Name:        ${CANDIDATE.fullName}`,
    `Email:            ${CANDIDATE.email}`,
    `Phone:            ${CANDIDATE.phone}`,
    `LinkedIn:         ${CANDIDATE.linkedin}`,
    `Location:         ${CANDIDATE.location}`,
    `Notice Period:    ${CANDIDATE.noticePeriod}`,
    `Current Company:  ${CANDIDATE.currentCompany}`,
    `Current Title:    ${CANDIDATE.currentTitle}`,
    `Experience:       ${CANDIDATE.yearsExperience} years`,
    `Expected Salary:  AED 18,000/month`,
    `Current Salary:   GBP 35,000/year`,
    `University:       ${CANDIDATE.university}`,
    `Degree:           MSc Management Finance (Merit) 2025`,
    `Second Uni:       University of Chicago Booth (MBA Exchange)`,
    `Third Uni:        Newcastle University BSc 2021`,
    `NOTE: Do not fill visa or work permit fields`,
    '==================================================',
  ].join('\n');
}

function forceEnglishUrl(url) {
  if (url.includes('linkedin.com')) {
    // Add language parameter to force English
    const separator = url.includes('?') ? '&' : '?';
    url = url + separator + 'locale=en_US';
    // Also replace any Arabic locale if present
    url = url.replace('locale=ar_AE', 'locale=en_US');
    url = url.replace('locale=ar', 'locale=en_US');
  }
  return url;
}

/**
 * Opens the URL, fills all fields, injects the overlay, and leaves the browser open.
 * Returns { filledCount, browser, page }
 */
async function fillForm(url, job) {
  const portal = detectPortal(url);
  console.log(`[formFiller] Opening ${portal.portal} job page...`);

  const isLinkedIn = url.includes('linkedin.com');
  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: null,
    args: [
      '--start-maximized',
      ...(isLinkedIn ? ['--lang=en-US,en', '--accept-lang=en-US,en'] : []),
    ],
  });

  const page = await browser.newPage();
  const englishUrl = forceEnglishUrl(url);
  await page.goto(englishUrl, { waitUntil: 'domcontentloaded' });

  try {
    await page.waitForSelector('body', { timeout: 15000 });
  } catch {
    console.warn('[formFiller] Warning: Page body not found after 15s — continuing anyway.');
  }

  await injectWaitingOverlay(page, portal, job);
  console.log(`[formFiller] ${portal.portal} detected — waiting for user to click Apply button...`);

  // Run Phase 2 in background — do not await
  waitForFormAndFill(page, job, portal).catch(err => {
    console.error('[formFiller] waitForFormAndFill error:', err);
  });

  // Browser intentionally left open
  return { portal: portal.portal, browser, page };
}

/**
 * Main entry point called from the dashboard (Session 20).
 * Input: job object with applyUrl field.
 */
async function autoFillJobApplication(job) {
  return fillForm(job.applyUrl, job);
}

// ─── Exports ──────────────────────────────────────────────────────────────────
module.exports = {
  fillForm,
  fillAllFields,
  injectOverlay,
  autoFillJobApplication,
  detectPortal,
  injectWaitingOverlay,
  waitForFormAndFill,
  getCandidateDataAsText,
};

// ─── Test Block ───────────────────────────────────────────────────────────────
if (require.main === module) {
  // Test 1: detectPortal offline tests
  console.log('\n=== Test 1: detectPortal ===');

  const testA = detectPortal('https://www.linkedin.com/jobs/view/123');
  console.log(`Test A — LinkedIn:          portal = "${testA.portal}"`);

  const testB = detectPortal('https://www.michaelpage.com/job/456');
  console.log(`Test B — Michael Page:      portal = "${testB.portal}"`);

  const testC = detectPortal('https://www.bayt.com/en/job/789');
  console.log(`Test C — Bayt:              portal = "${testC.portal}"`);

  const testD = detectPortal('https://careers.somecompany.com/apply');
  console.log(`Test D — Recruiter Website: portal = "${testD.portal}"`);

  // Test 2: getCandidateDataAsText
  console.log('\n=== Test 2: Candidate Data Text ===');
  console.log(getCandidateDataAsText());

  // Test 3: forceEnglishUrl
  console.log('\n=== Test 3: forceEnglishUrl ===');
  console.log(forceEnglishUrl('https://www.linkedin.com/jobs/view/123'));
  console.log(forceEnglishUrl('https://www.linkedin.com/jobs/view/123?locale=ar_AE'));
  console.log(forceEnglishUrl('https://www.bayt.com/job/456'));

  console.log('\nLinkedIn English language fix applied');
  // Browser test
  console.log('Browser auto-fill ready — call fillForm(url, job) to test manually');
}
