// propertyIntel.js – Dubai Property Investment Intelligence
const express = require('express');
const router  = express.Router();
const https   = require('https');
const { MongoClient } = require('mongodb');

const RAPIDAPI_KEY  = process.env.RAPIDAPI_KEY || '';
const MONGO_URI     = process.env.MONGODB_URI  || '';
const RAPIDAPI_HOST = 'bayuut-working-api.p.rapidapi.com';
const PF_HOST       = 'propertyfinder-uae-data.p.rapidapi.com';

const AREAS = [
  { name:'JVC',                   q:'Jumeirah Village Circle', city:'Dubai'   },
  { name:'JLT',                   q:'Jumeirah Lake Towers',    city:'Dubai'   },
  { name:'Arjan',                 q:'Arjan',                   city:'Dubai'   },
  { name:'Meydan City',           q:'Meydan City',             city:'Dubai'   },
  { name:'Business Bay',          q:'Business Bay',            city:'Dubai'   },
  { name:'Downtown Dubai',        q:'Downtown Dubai',          city:'Dubai'   },
  { name:'Dubai Marina',          q:'Dubai Marina',            city:'Dubai'   },
  { name:'Dubai Hills',           q:'Dubai Hills Estate',      city:'Dubai'   },
  { name:'Silicon Oasis',         q:'Dubai Silicon Oasis',     city:'Dubai'   },
  { name:'International City',    q:'International City',      city:'Dubai'   },
  { name:'Al Furjan',             q:'Al Furjan',               city:'Dubai'   },
  { name:'Dubai South',           q:'Dubai South',             city:'Dubai'   },
  { name:'DIP',                   q:'Dubai Investment Park',   city:'Dubai'   },
  { name:'Dubai Production City', q:'Dubai Production City',   city:'Dubai'   },
  { name:'Tilal City',            q:'Tilal City',              city:'Sharjah' },
];

const ROOMS = [
  { label:'Studio', n:0 },
  { label:'1 BR',   n:1 },
  { label:'2 BR',   n:2 },
  { label:'3 BR',   n:3 },
];

