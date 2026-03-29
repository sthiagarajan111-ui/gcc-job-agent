// propertyIntel.js – Dubai Property Investment Intelligence
// Mount: app.use('/api/property', require('./propertyIntel'))
const express = require('express');
const router  = express.Router();
const https   = require('https');
const { MongoClient } = require('mongodb');

const RAPIDAPI_KEY  = process.env.RAPIDAPI_KEY || '';
const MONGO_URI     = process.env.MONGODB_URI  || '';
const RAPIDAPI_HOST = 'uae-real-estate-api.p.rapidapi.com';

const TARGET_AREAS = [
  { name:'JVC',                   query:'Jumeirah Village Circle', city:'Dubai'   },
  { name:'JLT',                   query:'Jumeirah Lake Towers',    city:'Dubai'   },
  { name:'Arjan',                 query:'Arjan',                   city:'Dubai'   },
  { name:'Meydan City',           query:'Meydan City',             city:'Dubai'   },
  { name:'Business Bay',          query:'Business Bay',            city:'Dubai'   },
  { name:'Downtown Dubai',        query:'Downtown Dubai',          city:'Dubai'   },
  { name:'Dubai Marina',          query:'Dubai Marina',            city:'Dubai'   },
  { name:'Dubai Hills',           query:'Dubai Hills Estate',      city:'Dubai'   },
  { name:'Silicon Oasis',         query:'Dubai Silicon Oasis',     city:'Dubai'   },
  { name:'International City',    query:'International City',      city:'Dubai'   },
  { name:'Al Furjan',             query:'Al Furjan',               city:'Dubai'   },
  { name:'Dubai South',           query:'Dubai South',             city:'Dubai'   },
  { name:'DIP',                   query:'Dubai Investment Park',   city:'Dubai'   },
  { name:'Dubai Production City', query:'Dubai Production City',   city:'Dubai'   },
  { name:'Tilal City',            query:'Tilal City',              city:'Sharjah' },
];

const ROOM_TYPES = [
  { label:'Studio', rooms:0 },
  { label:'1 BR',   rooms:1 },
  { label:'2 BR',   rooms:2 },
  { label:'3 BR',   rooms:3 },
];

// ── HTTP GET helper ───────────────────────────────────────────
function rapidGet(path) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      { hostname: RAPIDAPI_HOST, path, method:'GET',
        headers:{ 'x-rapidapi-key': RAPIDAPI_KEY, 'x-rapidapi-host': RAPIDAPI_HOST } },
      res => { let d=''; res.on('data',c=>d+=c); res.on('end',()=>{ try{resolve(JSON.parse(d))}catch(e){reject(new Error('Parse:'+d.slice(0,200)))} }); }
    );
    req.on('error', reject);
    req.setTimeout(15000, ()=>{ req.destroy(); reject(new Error('Timeout')); });
    req.end();
  });
}

// ── Get location_id for area name ────────────────────────────
async function getLocationId(query) {
  try {
    const r = await rapidGet(`/autocomplete?query=${encodeURIComponent(query)}`);
    const hits = r?.data || [];
    // Find best match
    const match = hits.find(h =>
      (h.name||'').toLowerCase() === query.toLowerCase()
    ) || hits.find(h =>
      (h.name||'').toLowerCase().includes(query.toLowerCase().split(' ')[0].toLowerCase())
    ) || hits[0];
    return match?.location_id || null;
  } catch(e) {
    console.error(`[PI] location lookup failed "${query}":`, e.message);
    return null;
  }
}

// ── Fetch property listings ───────────────────────────────────
async function fetchProps(locationId, purpose, rooms) {
  try {
    const roomParam = rooms === 0 ? 'bedrooms=0' : `bedrooms=${rooms}`;
    const path = `/uae-re-search-properties?location_id=${locationId}&purpose=${purpose}`
               + `&category=apartments&${roomParam}&page=1&sort=price_asc`;
    const r = await rapidGet(path);
    return r?.data || r?.results || r?.hits || [];
  } catch(e) {
    console.error(`[PI] props failed loc=${locationId} ${purpose} ${rooms}:`, e.message);
    return [];
  }
}

// ── Stats helpers ─────────────────────────────────────────────
const median = a => {
  if (!a.length) return null;
  const s=[...a].sort((x,y)=>x-y), m=Math.floor(s.length/2);
  return s.length%2 ? s[m] : (s[m-1]+s[m])/2;
};
const r1 = n => n!=null ? Math.round(n*10)/10 : null;
const r0 = n => n!=null ? Math.round(n) : null;

