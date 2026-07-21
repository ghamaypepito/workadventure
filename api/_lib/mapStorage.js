const MAP_STORAGE_URL = 'https://map-storage-production-4cf3.up.railway.app';
const MAP_STORAGE_TOKEN = process.env.MAP_STORAGE_API_TOKEN;
const WAM_PATH = '/vings-test/map.wam';

async function fetchWam() {
    const res = await fetch(`${MAP_STORAGE_URL}${WAM_PATH}`);
    if (!res.ok) {
        throw new Error(`Failed to fetch WAM: ${res.status}`);
    }
    return res.json();
}

async function patchWam(operations) {
    const res = await fetch(`${MAP_STORAGE_URL}${WAM_PATH}`, {
        method: 'PATCH',
        headers: {
            Authorization: `Bearer ${MAP_STORAGE_TOKEN}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(operations),
    });
    if (!res.ok) {
        const text = await res.text();
        throw new Error(`Failed to patch WAM: ${res.status} ${text}`);
    }
    return res.json();
}

module.exports = { fetchWam, patchWam };
