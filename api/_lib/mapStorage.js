const MAP_STORAGE_URL = 'https://map-storage-production.up.railway.app';
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

// Resolves a named area (e.g. "Conference 01") from a fetched .wam's areas array into
// its center coordinates, for teleporting a player there. Returns null if no area with
// that exact name exists (e.g. the map was edited and the room was renamed/removed).
function resolveRoomCoordinates(wam, roomName) {
    const area = wam.areas.find((a) => a.name === roomName);
    if (!area) return null;
    return { x: area.x + area.width / 2, y: area.y + area.height / 2 };
}

module.exports = { fetchWam, patchWam, resolveRoomCoordinates };
