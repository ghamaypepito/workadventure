const { requireUser } = require('../_lib/requireUser');
const { fetchWam, patchWam } = require('../_lib/mapStorage');

module.exports = async (req, res) => {
    res.setHeader('Content-Type', 'application/json');

    const user = await requireUser(req, res);
    if (!user) return;

    let body = '';
    for await (const chunk of req) body += chunk;
    let areaId;
    try {
        ({ areaId } = JSON.parse(body || '{}'));
    } catch {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: 'Invalid JSON body' }));
        return;
    }
    if (!areaId) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: 'Missing areaId' }));
        return;
    }

    try {
        const wam = await fetchWam();
        const areaIndex = wam.areas.findIndex((a) => a.id === areaId);
        if (areaIndex === -1) {
            res.statusCode = 404;
            res.end(JSON.stringify({ error: 'Seat not found' }));
            return;
        }
        const area = wam.areas[areaIndex];
        const propIndex = area.properties.findIndex((p) => p.type === 'personalAreaPropertyData');
        if (propIndex === -1) {
            res.statusCode = 400;
            res.end(JSON.stringify({ error: 'Not a claimable seat' }));
            return;
        }
        if (area.properties[propIndex].ownerId) {
            res.statusCode = 409;
            res.end(JSON.stringify({ error: 'Seat already claimed' }));
            return;
        }

        await patchWam([
            {
                op: 'replace',
                path: `/areas/${areaIndex}/properties/${propIndex}/ownerId`,
                value: user.email,
            },
        ]);

        res.statusCode = 200;
        res.end(
            JSON.stringify({
                success: true,
                x: area.x + area.width / 2,
                y: area.y + area.height / 2,
            }),
        );
    } catch (err) {
        res.statusCode = 500;
        res.end(JSON.stringify({ error: err.message }));
    }
};
