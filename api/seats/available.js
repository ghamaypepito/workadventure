const { requireUser } = require('../_lib/requireUser');
const { fetchWam } = require('../_lib/mapStorage');

module.exports = async (req, res) => {
    res.setHeader('Content-Type', 'application/json');

    const user = await requireUser(req, res);
    if (!user) return;

    try {
        const wam = await fetchWam();
        const seats = wam.areas
            .map((area) => {
                const prop = area.properties.find((p) => p.type === 'personalAreaPropertyData');
                if (!prop || prop.ownerId) return null;
                return {
                    id: area.id,
                    name: area.name,
                    x: area.x + area.width / 2,
                    y: area.y + area.height / 2,
                };
            })
            .filter(Boolean);

        res.statusCode = 200;
        res.end(JSON.stringify({ seats }));
    } catch (err) {
        res.statusCode = 500;
        res.end(JSON.stringify({ error: err.message }));
    }
};
