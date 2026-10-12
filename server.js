const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Retrieve your free authentication key loaded inside your Render Environment panel
const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY || "";

// Failsafe deep scanner to find URLs in a complex object when keys mismatch
function deepFindMediaUrls(obj, extracted = []) {
    if (!obj) return extracted;

    if (typeof obj === 'string') {
        if (obj.startsWith('http://') || obj.startsWith('https://')) {
            const isVideo = obj.includes('.mp4') || obj.includes('mp4=') || obj.includes('/v/') || obj.includes('video');
            const isImage = obj.includes('.jpg') || obj.includes('.jpeg') || obj.includes('.png') || obj.includes('.webp') || obj.includes('image');
            
            if (isVideo || isImage) {
                extracted.push({
                    type: isVideo ? 'video' : 'image',
                    url: obj.replace(/\\u0026/g, '&')
                });
            }
        }
    } else if (Array.isArray(obj)) {
        for (const element of obj) {
            deepFindMediaUrls(element, extracted);
        }
    } else if (typeof obj === 'object') {
        for (const key in obj) {
            if (Object.prototype.hasOwnProperty.call(obj, key)) {
                deepFindMediaUrls(obj[key], extracted);
            }
        }
    }
    return extracted;
}

async function fetchMediaViaAllInOneAPI(instagramUrl) {
    if (!RAPIDAPI_KEY) {
        throw new Error("RapidAPI Key configuration missing. Please add RAPIDAPI_KEY inside Render.");
    }

    console.log(`[FastSaver] Querying direct endpoint: ${instagramUrl}`);

    const response = await axios.get('https://rapidapi.com', {
        params: { url: instagramUrl },
        headers: {
            'x-rapidapi-key': RAPIDAPI_KEY,
            'x-rapidapi-host': '://rapidapi.com'
        },
        timeout: 30000
    });

    const data = response.data;
    if (!data) throw new Error("Empty response received from the API endpoint.");

    console.log("[Raw API Response Payload Debug]:", JSON.stringify(data));

    // Safely extract username string from data payloads if present
    const username = data.username || data.author || data.screen_name || "unknown_user";

    let mediaResults = [];

    // Approach 1: Try strict property checking based on documentation structures
    if (data.type === 'album' && Array.isArray(data.items)) {
        mediaResults = data.items.map(item => ({
            type: item.type === 'video' ? 'video' : 'image',
            url: item.download_url || item.url
        }));
    } else if (Array.isArray(data.url)) {
        mediaResults = data.url.map(item => ({
            type: (item.type === 'video' || (item.url && item.url.includes('.mp4'))) ? 'video' : 'image',
            url: item.url || item.download_url || item
        }));
    } else if (data.download_url || data.url) {
        const fallbackLink = data.download_url || data.url;
        if (typeof fallbackLink === 'string') {
            const isVid = data.type === 'video' || fallbackLink.includes('.mp4');
            mediaResults.push({ type: isVid ? 'video' : 'image', url: fallbackLink });
        }
    }

    // Approach 2: Safe Failsafe Scanner (Corrected array length check to fix the silent crash loop)
    if (mediaResults.length === 0) {
        console.log("[Scanner] Strict keys empty or layout undefined. Booting fallback scanner...");
        mediaResults = deepFindMediaUrls(data);
    }

    // Filter out duplicates and invalid strings cleanly
    const seenUrls = new Set();
    const finalCleaned = mediaResults.filter(item => {
        if (!item || !item.url || typeof item.url !== 'string') return false;
        const base = item.url.split('?')[0];
        if (seenUrls.has(base)) return false;
        seenUrls.add(base);
        return true;
    });

    if (finalCleaned.length === 0) {
        throw new Error("Could not isolate direct file properties out of the API response structure.");
    }

    return { username, media: finalCleaned };
}

// 1. Unified Metadata Retrieval API Endpoint
app.post('/api/download', async (req, res) => {
    const { url } = req.body;
    if (!url || (!url.includes('instagram.com') && !url.includes('instagr.am'))) {
        return res.status(400).json({ error: 'Please provide a valid Instagram link.' });
    }
    try {
        const dataObject = await fetchMediaViaAllInOneAPI(url);
        return res.json({ success: true, username: dataObject.username, media: dataObject.media });
    } catch (error) {
        console.error(`Processing error stack:`, error.message);
        return res.status(500).json({ success: false, error: error.message });
    }
});

// 2. STABLE FILE TUNNEL: Streams the target bytes straight onto your device's filesystem folder structure
app.get('/api/proxy-download', async (req, res) => {
    const targetMediaUrl = req.query.url;
    const clientFileName = req.query.filename || 'instagram_download.mp4';

    if (!targetMediaUrl) return res.status(400).send('Missing download parameters.');

    try {
        console.log(`Piping direct local storage attachment download stream...`);
        const cdnResponse = await axios({
            method: 'get',
            url: targetMediaUrl,
            responseType: 'stream',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
        });

        res.setHeader('Content-Disposition', `attachment; filename="${clientFileName}"`);
        res.setHeader('Content-Type', cdnResponse.headers['content-type'] || 'application/octet-stream');

        cdnResponse.data.pipe(res);
    } catch (error) {
        console.error('File stream pipeline failure:', error.message);
        res.status(500).send('Could not compile local media bytes bundle.');
    }
});

app.listen(PORT, () => {
    console.log(`Server running successfully on port ${PORT}`);
});