function parseProps(hits) {
  return hits.map(h => {
    const price = h.price || h.rental_price || 0;
    const area  = h.area  || h.size || 0;
    return { price, area, psf: price&&area ? r0(price/area) : null };
  }).filter(h => h.price > 1000 && h.area > 50);
}

// ── Build all market rows ─────────────────────────────────────
async function buildRows() {
  const rows = [];

  // Resolve location IDs
  const areaWithIds = [];
  for (const area of TARGET_AREAS) {
    const id = await getLocationId(area.query);
    if (id) { areaWithIds.push({ ...area, id }); console.log(`[PI] ${area.name} → ${id}`); }
    else console.error(`[PI] No ID for ${area.name}`);
    await new Promise(r => setTimeout(r, 400));
  }

  // Fetch listings per area per room type
  for (const area of areaWithIds) {
    for (const rt of ROOM_TYPES) {
      const [saleH, rentH] = await Promise.all([
        fetchProps(area.id, 'for-sale', rt.rooms),
        fetchProps(area.id, 'for-rent',  rt.rooms),
      ]);

      const sales = parseProps(saleH).filter(h => h.price > 50000);
      const rents = parseProps(rentH).filter(h => h.price > 3000);

      if (sales.length < 2 && rents.length < 2) continue;

      const medSalePrice  = median(sales.map(s=>s.price));
      const medSalePsf    = median(sales.map(s=>s.psf).filter(Boolean));
      const medRentAnnual = median(rents.map(r=>r.price));
      const medRentPsf    = median(rents.map(r=>r.psf).filter(Boolean));
      const medSaleArea   = median(sales.map(s=>s.area).filter(Boolean));
      const minPrice      = sales.length ? Math.min(...sales.map(s=>s.price)) : null;
      const maxPrice      = sales.length ? Math.max(...sales.map(s=>s.price)) : null;

      const grossYield = medSalePrice&&medRentAnnual ? r1(medRentAnnual/medSalePrice*100) : null;
      const netYield   = grossYield ? r1(grossYield*0.80) : null;
      const paybackYrs = medSalePrice&&medRentAnnual ? r1(medSalePrice/medRentAnnual) : null;
      const roiScore   = grossYield ? r1(Math.min(grossYield/10*10,10)) : null;

      rows.push({
        area: area.name, city: area.city, rooms: rt.label,
        locationId: area.id,
        saleCount: sales.length, rentCount: rents.length,
        medSalePrice:  r0(medSalePrice),
        medSalePsf:    r0(medSalePsf),
        medTxPsf:      null,
        medRentAnnual: r0(medRentAnnual),
        medRentPsf:    r1(medRentPsf),
        medSaleArea:   r0(medSaleArea),
        minPrice:      r0(minPrice),
        maxPrice:      r0(maxPrice),
        grossYield, netYield, paybackYrs,
        valueSignal: null,
        roiScore,
        fetchedAt: new Date(),
      });
      await new Promise(r => setTimeout(r, 400));
    }
  }
  return rows.sort((a,b)=>(b.grossYield||0)-(a.grossYield||0));
}

// ── MongoDB cache ─────────────────────────────────────────────
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

// ── Routes ────────────────────────────────────────────────────
router.get('/data', async (req, res) => {
  try {
    const cached = await getCached();
    if (cached && new Date(cached.expiresAt) > new Date())
      return res.json({ source:'cache', updatedAt:cached.updatedAt, data:cached.data });
    if (!RAPIDAPI_KEY)
      return res.status(503).json({ error:'RAPIDAPI_KEY not configured.' });
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

// Test route — verify one location lookup
router.get('/test', async (req, res) => {
  if (!RAPIDAPI_KEY) return res.status(503).json({ error:'no key' });
  try {
    const r = await rapidGet('/autocomplete?query=jumeirah+village+circle&platform=bayut');
    const id = r?.data?.[0]?.location_id;
    let props = null;
    if (id) {
      props = await rapidGet(`/uae-re-search-properties?location_id=${id}&purpose=for-sale&category=apartments&bedrooms=1&page=1`);
    }
    res.json({ ok:true, rawLoc:r, locId:id, rawProps:props });
  } catch(e) { res.status(500).json({ error:e.message }); }
});

module.exports = router;
