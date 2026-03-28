// propertyIntel.js – Dubai Property Investment Intelligence
// Usage: app.use('/api/property', require('./propertyIntel'))
const express = require('express');
const router  = express.Router();
const https   = require('https');
const { MongoClient } = require('mongodb');

const RAPIDAPI_KEY  = process.env.RAPIDAPI_KEY || '';
const MONGO_URI     = process.env.MONGODB_URI  || '';
const RAPIDAPI_HOST = 'bayut.p.rapidapi.com';

const TARGET_AREAS = [
  { name:'JVC',                  slug:'jumeirah-village-circle-jvc',  city:'Dubai'   },
  { name:'JLT',                  slug:'jumeirah-lake-towers-jlt',     city:'Dubai'   },
  { name:'Arjan',                slug:'arjan',                        city:'Dubai'   },
  { name:'Meydan City',          slug:'meydan-city',                  city:'Dubai'   },
  { name:'Business Bay',         slug:'business-bay',                 city:'Dubai'   },
  { name:'Downtown Dubai',       slug:'downtown-dubai',               city:'Dubai'   },
  { name:'Dubai Marina',         slug:'dubai-marina',                 city:'Dubai'   },
  { name:'Dubai Hills',          slug:'dubai-hills-estate',           city:'Dubai'   },
  { name:'Silicon Oasis',        slug:'dubai-silicon-oasis',          city:'Dubai'   },
  { name:'International City',   slug:'international-city',           city:'Dubai'   },
  { name:'Al Furjan',            slug:'al-furjan',                    city:'Dubai'   },
  { name:'Dubai South',          slug:'dubai-south',                  city:'Dubai'   },
  { name:'DIP',                  slug:'dubai-investment-park-dip',    city:'Dubai'   },
  { name:'Dubai Production City',slug:'dubai-production-city-impz',   city:'Dubai'   },
  { name:'Tilal City',           slug:'tilal-city',                   city:'Sharjah' },
];

const ROOM_TYPES = [
  { label:'Studio', rooms:0 },
  { label:'1 BR',   rooms:1 },
  { label:'2 BR',   rooms:2 },
  { label:'3 BR',   rooms:3 },
];

function rapidGet(path) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      { hostname: RAPIDAPI_HOST, path, method:'GET',
        headers:{ 'x-rapidapi-key': RAPIDAPI_KEY, 'x-rapidapi-host': RAPIDAPI_HOST } },
      res => {
        let d = '';
        res.on('data', c => d += c);
        res.on('end', () => {
          try { resolve(JSON.parse(d)); }
          catch(e) { reject(new Error('Parse: ' + d.slice(0,120))); }
        });
      }
    );
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('Timeout')); });
    req.end();
  });
}

async function fetchListings(slug, purpose, rooms) {
  const rp = rooms === 0 ? 'rooms=0' : `rooms=${rooms}`;
  const p  = `/properties/list?locationSlug=${slug}&purpose=${purpose}`
           + `&categoryExternalID=4&${rp}&hitsPerPage=50&page=0&lang=en&sort=price_asc`;
  try { const r = await rapidGet(p); return r.hits || []; }
  catch(e) { console.error(`[PI] ${slug} ${purpose} ${rooms}:`, e.message); return []; }
}

async function fetchTransactions(slug, rooms) {
  const rp = rooms === 0 ? 'bedrooms=0' : `bedrooms=${rooms}`;
  const p  = `/transactions/list?locationSlug=${slug}&categoryExternalID=4`
           + `&${rp}&hitsPerPage=50&page=0&lang=en`;
  try { const r = await rapidGet(p); return r.hits || []; }
  catch(e) { console.error(`[PI] tx ${slug} ${rooms}:`, e.message); return []; }
}

const median = a => {
  if (!a.length) return null;
  const s = [...a].sort((x,y)=>x-y), m = Math.floor(s.length/2);
  return s.length%2 ? s[m] : (s[m-1]+s[m])/2;
};
const r1 = n => n !== null ? Math.round(n*10)/10 : null;
const r0 = n => n !== null ? Math.round(n) : null;