function apiGet(host, path) {
  return new Promise(function(resolve, reject) {
    var req = https.request({
      hostname: host, path: path, method: 'GET',
      headers: { 'x-rapidapi-key': RAPIDAPI_KEY, 'x-rapidapi-host': host }
    }, function(res) {
      var d = '';
      res.on('data', function(c) { d += c; });
      res.on('end', function() {
        try { resolve(JSON.parse(d)); }
        catch(e) { reject(new Error('Parse error: ' + d.slice(0,100))); }
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, function() { req.destroy(); reject(new Error('Timeout')); });
    req.end();
  });
}

function sleep(ms) { return new Promise(function(r) { setTimeout(r, ms); }); }

function median(arr) {
  if (!arr || !arr.length) return null;
  var s = arr.slice().sort(function(a,b){ return a-b; });
  var m = Math.floor(s.length/2);
  return s.length%2 ? s[m] : (s[m-1]+s[m])/2;
}
function r0(n) { return n!=null ? Math.round(n) : null; }
function r1(n) { return n!=null ? Math.round(n*10)/10 : null; }

// Bayuut location lookup
async function getBayuutLocId(query) {
  var r = await apiGet(RAPIDAPI_HOST, '/autocomplete?query=' + encodeURIComponent(query));
  var hits = (r && r.data && r.data.hits) ? r.data.hits : [];
  if (!hits.length) { console.error('[PI] No hits for: ' + query); return null; }
  var m = hits.find(function(h){ return (h.name||'').toLowerCase()===query.toLowerCase(); }) || hits[0];
  return m ? (m.externalID || null) : null;
}

// PropertyFinder location lookup (for DLD transactions)
async function getPFLocId(query) {
  try {
    var r = await apiGet(PF_HOST, '/autocomplete-location?query=' + encodeURIComponent(query));
    var hits = (r && Array.isArray(r.data)) ? r.data : [];
    var m = hits.find(function(h){ return (h.name||'').toLowerCase()===query.toLowerCase(); }) || hits[0];
    return m ? m.id : null;
  } catch(e) { return null; }
}

// Bayuut property listings
async function fetchListings(locId, purpose, rooms) {
  var bp = purpose === 'sale' ? 'for-sale' : 'for-rent';
  var path = '/search/property?location_external_id=' + locId
           + '&purpose=' + bp + '&hitsPerPage=50&page=0&category=residential&rooms=' + rooms;
  try {
    var r = await apiGet(RAPIDAPI_HOST, path);
    return (r && r.datan && r.datan.hits) ? r.datan.hits : [];
  } catch(e) { return []; }
}

// DLD actual transactions via PropertyFinder
async function getDLDTx(pfId, beds) {
  try {
    var path = '/get-transactions?location_id=' + pfId
             + '&transaction_type=sold&property_type=apartment&bedrooms=' + beds
             + '&period=1y&sort=newest&page=1';
    var r = await apiGet(PF_HOST, path);
    var attrs = (r && r.data && r.data.data && r.data.data.attributes) ? r.data.data.attributes : null;
    if (!attrs) return null;
    var txs = attrs.transactions || [];
    var psfs   = txs.map(function(t){ return t.price_per_sqft; }).filter(function(p){ return p>50; });
    var prices = txs.map(function(t){ return t.price; }).filter(function(p){ return p>50000; });
    return {
      medTxPsf:   psfs.length   ? r0(median(psfs))   : null,
      medTxPrice: prices.length ? r0(median(prices))  : null,
      txCount:    txs.length,
    };
  } catch(e) { return null; }
}

function parseListings(hits) {
  if (!Array.isArray(hits)) return [];
  return hits.map(function(h) {
    var price   = h.price || 0;
    var areaSqm = h.area  || 0;
    var area    = Math.round(areaSqm * 10.764);
    return { price:price, area:area, psf:(price&&area) ? r0(price/area) : null };
  }).filter(function(h){ return h.price>5000 && h.area>100; });
}

async function buildRows() {
  var rows = [];
  var resolved = [];

  // Step 1: resolve all location IDs
  for (var i=0; i<AREAS.length; i++) {
    var area = AREAS[i];
    try {
      var bayuutId = await getBayuutLocId(area.q);
      await sleep(400);
      var pfId = await getPFLocId(area.q);
      await sleep(400);
      if (bayuutId) {
        resolved.push({ name:area.name, city:area.city, id:bayuutId, pfId:pfId });
        console.log('[PI] ' + area.name + ' -> bayuut:' + bayuutId + ' pf:' + pfId);
      } else {
        console.error('[PI] No ID for ' + area.name);
      }
    } catch(e) {
      console.error('[PI] Error ' + area.name + ': ' + e.message);
    }
  }

  // Step 2: fetch listings + DLD transactions per area per room type
  for (var ai=0; ai<resolved.length; ai++) {
    var a = resolved[ai];
    for (var ri=0; ri<ROOMS.length; ri++) {
      var rt = ROOMS[ri];
      try {
        var saleHits = await fetchListings(a.id, 'sale', rt.n);
        await sleep(400);
        var rentHits = await fetchListings(a.id, 'rent', rt.n);
        await sleep(400);

        var sales = parseListings(saleHits).filter(function(h){ return h.price>50000; });
        var rents = parseListings(rentHits).filter(function(h){ return h.price>3000; });

        if (sales.length < 2 && rents.length < 2) continue;

        var sp = sales.map(function(s){ return s.price; });
        var rp = rents.map(function(r){ return r.price; });
        var msp = median(sp);
        var mrp = median(rp);
        var gy  = (msp && mrp) ? r1(mrp/msp*100) : null;

        // DLD actual transactions
        var dld = null;
        if (a.pfId) {
          try { dld = await getDLDTx(a.pfId, rt.n); await sleep(400); } catch(e) {}
        }
        var medTxPsf = dld ? dld.medTxPsf : null;
        var medSalePsf = r0(median(sales.map(function(s){ return s.psf; }).filter(Boolean)));
        var valueSignal = (medTxPsf && medSalePsf) ? r1((medSalePsf - medTxPsf) / medTxPsf * 100) : null;

        rows.push({
          area: a.name, city: a.city, rooms: rt.label,
          saleCount: sales.length, rentCount: rents.length,
          medSalePrice:  r0(msp),
          medSalePsf:    medSalePsf,
          medTxPsf:      medTxPsf,
          medRentAnnual: r0(mrp),
          medRentPsf:    r1(median(rents.map(function(r){ return r.psf; }).filter(Boolean))),
          medSaleArea:   r0(median(sales.map(function(s){ return s.area; }).filter(Boolean))),
          minPrice:      sp.length ? Math.min.apply(null,sp) : null,
          maxPrice:      sp.length ? Math.max.apply(null,sp) : null,
          grossYield:    gy,
          netYield:      gy ? r1(gy*0.8) : null,
          paybackYrs:    (msp&&mrp) ? r1(msp/mrp) : null,
          valueSignal:   valueSignal,
          roiScore:      gy ? r1(Math.min(gy,10)) : null,
          dldTxCount:    dld ? dld.txCount : null,
          fetchedAt:     new Date(),
        });
        console.log('[PI] OK ' + a.name + ' ' + rt.label + (medTxPsf?' DLD:'+medTxPsf:''));
      } catch(e) {
        console.error('[PI] row error ' + a.name + ' ' + rt.label + ': ' + e.message);
      }
    }
  }

  rows.sort(function(a,b){ return (b.grossYield||0)-(a.grossYield||0); });
  console.log('[PI] Built ' + rows.length + ' rows');
  return rows;
}

async function getCache() {
  if (!MONGO_URI) return null;
  try {
    var c = new MongoClient(MONGO_URI, {serverSelectionTimeoutMS:30000,connectTimeoutMS:30000});
    await c.connect();
    var doc = await c.db('gcc-job-agent').collection('propertyIntel').findOne({_id:'cache'});
    await c.close(); return doc;
  } catch(e) { return null; }
}

async function setCache(data) {
  if (!MONGO_URI) return;
  try {
    var c = new MongoClient(MONGO_URI, {serverSelectionTimeoutMS:30000,connectTimeoutMS:30000});
    await c.connect();
    await c.db('gcc-job-agent').collection('propertyIntel').replaceOne(
      {_id:'cache'},
      {_id:'cache', data:data, updatedAt:new Date(), expiresAt:new Date(Date.now()+12*3600*1000)},
      {upsert:true}
    );
    await c.close();
  } catch(e) { console.error('[PI] cache write: ' + e.message); }
}

router.get('/data', async function(req, res) {
  try {
    var cached = await getCache();
    if (cached && new Date(cached.expiresAt) > new Date())
      return res.json({ source:'cache', updatedAt:cached.updatedAt, data:cached.data });
    if (!RAPIDAPI_KEY) return res.status(503).json({ error:'RAPIDAPI_KEY not set' });
    var data = await buildRows();
    await setCache(data);
    res.json({ source:'live', updatedAt:new Date(), data:data });
  } catch(e) { res.status(500).json({ error:e.message }); }
});

router.post('/refresh', async function(req, res) {
  try {
    if (!RAPIDAPI_KEY) return res.status(503).json({ error:'no key' });
    var data = await buildRows();
    await setCache(data);
    res.json({ success:true, count:data.length, updatedAt:new Date() });
  } catch(e) { res.status(500).json({ error:e.message }); }
});

router.get('/test', async function(req, res) {
  if (!RAPIDAPI_KEY) return res.status(503).json({ error:'no key' });
  try {
    var r = await apiGet(RAPIDAPI_HOST, '/autocomplete?query=Jumeirah+Village+Circle');
    var hits = (r && r.data && r.data.hits) ? r.data.hits : [];
    var id = hits[0] ? hits[0].externalID : null;
    var pfId = await getPFLocId('Jumeirah Village Circle');
    var cnt = 0;
    if (id) {
      var p = await apiGet(RAPIDAPI_HOST, '/search/property?location_external_id='+id+'&purpose=for-sale&hitsPerPage=5&page=0&category=residential&rooms=1');
      cnt = (p && p.datan && p.datan.hits) ? p.datan.hits.length : 0;
    }
    res.json({ ok:true, bayuutId:id, pfId:pfId, propCount:cnt });
  } catch(e) { res.status(500).json({ error:e.message }); }
});

module.exports = router;