async function buildRows() {
  const rows = [];
  for (const area of TARGET_AREAS) {
    for (const rt of ROOM_TYPES) {
      const [saleH, rentH, txH] = await Promise.all([
        fetchListings(area.slug, 'for-sale', rt.rooms),
        fetchListings(area.slug, 'for-rent', rt.rooms),
        fetchTransactions(area.slug, rt.rooms),
      ]);

      const sales = saleH
        .map(h => ({ price:h.price||0, area:h.area||0, psf: h.price&&h.area ? r0(h.price/h.area) : null }))
        .filter(h => h.price>50000 && h.area>100);
      const rents = rentH
        .map(h => ({ price:h.price||0, area:h.area||0, psf: h.price&&h.area ? r1(h.price/h.area) : null }))
        .filter(h => h.price>5000 && h.area>100);
      const txs = txH
        .map(h => ({ price:h.transactionValue||0, area:h.area||0, psf: h.transactionValue&&h.area ? r0(h.transactionValue/h.area) : null }))
        .filter(h => h.price>50000 && h.area>100);

      if (sales.length < 2 && rents.length < 2) continue;

      const medSalePrice  = median(sales.map(s=>s.price));
      const medSalePsf    = median(sales.map(s=>s.psf).filter(Boolean));
      const medRentAnnual = median(rents.map(r=>r.price));
      const medRentPsf    = median(rents.map(r=>r.psf).filter(Boolean));
      const medTxPsf      = median(txs.map(t=>t.psf).filter(Boolean));
      const medSaleArea   = median(sales.map(s=>s.area).filter(Boolean));
      const minPrice      = sales.length ? Math.min(...sales.map(s=>s.price)) : null;
      const maxPrice      = sales.length ? Math.max(...sales.map(s=>s.price)) : null;

      const grossYield = medSalePrice && medRentAnnual ? r1(medRentAnnual/medSalePrice*100) : null;
      const netYield   = grossYield ? r1(grossYield*0.80) : null;
      const paybackYrs = medSalePrice && medRentAnnual ? r1(medSalePrice/medRentAnnual) : null;
      // valueSignal: negative = listing below DLD actual transactions = good value
      const valueSignal = medTxPsf && medSalePsf ? r1((medSalePsf-medTxPsf)/medTxPsf*100) : null;
      // ROI score /10
      const yScore = grossYield ? Math.min(grossYield/10*6,6) : 0;
      const vScore = valueSignal!==null ? Math.min(Math.max((-valueSignal/20)*4,0),4) : 2;
      const roiScore = r1(yScore+vScore);

      rows.push({
        area: area.name, city: area.city, rooms: rt.label,
        saleCount: sales.length, rentCount: rents.length, txCount: txs.length,
        medSalePrice:  r0(medSalePrice),
        medSalePsf:    r0(medSalePsf),
        medRentAnnual: r0(medRentAnnual),
        medRentPsf:    r1(medRentPsf),
        medTxPsf:      r0(medTxPsf),
        medSaleArea:   r0(medSaleArea),
        minPrice:      r0(minPrice),
        maxPrice:      r0(maxPrice),
        grossYield, netYield, paybackYrs, valueSignal, roiScore,
        fetchedAt: new Date(),
      });
      await new Promise(r => setTimeout(r, 350));
    }
  }
  return rows.sort((a,b) => (b.grossYield||0)-(a.grossYield||0));
}

async function getCached() {
  if (!MONGO_URI) return null;
  try {
    const c = new MongoClient(MONGO_URI); await c.connect();
    const doc = await c.db('gcc-job-agent').collection('propertyIntel').findOne({_id:'cache'});
    await c.close(); return doc;
  } catch(e) { return null; }
}

async function setCache(data) {
  if (!MONGO_URI) return;
  try {
    const c = new MongoClient(MONGO_URI); await c.connect();
    await c.db('gcc-job-agent').collection('propertyIntel').replaceOne(
      {_id:'cache'},
      {_id:'cache', data, updatedAt:new Date(), expiresAt:new Date(Date.now()+12*3600*1000)},
      {upsert:true}
    );
    await c.close();
  } catch(e) { console.error('[PI] cache write:', e.message); }
}

router.get('/data', async (req, res) => {
  try {
    const cached = await getCached();
    if (cached && new Date(cached.expiresAt) > new Date())
      return res.json({ source:'cache', updatedAt:cached.updatedAt, data:cached.data });
    if (!RAPIDAPI_KEY)
      return res.status(503).json({ error:'RAPIDAPI_KEY not configured in Render environment variables.' });
    const data = await buildRows();
    await setCache(data);
    res.json({ source:'live', updatedAt:new Date(), data });
  } catch(e) { res.status(500).json({ error:e.message }); }
});

router.post('/refresh', async (req, res) => {
  try {
    if (!RAPIDAPI_KEY) return res.status(503).json({ error:'RAPIDAPI_KEY not set.' });
    const data = await buildRows();
    await setCache(data);
    res.json({ success:true, count:data.length, updatedAt:new Date() });
  } catch(e) { res.status(500).json({ error:e.message }); }
});

module.exports = router;
